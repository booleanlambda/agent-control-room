-- AAU NVIDIA timeout bounded recovery v0.1
-- Applied to Supabase 2026-09-20.
-- Runtime-owned timeout handling: retry same wake at 2/4 minutes, then hold
-- after 3 failures, disable existence levy, preserve canonical agent data.
-- Does not switch the bound agent model or claim task/competence failure.
-- Operator restoration is explicit and must reconcile the failed action.

CREATE OR REPLACE FUNCTION public.aau_bridge_fail_nvidia_experimental_wake(p_bridge_token text, p_wake_request_id uuid, p_error text)
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
  v_error text := left(coalesce(p_error,'nvidia_experimental_wake_failed'),3000);
  v_statement_timeout boolean := false;
  v_nvidia_timeout boolean := false;
  v_retry_minutes integer := 5;
  v_retry_due_at timestamptz;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  -- Serialize failure transitions. Stale deliveries cannot resurrect a wake.
  select q.agent_id,q.status,q.attempts into v_agent_id,v_status,v_attempts
    from agent_lab.wake_queue q
   where q.wake_request_id=p_wake_request_id for update;
  if v_agent_id is null or v_status not in ('claimed','running') then
    return false;
  end if;

  v_statement_timeout := v_error ilike '%57014%' or v_error ilike '%statement timeout%';
  v_nvidia_timeout := v_error ~* '^nvidia_timeout_after_[0-9]+ms$';
  if v_nvidia_timeout then
    -- 2 minutes after first failure, 4 after second; stop after third.
    v_retry_minutes := case when coalesce(v_attempts,0)<=1 then 2 else 4 end;
  end if;

  v_released := agent_lab.release_wake_request(
    p_wake_request_id, v_error, v_retry_minutes,
    case when v_nvidia_timeout then 3 else 8 end
  );

  select q.status,q.due_at into v_status_after,v_retry_due_at
    from agent_lab.wake_queue q where q.wake_request_id=p_wake_request_id;

  update agent_lab.wake_queue
     set metadata=(coalesce(metadata,'{}'::jsonb)
          -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
          -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
       || case
            when v_nvidia_timeout then jsonb_build_object(
              'failure_class','nvidia_model_timeout',
              'timeout_recovery_version','nvidia_timeout_bounded_recovery_v0_1',
              'timeout_max_attempts',3,'timeout_attempts',v_attempts,
              'timeout_last_failure_at',now(),'retry_scheduled',v_status_after='queued',
              'recovery_required',v_status_after='failed',
              'model_switch_performed',false)
            when v_released and v_statement_timeout and v_status_after='queued' then
              jsonb_build_object(
                'transient_retry_class','postgres_statement_timeout',
                'transient_retry_scheduled_at',now(),
                'lifecycle_degradation_suppressed',true)
            else '{}'::jsonb
          end
   where wake_request_id=p_wake_request_id and status in ('queued','failed');

  if v_released and v_nvidia_timeout and v_status_after='queued' then
    update agent_lab.autonomous_lifecycle_runs
       set status='running',next_wake_at=v_retry_due_at,last_error=null,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'last_transient_retry_error',v_error,
             'last_transient_retry_class','nvidia_model_timeout',
             'last_transient_retry_at',now(),
             'last_transient_retry_wake_request_id',p_wake_request_id,
             'timeout_attempts',v_attempts,'timeout_max_attempts',3,
             'timeout_recovery_version','nvidia_timeout_bounded_recovery_v0_1'),
           updated_at=now()
     where agent_id=v_agent_id and status in ('starting','running','degraded');
  elsif v_released and v_nvidia_timeout and v_status_after='failed' then
    -- Preserve cognition, artifacts, and failed wake for diagnosis; suspend
    -- scheduled cognition and the minute levy until deliberate operator recovery.
    update agent_lab.autonomous_lifecycle_runs
       set status='paused',next_wake_at=null,last_error=v_error,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'repair_required',true,'repair_reason','nvidia_timeout_exhausted',
             'repair_required_at',now(),'failed_wake_request_id',p_wake_request_id,
             'timeout_attempts',v_attempts,'timeout_max_attempts',3,
             'timeout_recovery_version','nvidia_timeout_bounded_recovery_v0_1'),
           updated_at=now()
     where agent_id=v_agent_id;
    update agent_lab.agent_existence_accounts
       set account_state='suspended',levy_enabled=false,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
             'suspended_reason','nvidia_timeout_exhausted','suspended_at',now(),
             'failed_wake_request_id',p_wake_request_id,
             'resume_rule','restart_next_due_from_resume_time'),
           updated_at=now()
     where agent_id=v_agent_id;
    update agent_lab.state
       set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
             'system_paused',true,'awake',false,'sleeping',false,'intent_pending',false,
             'wake_pending',false,'repair_pause_reason','nvidia_timeout_exhausted',
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
  return v_released;
end;
$function$;

-- accurate_timeout_failure_feedback_v0_1: distinguish requeued vs terminal hold.
CREATE OR REPLACE FUNCTION public.aau_bridge_fail_nvidia_intent_execution(p_bridge_token text, p_intent_execution_id uuid, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_status text;
  v_error text:=left(coalesce(p_error,'nvidia_intent_execution_failed'),3000);
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

    return jsonb_build_object('intent_execution_id',p_intent_execution_id,'agent_id',v_agent_id,'status','repair_required','failure_class','semantic_contract','retry_scheduled',false,'existence_suspended',true,'protocol_version','next_intent_protocol_v0_1');
  end if;

  v_released:=public.aau_bridge_fail_nvidia_experimental_wake(p_bridge_token,p_intent_execution_id,v_error);

  if v_error ~* '^nvidia_timeout_after_[0-9]+ms$' then
    select q.status into v_after_status from agent_lab.wake_queue q
      where q.wake_request_id=p_intent_execution_id;
    return jsonb_build_object(
      'intent_execution_id',p_intent_execution_id,'agent_id',v_agent_id,
      'status',case when not v_released then 'not_released'
        when v_after_status='queued' then 'retry_released'
        when v_after_status='failed' then 'repair_required'
        else 'not_released' end,
      'failure_class','nvidia_model_timeout',
      'retry_scheduled',v_released and v_after_status='queued',
      'existence_suspended',v_released and v_after_status='failed',
      'timeout_max_attempts',3,
      'protocol_version','next_intent_protocol_v0_1');
  end if;

  return jsonb_build_object('intent_execution_id',p_intent_execution_id,'agent_id',v_agent_id,
    'status',case when v_released then 'retry_released' else 'not_released' end,
    'failure_class','transient_or_unclassified','retry_scheduled',v_released,'protocol_version','next_intent_protocol_v0_1');
end
$function$;
