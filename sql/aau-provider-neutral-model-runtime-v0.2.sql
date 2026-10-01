-- AAU provider-neutral model runtime v0.2
-- Snapshot of the deployed provider-neutral cognition bridge on 2026-10-01.
-- Provider-specific adapters may retain vendor names; shared lifecycle/retry contracts may not.

begin;

CREATE OR REPLACE FUNCTION public.aau_bridge_begin_model_experimental_wake(p_bridge_token text, p_wake_request_id uuid, p_agent_id uuid, p_worker_id text DEFAULT 'render-model-experimental'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_q agent_lab.wake_queue%rowtype;
  v_agent agent_lab.agents%rowtype;
  v_packet jsonb;
  v_global_pause boolean := false;
  v_started boolean := false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select coalesce((metadata->>'global_pause')::boolean,false)
    into v_global_pause
    from agent_lab.runtime_config
   where config_id=1;
  if not v_global_pause then
    raise exception 'isolated_model_wake_requires_global_pause';
  end if;

  select * into v_agent
    from agent_lab.agents
   where agent_id=p_agent_id
     and status <> 'archived';
  if v_agent.agent_id is null then
    raise exception 'agent_missing_or_archived';
  end if;
  if nullif(btrim(coalesce(v_agent.primary_model_provider,'')),'') is null
     or nullif(btrim(coalesce(v_agent.primary_model_id,'')),'') is null then
    raise exception 'agent_model_binding_missing';
  end if;

  if exists(
       select 1 from agent_lab.autonomous_lifecycle_runs r
        where r.agent_id=p_agent_id
     )
     and not exists(
       select 1 from agent_lab.autonomous_lifecycle_runs r
        where r.agent_id=p_agent_id
          and r.status in ('starting','running','degraded')
     ) then
    raise exception 'autonomous_lifecycle_not_running';
  end if;

  update agent_lab.wake_queue q
     set status='claimed',
         claimed_at=now(),
         worker_id=coalesce(nullif(p_worker_id,''),'render-model-experimental'),
         attempts=q.attempts+1,
         metadata=
           case when q.last_error is not null then
             coalesce(q.metadata,'{}'::jsonb)
             || jsonb_build_object(
               'retry_history',
               (case when jsonb_typeof(q.metadata->'retry_history')='array'
                     then q.metadata->'retry_history' else '[]'::jsonb end)
               || jsonb_build_array(jsonb_build_object(
                    'error',q.last_error,
                    'reclaimed_at',now(),
                    'prior_attempts',q.attempts,
                    'prior_worker_id',q.worker_id,
                    'prior_started_at',q.started_at
                  )),
               'last_recovery_cleared_at',now(),
               'last_recovery_cleared_by',coalesce(nullif(p_worker_id,''),'render-model-experimental')
             )
           else coalesce(q.metadata,'{}'::jsonb) end,
         last_error=null
   where q.wake_request_id=p_wake_request_id
     and q.agent_id=p_agent_id
     and q.status='queued'
     and (q.due_at is null or q.due_at<=now())
  returning q.* into v_q;

  if v_q.wake_request_id is null then
    raise exception 'wake_not_claimable';
  end if;

  if v_q.wake_intent_id is not null then
    update agent_lab.wake_intents
       set status='triggered',triggered_at=now()
     where wake_intent_id=v_q.wake_intent_id
       and status='active';
  end if;

  update agent_lab.wake_queue
     set status='running',
         started_at=coalesce(started_at,now()),
         metadata=coalesce(metadata,'{}'::jsonb)
           || jsonb_build_object(
             'running_transition','direct_claimed_to_running_v0_1',
             'running_transition_at',now()
           )
   where wake_request_id=p_wake_request_id
     and agent_id=p_agent_id
     and status='claimed';

  get diagnostics v_started = row_count;
  if not v_started then
    raise exception 'wake_direct_running_transition_failed';
  end if;

  update agent_lab.state
     set state_payload=
       (coalesce(state_payload,'{}'::jsonb)-'repair_pause_reason')
       || jsonb_build_object(
         'system_paused',false,
         'awake',true,
         'sleeping',false,
         'wake_pending',false,
         'intent_pending',false,
         'between_cognition_ticks',false,
         'inactive_between_wakes',false,
         'last_wake_at',now()
       ),
       updated_at=now()
   where agent_id=p_agent_id;

  update agent_lab.autonomous_lifecycle_runs
     set status='running',
         last_error=null,
         updated_at=now()
   where agent_id=p_agent_id
     and status in ('starting','running','degraded');

  update agent_lab.operator_alerts
     set status='resolved',
         resolved_at=now(),
         last_seen_at=now(),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'resolved_reason','wake_successfully_reclaimed',
           'resolved_by_worker',coalesce(nullif(p_worker_id,''),'render-model-experimental'),
           'resolved_wake_request_id',p_wake_request_id
         )
   where agent_id=p_agent_id
     and alert_type='orphaned_autonomous_intent_recovered'
     and source_ref=p_wake_request_id::text
     and status='open';

  v_packet:=agent_lab.get_cognition_packet(p_agent_id,p_wake_request_id);

  return jsonb_build_object(
    'wake_request_id',p_wake_request_id,
    'agent_id',p_agent_id,
    'primary_model_provider',v_agent.primary_model_provider,
    'primary_model_id',v_agent.primary_model_id,
    'consistency_status',v_agent.consistency_status,
    'packet',v_packet
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_apply_model_experimental_wake(p_bridge_token text, p_wake_request_id uuid, p_result jsonb, p_runtime jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_provider text;
  v_applied jsonb;
  v_next timestamptz;
  v_caps jsonb;
  v_activity_id uuid;
  v_requests jsonb;
  v_stage text;
  v_public_name text;
  v_result jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select q.agent_id,a.primary_model_provider into v_agent_id,v_provider
  from agent_lab.wake_queue q join agent_lab.agents a on a.agent_id=q.agent_id
  where q.wake_request_id=p_wake_request_id;
  if v_agent_id is null then raise exception 'intent_execution_not_found'; end if;
  if nullif(btrim(coalesce(v_provider,'')),'') is null then raise exception 'agent_model_provider_missing'; end if;

  v_result:=agent_lab.normalize_next_intents_v0_1(coalesce(p_result,'{}'::jsonb));

  select m.current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states m
  where m.agent_id=v_agent_id;

  if v_stage='identity_artifact' then
    v_public_name:=nullif(btrim(coalesce(v_result->'identity_update'->>'public_name','')),'');
    if v_public_name is null then raise exception 'identity_stage_requires_public_name_in_same_cognition'; end if;
    if not agent_lab.is_human_aligned_public_name(v_agent_id,v_public_name) then raise exception 'identity_stage_public_name_not_human_aligned'; end if;
  end if;

  if jsonb_typeof(v_result->'next_intents')<>'array' or jsonb_array_length(v_result->'next_intents')=0 then
    raise exception 'next_intent_protocol_requires_next_intents';
  end if;

  v_applied:=agent_lab.apply_cognition_result_with_identity_clock(
    p_wake_request_id,v_result,
    coalesce(p_runtime,'{}'::jsonb)||jsonb_build_object('next_intent_protocol','next_intent_protocol_v0_1')
  );
  v_activity_id:=nullif(v_applied->>'activity_id','')::uuid;
  v_requests:=agent_lab.extract_capability_requests(v_result);
  v_caps:=agent_lab.apply_capability_requests(v_agent_id,p_wake_request_id,v_activity_id,v_requests);

  select min(wake_at) into v_next from agent_lab.wake_intents
  where agent_id=v_agent_id and status='active' and wake_kind='time' and wake_at is not null;

  update agent_lab.autonomous_lifecycle_runs
     set status=case when v_next is null then 'degraded' else 'running' end,
         wake_count=wake_count+1,
         last_wake_at=now(),
         last_wake_request_id=p_wake_request_id,
         next_wake_at=v_next,
         last_error=case when v_next is null then 'completed_intent_without_next_time_intent' else null end,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('canonical_protocol','next_intent_protocol_v0_1'),
         updated_at=now()
   where agent_id=v_agent_id;

  return v_applied||jsonb_build_object(
    'capability_requests',v_caps,
    'next_intent_at',v_next,
    'intent_lifecycle_state',case when v_next is null then 'degraded' else 'running' end,
    'next_intent_protocol','next_intent_protocol_v0_1'
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_fail_model_experimental_wake(p_bridge_token text, p_wake_request_id uuid, p_error text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_status text;
  v_status_after text;
  v_attempts integer;
  v_released boolean := false;
  v_error text := left(coalesce(p_error,'model_experimental_wake_failed'),3000);
  v_statement_timeout boolean := false;
  v_model_timeout boolean := false;
  v_retry_minutes integer := 5;
  v_retry_due_at timestamptz;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.status,q.attempts into v_agent_id,v_status,v_attempts
    from agent_lab.wake_queue q
   where q.wake_request_id=p_wake_request_id for update;
  if v_agent_id is null or v_status not in ('claimed','running') then
    return false;
  end if;

  v_statement_timeout := v_error ilike '%57014%' or v_error ilike '%statement timeout%';
  v_model_timeout := v_error ~* '^model_timeout_after_[0-9]+ms$';
  if v_model_timeout then
    v_retry_minutes := case when coalesce(v_attempts,0)<=1 then 2 else 4 end;
  end if;

  v_released := agent_lab.release_wake_request(
    p_wake_request_id, v_error, v_retry_minutes,
    case when v_model_timeout then 3 else 8 end
  );

  select q.status,q.due_at into v_status_after,v_retry_due_at
    from agent_lab.wake_queue q where q.wake_request_id=p_wake_request_id;

  update agent_lab.wake_queue
     set metadata=(coalesce(metadata,'{}'::jsonb)
          -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
          -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
       || case
            when v_model_timeout then jsonb_build_object(
              'failure_class','model_transport_timeout',
              'model_transport_recovery_version','model_transport_timeout_bounded_v0_1',
              'model_transport_max_attempts',3,'model_transport_attempts',v_attempts,
              'model_transport_last_failure_at',now(),'retry_scheduled',v_status_after='queued',
              'recovery_required',v_status_after='failed',
              'semantic_state_preserved',true,
              'model_switch_performed',false)
            when v_released and v_statement_timeout and v_status_after='queued' then
              jsonb_build_object(
                'transient_retry_class','postgres_statement_timeout',
                'transient_retry_scheduled_at',now(),
                'lifecycle_degradation_suppressed',true)
            else '{}'::jsonb
          end
   where wake_request_id=p_wake_request_id and status in ('queued','failed');

  if v_released and v_model_timeout and v_status_after='queued' then
    update agent_lab.autonomous_lifecycle_runs
       set status='running',next_wake_at=v_retry_due_at,last_error=null,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'last_transient_retry_error',v_error,
             'last_transient_retry_class','model_transport_timeout',
             'last_transient_retry_at',now(),
             'last_transient_retry_wake_request_id',p_wake_request_id,
             'model_transport_attempts',v_attempts,'model_transport_max_attempts',3,
             'model_transport_recovery_version','model_transport_timeout_bounded_v0_1'),
           updated_at=now()
     where agent_id=v_agent_id and status in ('starting','running','degraded');
  elsif v_released and v_model_timeout and v_status_after='failed' then
    update agent_lab.autonomous_lifecycle_runs
       set status='paused',next_wake_at=null,last_error=v_error,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'repair_required',true,'repair_reason','model_transport_timeout_exhausted',
             'repair_required_at',now(),'failed_wake_request_id',p_wake_request_id,
             'model_transport_attempts',v_attempts,'model_transport_max_attempts',3,
             'model_transport_recovery_version','model_transport_timeout_bounded_v0_1'),
           updated_at=now()
     where agent_id=v_agent_id;
    update agent_lab.agent_existence_accounts
       set account_state='suspended',levy_enabled=false,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'suspended_reason','model_transport_timeout_exhausted','suspended_at',now(),
             'failed_wake_request_id',p_wake_request_id,
             'resume_rule','restart_next_due_from_resume_time'),
           updated_at=now()
     where agent_id=v_agent_id;
    update agent_lab.state
       set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
             'system_paused',true,'awake',false,'sleeping',false,'intent_pending',false,
             'wake_pending',false,'repair_pause_reason','model_transport_timeout_exhausted',
             'failed_wake_request_id',p_wake_request_id),
           updated_at=now()
     where agent_id=v_agent_id;
  elsif v_released and v_statement_timeout and v_status_after='queued' then
    update agent_lab.autonomous_lifecycle_runs
       set status='running',next_wake_at=coalesce(v_retry_due_at,next_wake_at),
           last_error=null,metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'last_transient_retry_error',v_error,
             'last_transient_retry_class','postgres_statement_timeout',
             'last_transient_retry_at',now(),
             'last_transient_retry_wake_request_id',p_wake_request_id,
             'transient_retry_does_not_degrade_lifecycle',true),
           updated_at=now()
     where agent_id=v_agent_id;
  else
    update agent_lab.autonomous_lifecycle_runs
       set status='degraded',last_error=v_error,updated_at=now()
     where agent_id=v_agent_id;
  end if;

  if v_released and v_model_timeout and v_status_after='failed' then
    begin
      perform agent_lab.queue_intervention_admin_message_v0_1(
        v_agent_id,p_wake_request_id,'model_transport_timeout',v_error,v_attempts
      );
    exception when others then
      update agent_lab.wake_queue
        set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'intervention_enqueue_error',left(sqlerrm,300),
          'intervention_enqueue_failed_at',now()
        ) where wake_request_id=p_wake_request_id;
    end;
  end if;
  return v_released;
end;
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_begin_model_intent_execution(p_bridge_token text, p_intent_execution_id uuid, p_agent_id uuid, p_worker_id text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
  with begun as (
    select public.aau_bridge_begin_model_experimental_wake(
      p_bridge_token,p_intent_execution_id,p_agent_id,p_worker_id
    ) as body
  ), with_identity as (
    select jsonb_set(
      body,
      '{packet,identity_stage_output_contract}',
      jsonb_build_object(
        'contract','identity_protocol_v0_2',
        'applies_when_current_stage','identity_artifact',
        'mandatory',true,
        'required_fields',jsonb_build_array('public_name','gender_identity'),
        'instruction','When current_stage is identity_artifact, complete both required identity fields. Preserve an already committed valid public_name or gender_identity; choose only missing values. gender_identity must be your own self-chosen nonempty string. The runtime must not choose or infer gender for you. Both fields are required before Stage 1 can complete.',
        'public_name_rule','human-aligned personal name; agent-authored',
        'gender_identity_rule','nonempty string; agent-authored; no runtime-selected default; no intentionally-unset completion',
        'autonomy_rule','The requirement to choose is environmental; the substantive gender choice belongs only to the agent.'
      ),
      true
    ) as body
    from begun
  )
  select jsonb_set(
           body,
           '{packet,expertise_stage_output_contract}',
           jsonb_build_object(
             'contract','expertise_artifact_initiation_v0_2',
             'applies_when_current_stage','expertise_artifact',
             'instruction','When the mandatory lifecycle current_stage is expertise_artifact, choose your own substantive expertise field now and initiate the artifact in this cognition. Set current_focus to expertise_artifact and use an expertise-oriented selected_action. Return at least one associations item whose origin is expertise_artifact_initiation_v0_1. The runtime must not choose the domain for you.',
             'association_origin','expertise_artifact_initiation_v0_1',
             'required_fields',jsonb_build_array('domain','target_standard','scope','competencies','evidence_requirements','verification_plan'),
             'field_contract',jsonb_build_object(
               'domain','nonempty string selected by agent',
               'target_standard','nonempty string describing the intended professional or advanced standard',
               'scope','nonempty JSON object',
               'competencies','nonempty JSON array',
               'evidence_requirements','nonempty JSON object',
               'verification_plan','nonempty JSON object describing independent assessment method/provenance/evidence'
             ),
             'verification_threshold_policy','Pass/fail thresholds are verifier/runtime-owned. Do not set mean_score_min, pass_score, task_score_min, or required_task_fraction.',
             'expertise_credit_rule','Initiation grants zero verified expertise credit until independent verification succeeds'
           ),
           true
         ) || jsonb_build_object(
           'intent_execution_id',p_intent_execution_id,
           'protocol_version','next_intent_protocol_v0_1',
           'identity_protocol_version','identity_protocol_v0_2'
         )
  from with_identity;
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_apply_model_intent_execution_pre_eoa_v0_1(p_bridge_token text, p_intent_execution_id uuid, p_result jsonb, p_runtime jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_stage text;
  v_started_at timestamptz;
  v_update jsonb:=coalesce(p_result->'embodiment_update','{}'::jsonb);
  v_identity_update jsonb:=coalesce(p_result->'identity_update','{}'::jsonb);
  v_existing_name text;
  v_existing_gender text;
  v_effective_name text;
  v_effective_gender text;
  v_candidates_at_start integer:=0;
  v_selected_text text;
  v_selected_id uuid;
  v_applied jsonb;
  v_selection jsonb:='{}'::jsonb;
  v_lifecycle jsonb:='{}'::jsonb;
  v_activity_id uuid;
  v_cognition_run_id uuid;
  v_selected_action text:=trim(coalesce(p_result->>'selected_action',''));
  v_expertise_artifact_id uuid;
  v_expertise_contract text;
  v_portfolio_gate jsonb:='{}'::jsonb;
  v_repeat_gate jsonb:='{}'::jsonb;
  v_academic_gate jsonb:='{}'::jsonb;
  v_practice_gate jsonb:='{}'::jsonb;
  v_verification_run_id uuid;
  v_verification_dispatch jsonb:=jsonb_build_object('status','not_requested');
  v_portfolio_submission jsonb:=jsonb_build_object('status','not_applicable');
  v_attention_interrupt boolean:=false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.started_at,coalesce((q.metadata->>'attention_arbiter')::boolean,false)
  into v_agent_id,v_started_at,v_attention_interrupt
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id;

  if v_agent_id is null then raise exception 'intent_execution_not_found'; end if;

  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states
  where agent_id=v_agent_id;

  if not v_attention_interrupt and v_stage='identity_artifact' then
    select a.public_name,a.gender_identity
    into v_existing_name,v_existing_gender
    from agent_lab.agents a
    where a.agent_id=v_agent_id;

    v_effective_name:=coalesce(nullif(btrim(v_existing_name),''),nullif(btrim(v_identity_update->>'public_name'),''));
    v_effective_gender:=coalesce(nullif(btrim(v_existing_gender),''),nullif(btrim(v_identity_update->>'gender_identity'),''));

    if v_effective_name is null or not agent_lab.is_human_aligned_public_name(v_agent_id,v_effective_name) then
      raise exception 'MANDATORY_IDENTITY_PUBLIC_NAME_REQUIRED';
    end if;
    if v_effective_gender is null then raise exception 'MANDATORY_IDENTITY_GENDER_REQUIRED'; end if;
    if v_existing_gender is null and jsonb_typeof(v_identity_update->'gender_identity') is distinct from 'string' then
      raise exception 'MANDATORY_IDENTITY_GENDER_MUST_BE_SELF_CHOSEN_STRING';
    end if;
  end if;

  if v_stage='embodiment_artifact' then
    select count(*) into v_candidates_at_start
    from agent_lab.embodiment_assets a
    where a.agent_id=v_agent_id
      and a.asset_role='provisional_source'
      and a.status='active'
      and a.created_at<=coalesce(v_started_at,now())
      and coalesce((a.metadata->>'operator_smoke_test')::boolean,false)=false
      and coalesce((a.metadata->>'human_embodiment_compliant')::boolean,(a.metadata->'result'->>'human_embodiment_compliant')::boolean,false)=true
      and coalesce(nullif(a.metadata->>'human_embodiment_policy_version',''),nullif(a.metadata->'result'->>'human_embodiment_policy_version',''),'')='human_embodiment_requirement_v0_1';

    if not v_attention_interrupt then
      if v_candidates_at_start=0 then
        if lower(coalesce(v_update->>'representation_desired','false'))<>'true'
           or lower(coalesce(v_update->>'request_visual_candidates','false'))<>'true'
           or nullif(trim(coalesce(v_update->>'reason','')),'') is null
           or not (
             (jsonb_typeof(coalesce(v_update->'preferences','{}'::jsonb))='object' and coalesce(v_update->'preferences','{}'::jsonb)<>'{}'::jsonb)
             or
             (jsonb_typeof(coalesce(v_update->'requested_changes','{}'::jsonb))='object' and coalesce(v_update->'requested_changes','{}'::jsonb)<>'{}'::jsonb)
           )
        then
          raise exception 'MANDATORY_EMBODIMENT_INITIATION_INCOMPLETE';
        end if;
      else
        v_selected_text:=nullif(trim(coalesce(v_update->>'selected_candidate_asset_id','')),'');
        if v_selected_text is null then raise exception 'MANDATORY_EMBODIMENT_SELECTION_REQUIRED'; end if;
        begin v_selected_id:=v_selected_text::uuid;
        exception when others then raise exception 'MANDATORY_EMBODIMENT_SELECTION_INVALID_ID';
        end;

        if not exists(
          select 1
          from agent_lab.embodiment_assets a
          where a.embodiment_asset_id=v_selected_id
            and a.agent_id=v_agent_id
            and a.asset_role='provisional_source'
            and a.status='active'
            and a.created_at<=coalesce(v_started_at,now())
            and coalesce((a.metadata->>'operator_smoke_test')::boolean,false)=false
            and coalesce((a.metadata->>'human_embodiment_compliant')::boolean,(a.metadata->'result'->>'human_embodiment_compliant')::boolean,false)=true
            and coalesce(nullif(a.metadata->>'human_embodiment_policy_version',''),nullif(a.metadata->'result'->>'human_embodiment_policy_version',''),'')='human_embodiment_requirement_v0_1'
        ) then
          raise exception 'MANDATORY_EMBODIMENT_SELECTION_NOT_ELIGIBLE';
        end if;

        if nullif(trim(coalesce(v_update->>'reason','')),'') is null then
          raise exception 'MANDATORY_EMBODIMENT_SELECTION_REASON_REQUIRED';
        end if;
      end if;
    end if;
  end if;

  v_applied:=public.aau_bridge_apply_model_experimental_wake(
    p_bridge_token,p_intent_execution_id,p_result,p_runtime
  );

  v_activity_id:=nullif(v_applied->>'activity_id','')::uuid;
  v_cognition_run_id:=nullif(v_applied->>'cognition_run_id','')::uuid;

  v_portfolio_submission:=agent_lab.apply_expertise_portfolio_submissions_v0_2(
    v_agent_id,v_activity_id,v_cognition_run_id,p_intent_execution_id,
    coalesce(p_result->'associations','[]'::jsonb)
  );

  v_selected_text:=nullif(trim(coalesce(v_update->>'selected_candidate_asset_id','')),'');
  if v_stage='embodiment_artifact' and v_candidates_at_start>0 and v_selected_text is not null then
    begin v_selected_id:=v_selected_text::uuid;
    exception when others then v_selected_id:=null;
    end;
    if v_selected_id is not null then
      v_selection:=agent_lab.select_embodiment_candidate_v0_1(
        v_agent_id,v_activity_id,v_cognition_run_id,p_intent_execution_id,v_update
      );
      v_lifecycle:=agent_lab.refresh_mandatory_lifecycle_state(v_agent_id);
    end if;
  end if;

  if v_selected_action in (
    'request_independent_verification_of_artifact',
    'request_independent_assessment',
    'request_expertise_verification',
    'request_verifier_retry'
  ) then
    select
      x.expertise_artifact_id,
      coalesce(x.metadata->>'portfolio_contract_version','expertise_portfolio_v0_1_legacy')
    into v_expertise_artifact_id,v_expertise_contract
    from agent_lab.expertise_artifacts x
    where x.agent_id=v_agent_id
      and x.status in ('initiated','accepted_for_development')
    order by x.created_at desc
    limit 1;

    if v_expertise_artifact_id is null then
      v_verification_dispatch:=jsonb_build_object(
        'status','blocked',
        'reason','eligible_expertise_artifact_not_found',
        'selected_action',v_selected_action,
        'retryable',false
      );
    else
      if v_expertise_contract='expertise_portfolio_v0_2' then
        v_portfolio_gate:=agent_lab.evaluate_expertise_portfolio_gate_v0_2(
          v_agent_id,v_expertise_artifact_id
        );
      else
        v_portfolio_gate:=jsonb_build_object(
          'ready_for_verification',true,
          'contract_version',v_expertise_contract,
          'legacy_baseline',true
        );
      end if;

      if coalesce((select (metadata->>'standards_required')::boolean from agent_lab.expertise_artifacts
          where expertise_artifact_id=v_expertise_artifact_id),false) then
        v_academic_gate:=agent_lab.expertise_standard_gate_v0_3(v_agent_id,v_expertise_artifact_id);
        if coalesce((v_academic_gate->>'ready')::boolean,false) then
          v_practice_gate:=agent_lab.evaluate_owned_master_practice_v0_3(v_agent_id,v_expertise_artifact_id);
        end if;
      end if;
      if v_selected_action <> 'request_verifier_retry' then
        v_repeat_gate:=agent_lab.evaluate_expertise_reverification_evidence_v0_1(
          v_agent_id,v_expertise_artifact_id
        );
      end if;

      if v_academic_gate<>'{}'::jsonb
         and not coalesce((v_academic_gate->>'ready')::boolean,false) then
        v_verification_dispatch:=jsonb_build_object(
          'status','blocked','reason','AAU_owned_master_standard_not_approved',
          'selected_action',v_selected_action,
          'expertise_artifact_id',v_expertise_artifact_id,
          'academic_standard_gate',v_academic_gate,'retryable',false,
          'agent_action_required',false,'operator_action_required',true
        );
      elsif v_practice_gate<>'{}'::jsonb
        and not coalesce((v_practice_gate->>'ready')::boolean,false) then
        v_verification_dispatch:=jsonb_build_object(
          'status','blocked','reason','AAU_owned_master_independent_practice_incomplete',
          'selected_action',v_selected_action,'retryable',false,
          'academic_practice_gate',v_practice_gate,'agent_action_required',true,
          'independent_evaluator_required',true
        );
      elsif not coalesce((v_portfolio_gate->>'ready_for_verification')::boolean,false) then
        v_verification_dispatch:=jsonb_build_object(
          'status','blocked',
          'reason','expertise_portfolio_v0_2_incomplete',
          'selected_action',v_selected_action,
          'expertise_artifact_id',v_expertise_artifact_id,
          'portfolio_gate',v_portfolio_gate,
          'retryable',false,
          'agent_action_required',true
        );
      elsif v_selected_action <> 'request_verifier_retry'
        and not coalesce((v_repeat_gate->>'ready_for_new_verification')::boolean,false) then
        v_verification_dispatch:=jsonb_build_object(
          'status','blocked',
          'reason','expertise_reverification_evidence_required',
          'selected_action',v_selected_action,
          'expertise_artifact_id',v_expertise_artifact_id,
          'repeat_verification_gate',v_repeat_gate,
          'retryable',false,
          'agent_action_required',true
        );
      elsif v_selected_action='request_verifier_retry' then
        v_verification_run_id:=agent_lab.retry_expertise_verification(
          v_agent_id,v_expertise_artifact_id,
          jsonb_build_object(
            'origin','agent_selected_retry_action_v0_1',
            'source_intent_execution_id',p_intent_execution_id,
            'source_activity_id',v_activity_id,
            'source_cognition_run_id',v_cognition_run_id,
            'selected_action',v_selected_action
          )
        );
        v_verification_dispatch:=jsonb_build_object(
          'status','retry_requested',
          'verification_run_id',v_verification_run_id,
          'expertise_artifact_id',v_expertise_artifact_id,
          'retryable',false
        );
      else
        v_verification_run_id:=agent_lab.request_expertise_verification(
          v_agent_id,v_expertise_artifact_id,
          jsonb_build_object(
            'origin','agent_selected_action_v0_1',
            'source_intent_execution_id',p_intent_execution_id,
            'source_activity_id',v_activity_id,
            'source_cognition_run_id',v_cognition_run_id,
            'selected_action',v_selected_action
          )
        );
        v_verification_dispatch:=jsonb_build_object(
          'status','requested',
          'verification_run_id',v_verification_run_id,
          'expertise_artifact_id',v_expertise_artifact_id,
          'retryable',false
        );
      end if;
    end if;

    -- Persist runtime feedback into the cognition outcome so the block is part of
    -- the auditable record and available to downstream context builders.
    if v_activity_id is not null then
      update agent_lab.activity_log
      set outcome=jsonb_set(
        coalesce(outcome,'{}'::jsonb),
        '{runtime_feedback}',
        coalesce(outcome->'runtime_feedback','{}'::jsonb)||jsonb_build_object('expertise_verification',v_verification_dispatch),
        true
      )
      where activity_id=v_activity_id;
    end if;
  end if;

  return coalesce(v_applied,'{}'::jsonb)||jsonb_build_object(
    'intent_execution_id',p_intent_execution_id,
    'protocol_version','next_intent_protocol_v0_1',
    'identity_protocol_version','identity_protocol_v0_2',
    'attention_arbiter_version','attention_arbiter_v0_1',
    'attention_interrupt_lifecycle_exemption',v_attention_interrupt,
    'embodiment_selection',v_selection,
    'mandatory_lifecycle_after_selection',v_lifecycle,
    'expertise_verification_dispatch',v_verification_dispatch,
    'expertise_portfolio_submission',v_portfolio_submission
  );
end
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_apply_model_intent_execution(p_bridge_token text, p_intent_execution_id uuid, p_result jsonb, p_runtime jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_applied jsonb;
  v_product_service jsonb:=jsonb_build_object('status','not_submitted_this_cognition');
  v_stage text;
  v_dep_state text:='';
  v_construct_id uuid;
  v_latest_github_success timestamptz;
  v_latest_deployment_failure timestamptz;
  v_action text := lower(trim(coalesce(p_result->>'selected_action','')));
  v_reason text := lower(trim(coalesce(p_result->>'stated_reason','')));
  v_conflict boolean := false;
  v_repo_claim_conflict boolean := false;
  v_no_progress_loop boolean := false;
  v_last_action text := '';
  v_prior_requested integer := 0;
  v_cap_request_count integer := 0;
  v_has_product_submission boolean:=false;
  v_test_dispatch jsonb:=jsonb_build_object('requested',false,'status','not_requested');
  v_group_result jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id into v_agent_id
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id;
  if v_agent_id is null then raise exception 'intent_execution_not_found'; end if;

  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states
  where agent_id=v_agent_id;

  select exists(
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_result->'associations','[]'::jsonb))='array'
           then coalesce(p_result->'associations','[]'::jsonb)
           else '[]'::jsonb end
    ) a
    where a->>'origin'='product_service_test_submission_v0_1'
  ) into v_has_product_submission;

  if v_stage='product_service_test' then
    select t.construct_id into v_construct_id
    from agent_lab.product_service_tests t
    where t.agent_id=v_agent_id
      and t.protocol_version='product_service_test_v0_1'
    limit 1;

    if v_construct_id is not null then
      select
        case
          when j.status='failed' then 'FAILED'
          when j.status='succeeded' then upper(coalesce(
            j.result_payload->'deployment'->>'readyState',
            j.result_payload->'deployment'->>'status',
            j.result_payload->>'ready_state',
            j.result_payload->>'status',
            'SUCCEEDED'
          ))
          else upper(coalesce(j.status,''))
        end
      into v_dep_state
      from agent_lab.infrastructure_broker_jobs j
      join agent_lab.infrastructure_broker_requests r
        on r.broker_request_id=j.broker_request_id
      where j.construct_id=v_construct_id
        and j.provider='vercel'
        and r.resource_type='deployment'
        and r.operation='deploy'
      order by j.created_at desc
      limit 1;

      select max(coalesce(j.finished_at,j.updated_at,j.created_at))
      into v_latest_github_success
      from agent_lab.infrastructure_broker_jobs j
      where j.construct_id=v_construct_id
        and j.provider='github'
        and j.status='succeeded';

      select max(coalesce(j.finished_at,j.updated_at,j.created_at))
      into v_latest_deployment_failure
      from agent_lab.infrastructure_broker_jobs j
      join agent_lab.infrastructure_broker_requests r
        on r.broker_request_id=j.broker_request_id
      where j.construct_id=v_construct_id
        and j.provider='vercel'
        and r.resource_type='deployment'
        and r.operation='deploy'
        and j.status='failed';
    end if;

    select lower(trim(coalesce(s.state_payload->>'last_action',''))),
           coalesce((s.state_payload->'last_capability_request_feedback'->>'requested')::integer,0)
      into v_last_action,v_prior_requested
    from agent_lab.state s
    where s.agent_id=v_agent_id;

    select count(*)
      into v_cap_request_count
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_result->'associations','[]'::jsonb))='array'
           then coalesce(p_result->'associations','[]'::jsonb)
           else '[]'::jsonb end
    ) a
    where a->>'origin'='capability_request_v0_1';

    if v_dep_state='FAILED' then
      v_conflict :=
           v_action ~ '(verify.*deployment|verify.*http|http.*status|submit.*final|final.*verification|final.*adjudication)'
        or v_reason ~ '(re-?initiated|re-?deployed|re-?submitted|retried|deployment has been initiated|deployment is now pending)'
        or (v_reason like '%verify%' and v_reason like '%succeeded%' and v_reason like '%deployment%');

      v_no_progress_loop :=
           v_action <> ''
       and v_action = v_last_action
       and v_prior_requested = 0
       and v_cap_request_count = 0
       and v_action ~ '(analy[sz]e|inspect|review|synthesi[sz]e|diagnos|investigate)';
    end if;

    if v_construct_id is not null then
      v_repo_claim_conflict :=
        v_reason ~ '(have |already )?(updated|modified|changed|fixed|repaired|rewritten).*(repository|build script|build scripts|file|files|code|package|entrypoint)'
        and (
          v_latest_github_success is null
          or (v_latest_deployment_failure is not null and v_latest_github_success <= v_latest_deployment_failure)
        );
    end if;

    if v_no_progress_loop then
      raise exception 'NO_PROGRESS_EXTERNAL_ACTION_LOOP: repeated analysis/inspection action with requested=0 and unchanged FAILED deployment. Issue an actual capability request or choose a different substantive repair step';
    end if;

    if v_repo_claim_conflict then
      raise exception 'AUTHORITATIVE_EXTERNAL_STATE_CONFLICT: repository_mutation_unconfirmed; no successful GitHub write exists after the latest failed deployment. Issue an actual GitHub capability request and wait for durable success before claiming repository changes were applied';
    end if;

    if v_conflict then
      raise exception 'AUTHORITATIVE_EXTERNAL_STATE_CONFLICT: production_deployment durable_state=FAILED; repair or issue a new runtime action before verification/final submission';
    end if;
  end if;

  -- Validate the entire batch before the legacy executor may write anything.
  perform agent_lab.validate_next_intent_group_v0_1(coalesce(p_result->'next_intents','[]'::jsonb));
  v_applied:=public.aau_bridge_apply_model_intent_execution_pre_eoa_v0_1(
    p_bridge_token,p_intent_execution_id,p_result,
    coalesce(p_runtime,'{}'::jsonb)||jsonb_build_object(
      'evidence_of_action_mode','optional_submission_v0_1',
      'product_service_test_contract','product_service_test_v0_1',
      'authoritative_external_state_commit_guard','v0_4_direct_state',
      'no_progress_loop_guard','v0_1'
    )
  );

  if v_action='request_product_test_execution' then
    v_test_dispatch:=agent_lab.request_product_test_execution_v0_1(
      v_agent_id,nullif(v_applied->>'activity_id','')::uuid,p_intent_execution_id
    );
  end if;
  if v_has_product_submission then
    v_product_service:=agent_lab.apply_product_service_test_submission_v0_1(
      v_agent_id,coalesce(p_result->'associations','[]'::jsonb)
    );
    perform agent_lab.refresh_mandatory_lifecycle_state(v_agent_id);
  end if;

  -- Members are agent-declared; the runtime executes only allowlisted existing operations.
  v_group_result:=agent_lab.execute_next_intent_group_v0_1(
    v_agent_id,p_intent_execution_id,nullif(v_applied->>'activity_id','')::uuid,p_result
  );
  return coalesce(v_applied,'{}'::jsonb)
    || jsonb_build_object(
      'intent_group_execution',v_group_result,
      'product_test_execution_dispatch',v_test_dispatch,
      'product_service_test',v_product_service,
      'product_service_evaluation_mode',
      case when v_has_product_submission then 'submission_triggered' else 'skipped_no_submission' end
    );
end
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_fail_model_intent_execution(p_bridge_token text, p_intent_execution_id uuid, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_status text;
  v_error text:=left(coalesce(p_error,'model_intent_execution_failed'),3000);
  v_semantic boolean:=false;
  v_external_state_conflict boolean:=false;
  v_repo_conflict boolean:=false;
  v_no_progress_loop boolean:=false;
  v_released boolean:=false;
  v_after_status text;
  v_rule text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.status into v_agent_id,v_status
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id;

  if v_agent_id is null then
    return jsonb_build_object('intent_execution_id',p_intent_execution_id,'status','not_found','protocol_version','next_intent_protocol_v0_1');
  end if;

  v_external_state_conflict := v_error ilike '%AUTHORITATIVE_EXTERNAL_STATE_CONFLICT%';
  v_repo_conflict := v_error ilike '%repository_mutation_unconfirmed%';
  v_no_progress_loop := v_error ilike '%NO_PROGRESS_EXTERNAL_ACTION_LOOP%';

  if (v_external_state_conflict or v_no_progress_loop) and v_status in ('claimed','running') then
    v_rule:=case
      when v_no_progress_loop then
        'The prior cognition was rejected because it repeated the same analysis/inspection action while requested=0 and durable deployment state remained FAILED. Repeating a promise to analyze is not progress. Choose your own next substantive step, but if it involves GitHub/Vercel inspection, mutation, configuration, or deployment, issue the matching capability_request_v0_1 in the same cognition.'
      when v_repo_conflict then
        'The prior cognition was rejected because it claimed repository/build-script changes without a successful GitHub runtime write after the latest failed deployment. No repository mutation is confirmed. Use an authorized GitHub capability request with the exact agent-authored files if you choose to modify the repository, and do not claim the edit succeeded until durable runtime state confirms it.'
      else
        'The prior cognition was rejected because it treated a FAILED deployment as retried/pending/succeeded without runtime evidence. Acknowledge the failure and autonomously choose a repair, investigation, implementation change, or a new runtime capability action before verification.'
    end;

    v_released:=agent_lab.release_wake_request(p_intent_execution_id,v_error,5,8);

    if v_released then
      update agent_lab.wake_queue
      set payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
            case when v_no_progress_loop then 'no_progress_repair' else 'authoritative_state_reconciliation' end,
            jsonb_build_object(
              'required',true,
              'production_deployment_state','FAILED',
              'repository_mutation_confirmed',case when v_repo_conflict then false else null end,
              'prior_action_repetition_blocked',v_no_progress_loop,
              'rule',v_rule,
              'runtime_does_not_choose_repair',true
            )
          ),
          metadata=(coalesce(metadata,'{}'::jsonb)
            -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
            -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
            ||jsonb_build_object(
              'failure_class',case
                when v_no_progress_loop then 'no_progress_external_action_loop'
                when v_repo_conflict then 'authoritative_repository_state_conflict'
                else 'authoritative_external_state_conflict'
              end,
              'reconciliation_retry_at',now(),
              'lifecycle_degradation_suppressed',true
            )
      where wake_request_id=p_intent_execution_id and status='queued';

      update agent_lab.autonomous_lifecycle_runs
      set status='running',
          next_wake_at=(select due_at from agent_lab.wake_queue where wake_request_id=p_intent_execution_id),
          last_error=null,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'last_reconciliation_conflict_at',now(),
            'last_reconciliation_conflict_wake_request_id',p_intent_execution_id,
            'authoritative_external_state_guard','v0_3',
            'no_progress_loop_guard','v0_1'
          ),
          updated_at=now()
      where agent_id=v_agent_id;

      update agent_lab.state
      set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
            'wake_pending',true,'intent_pending',true,
            'authoritative_state_reconciliation_pending',not v_no_progress_loop,
            'no_progress_repair_pending',v_no_progress_loop,
            'no_progress_repair_at',case when v_no_progress_loop then now() else null end,
            'authoritative_state_reconciliation_at',case when not v_no_progress_loop then now() else null end
          ),
          updated_at=now()
      where agent_id=v_agent_id;
    end if;

    return jsonb_build_object(
      'intent_execution_id',p_intent_execution_id,'agent_id',v_agent_id,
      'status',case when v_released then 'retry_released' else 'not_released' end,
      'failure_class',case
        when v_no_progress_loop then 'no_progress_external_action_loop'
        when v_repo_conflict then 'authoritative_repository_state_conflict'
        else 'authoritative_external_state_conflict'
      end,
      'retry_scheduled',v_released,'lifecycle_degraded',false,
      'protocol_version','next_intent_protocol_v0_1'
    );
  end if;

  v_semantic:=
       v_error ilike '%stage_contract_incomplete%'
    or v_error ilike '%mandatory_embodiment_%'
    or v_error ilike '%identity_stage_requires_public_name%'
    or v_error ilike '%identity_stage_public_name_not_human_aligned%'
    or v_error ilike '%stage_action_alignment%'
    or v_error ilike '%attention_resolution_contract_incomplete%';

  if v_semantic and v_status in ('claimed','running') then
    update agent_lab.wake_queue
       set status='failed',completed_at=coalesce(completed_at,now()),last_error=v_error,worker_id=null,
           metadata=(coalesce(metadata,'{}'::jsonb)
             -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
             -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
             ||jsonb_build_object('repair_required',true,'failure_class','semantic_contract','repair_required_at',now(),'protocol_version','next_intent_protocol_v0_1')
     where wake_request_id=p_intent_execution_id;

    update agent_lab.autonomous_lifecycle_runs
       set status='paused',next_wake_at=null,last_error=v_error,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('repair_required',true,'repair_reason','semantic_contract_failure','repair_required_at',now()),
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.agent_existence_accounts
       set account_state='suspended',levy_enabled=false,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('suspended_reason','semantic_contract_failure','suspended_at',now(),'resume_rule','restart_next_due_from_resume_time'),
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.state
       set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object('system_paused',true,'repair_pause_reason','semantic_contract_failure','intent_pending',false,'awake',false,'sleeping',false),
           updated_at=now()
     where agent_id=v_agent_id;

    begin
      perform agent_lab.queue_intervention_admin_message_v0_1(
        v_agent_id,p_intent_execution_id,'semantic_contract',v_error,
        (select attempts from agent_lab.wake_queue where wake_request_id=p_intent_execution_id)
      );
    exception when others then
      update agent_lab.wake_queue
        set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'intervention_enqueue_error',left(sqlerrm,300),
          'intervention_enqueue_failed_at',now()
        ) where wake_request_id=p_intent_execution_id;
    end;

    return jsonb_build_object('intent_execution_id',p_intent_execution_id,'agent_id',v_agent_id,'status','repair_required','failure_class','semantic_contract','retry_scheduled',false,'existence_suspended',true,'protocol_version','next_intent_protocol_v0_1');
  end if;

  v_released:=public.aau_bridge_fail_model_experimental_wake(p_bridge_token,p_intent_execution_id,v_error);

  if v_error ~* '^model_timeout_after_[0-9]+ms$' then
    select q.status into v_after_status from agent_lab.wake_queue q
      where q.wake_request_id=p_intent_execution_id;
    return jsonb_build_object(
      'intent_execution_id',p_intent_execution_id,'agent_id',v_agent_id,
      'status',case when not v_released then 'not_released'
        when v_after_status='queued' then 'retry_released'
        when v_after_status='failed' then 'repair_required'
        else 'not_released' end,
      'failure_class','model_transport_timeout',
      'retry_scheduled',v_released and v_after_status='queued',
      'existence_suspended',v_released and v_after_status='failed',
      'timeout_max_attempts',3,
      'protocol_version','next_intent_protocol_v0_1');
  end if;

  return jsonb_build_object('intent_execution_id',p_intent_execution_id,'agent_id',v_agent_id,
    'status',case when v_released then 'retry_released' else 'not_released' end,
    'failure_class','transient_or_unclassified','retry_scheduled',v_released,'protocol_version','next_intent_protocol_v0_1');
end
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_fail_model_intent_execution_detailed(p_bridge_token text, p_intent_execution_id uuid, p_error text, p_failure_details jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_result jsonb;
  v_agent_id uuid;
  v_details jsonb := coalesce(p_failure_details,'{}'::jsonb);
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id into v_agent_id
  from agent_lab.wake_queue q
  where q.wake_request_id = p_intent_execution_id;

  v_result := public.aau_bridge_fail_model_intent_execution(
    p_bridge_token,
    p_intent_execution_id,
    p_error
  );

  if v_agent_id is not null and v_details <> '{}'::jsonb then
    update agent_lab.wake_queue
       set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
         'failure_details', v_details,
         'failure_details_at', now(),
         'failure_details_schema', coalesce(v_details->>'schema','aau.lifecycle_contract_failure.v0_1')
       )
     where wake_request_id = p_intent_execution_id;

    update agent_lab.autonomous_lifecycle_runs
       set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
         'last_failure_details', v_details,
         'last_failure_details_at', now(),
         'last_failure_intent_execution_id', p_intent_execution_id
       ),
       updated_at = now()
     where agent_id = v_agent_id;
  end if;

  return coalesce(v_result,'{}'::jsonb) || jsonb_build_object(
    'failure_details_persisted', v_agent_id is not null and v_details <> '{}'::jsonb
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.aau_bridge_fail_model_transport_transient_v0_1(p_bridge_token text, p_intent_execution_id uuid, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_status text;
  v_attempts integer;
  v_after_status text;
  v_due_at timestamptz;
  v_released boolean:=false;
  v_error text:=left(coalesce(p_error,'model_transport_transient'),3000);
  v_retry_minutes integer;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.status,q.attempts
    into v_agent_id,v_status,v_attempts
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id
  for update;

  if v_agent_id is null then
    return jsonb_build_object('status','not_found','intent_execution_id',p_intent_execution_id);
  end if;

  if v_status not in ('claimed','running') then
    return jsonb_build_object(
      'status','not_released',
      'intent_execution_id',p_intent_execution_id,
      'agent_id',v_agent_id,
      'wake_status',v_status
    );
  end if;

  v_retry_minutes:=case when coalesce(v_attempts,0)<=1 then 2 else 4 end;
  v_released:=agent_lab.release_wake_request(
    p_intent_execution_id,v_error,v_retry_minutes,3
  );

  select q.status,q.due_at into v_after_status,v_due_at
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id;

  update agent_lab.wake_queue
     set metadata=(coalesce(metadata,'{}'::jsonb)
       -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
       -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
       ||jsonb_build_object(
         'failure_class','model_transport_transient',
         'model_transport_recovery_version','model_transport_transient_bounded_v0_1',
         'model_transport_max_attempts',3,
         'model_transport_attempts',v_attempts,
         'model_transport_last_failure_at',now(),
         'semantic_state_preserved',true,
         'unfinished_model_output_discarded',true,
         'resume_from_durable_boundary',true,
         'retry_scheduled',v_after_status='queued',
         'recovery_required',v_after_status='failed',
         'model_switch_performed',false
       )
   where wake_request_id=p_intent_execution_id
     and status in ('queued','failed');

  if v_released and v_after_status='queued' then
    update agent_lab.autonomous_lifecycle_runs
       set status='running',
           next_wake_at=v_due_at,
           last_error=null,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'last_transport_retry_error',v_error,
             'last_transport_retry_class','model_transport_transient',
             'last_transport_retry_at',now(),
             'last_transport_retry_wake_request_id',p_intent_execution_id,
             'model_transport_attempts',v_attempts,
             'model_transport_max_attempts',3,
             'model_transport_recovery_version','model_transport_transient_bounded_v0_1',
             'semantic_state_preserved',true,
             'resume_from_durable_boundary',true
           ),
           updated_at=now()
     where agent_id=v_agent_id
       and status in ('starting','running','degraded');
  elsif v_released and v_after_status='failed' then
    update agent_lab.autonomous_lifecycle_runs
       set status='paused',
           next_wake_at=null,
           last_error=v_error,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'repair_required',true,
             'repair_reason','model_transport_transient_exhausted',
             'repair_required_at',now(),
             'failed_wake_request_id',p_intent_execution_id,
             'model_transport_attempts',v_attempts,
             'model_transport_max_attempts',3,
             'model_transport_recovery_version','model_transport_transient_bounded_v0_1',
             'semantic_state_preserved',true
           ),
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.agent_existence_accounts
       set account_state='suspended',
           levy_enabled=false,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'suspended_reason','model_transport_transient_exhausted',
             'suspended_at',now(),
             'failed_wake_request_id',p_intent_execution_id,
             'resume_rule','restart_next_due_from_resume_time'
           ),
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.state
       set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
             'system_paused',true,
             'awake',false,
             'sleeping',false,
             'intent_pending',false,
             'wake_pending',false,
             'repair_pause_reason','model_transport_transient_exhausted',
             'failed_wake_request_id',p_intent_execution_id
           ),
           updated_at=now()
     where agent_id=v_agent_id;
  end if;

  return jsonb_build_object(
    'status',case
      when not v_released then 'not_released'
      when v_after_status='queued' then 'retry_released'
      when v_after_status='failed' then 'repair_required'
      else 'not_released'
    end,
    'intent_execution_id',p_intent_execution_id,
    'agent_id',v_agent_id,
    'failure_class','model_transport_transient',
    'semantic_state_preserved',true,
    'resume_from_durable_boundary',true,
    'retry_scheduled',v_released and v_after_status='queued',
    'existence_suspended',v_released and v_after_status='failed',
    'max_attempts',3
  );
end;
$function$


-- Shared bridge functions remain broker-token protected SECURITY DEFINER endpoints.
revoke all on function public.aau_bridge_begin_model_experimental_wake(text,uuid,uuid,text) from public,authenticated;
revoke all on function public.aau_bridge_apply_model_experimental_wake(text,uuid,jsonb,jsonb) from public,authenticated;
revoke all on function public.aau_bridge_fail_model_experimental_wake(text,uuid,text) from public,authenticated;
revoke all on function public.aau_bridge_begin_model_intent_execution(text,uuid,uuid,text) from public,authenticated;
revoke all on function public.aau_bridge_apply_model_intent_execution_pre_eoa_v0_1(text,uuid,jsonb,jsonb) from public,authenticated;
revoke all on function public.aau_bridge_apply_model_intent_execution(text,uuid,jsonb,jsonb) from public,authenticated;
revoke all on function public.aau_bridge_fail_model_intent_execution(text,uuid,text) from public,authenticated;
revoke all on function public.aau_bridge_fail_model_intent_execution_detailed(text,uuid,text,jsonb) from public,authenticated;
revoke all on function public.aau_bridge_fail_model_transport_transient_v0_1(text,uuid,text) from public,authenticated;

grant execute on function public.aau_bridge_begin_model_experimental_wake(text,uuid,uuid,text) to anon,service_role;
grant execute on function public.aau_bridge_apply_model_experimental_wake(text,uuid,jsonb,jsonb) to anon,service_role;
grant execute on function public.aau_bridge_fail_model_experimental_wake(text,uuid,text) to anon,service_role;
grant execute on function public.aau_bridge_begin_model_intent_execution(text,uuid,uuid,text) to anon,service_role;
grant execute on function public.aau_bridge_apply_model_intent_execution_pre_eoa_v0_1(text,uuid,jsonb,jsonb) to anon,service_role;
grant execute on function public.aau_bridge_apply_model_intent_execution(text,uuid,jsonb,jsonb) to anon,service_role;
grant execute on function public.aau_bridge_fail_model_intent_execution(text,uuid,text) to anon,service_role;
grant execute on function public.aau_bridge_fail_model_intent_execution_detailed(text,uuid,text,jsonb) to anon,service_role;
grant execute on function public.aau_bridge_fail_model_transport_transient_v0_1(text,uuid,text) to anon,service_role;

-- Retire provider-named compatibility contracts.
drop function if exists public.aau_bridge_begin_nvidia_experimental_wake(text,uuid,uuid,text);
drop function if exists public.aau_bridge_apply_nvidia_experimental_wake(text,uuid,jsonb,jsonb);
drop function if exists public.aau_bridge_fail_nvidia_experimental_wake(text,uuid,text);
drop function if exists public.aau_bridge_begin_nvidia_intent_execution(text,uuid,uuid,text);
drop function if exists public.aau_bridge_apply_nvidia_intent_execution_pre_eoa_v0_1(text,uuid,jsonb,jsonb);
drop function if exists public.aau_bridge_apply_nvidia_intent_execution(text,uuid,jsonb,jsonb);
drop function if exists public.aau_bridge_fail_nvidia_intent_execution(text,uuid,text);
drop function if exists public.aau_bridge_fail_nvidia_intent_execution_detailed(text,uuid,text,jsonb);
drop function if exists public.aau_bridge_fail_nvidia_provider_transient_v0_1(text,uuid,text);

commit;
