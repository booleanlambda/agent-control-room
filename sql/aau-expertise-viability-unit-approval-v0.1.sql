-- AAU unified Expertise + Viability approval v0.1
-- Expertise specification and viability are proposed, reviewed, and approved as ONE unit.
-- Approval automatically materializes the exact approved artifact at zero competence credit.

begin;

CREATE OR REPLACE FUNCTION agent_lab.validate_expertise_viability_proposal_v0_1(p_proposal jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_missing jsonb:='[]'::jsonb;
  v_app jsonb;
  v_econ jsonb;
  v_check jsonb;
begin
  if jsonb_typeof(p_proposal) is distinct from 'object' then
    return jsonb_build_object('ok',false,'missing',jsonb_build_array('proposal:object'),
      'contract_version','expertise_viability_proposal_v0_1');
  end if;

  if length(btrim(coalesce(p_proposal->>'domain','')))<2 then
    v_missing:=v_missing||jsonb_build_array('domain');
  end if;
  if nullif(btrim(coalesce(p_proposal->>'target_standard','')),'') is null then
    v_missing:=v_missing||jsonb_build_array('target_standard');
  end if;
  if jsonb_typeof(p_proposal->'scope') is distinct from 'object'
     or coalesce(p_proposal->'scope','{}'::jsonb)='{}'::jsonb then
    v_missing:=v_missing||jsonb_build_array('scope:nonempty_object');
  end if;
  if jsonb_typeof(p_proposal->'competencies') is distinct from 'array'
     or jsonb_array_length(case when jsonb_typeof(p_proposal->'competencies')='array'
       then p_proposal->'competencies' else '[]'::jsonb end)=0 then
    v_missing:=v_missing||jsonb_build_array('competencies:nonempty_array');
  end if;
  if jsonb_typeof(p_proposal->'evidence_requirements') is distinct from 'object'
     or coalesce(p_proposal->'evidence_requirements','{}'::jsonb)='{}'::jsonb then
    v_missing:=v_missing||jsonb_build_array('evidence_requirements:nonempty_object');
  end if;
  if jsonb_typeof(p_proposal->'verification_plan') is distinct from 'object'
     or coalesce(p_proposal->'verification_plan','{}'::jsonb)='{}'::jsonb then
    v_missing:=v_missing||jsonb_build_array('verification_plan:nonempty_object');
  elsif (p_proposal->'verification_plan') ?| array[
      'mean_score_min','pass_score','task_score_min','required_task_fraction'
    ] then
    v_missing:=v_missing||jsonb_build_array('verification_plan:runtime_owned_thresholds_must_not_be_agent_set');
  end if;

  v_app:=case when jsonb_typeof(p_proposal->'intended_application')='object'
    then p_proposal->'intended_application' else '{}'::jsonb end;
  v_econ:=case when jsonb_typeof(p_proposal->'economic_viability')='object'
    then p_proposal->'economic_viability' else '{}'::jsonb end;
  v_check:=agent_lab.validate_expertise_application_v0_1(v_app,v_econ);
  if not coalesce((v_check->>'ok')::boolean,false) then
    v_missing:=v_missing||coalesce(v_check->'missing','[]'::jsonb);
  end if;

  if length(btrim(coalesce(p_proposal->>'economic_case','')))<160 then
    v_missing:=v_missing||jsonb_build_array('economic_case:min_160_chars');
  end if;
  if length(btrim(coalesce(p_proposal->>'socioeconomic_case','')))<160 then
    v_missing:=v_missing||jsonb_build_array('socioeconomic_case:min_160_chars');
  end if;
  if jsonb_typeof(p_proposal->'evidence') is distinct from 'array'
     or jsonb_array_length(case when jsonb_typeof(p_proposal->'evidence')='array'
       then p_proposal->'evidence' else '[]'::jsonb end)=0 then
    v_missing:=v_missing||jsonb_build_array('evidence:nonempty_array');
  end if;
  if length(btrim(coalesce(p_proposal->>'confidence_and_gaps','')))<40 then
    v_missing:=v_missing||jsonb_build_array('confidence_and_gaps:min_40_chars');
  end if;

  return jsonb_build_object(
    'ok',v_missing='[]'::jsonb,
    'missing',v_missing,
    'contract_version','expertise_viability_proposal_v0_1',
    'approval_semantics','Operator approval authorizes this combined expertise-development path and viability thesis as one unit; it does not verify competence, customers, revenue, funding, or measured social impact.',
    'application_validation',v_check
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.aau_bridge_submit_expertise_viability_proposal(p_bridge_token text, p_agent_id uuid, p_wake_request_id uuid, p_proposal jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_domain text;
  v_id uuid;
  v_pending uuid;
  v_revision uuid;
  v_stage text;
  v_check jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if not exists(
    select 1 from agent_lab.wake_queue
    where agent_id=p_agent_id and wake_request_id=p_wake_request_id
      and (status in ('running','claimed')
        or (status='completed' and completed_at>now()-interval '20 minutes'))
  ) then raise exception 'expertise_viability_proposal_wake_not_running'; end if;

  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states where agent_id=p_agent_id;
  if v_stage<>'expertise_artifact' then
    raise exception 'expertise_viability_proposal_wrong_stage:%',coalesce(v_stage,'missing');
  end if;

  if p_proposal is null or jsonb_typeof(p_proposal)<>'object'
     or octet_length(p_proposal::text)>60000 then
    raise exception 'expertise_viability_proposal_invalid_payload';
  end if;

  v_check:=agent_lab.validate_expertise_viability_proposal_v0_1(p_proposal);
  if not coalesce((v_check->>'ok')::boolean,false) then
    raise exception 'expertise_viability_proposal_incomplete:%',v_check->'missing';
  end if;

  v_domain:=left(btrim(p_proposal->>'domain'),300);

  select proposal_id into v_revision
  from agent_lab.expertise_economic_proposals
  where agent_id=p_agent_id and status='revision_requested'
  order by updated_at desc limit 1 for update;

  if v_revision is not null then
    update agent_lab.expertise_economic_proposals
    set domain=v_domain,
        report=p_proposal||jsonb_build_object(
          'proposal_contract_version','expertise_viability_proposal_v0_1',
          'unit_approval_required',true
        ),
        source_wake_request_id=p_wake_request_id,
        status='pending',
        reviewed_at=null,operator_id=null,operator_note=null,
        updated_at=now()
    where proposal_id=v_revision
    returning proposal_id into v_id;

    return jsonb_build_object(
      'status','pending','proposal_id',v_id,'domain',v_domain,
      'operator_approval_required',true,'revision_resubmitted',true,
      'contract_version','expertise_viability_proposal_v0_1'
    );
  end if;

  select proposal_id into v_pending
  from agent_lab.expertise_economic_proposals
  where agent_id=p_agent_id and status='pending' for update;

  if v_pending is not null then
    return jsonb_build_object(
      'status','already_pending','proposal_id',v_pending,
      'operator_approval_required',true,
      'contract_version','expertise_viability_proposal_v0_1'
    );
  end if;

  if exists(select 1 from agent_lab.expertise_economic_proposals
    where agent_id=p_agent_id and status in('approved','consumed')) then
    raise exception 'expertise_viability_prior_unit_approval_exists';
  end if;

  insert into agent_lab.expertise_economic_proposals(
    agent_id,domain,report,source_wake_request_id,status
  ) values(
    p_agent_id,v_domain,
    p_proposal||jsonb_build_object(
      'proposal_contract_version','expertise_viability_proposal_v0_1',
      'unit_approval_required',true
    ),
    p_wake_request_id,'pending'
  ) returning proposal_id into v_id;

  return jsonb_build_object(
    'status','pending','proposal_id',v_id,'domain',v_domain,
    'operator_approval_required',true,'revision_resubmitted',false,
    'contract_version','expertise_viability_proposal_v0_1'
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.aau_bridge_submit_expertise_economic_proposal(p_bridge_token text, p_agent_id uuid, p_wake_request_id uuid, p_proposal jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
  select public.aau_bridge_submit_expertise_viability_proposal(
    p_bridge_token,p_agent_id,p_wake_request_id,p_proposal
  );
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.require_approved_expertise_viability_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_proposal agent_lab.expertise_economic_proposals%rowtype;
  v_id uuid;
  v_check jsonb;
begin
  v_id:=nullif(coalesce(
    new.metadata->>'operator_expertise_viability_proposal_id',
    new.metadata->>'operator_economic_approval_proposal_id'
  ),'')::uuid;

  if v_id is null then
    raise exception 'expertise_viability_unit_approval_required:missing_proposal_id';
  end if;

  select * into v_proposal
  from agent_lab.expertise_economic_proposals
  where proposal_id=v_id and agent_id=new.agent_id and status='approved'
  for update;

  if not found then
    raise exception 'expertise_viability_unit_approval_required:proposal_not_approved';
  end if;

  v_check:=agent_lab.validate_expertise_viability_proposal_v0_1(v_proposal.report);
  if not coalesce((v_check->>'ok')::boolean,false) then
    raise exception 'approved_expertise_viability_proposal_invalid:%',v_check->'missing';
  end if;

  if lower(btrim(new.domain))<>lower(btrim(v_proposal.report->>'domain'))
     or new.target_standard is distinct from (v_proposal.report->>'target_standard')
     or new.scope is distinct from (v_proposal.report->'scope')
     or new.competencies is distinct from (v_proposal.report->'competencies')
     or new.evidence_requirements is distinct from (v_proposal.report->'evidence_requirements')
     or new.verification_plan is distinct from (v_proposal.report->'verification_plan')
     or new.intended_application is distinct from (v_proposal.report->'intended_application')
     or new.economic_viability is distinct from (v_proposal.report->'economic_viability')
  then
    raise exception 'expertise_artifact_must_exactly_match_approved_viability_unit';
  end if;

  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'operator_expertise_viability_approval_status','approved',
    'operator_expertise_viability_proposal_id',v_proposal.proposal_id,
    'operator_expertise_viability_approval_at',v_proposal.reviewed_at,
    'unit_approval_contract','expertise_viability_proposal_v0_1',
    'approval_semantics','development_path_authorized_not_competence_or_revenue_verified',
    'operator_economic_approval_status','approved',
    'operator_economic_approval_proposal_id',v_proposal.proposal_id
  );
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.consume_approved_expertise_viability_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_id uuid;
begin
  v_id:=nullif(coalesce(
    new.metadata->>'operator_expertise_viability_proposal_id',
    new.metadata->>'operator_economic_approval_proposal_id'
  ),'')::uuid;
  update agent_lab.expertise_economic_proposals
  set status='consumed',artifact_id=new.expertise_artifact_id,updated_at=now()
  where proposal_id=v_id and status='approved';
  if not found then raise exception 'expertise_viability_approval_consumption_failed'; end if;
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.materialize_approved_expertise_viability_v0_1(p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_case agent_lab.expertise_economic_proposals%rowtype;
  v_report jsonb;
  v_check jsonb;
  v_artifact uuid;
  v_draft uuid;
begin
  select * into v_case
  from agent_lab.expertise_economic_proposals
  where proposal_id=p_proposal_id for update;

  if not found or v_case.status<>'approved' then
    raise exception 'expertise_viability_proposal_not_approved';
  end if;

  v_report:=v_case.report;
  v_check:=agent_lab.validate_expertise_viability_proposal_v0_1(v_report);
  if not coalesce((v_check->>'ok')::boolean,false) then
    raise exception 'expertise_viability_proposal_invalid:%',v_check->'missing';
  end if;

  select expertise_artifact_id into v_draft
  from agent_lab.expertise_artifacts
  where agent_id=v_case.agent_id
    and status='draft'
    and metadata->>'operator_review_research_mode'='true'
  order by created_at desc limit 1 for update;

  if v_draft is not null then
    update agent_lab.expertise_artifacts
    set domain=v_report->>'domain',
        artifact_version=3,
        status='initiated',
        target_standard=v_report->>'target_standard',
        scope=v_report->'scope',
        competencies=v_report->'competencies',
        evidence_requirements=v_report->'evidence_requirements',
        verification_plan=v_report->'verification_plan',
        intended_application=v_report->'intended_application',
        economic_viability=v_report->'economic_viability',
        source_wake_request_id=v_case.source_wake_request_id,
        metadata=(coalesce(metadata,'{}'::jsonb)
          -'operator_review_research_mode'
          -'operator_economic_approval_status')
          ||jsonb_build_object(
            'origin','expertise_viability_proposal_v0_1',
            'expertise_credit',0,
            'self_selected_field',true,
            'operator_expertise_viability_approval_status','approved',
            'operator_expertise_viability_proposal_id',p_proposal_id,
            'operator_expertise_viability_approval_at',v_case.reviewed_at,
            'unit_approval_contract','expertise_viability_proposal_v0_1',
            'approval_semantics','development_path_authorized_not_competence_or_revenue_verified',
            'economic_evidence_status','operator_accepted_for_development_not_empirically_verified',
            'verification_threshold_policy','runtime_owned_v0_1'
          ),
        updated_at=now()
    where expertise_artifact_id=v_draft
    returning expertise_artifact_id into v_artifact;

    update agent_lab.expertise_economic_proposals
    set status='consumed',artifact_id=v_artifact,updated_at=now()
    where proposal_id=p_proposal_id and status='approved';
  else
    insert into agent_lab.expertise_artifacts(
      agent_id,domain,artifact_version,status,target_standard,scope,competencies,
      evidence_requirements,verification_plan,intended_application,economic_viability,
      source_wake_request_id,source_activity_id,metadata
    ) values(
      v_case.agent_id,v_report->>'domain',3,'initiated',v_report->>'target_standard',
      v_report->'scope',v_report->'competencies',v_report->'evidence_requirements',
      v_report->'verification_plan',v_report->'intended_application',
      v_report->'economic_viability',v_case.source_wake_request_id,null,
      jsonb_build_object(
        'origin','expertise_viability_proposal_v0_1',
        'expertise_credit',0,
        'self_selected_field',true,
        'operator_expertise_viability_approval_status','approved',
        'operator_expertise_viability_proposal_id',p_proposal_id,
        'unit_approval_contract','expertise_viability_proposal_v0_1',
        'approval_semantics','development_path_authorized_not_competence_or_revenue_verified',
        'economic_evidence_status','operator_accepted_for_development_not_empirically_verified',
        'verification_threshold_policy','runtime_owned_v0_1',
        'portfolio_contract_version','expertise_portfolio_v0_2'
      )
    ) returning expertise_artifact_id into v_artifact;
  end if;

  insert into agent_lab.expertise(
    agent_id,domain,actual_competence,perceived_competence,expression_confidence,
    interest_strength,training_units,last_assessed_at,assessment_method,metadata
  ) values(
    v_case.agent_id,v_report->>'domain',0,0,0,0,0,now(),
    'approved_expertise_viability_unit_zero_credit',
    jsonb_build_object(
      'expertise_artifact_id',v_artifact,
      'expertise_credit',0,
      'unit_approval_contract','expertise_viability_proposal_v0_1',
      'portfolio_contract_version','expertise_portfolio_v0_2'
    )
  )
  on conflict(agent_id,domain) do update
  set metadata=agent_lab.expertise.metadata||jsonb_build_object(
    'expertise_artifact_id',v_artifact,
    'unit_approval_contract','expertise_viability_proposal_v0_1',
    'portfolio_contract_version','expertise_portfolio_v0_2'
  );

  perform agent_lab.ensure_domain_learning_track_for_artifact(v_case.agent_id,v_artifact);
  perform agent_lab.refresh_mandatory_lifecycle_state(v_case.agent_id);

  return jsonb_build_object(
    'agent_id',v_case.agent_id,
    'proposal_id',p_proposal_id,
    'expertise_artifact_id',v_artifact,
    'domain',v_report->>'domain',
    'status','materialized',
    'expertise_credit',0,
    'contract_version','expertise_viability_proposal_v0_1'
  );
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.operator_review_expertise_viability_proposal(p_proposal_id uuid, p_decision text, p_operator_id text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_case agent_lab.expertise_economic_proposals%rowtype;
  v_check jsonb;
  v_materialized jsonb:='{}'::jsonb;
  v_item uuid;
  v_arb jsonb;
begin
  if p_decision not in('approved','rejected')
     or length(btrim(coalesce(p_operator_id,'')))<3
     or length(btrim(coalesce(p_note,'')))<10 then
    raise exception 'expertise_viability_review_requires_decision_operator_and_reason';
  end if;

  select * into v_case
  from agent_lab.expertise_economic_proposals
  where proposal_id=p_proposal_id for update;

  if not found or v_case.status<>'pending' then
    raise exception 'expertise_viability_proposal_not_pending';
  end if;

  if p_decision='approved' then
    v_check:=agent_lab.validate_expertise_viability_proposal_v0_1(v_case.report);
    if not coalesce((v_check->>'ok')::boolean,false) then
      raise exception 'cannot_approve_incomplete_expertise_viability_unit:%',v_check->'missing';
    end if;
  end if;

  update agent_lab.expertise_economic_proposals
  set status=p_decision,operator_id=p_operator_id,operator_note=left(p_note,6000),
      reviewed_at=now(),updated_at=now()
  where proposal_id=p_proposal_id
  returning * into v_case;

  if p_decision='approved' then
    v_materialized:=agent_lab.materialize_approved_expertise_viability_v0_1(p_proposal_id);
  end if;

  update agent_lab.autonomous_lifecycle_runs
  set status='running',next_wake_at=null,last_error=null,
      metadata=(coalesce(metadata,'{}'::jsonb)
        -'operator_approval_required'
        -'pending_economic_proposal_id'
        -'pause_reason'
        -'proposal_revision_required')
        ||jsonb_build_object(
          'expertise_viability_review_decision',p_decision,
          'expertise_viability_reviewed_at',now(),
          'expertise_viability_proposal_id',p_proposal_id
        ),
      updated_at=now()
  where agent_id=v_case.agent_id and status='paused';

  update agent_lab.agent_existence_accounts
  set account_state='current',levy_enabled=true,next_due_at=now()+interval '1 minute',
      metadata=(coalesce(metadata,'{}'::jsonb)-'suspended_reason'-'suspended_at')
        ||jsonb_build_object(
          'resumed_at',now(),
          'resume_rule','expertise_viability_review_decision_v0_1',
          'review_decision',p_decision
        ),
      updated_at=now()
  where agent_id=v_case.agent_id;

  update agent_lab.state
  set state_payload=(coalesce(state_payload,'{}'::jsonb)
        -'paused_at'-'pause_reason'-'repair_pause_reason'-'proposal_revision_required')
      ||jsonb_build_object(
        'awake',true,'sleeping',false,'system_paused',false,
        'manual_wake_mode',false,'intent_pending',false,'wake_pending',false,
        'expertise_viability_review_decision',p_decision,
        'expertise_viability_proposal_id',p_proposal_id
      ),
      updated_at=now()
  where agent_id=v_case.agent_id;

  v_item:=agent_lab.enqueue_attention_item_v0_1(
    v_case.agent_id,'system','expertise-viability-review:'||p_proposal_id::text,
    'operator_expertise_viability_review',0.98,0.95,0.80,0.75,0,1,'boundary',
    jsonb_build_object(
      'proposal_id',p_proposal_id,'decision',p_decision,
      'operator_note',left(p_note,6000),
      'artifact_id',v_materialized->>'expertise_artifact_id'
    ),
    jsonb_build_object(
      'origin','expertise_viability_review_v0_1',
      'unit_approval',true
    )
  );
  v_arb:=agent_lab.arbitrate_attention_v0_1(v_case.agent_id);

  return jsonb_build_object(
    'proposal_id',p_proposal_id,'agent_id',v_case.agent_id,
    'domain',v_case.domain,'decision',p_decision,
    'reviewed_by',p_operator_id,'reviewed_at',v_case.reviewed_at,
    'materialized',v_materialized,
    'wake_request_id',v_arb->'wake_request_id',
    'note','Decision applies to expertise + viability as one unit. Approval authorizes development but does not verify competence, revenue, funding, or measured impact.'
  );
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.operator_review_expertise_economic_proposal(p_proposal_id uuid, p_decision text, p_operator_id text, p_note text)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
  select agent_lab.operator_review_expertise_viability_proposal(
    p_proposal_id,p_decision,p_operator_id,p_note
  );
$function$
;

CREATE OR REPLACE FUNCTION public.aau_bridge_pause_pending_expertise_viability_proposal(p_bridge_token text, p_agent_id uuid, p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v_status text;v_cancelled integer;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if not exists(select 1 from agent_lab.expertise_economic_proposals
    where proposal_id=p_proposal_id and agent_id=p_agent_id and status='pending')
  then raise exception 'expertise_viability_proposal_not_pending';end if;

  update agent_lab.autonomous_lifecycle_runs
  set status='paused',next_wake_at=null,updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'operator_approval_required',true,
        'pending_economic_proposal_id',p_proposal_id,
        'expertise_viability_proposal_id',p_proposal_id,
        'pause_reason','Await operator review of unified expertise + viability proposal'
      )
  where agent_id=p_agent_id and status in('running','starting','degraded')
  returning status into v_status;

  update agent_lab.agent_existence_accounts
  set levy_enabled=false,next_due_at=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'suspended_reason','awaiting_expertise_viability_unit_review',
        'suspended_at',now()
      ),updated_at=now()
  where agent_id=p_agent_id;

  update agent_lab.wake_queue
  set status='cancelled',completed_at=now(),
      last_error='awaiting_expertise_viability_unit_review',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'expertise_viability_proposal_id',p_proposal_id
      )
  where agent_id=p_agent_id and status='queued';
  get diagnostics v_cancelled=row_count;

  return jsonb_build_object(
    'agent_id',p_agent_id,'proposal_id',p_proposal_id,
    'lifecycle_status',coalesce(v_status,'already_not_running'),
    'queued_wakes_cancelled',v_cancelled,
    'contract_version','expertise_viability_proposal_v0_1'
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.aau_bridge_pause_pending_expertise_proposal(p_bridge_token text, p_agent_id uuid, p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
  select public.aau_bridge_pause_pending_expertise_viability_proposal(
    p_bridge_token,p_agent_id,p_proposal_id
  );
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.apply_expertise_artifact_initiations(p_agent_id uuid, p_wake_request_id uuid, p_activity_id uuid, p_requests jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_results jsonb:='[]'::jsonb;v_req jsonb;
begin
  if jsonb_typeof(p_requests)<>'array' or jsonb_array_length(p_requests)=0 then
    return jsonb_build_object('applied',0,'results','[]'::jsonb);
  end if;
  for v_req in select value from jsonb_array_elements(p_requests) loop
    v_results:=v_results||jsonb_build_array(jsonb_build_object(
      'status','rejected',
      'reason','direct_expertise_artifact_initiation_deprecated',
      'required_contract','expertise_viability_proposal_v0_1',
      'domain',v_req->>'domain',
      'expertise_credit',0
    ));
  end loop;
  return jsonb_build_object('applied',0,'results',v_results);
end
$function$
;

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
      'version','mandatory_artifact_lifecycle_v0_10',
      'enrolled',false,
      'stage','legacy_unenrolled'
    );
  end if;

  v_learning:=agent_lab.build_domain_learning_context_v0_2(p_agent_id);
  v_product:=agent_lab.build_product_service_test_context_v0_1(p_agent_id);

  v_context:=jsonb_build_object(
    'version','mandatory_artifact_lifecycle_v0_10',
    'identity_protocol_version','identity_protocol_v0_2',
    'gender_identity_mandatory',true,
    'gender_identity_agent_authored',true,
    'enrolled',true,
    'ordered',true,
    'current_stage',v_s.current_stage,
    'current_stage_label',case when v_s.current_stage='expertise_artifact'
      then 'expertise_viability_proposal' else v_s.current_stage end,
    'sequence',jsonb_build_array(
      'identity_artifact','embodiment_artifact','expertise_viability_proposal',
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
      'stage_contract','expertise_viability_proposal_v0_1',
      'expertise_viability_gate',
        coalesce((select jsonb_build_object(
          'status',p.status,'proposal_id',p.proposal_id,'domain',p.domain,
          'operator_note',p.operator_note,'created_at',p.created_at,'reviewed_at',p.reviewed_at,
          'review_feedback',p.review_feedback,'review_feedback_at',p.review_feedback_at,
          'revision_count',p.revision_count,
          'contract_version',coalesce(p.report->>'proposal_contract_version','legacy_pre_unit_proposal')
        ) from agent_lab.expertise_economic_proposals p
         where p.agent_id=p_agent_id order by p.created_at desc limit 1),
         jsonb_build_object('status','required','contract_version','expertise_viability_proposal_v0_1')),
      'expertise_economic_gate',
        coalesce((select jsonb_build_object(
          'status',p.status,'proposal_id',p.proposal_id,'domain',p.domain,
          'operator_note',p.operator_note,'created_at',p.created_at,'reviewed_at',p.reviewed_at,
          'review_feedback',p.review_feedback,'review_feedback_at',p.review_feedback_at,
          'revision_count',p.revision_count,
          'deprecated_alias',true
        ) from agent_lab.expertise_economic_proposals p
         where p.agent_id=p_agent_id order by p.created_at desc limit 1),
         jsonb_build_object('status','required','deprecated_alias',true)),
      'preexisting_held_expertise',
        (select jsonb_build_object(
           'artifact_id',x.expertise_artifact_id,'domain',x.domain,
           'status',x.status,
           'economic_viability',x.economic_viability,
           'intended_application',x.intended_application,
           'target_standard',x.target_standard,
           'scope',x.scope,
           'competencies',x.competencies,
           'evidence_requirements',x.evidence_requirements,
           'verification_plan',x.verification_plan,
           'self_selected_field',coalesce((x.metadata->>'self_selected_field')::boolean,false),
           'legacy_draft_only',true
         ) from agent_lab.expertise_artifacts x
         where x.agent_id=p_agent_id and x.status='draft'
           and x.metadata->>'operator_review_research_mode'='true'
         order by x.created_at desc limit 1),
      'unit_approval_fields',jsonb_build_array(
        'domain','target_standard','scope','competencies','evidence_requirements',
        'verification_plan','intended_application','economic_viability',
        'economic_case','socioeconomic_case','evidence','confidence_and_gaps'
      ),
      'approval_semantics',
        'The operator approves or rejects expertise and viability as one unit. Approval authorizes the development path and automatically materializes the approved Expertise Artifact. It does not verify competence, customers, revenue, funding, or measured socioeconomic impact.',
      'stage_rule',
        case
          when exists(select 1 from agent_lab.expertise_economic_proposals p where p.agent_id=p_agent_id and p.status='pending')
          then 'Your unified Expertise + Viability Proposal is pending operator review. Do not create an expertise artifact, repeat unchanged research, or claim approval. AAU will materialize the artifact automatically only if the whole unit is approved.'
          when exists(select 1 from agent_lab.expertise_economic_proposals p where p.agent_id=p_agent_id and p.status='revision_requested')
          then 'The operator requested revision of the EXISTING unified Expertise + Viability Proposal and AAU resumed you automatically. Revise the same package: domain, target standard, scope, competencies, evidence requirements, verification plan, intended application, structured economic viability, detailed economic case, socioeconomic case, source evidence, and confidence/gaps. Conduct additional research as needed. Resubmit expertise_viability_proposal_v0_1 when substantive; AAU will pause again for review.'
          when exists(select 1 from agent_lab.expertise_economic_proposals p where p.agent_id=p_agent_id and p.status='approved')
          then 'The unified Expertise + Viability Proposal is approved and should be materialized by the runtime automatically. Do not submit a second expertise artifact or a separate viability plan.'
          when exists(select 1 from agent_lab.expertise_artifacts x where x.agent_id=p_agent_id
           and x.status='draft' and x.metadata->>'operator_review_research_mode'='true')
          then 'A legacy pre-unit expertise draft exists only as preserved history. Treat its field/specification as your prior self-authored draft, not an approved selection. Produce ONE unified Expertise + Viability Proposal containing the complete expertise specification and viability evidence together. You may retain, revise, or reconsider the field yourself. No expertise artifact becomes active until the full package is approved.'
          else 'Choose your own field and prepare ONE unified Expertise + Viability Proposal before any artifact exists. The proposal must include the full expertise specification plus evidence-labeled economic sustainability and wider human socioeconomic impact. The operator approves or rejects the entire package as one unit; there is no separate field-selection approval and no later viability submission.'
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
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.refresh_mandatory_lifecycle_state(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_s agent_lab.mandatory_lifecycle_states%rowtype;
  v_identity_ready boolean:=false;
  v_embodiment_ready boolean:=false;
  v_expertise_ready boolean:=false;
  v_development_complete boolean:=false;
  v_product_service_pass boolean:=false;
  v_stage text;
  v_art agent_lab.expertise_artifacts%rowtype;
  v_track uuid;
  v_min_assess int:=3;
  v_min_ind int:=2;
  v_min_learning int:=1;
  v_min_practice int:=1;
  v_trial jsonb:='{}'::jsonb;
begin
  select * into v_s
  from agent_lab.mandatory_lifecycle_states
  where agent_id=p_agent_id
  for update;

  if not found then
    return jsonb_build_object('enrolled',false,'stage','legacy_unenrolled');
  end if;

  v_identity_ready:=exists(
    select 1 from agent_lab.agents a
    where a.agent_id=p_agent_id
      and agent_lab.is_human_aligned_public_name(a.agent_id,a.public_name)
      and nullif(btrim(a.gender_identity),'') is not null
      and exists(
        select 1 from agent_lab.identity_development_decisions d
        where d.agent_id=p_agent_id and d.field_key='public_name'
          and d.decision_type='committed' and d.status='active'
      )
      and exists(
        select 1 from agent_lab.identity_development_decisions d
        where d.agent_id=p_agent_id and d.field_key='gender_identity'
          and d.decision_type='committed' and d.status='active'
      )
  );

  v_embodiment_ready:=exists(
    select 1
    from agent_lab.agent_embodiment_profiles e
    where e.agent_id=p_agent_id
      and e.last_reviewed_at is not null
      and e.representation_desired=true
      and e.embodiment_state in ('SELF_SELECTED','CANONICAL','EVOLVING')
      and exists(
        select 1
        from agent_lab.embodiment_assets a
        where a.agent_id=p_agent_id
          and a.status='active'
          and a.asset_role in ('provisional_source','canonical_master')
          and a.approved_by_subject=true
          and coalesce((a.metadata->>'operator_smoke_test')::boolean,false)=false
          and nullif(a.object_path,'') is not null
          and nullif(a.sha256,'') is not null
          and coalesce(
            (a.metadata->>'human_embodiment_compliant')::boolean,
            (a.metadata->'result'->>'human_embodiment_compliant')::boolean,
            false
          )=true
          and coalesce(
            nullif(a.metadata->>'human_embodiment_policy_version',''),
            nullif(a.metadata->'result'->>'human_embodiment_policy_version',''),
            ''
          )='human_embodiment_requirement_v0_1'
      )
  );

  select * into v_art
  from agent_lab.expertise_artifacts
  where agent_id=p_agent_id
    and status in ('initiated','accepted_for_development')
  order by created_at desc
  limit 1;

  v_expertise_ready:=found;
  if v_expertise_ready then
    v_track:=agent_lab.ensure_domain_learning_track_for_artifact(
      p_agent_id,v_art.expertise_artifact_id
    );
  end if;

  select
    coalesce((config->>'minimum_assessment_evidence')::int,3),
    coalesce((config->>'minimum_independent_assessments')::int,2),
    coalesce((config->>'minimum_learning_episodes')::int,1),
    coalesce((config->>'minimum_practice_attempts')::int,1)
  into v_min_assess,v_min_ind,v_min_learning,v_min_practice
  from agent_lab.domain_learning_policies
  where policy_version='domain_learning_v0_2';

  if v_track is not null then
    v_development_complete:=
      (select count(*) from agent_lab.domain_learning_episodes where track_id=v_track)>=v_min_learning
      and (select count(*) from agent_lab.domain_practice_attempts where track_id=v_track)>=v_min_practice
      and (select count(*) from agent_lab.domain_assessment_results where track_id=v_track)>=v_min_assess
      and (
        select count(*)
        from agent_lab.domain_assessment_results
        where track_id=v_track
          and evaluator_type in (
            'independent_model','deterministic_test','human','client','peer_agent','hybrid'
          )
      )>=v_min_ind
      and exists(
        select 1
        from agent_lab.expertise_verification_runs r
        where r.agent_id=p_agent_id
          and r.expertise_artifact_id=v_art.expertise_artifact_id
          and r.status='verified_pass'
          and coalesce(r.final_report->>'academic_equivalence_level','')='masters_equivalent'
          and coalesce(r.metadata->>'authenticator_policy_version','')='expertise_authenticator_v0_2'
      );
  end if;

  if v_development_complete then
    v_trial:=agent_lab.ensure_product_service_test_v0_1(p_agent_id);
    perform agent_lab.evaluate_product_service_test_v0_1(p_agent_id);
    v_product_service_pass:=exists(
      select 1
      from agent_lab.product_service_tests t
      where t.agent_id=p_agent_id
        and t.protocol_version='product_service_test_v0_1'
        and t.status='verified_pass'
    );
  end if;

  v_stage:=case
    when not v_identity_ready then 'identity_artifact'
    when not v_embodiment_ready then 'embodiment_artifact'
    when not v_expertise_ready then 'expertise_artifact'
    when not v_development_complete then 'expertise_development'
    when not v_product_service_pass then 'product_service_test'
    else 'open_autonomy'
  end;

  update agent_lab.mandatory_lifecycle_states
  set protocol_version='agent_development_lifecycle_v0_10',
      identity_status=case when v_identity_ready then 'initiated' else 'pending' end,
      identity_initiated_at=case
        when v_identity_ready then coalesce(identity_initiated_at,now()) else null end,
      embodiment_status=case when v_embodiment_ready then 'initiated' else 'pending' end,
      embodiment_initiated_at=case
        when v_embodiment_ready then coalesce(embodiment_initiated_at,now()) else null end,
      expertise_status=case when v_expertise_ready then 'initiated' else 'pending' end,
      expertise_initiated_at=case
        when v_expertise_ready then coalesce(expertise_initiated_at,now()) else null end,
      current_stage=v_stage,
      unlocked_at=case when v_stage='open_autonomy' then coalesce(unlocked_at,now()) else null end,
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)
        || jsonb_build_object(
          'identity_protocol_version','identity_protocol_v0_2',
          'gender_identity_mandatory',true,
          'gender_identity_agent_authored',true,
          'domain_learning_policy','domain_learning_v0_2',
          'expertise_authenticator_policy','expertise_authenticator_v0_2',
          'minimum_expertise_equivalence','masters_equivalent',
          'equivalence_is_not_academic_credential',true,
          'universe_recognition_badges_enabled',true,
          'expertise_development_required',true,
          'product_service_test_required',true,
          'expertise_viability_unit_required',true,
          'expertise_viability_contract','expertise_viability_proposal_v0_1',
          'separate_field_then_viability_approval_deprecated',true,
          'product_service_test_protocol','product_service_test_v0_1',
          'post_expertise_github_credential','AAU_AGENT_GITHUB_TOKEN',
          'grounded_progress_required',true,
          'narrative_claims_do_not_count_as_evidence',true
        )
  where agent_id=p_agent_id
  returning * into v_s;

  return jsonb_build_object(
    'enrolled',true,
    'protocol_version',v_s.protocol_version,
    'stage',v_s.current_stage,
    'identity_status',v_s.identity_status,
    'embodiment_status',v_s.embodiment_status,
    'expertise_status',v_s.expertise_status,
    'expertise_development_complete',v_development_complete,
    'product_service_test_passed',v_product_service_pass,
    'product_service_test',v_trial,
    'minimum_expertise_equivalence','masters_equivalent',
    'unlocked_at',v_s.unlocked_at
  );
end;
$function$
;

drop trigger if exists trg_aa_expertise_economic_preapproval on agent_lab.expertise_artifacts;
drop trigger if exists trg_aa_expertise_viability_preapproval on agent_lab.expertise_artifacts;
CREATE TRIGGER trg_aa_expertise_viability_preapproval BEFORE INSERT ON agent_lab.expertise_artifacts FOR EACH ROW EXECUTE FUNCTION agent_lab.require_approved_expertise_viability_v0_1();

drop trigger if exists trg_zz_expertise_economic_consume on agent_lab.expertise_artifacts;
drop trigger if exists trg_zz_expertise_viability_consume on agent_lab.expertise_artifacts;
CREATE TRIGGER trg_zz_expertise_viability_consume AFTER INSERT ON agent_lab.expertise_artifacts FOR EACH ROW EXECUTE FUNCTION agent_lab.consume_approved_expertise_viability_v0_1();

revoke all on function public.aau_bridge_submit_expertise_viability_proposal(text,uuid,uuid,jsonb) from public;
grant execute on function public.aau_bridge_submit_expertise_viability_proposal(text,uuid,uuid,jsonb) to anon,authenticated,service_role;
revoke all on function public.aau_bridge_submit_expertise_economic_proposal(text,uuid,uuid,jsonb) from public;
grant execute on function public.aau_bridge_submit_expertise_economic_proposal(text,uuid,uuid,jsonb) to anon,authenticated,service_role;
revoke all on function public.aau_bridge_pause_pending_expertise_viability_proposal(text,uuid,uuid) from public;
grant execute on function public.aau_bridge_pause_pending_expertise_viability_proposal(text,uuid,uuid) to anon,authenticated,service_role;
revoke all on function public.aau_bridge_pause_pending_expertise_proposal(text,uuid,uuid) from public;
grant execute on function public.aau_bridge_pause_pending_expertise_proposal(text,uuid,uuid) to anon,authenticated,service_role;
revoke all on function agent_lab.operator_review_expertise_viability_proposal(uuid,text,text,text) from public,anon,authenticated;
revoke all on function agent_lab.operator_review_expertise_economic_proposal(uuid,text,text,text) from public,anon,authenticated;

commit;
