CREATE OR REPLACE FUNCTION public.aau_bridge_claim_expertise_standard(p_bridge_token text, p_worker_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v agent_lab.expertise_standard_versions%rowtype; v_agent_model text;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 if length(coalesce(p_worker_id,''))<3 then raise exception 'standards_worker_id_required'; end if;
 select * into v from agent_lab.expertise_standard_versions
 where status='pending' and attempt_count<4
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
   'prior_artifact_legacy',v.artifact_id is not null,
   'checkpoint_public_spec',v.public_spec,
   'checkpoint_private_assessment',v.private_assessment,
   'checkpoint_sources',v.source_receipts,
   'checkpoint_author_model',v.author_model);
end;
$function$
;
