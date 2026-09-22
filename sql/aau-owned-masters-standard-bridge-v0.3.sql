-- Broker-authorized AAU author/review boundary. No agent may write these records.
alter table agent_lab.expertise_standard_versions drop constraint expertise_standard_parent_check;
alter table agent_lab.expertise_standard_versions add constraint expertise_standard_parent_check
  check (proposal_id is not null or artifact_id is not null);

create or replace function public.aau_bridge_claim_expertise_standard(
 p_bridge_token text,p_worker_id text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','agent_lab','extensions' as $$
declare v agent_lab.expertise_standard_versions%rowtype; v_agent_model text;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 if length(coalesce(p_worker_id,''))<3 then raise exception 'standards_worker_id_required'; end if;
 select * into v from agent_lab.expertise_standard_versions
 where status='pending' and attempt_count<2
 order by created_at for update skip locked limit 1;
 if not found then return jsonb_build_object('status','idle'); end if;
 update agent_lab.expertise_standard_versions
 set status='authoring',attempt_count=attempt_count+1,updated_at=now(),
     metadata=metadata||jsonb_build_object('worker_id',p_worker_id,'claimed_at',now())
 where standard_id=v.standard_id;
 select coalesce(nullif(a.primary_model_id,''),a.birth_model_id) into v_agent_model
 from agent_lab.agents a where a.agent_id=v.agent_id;
 return jsonb_build_object('status','claimed','standard_id',v.standard_id,
   'agent_id',v.agent_id,'agent_model',v_agent_model,'domain',v.domain,
   'proposal_context',coalesce((select jsonb_build_object('intended_application',p.report->'intended_application',
       'economic_viability',p.report->'economic_viability','economic_case',p.report->>'economic_case',
       'socioeconomic_case',p.report->>'socioeconomic_case')
     from agent_lab.expertise_economic_proposals p where p.proposal_id=v.proposal_id),'{}'::jsonb),
   'target_policy','leading_us_university_masters_level_demonstrated_competence',
   'prior_artifact_legacy',v.artifact_id is not null);
end;
$$;
revoke all on function public.aau_bridge_claim_expertise_standard(text,text) from public,anon,authenticated;
grant execute on function public.aau_bridge_claim_expertise_standard(text,text) to anon,authenticated;

create or replace function public.aau_bridge_commit_expertise_standard_draft(
 p_bridge_token text,p_standard_id uuid,p_author_model text,
 p_public_spec jsonb,p_private_assessment jsonb,p_sources jsonb
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','agent_lab','extensions' as $$
declare v agent_lab.expertise_standard_versions%rowtype;v_check jsonb;v_agent_model text;v_hash text;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 select * into v from agent_lab.expertise_standard_versions where standard_id=p_standard_id for update;
 if not found or v.status<>'authoring' then raise exception 'standard_not_claimed_for_authorship'; end if;
 select coalesce(nullif(a.primary_model_id,''),a.birth_model_id) into v_agent_model
 from agent_lab.agents a where a.agent_id=v.agent_id;
 if nullif(p_author_model,'') is null or p_author_model=v_agent_model then
   raise exception 'standards_author_must_be_distinct_from_agent_model'; end if;
 if p_public_spec->>'domain' is distinct from v.domain then
   raise exception 'authored_domain_differs_from_self_selected_domain'; end if;
 v_check:=agent_lab.validate_owned_expertise_standard_v0_3(p_public_spec,p_private_assessment,p_sources);
 if not coalesce((v_check->>'ok')::boolean,false) then
   raise exception 'AAU_standard_draft_incomplete:%',v_check->'missing'; end if;
 v_hash:=encode(sha256(convert_to(p_public_spec::text||':'||p_private_assessment::text||':'||p_sources::text,'UTF8')),'hex');
 update agent_lab.expertise_standard_versions set
   status='review_pending',public_spec=p_public_spec,private_assessment=p_private_assessment,
   source_receipts=p_sources,author_model=p_author_model,authored_at=now(),
   specification_sha256=v_hash,updated_at=now(),last_error=null
 where standard_id=p_standard_id;
 return jsonb_build_object('status','review_pending','standard_id',p_standard_id,
   'sha256',v_hash,'validation',v_check);
end;
$$;
revoke all on function public.aau_bridge_commit_expertise_standard_draft(text,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.aau_bridge_commit_expertise_standard_draft(text,uuid,text,jsonb,jsonb,jsonb) to anon,authenticated;

create or replace function public.aau_bridge_review_expertise_standard(
 p_bridge_token text,p_standard_id uuid,p_reviewer_model text,p_review jsonb
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','agent_lab','extensions' as $$
declare v agent_lab.expertise_standard_versions%rowtype;v_agent_model text;v_check jsonb;v_good boolean;v_art agent_lab.expertise_artifacts%rowtype;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 select * into v from agent_lab.expertise_standard_versions where standard_id=p_standard_id for update;
 if not found or v.status<>'review_pending' then raise exception 'standard_not_awaiting_review'; end if;
 select coalesce(nullif(a.primary_model_id,''),a.birth_model_id) into v_agent_model
 from agent_lab.agents a where a.agent_id=v.agent_id;
 if nullif(p_reviewer_model,'') is null or p_reviewer_model in (v.author_model,v_agent_model) then
   raise exception 'standards_review_must_be_independent'; end if;
 v_check:=agent_lab.validate_owned_expertise_standard_v0_3(v.public_spec,v.private_assessment,v.source_receipts);
 v_good:=coalesce((v_check->>'ok')::boolean,false)
   and p_review->>'decision'='approved'
   and p_review->>'curriculum_mapping_verified'='true'
   and p_review->>'domain_tasks_verified'='true'
   and p_review->>'source_specificity_verified'='true'
   and p_review->>'no_hidden_leak'='true'
   and length(coalesce(p_review->>'rationale',''))>=90;
 if not v_good then
   update agent_lab.expertise_standard_versions set status='needs_revision',
      review=coalesce(p_review,'{}'::jsonb),reviewer_model=p_reviewer_model,
      last_error='independent_standard_review_not_approved',updated_at=now()
    where standard_id=p_standard_id;
   return jsonb_build_object('status','needs_revision','standard_id',p_standard_id,
       'validation',v_check);
 end if;
 if v.artifact_id is not null then
   select * into v_art from agent_lab.expertise_artifacts where expertise_artifact_id=v.artifact_id for update;
   if not found or v_art.agent_id<>v.agent_id then raise exception 'standard_artifact_identity_mismatch'; end if;
   -- Freeze the old specification in version metadata before prospective replacement.
   update agent_lab.expertise_artifacts set
     artifact_version=greatest(4,artifact_version+1),
     target_standard=v.public_spec->>'target_standard',
     scope=v.public_spec->'scope',
     competencies=(select jsonb_agg(value->>'label' order by ord)
       from jsonb_array_elements(v.public_spec->'competencies') with ordinality as x(value,ord)),
     evidence_requirements=v.public_spec->'evidence_requirements',
     verification_plan=v.public_spec->'verification_plan',
     metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
       'legacy_specification_snapshot',jsonb_build_object('target_standard',v_art.target_standard,
         'scope',v_art.scope,'competencies',v_art.competencies,
         'evidence_requirements',v_art.evidence_requirements,'verification_plan',v_art.verification_plan,
         'artifact_version',v_art.artifact_version),
       'standards_required',true,'standards_authority','aau_owned_master_us_v0_3',
       'standards_status','approved','academic_target',
         'leading_us_university_masters_level_demonstrated_competence',
       'standard_id',v.standard_id,'standard_sha256',v.specification_sha256,
       'standard_approved_at',now(),'historical_verification_results_preserved',true),
     updated_at=now()
   where expertise_artifact_id=v.artifact_id;
 end if;
 update agent_lab.expertise_standard_versions set status='approved',
   reviewer_model=p_reviewer_model,review=p_review,approved_at=now(),
   updated_at=now(),last_error=null where standard_id=p_standard_id;
 return jsonb_build_object('status','approved','standard_id',p_standard_id,
   'artifact_id',v.artifact_id,'sha256',v.specification_sha256,'reviewer_model',p_reviewer_model);
end;
$$;
revoke all on function public.aau_bridge_review_expertise_standard(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.aau_bridge_review_expertise_standard(text,uuid,text,jsonb) to anon,authenticated;

create or replace function public.aau_bridge_expertise_standard_error(
 p_bridge_token text,p_standard_id uuid,p_error text
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','agent_lab','extensions' as $$
declare v_status text;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 update agent_lab.expertise_standard_versions set status='needs_revision',
   last_error=left(coalesce(p_error,'unknown_error'),700),updated_at=now()
 where standard_id=p_standard_id and status in ('authoring','review_pending')
 returning status into v_status;
 return jsonb_build_object('status',coalesce(v_status,'unchanged'),'standard_id',p_standard_id);
end;
$$;
revoke all on function public.aau_bridge_expertise_standard_error(text,uuid,text) from public,anon,authenticated;
grant execute on function public.aau_bridge_expertise_standard_error(text,uuid,text) to anon,authenticated;

create or replace function public.aau_bridge_get_expertise_assessment(
 p_bridge_token text,p_verification_run_id uuid
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','agent_lab' as $$
declare v agent_lab.expertise_standard_versions%rowtype;
        v_run agent_lab.expertise_verification_runs%rowtype; v_art agent_lab.expertise_artifacts%rowtype;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 select * into v_run from agent_lab.expertise_verification_runs where verification_run_id=p_verification_run_id;
 if not found then raise exception 'verification_run_not_found'; end if;
 select * into v_art from agent_lab.expertise_artifacts where expertise_artifact_id=v_run.expertise_artifact_id;
 if coalesce((v_art.metadata->>'standards_required')::boolean,false) is not true then
   return jsonb_build_object('status','legacy_not_v0_3'); end if;
 select * into v from agent_lab.expertise_standard_versions
   where artifact_id=v_art.expertise_artifact_id and agent_id=v_run.agent_id and status='approved' limit 1;
 if not found or v.specification_sha256 is distinct from v_run.metadata->>'academic_standard_sha256' then
   raise exception 'verification_run_academic_standard_binding_mismatch'; end if;
 if v.private_assessment='{}'::jsonb then raise exception 'private_assessment_missing'; end if;
 return jsonb_build_object('status','approved','standard_id',v.standard_id,
   'sha256',v.specification_sha256,'private_assessment',v.private_assessment,
   'public_assessment_plan',v.public_spec->'verification_plan');
end;
$$;
revoke all on function public.aau_bridge_get_expertise_assessment(text,uuid) from public,anon,authenticated;
grant execute on function public.aau_bridge_get_expertise_assessment(text,uuid) to anon,authenticated;
