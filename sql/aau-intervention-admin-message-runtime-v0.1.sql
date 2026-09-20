-- AAU Intervention Protocol v0.1: applied to Supabase on 2026-09-20.
-- Migration deploy order: after aau-nvidia-timeout-bounded-recovery-v0.1.sql.
-- Automated system-authored (NOT human-authored) admin messages on terminal
-- NVIDIA timeout, semantic-contract failure, and stale/orphaned cognition hold.
-- Keeps lifecycle and levy suspended until deliberate operator resume.
-- No automatic model swap, competence verdict, or duplicate side effects.
CREATE TABLE IF NOT EXISTS agent_lab.intervention_events (
  intervention_id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agent_lab.agents(agent_id) ON DELETE CASCADE,
  wake_request_id uuid NOT NULL REFERENCES agent_lab.wake_queue(wake_request_id) ON DELETE CASCADE,
  failure_class text NOT NULL CHECK (failure_class IN
    ('nvidia_model_timeout','orphaned_running_intent','semantic_contract','postgres_statement_timeout')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','delivered','resolved')),
  message_id uuid REFERENCES agent_lab.admin_chat_messages(message_id) ON DELETE SET NULL,
  attention_item_id uuid REFERENCES agent_lab.attention_items(attention_item_id) ON DELETE SET NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(wake_request_id,failure_class)
);
ALTER TABLE agent_lab.intervention_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_lab.intervention_events FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION agent_lab.queue_intervention_admin_message_v0_1(p_agent_id uuid, p_wake_request_id uuid, p_failure_class text, p_error text, p_attempts integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_event_id uuid;
  v_message_id uuid;
  v_attention_id uuid;
  v_wake_status text;
  v_lifecycle_status text;
  v_levy boolean;
  v_message text;
  v_error text:=left(coalesce(nullif(btrim(p_error),''),'unknown_runtime_failure'),1000);
begin
  if p_failure_class not in ('nvidia_model_timeout','orphaned_running_intent','semantic_contract','postgres_statement_timeout') then
    raise exception 'unsupported_intervention_failure_class';
  end if;
  select status into v_wake_status from agent_lab.wake_queue
    where wake_request_id=p_wake_request_id and agent_id=p_agent_id;
  select status into v_lifecycle_status from agent_lab.autonomous_lifecycle_runs where agent_id=p_agent_id;
  select levy_enabled into v_levy from agent_lab.agent_existence_accounts where agent_id=p_agent_id;
  if v_wake_status is distinct from 'failed' or v_lifecycle_status is distinct from 'paused'
      or v_levy is distinct from false then
    raise exception 'intervention_requires_failed_wake_paused_agent_and_suspended_levy';
  end if;

  insert into agent_lab.intervention_events
    (agent_id,wake_request_id,failure_class,status,evidence)
  values (p_agent_id,p_wake_request_id,p_failure_class,'queued',
    jsonb_build_object('failure_error',v_error,'attempts',p_attempts,
      'origin','automatic_runtime_intervention_v0_1',
      'independent_result_not_implied',true,'model_switch_performed',false))
  on conflict (wake_request_id,failure_class) do nothing
  returning intervention_id into v_event_id;
  if v_event_id is null then
    return (select jsonb_build_object('status','already_recorded',
      'intervention_id',intervention_id,'message_id',message_id,
      'attention_item_id',attention_item_id) from agent_lab.intervention_events
       where wake_request_id=p_wake_request_id and failure_class=p_failure_class);
  end if;

  v_message:='AAU SYSTEM INTERVENTION (automatic; not authored by a human administrator). '
    || 'The previous operation is halted: wake='||p_wake_request_id::text
    ||'; failure_class='||p_failure_class
    ||'; attempts='||coalesce(p_attempts,0)::text
    ||'; authoritative runtime error='||v_error||'. '
    || 'The agent is paused with its existence levy suspended. This is an execution '
    || 'failure, NOT an expertise, thesis, product, or identity verdict. Your bound '
    || 'model, existing state, and artifacts are preserved. A prior external side '
    || 'effect may have occurred despite the missing response; reconcile authoritative '
    || 'results before replaying it. On authorized resume, review the checkpoint and '
    || 'identify one concise, evidence-producing next action or state the blocked '
    || 'dependency. Do not repeat the same oversized call or request verification '
    || 'without new evidence. Substantive goals and implementation choices remain yours. '
    || 'An acknowledgment is not proof the interrupted operation succeeded.';

  insert into agent_lab.admin_chat_messages(agent_id,sender_kind,content,delivery_status,metadata)
  values (p_agent_id,'admin',v_message,'queued',
    jsonb_build_object('origin','automatic_runtime_intervention_v0_1',
      'system_authored',true,'not_human_admin',true,'intervention_id',v_event_id,
      'source_wake_request_id',p_wake_request_id,'failure_class',p_failure_class,
      'requires_authorized_resume',true,'model_switch_performed',false))
  returning message_id into v_message_id;

  v_attention_id:=agent_lab.enqueue_attention_item_v0_1(
    p_agent_id,'admin_message',v_message_id::text,'runtime_intervention',0.95,0.90,
    0.75,0.70,0,1,'boundary',
    jsonb_build_object('admin_chat_message_id',v_message_id,'message',v_message,
      'intervention_id',v_event_id,'system_authored',true),
    jsonb_build_object('origin','automatic_runtime_intervention_v0_1',
      'source_wake_request_id',p_wake_request_id,'failure_class',p_failure_class)
  );
  update agent_lab.intervention_events
     set message_id=v_message_id,attention_item_id=v_attention_id,updated_at=now()
   where intervention_id=v_event_id;

  return jsonb_build_object('status','queued_for_authorized_resume',
    'intervention_id',v_event_id,'message_id',v_message_id,
    'attention_item_id',v_attention_id,'wake_request_id',p_wake_request_id);
end;
$function$;

REVOKE ALL ON FUNCTION agent_lab.queue_intervention_admin_message_v0_1(uuid,uuid,text,text,integer) FROM PUBLIC,anon,authenticated;

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
  -- Persist the automatically generated admin realignment message only
  -- after the failed wake, paused lifecycle, and suspended levy are durable.
  if v_released and v_nvidia_timeout and v_status_after='failed' then
    begin
      perform agent_lab.queue_intervention_admin_message_v0_1(
        v_agent_id,p_wake_request_id,'nvidia_model_timeout',v_error,v_attempts
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
$function$;

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

CREATE OR REPLACE FUNCTION agent_lab.recover_orphaned_autonomous_intents_v0_1(p_min_running_minutes integer DEFAULT 5, p_retry_minutes integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_count integer:=0;
  v_current_worker text;
  v_heartbeat timestamptz;
  r record;
begin
  select worker_id,heartbeat_at into v_current_worker,v_heartbeat
  from agent_lab.runtime_worker_health where queue_name='aau.intent';

  for r in
    select q.wake_request_id,q.agent_id,q.worker_id,q.started_at,q.attempts,q.metadata
    from agent_lab.wake_queue q
    where q.status='running'
      and coalesce((q.metadata->>'autonomous_lifecycle')::boolean,false)=true
      and q.started_at is not null
      and q.started_at < now()-make_interval(mins=>greatest(3,coalesce(p_min_running_minutes,5)))
      and (
        -- A different healthy worker has replaced the claimant.
        (v_current_worker is not null and q.worker_id is distinct from v_current_worker and v_heartbeat is not null and v_heartbeat>now()-interval '2 minutes')
        -- Or worker health itself is stale/missing.
        or v_heartbeat is null or v_heartbeat<now()-interval '2 minutes'
        -- Absolute ceiling: no canonical NVIDIA cognition should remain running this long.
        or q.started_at<now()-interval '15 minutes'
      )
    for update skip locked
  loop
    -- Any orphan with three or more execution attempts requires a terminal
    -- operator hold. Preserve the failed wake; do not keep replaying it.
    if r.attempts>=3 then
      update agent_lab.wake_queue q
         set status='failed',completed_at=now(),worker_id=null,
             last_error='orphaned_running_intent_retry_exhausted',
             metadata=(coalesce(q.metadata,'{}'::jsonb)
               -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by'
               -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue')
               ||jsonb_build_object(
                 'failure_class','orphaned_running_intent',
                 'orphan_recovery_version','intervention_orphan_bounded_v0_1',
                 'last_claimed_worker',r.worker_id,
                 'last_started_at',r.started_at,
                 'orphan_max_attempts',3,
                 'recovery_required',true,
                 'retry_scheduled',false,
                 'model_switch_performed',false)
       where q.wake_request_id=r.wake_request_id and q.status='running';
      if not found then continue; end if;

      update agent_lab.autonomous_lifecycle_runs
         set status='paused',next_wake_at=null,
             last_error='orphaned_running_intent_retry_exhausted',
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'repair_required',true,'repair_reason','orphaned_running_intent_exhausted',
               'repair_required_at',now(),
               'failed_wake_request_id',r.wake_request_id,
               'orphan_max_attempts',3,
               'orphan_recovery_version','intervention_orphan_bounded_v0_1'),
             updated_at=now()
       where agent_id=r.agent_id;
      update agent_lab.agent_existence_accounts
         set account_state='suspended',levy_enabled=false,
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'suspended_reason','orphaned_running_intent_exhausted',
               'suspended_at',now(),'failed_wake_request_id',r.wake_request_id,
               'resume_rule','restart_next_due_from_resume_time'),
             updated_at=now()
       where agent_id=r.agent_id;
      update agent_lab.state
         set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
               'system_paused',true,'awake',false,'sleeping',false,
               'intent_pending',false,'wake_pending',false,
               'repair_pause_reason','orphaned_running_intent_exhausted',
               'failed_wake_request_id',r.wake_request_id),
             updated_at=now()
       where agent_id=r.agent_id;

      insert into agent_lab.operator_alerts(agent_id,alert_type,severity,title,detail,source_ref,metadata)
      values (r.agent_id,'orphaned_autonomous_intent_exhausted','warning',
              'Orphaned autonomous intent requires intervention',
              'An orphaned cognition exhausted its three-attempt limit. Agent paused and levy suspended until explicit recovery.',
              r.wake_request_id::text,
              jsonb_build_object('last_worker_id',r.worker_id,'last_started_at',r.started_at,
                'attempts',r.attempts,'recovery_version','intervention_orphan_bounded_v0_1'))
      on conflict(agent_id,alert_type,source_ref) do update
        set status='open',resolved_at=null,last_seen_at=now(),
            occurrences=agent_lab.operator_alerts.occurrences+1,
            detail=excluded.detail,metadata=excluded.metadata;
      begin
        perform agent_lab.queue_intervention_admin_message_v0_1(
          r.agent_id,r.wake_request_id,'orphaned_running_intent',
          'orphaned_running_intent_retry_exhausted',r.attempts
        );
      exception when others then
        update agent_lab.wake_queue q
           set metadata=coalesce(q.metadata,'{}'::jsonb)||jsonb_build_object(
             'intervention_enqueue_error',left(sqlerrm,300),
             'intervention_enqueue_failed_at',now())
         where q.wake_request_id=r.wake_request_id;
      end;
      v_count:=v_count+1;
      continue;
    end if;

    update agent_lab.wake_queue q
       set status='queued',worker_id=null,claimed_at=null,started_at=null,
           due_at=now()+make_interval(mins=>greatest(1,least(coalesce(p_retry_minutes,1),60))),
           last_error='orphaned_running_intent_recovered_by_health_monitor',
           metadata=(coalesce(q.metadata,'{}'::jsonb)
             -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by'-'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue')
             ||jsonb_build_object(
               'orphan_recovered_at',now(),
               'orphan_recovered_from_worker',r.worker_id,
               'orphan_recovery_version','orphan_intent_recovery_v0_1',
               'orphan_original_started_at',r.started_at
             )
     where q.wake_request_id=r.wake_request_id;

    update agent_lab.autonomous_lifecycle_runs
       set status='degraded',last_error='orphaned_running_intent_recovered_for_retry',next_wake_at=now()+make_interval(mins=>greatest(1,least(coalesce(p_retry_minutes,1),60))),updated_at=now()
     where agent_id=r.agent_id and status in ('starting','running','degraded');

    insert into agent_lab.operator_alerts(agent_id,alert_type,severity,title,detail,source_ref,metadata)
    values(r.agent_id,'orphaned_autonomous_intent_recovered','warning','Orphaned autonomous intent recovered','A running autonomous intent outlived its claiming worker/runtime and was safely returned to the queue for retry.',r.wake_request_id::text,jsonb_build_object('worker_id',r.worker_id,'started_at',r.started_at,'recovery_version','orphan_intent_recovery_v0_1'))
    on conflict(agent_id,alert_type,source_ref) do update set status='open',resolved_at=null,last_seen_at=now(),occurrences=agent_lab.operator_alerts.occurrences+1,detail=excluded.detail,metadata=excluded.metadata;

    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;
