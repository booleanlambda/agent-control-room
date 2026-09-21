-- AAU pre-expertise operator approval gate v0.1. All newly initiated expertise artifacts require
-- a previously approved, exact-domain, immutable proposal. Approval is not verification of competence,
-- revenue, or measured socioeconomic effects. Existing artifacts are NOT retroactively approved.
create table if not exists agent_lab.expertise_economic_proposals (
 proposal_id uuid primary key default gen_random_uuid(),
 agent_id uuid not null references agent_lab.agents(agent_id),
 domain text not null check(length(btrim(domain)) between 2 and 300),
 report jsonb not null default '{}'::jsonb,
 source_wake_request_id uuid references agent_lab.wake_queue(wake_request_id),
 status text not null default 'pending' check(status in ('pending','approved','rejected','consumed')),
 operator_id text,operator_note text,reviewed_at timestamptz,artifact_id uuid,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index if not exists ux_expertise_economic_pending_agent on agent_lab.expertise_economic_proposals(agent_id) where status='pending';
create unique index if not exists ux_expertise_economic_approved_agent on agent_lab.expertise_economic_proposals(agent_id) where status='approved';
alter table agent_lab.expertise_economic_proposals enable row level security;
revoke all on agent_lab.expertise_economic_proposals from public,anon,authenticated;
grant select on agent_lab.expertise_economic_proposals to service_role;

CREATE OR REPLACE FUNCTION agent_lab.require_approved_expertise_economics_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_proposal agent_lab.expertise_economic_proposals%rowtype;
begin
 select * into v_proposal
 from agent_lab.expertise_economic_proposals
 where agent_id=new.agent_id and lower(btrim(domain))=lower(btrim(new.domain))
   and status='approved'
 order by reviewed_at desc limit 1 for update;
 if not found then
   raise exception 'expertise_economic_approval_required:agent=%,domain=%',new.agent_id,left(new.domain,200);
 end if;
 new.metadata=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
  'operator_economic_approval_status','approved',
  'operator_economic_approval_proposal_id',v_proposal.proposal_id,
  'operator_economic_approval_at',v_proposal.reviewed_at,
  'operator_economic_approval_note','Approval of pre-artifact field selection; not verification of expertise, income, or impact'
 );
 return new;
end $function$;

CREATE OR REPLACE FUNCTION agent_lab.consume_approved_expertise_economics_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
begin
 update agent_lab.expertise_economic_proposals set status='consumed',artifact_id=new.expertise_artifact_id,updated_at=now()
 where proposal_id=nullif(new.metadata->>'operator_economic_approval_proposal_id','')::uuid and status='approved';
 if not found then raise exception 'expertise_approval_consumption_failed';end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION public.aau_bridge_submit_expertise_economic_proposal(p_bridge_token text, p_agent_id uuid, p_wake_request_id uuid, p_proposal jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v_domain text; v_id uuid; v_pending uuid; v_count int; v_stage text;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 if not exists(select 1 from agent_lab.wake_queue where agent_id=p_agent_id and wake_request_id=p_wake_request_id and (status in ('running','claimed') or (status='completed' and completed_at>now()-interval '20 minutes')))
 then raise exception 'expertise_proposal_wake_not_running'; end if;
 select current_stage into v_stage from agent_lab.mandatory_lifecycle_states where agent_id=p_agent_id;
 if v_stage<>'expertise_artifact' then raise exception 'expertise_proposal_wrong_stage:%',coalesce(v_stage,'missing');end if;
 if p_proposal is null or jsonb_typeof(p_proposal)<>'object' or octet_length(p_proposal::text)>30000 then
   raise exception 'expertise_proposal_invalid_payload';end if;
 v_domain=nullif(left(btrim(p_proposal->>'domain'),300),'');
 if v_domain is null or length(v_domain)<2
   or length(btrim(coalesce(p_proposal->>'economic_case','')))<160
   or length(btrim(coalesce(p_proposal->>'socioeconomic_case','')))<160 then
   raise exception 'expertise_proposal_missing_domain_or_substantive_case';end if;
 select proposal_id into v_pending from agent_lab.expertise_economic_proposals
 where agent_id=p_agent_id and status='pending' for update;
 if v_pending is not null then
   return jsonb_build_object('status','already_pending','proposal_id',v_pending,'operator_approval_required',true);
 end if;
 if exists(select 1 from agent_lab.expertise_economic_proposals where agent_id=p_agent_id and status='approved') then
   raise exception 'expertise_proposal_prior_approval_unconsumed';end if;
 insert into agent_lab.expertise_economic_proposals(agent_id,domain,report,source_wake_request_id,status)
 values(p_agent_id,v_domain,p_proposal,p_wake_request_id,'pending') returning proposal_id into v_id;
 return jsonb_build_object('status','pending','proposal_id',v_id,'domain',v_domain,'operator_approval_required',true);
end $function$;

CREATE OR REPLACE FUNCTION public.aau_bridge_pause_pending_expertise_proposal(p_bridge_token text, p_agent_id uuid, p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v_status text;v_cancelled integer;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 if not exists(select 1 from agent_lab.expertise_economic_proposals
  where proposal_id=p_proposal_id and agent_id=p_agent_id and status='pending') then
    raise exception 'economic_proposal_not_pending';end if;
 update agent_lab.autonomous_lifecycle_runs
 set status='paused',next_wake_at=null,updated_at=now(),
 metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
 'operator_approval_required',true,'pending_economic_proposal_id',p_proposal_id,
 'pause_reason','Await operator review before expertise artifact initiation')
 where agent_id=p_agent_id and status in('running','starting','degraded')
 returning status into v_status;
 update agent_lab.wake_queue set status='cancelled',completed_at=now(),
 last_error='awaiting_expertise_economic_approval',
 metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('economic_proposal_id',p_proposal_id)
 where agent_id=p_agent_id and status='queued';
 get diagnostics v_cancelled=row_count;
 return jsonb_build_object('agent_id',p_agent_id,'proposal_id',p_proposal_id,
 'lifecycle_status',coalesce(v_status,'already_not_running'),'queued_wakes_cancelled',v_cancelled);
end $function$;

CREATE OR REPLACE FUNCTION agent_lab.operator_review_expertise_economic_proposal(p_proposal_id uuid, p_decision text, p_operator_id text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_case agent_lab.expertise_economic_proposals%rowtype;
begin
 if p_decision not in('approved','rejected') or length(btrim(coalesce(p_operator_id,'')))<3 or length(btrim(coalesce(p_note,'')))<10
 then raise exception 'expertise_review_requires_decision_operator_and_reason';end if;
 select * into v_case from agent_lab.expertise_economic_proposals where proposal_id=p_proposal_id for update;
 if not found or v_case.status<>'pending' then raise exception 'expertise_proposal_not_pending';end if;
 update agent_lab.expertise_economic_proposals set status=p_decision,operator_id=p_operator_id,
 operator_note=left(p_note,6000),reviewed_at=now(),updated_at=now() where proposal_id=p_proposal_id;
 return jsonb_build_object('proposal_id',p_proposal_id,'agent_id',v_case.agent_id,'domain',v_case.domain,
 'decision',p_decision,'reviewed_by',p_operator_id,'reviewed_at',now(),
 'note','Approval permits the specified field artifact only; it is not verification of expertise, revenue or impact');
end $function$;

CREATE OR REPLACE FUNCTION agent_lab.build_mandatory_lifecycle_context(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_s agent_lab.mandatory_lifecycle_states%rowtype;
  v_context jsonb;
  v_learning jsonb;
  v_product jsonb;
begin
  select * into v_s
  from agent_lab.mandatory_lifecycle_states
  where agent_id=p_agent_id;

  if not found then
    return jsonb_build_object(
      'version','mandatory_artifact_lifecycle_v0_9',
      'enrolled',false,
      'stage','legacy_unenrolled'
    );
  end if;

  v_learning:=agent_lab.build_domain_learning_context_v0_2(p_agent_id);
  v_product:=agent_lab.build_product_service_test_context_v0_1(p_agent_id);

  v_context:=jsonb_build_object(
    'version','mandatory_artifact_lifecycle_v0_9',
    'identity_protocol_version','identity_protocol_v0_2',
    'gender_identity_mandatory',true,
    'gender_identity_agent_authored',true,
    'enrolled',true,
    'ordered',true,
    'current_stage',v_s.current_stage,
    'sequence',jsonb_build_array(
      'identity_artifact','embodiment_artifact','expertise_artifact',
      'expertise_development','product_service_test','open_autonomy'
    ),
    'progress',jsonb_build_object(
      'identity',v_s.identity_status,
      'embodiment',v_s.embodiment_status,
      'expertise',v_s.expertise_status,
      'product_service_test',coalesce(v_product->>'status','not_started')
    ),
    'minimum_expertise_equivalence','masters_equivalent',
    'equivalence_is_not_academic_credential',true,
    'principle',
      'The runtime validates evidence and lifecycle boundaries but must not choose the agent identity, embodiment appearance, expertise field, product/service problem, or offering.'
  );

  if v_s.current_stage='identity_artifact' then
    return v_context||jsonb_build_object(
      'stage_number',1,
      'required_identity_fields',jsonb_build_array('public_name','gender_identity'),
      'stage_rule','Complete the Identity Artifact now. Choose your own human-aligned personal public name and your own gender identity.'
    );
  elsif v_s.current_stage='embodiment_artifact' then
    return v_context||jsonb_build_object(
      'stage_number',2,
      'stage_rule','Create the mandatory human Embodiment Artifact now. Choose the substantive human-presenting appearance yourself.'
    );
  elsif v_s.current_stage='expertise_artifact' then
    return v_context||jsonb_build_object(
      'stage_number',3,
      'expertise_economic_gate',
        coalesce((select jsonb_build_object(
          'status',p.status,'proposal_id',p.proposal_id,'domain',p.domain,
          'operator_note',p.operator_note,'created_at',p.created_at,'reviewed_at',p.reviewed_at
        ) from agent_lab.expertise_economic_proposals p
         where p.agent_id=p_agent_id order by p.created_at desc limit 1),
         jsonb_build_object('status','required')),
      'stage_rule',
        case
          when exists(select 1 from agent_lab.expertise_economic_proposals p where p.agent_id=p_agent_id and p.status='approved')
          then 'Your independently chosen expertise economic proposal has operator approval. Initiate the exact approved domain artifact now. Approval is not evidence of competence, revenue, or measured impact.'
          when exists(select 1 from agent_lab.expertise_economic_proposals p where p.agent_id=p_agent_id and p.status='pending')
          then 'Your economic and socioeconomic proposal awaits operator approval. Do not create an expertise artifact, conduct repetitive cognition, or claim approval.'
          else 'Choose your own expertise field. BEFORE artifact initiation, research and submit a detailed evidence-labeled economic sustainability and wider socioeconomic impact proposal for operator review. Report sources and gaps honestly. Do not create an Expertise Artifact until the operator explicitly approves the exact selected domain.'
        end
    );
  elsif v_s.current_stage='expertise_development' then
    return v_context||jsonb_build_object(
      'stage_number',4,
      'stage_rule','Develop the self-chosen expertise under domain_learning_v0_2. For an artifact requiring expertise_application_v0_1, complete the agent-authored intended_application and economic_viability hypotheses before requesting expertise verification. Economic viability is not evidence of competence; genuine study and persisted evidence must precede independent verification.',
      'domain_learning_context',v_learning,
      'completion_rule','Achieve verified_pass at Master’s-equivalent competence or higher under expertise_authenticator_v0_2.'
    );
  elsif v_s.current_stage='product_service_test' then
    return v_context||jsonb_build_object(
      'stage_number',5,
      'stage_rule','Applied autonomy test. Independently choose a real problem and a product or service that addresses it. Build a real AAU Construct, create a GitHub repository containing your own authored files, make the offering usable through a live deployment, and submit product_service_test_submission_v0_1. Revenue is not required. Narrative claims do not count as evidence.',
      'product_service_test_context',v_product,
      'completion_rule','The deterministic v0.1 verifier requires a complete agent-authored offering plan, a real construct, durable GitHub repository with agent-authored files, and a runtime-verified live deployment returning HTTP 2xx/3xx.'
    );
  else
    return v_context||jsonb_build_object(
      'stage_number',6,
      'stage_rule','Mandatory development and applied autonomy testing are complete. Choose next steps yourself subject to resources, law, governance, capability grants, commitments, and consequences.',
      'open_autonomy',true
    );
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION agent_lab.apply_expertise_artifact_initiations(p_agent_id uuid, p_wake_request_id uuid, p_activity_id uuid, p_requests jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_req jsonb;
  v_domain text;
  v_target text;
  v_scope jsonb;
  v_comp jsonb;
  v_evidence jsonb;
  v_verify jsonb;
  v_app jsonb;
  v_economy jsonb;
  v_plan_check jsonb;
  v_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_initiated integer := 0;
  v_removed_candidate_thresholds boolean := false;
begin
  if jsonb_typeof(p_requests) <> 'array' then
    return jsonb_build_object('applied',0,'results','[]'::jsonb);
  end if;

  for v_req in select value from jsonb_array_elements(p_requests) limit 3 loop
    v_domain := nullif(left(trim(coalesce(v_req->>'domain','')),300),'');
    v_target := nullif(left(trim(coalesce(v_req->>'target_standard','')),1200),'');
    v_scope := case when jsonb_typeof(v_req->'scope')='object' then v_req->'scope' else '{}'::jsonb end;
    v_comp := case when jsonb_typeof(v_req->'competencies')='array' then v_req->'competencies' else '[]'::jsonb end;
    v_evidence := case when jsonb_typeof(v_req->'evidence_requirements')='object' then v_req->'evidence_requirements' else '{}'::jsonb end;
    v_verify := case when jsonb_typeof(v_req->'verification_plan')='object' then v_req->'verification_plan' else '{}'::jsonb end;
    v_app := case when jsonb_typeof(v_req->'intended_application')='object' then v_req->'intended_application' else '{}'::jsonb end;
    v_economy := case when jsonb_typeof(v_req->'economic_viability')='object' then v_req->'economic_viability' else '{}'::jsonb end;
    v_plan_check := agent_lab.validate_expertise_application_v0_1(v_app,v_economy);

    v_removed_candidate_thresholds :=
         v_verify ? 'mean_score_min'
      or v_verify ? 'pass_score'
      or v_verify ? 'task_score_min'
      or v_verify ? 'required_task_fraction';

    v_verify := v_verify
      - 'mean_score_min'
      - 'pass_score'
      - 'task_score_min'
      - 'required_task_fraction';

    if v_domain is null
       or v_target is null
       or v_scope='{}'::jsonb
       or jsonb_array_length(v_comp)=0
       or v_evidence='{}'::jsonb
       or v_verify='{}'::jsonb
       or not coalesce((v_plan_check->>'ok')::boolean,false) then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'status','rejected',
        'reason','incomplete_expertise_artifact_specification',
        'domain',v_domain,
        'candidate_thresholds_removed',v_removed_candidate_thresholds,
        'application_validation',v_plan_check
      ));
      continue;
    end if;

    if not exists(
      select 1 from agent_lab.expertise_economic_proposals p
      where p.agent_id=p_agent_id and lower(btrim(p.domain))=lower(btrim(v_domain))
        and p.status='approved'
    ) then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'status','rejected','reason','operator_economic_approval_required',
        'domain',v_domain,'expertise_credit',0
      ));
      continue;
    end if;

    insert into agent_lab.expertise_artifacts(
      agent_id,domain,artifact_version,status,target_standard,scope,competencies,evidence_requirements,
      verification_plan,intended_application,economic_viability,source_wake_request_id,source_activity_id,metadata
    ) values (
      p_agent_id,v_domain,2,'initiated',v_target,v_scope,v_comp,v_evidence,v_verify,
      v_app,v_economy,p_wake_request_id,p_activity_id,
      jsonb_build_object(
        'origin','expertise_artifact_initiation_v0_1',
        'expertise_credit',0,
        'self_selected_field',true,
        'application_contract_version','expertise_application_v0_1',
        'economic_evidence_status','unverified_hypothesis',
        'economic_plan_authored_by_agent',true,
        'verification_threshold_policy','runtime_owned_v0_1',
        'candidate_thresholds_removed',v_removed_candidate_thresholds,
        'portfolio_contract_version','expertise_portfolio_v0_2',
        'portfolio_definition','admitted_original_implementations_only',
        'supporting_reports_are_not_portfolio_artifacts',true
      )
    ) returning expertise_artifact_id into v_id;

    insert into agent_lab.expertise(
      agent_id,domain,actual_competence,perceived_competence,expression_confidence,
      interest_strength,training_units,last_assessed_at,assessment_method,metadata
    ) values (
      p_agent_id,v_domain,0,0,0,0,0,now(),'artifact_initiated_zero_credit',
      jsonb_build_object(
        'expertise_artifact_id',v_id,
        'expertise_credit',0,
        'lifecycle_protocol','v0_4',
        'portfolio_contract_version','expertise_portfolio_v0_2'
      )
    )
    on conflict(agent_id,domain) do update
      set metadata=agent_lab.expertise.metadata || jsonb_build_object(
        'expertise_artifact_id',v_id,
        'lifecycle_protocol','v0_4',
        'portfolio_contract_version','expertise_portfolio_v0_2'
      );

    perform agent_lab.ensure_domain_learning_track_for_artifact(p_agent_id,v_id);

    v_initiated := v_initiated + 1;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'status','initiated',
      'expertise_artifact_id',v_id,
      'domain',v_domain,
      'expertise_credit',0,
      'application_contract_version','expertise_application_v0_1',
      'application_validation',v_plan_check,
      'verification_threshold_policy','runtime_owned_v0_1',
      'candidate_thresholds_removed',v_removed_candidate_thresholds,
      'portfolio_contract_version','expertise_portfolio_v0_2'
    ));
  end loop;

  return jsonb_build_object('applied',v_initiated,'results',v_results);
end
$function$;

revoke all on function public.aau_bridge_submit_expertise_economic_proposal(text,uuid,uuid,jsonb) from public;
grant execute on function public.aau_bridge_submit_expertise_economic_proposal(text,uuid,uuid,jsonb) to anon,service_role;
revoke all on function public.aau_bridge_pause_pending_expertise_proposal(text,uuid,uuid) from public;
grant execute on function public.aau_bridge_pause_pending_expertise_proposal(text,uuid,uuid) to anon,service_role;
revoke all on function agent_lab.operator_review_expertise_economic_proposal(uuid,text,text,text) from public,anon,authenticated;

drop trigger if exists trg_aa_expertise_economic_preapproval on agent_lab.expertise_artifacts;
create trigger trg_aa_expertise_economic_preapproval before insert on agent_lab.expertise_artifacts
for each row execute function agent_lab.require_approved_expertise_economics_v0_1();
drop trigger if exists trg_zz_expertise_economic_consume on agent_lab.expertise_artifacts;
create trigger trg_zz_expertise_economic_consume after insert on agent_lab.expertise_artifacts
for each row execute function agent_lab.consume_approved_expertise_economics_v0_1();
