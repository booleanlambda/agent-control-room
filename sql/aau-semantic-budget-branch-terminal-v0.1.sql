-- Semantic budget exhaustion is a branch terminal, not an agent terminal.
-- SEMANTIC_RUNTIME_CYCLE_LOCK remains a global pause because it signals runaway cognition.
-- Budget exhaustion schedules a 5-minute autonomous handoff so the agent can choose
-- a different viable action without replaying the exhausted branch.

create or replace function public.aau_bridge_hold_semantic_runtime_terminal_v0_2(
  p_bridge_token text,
  p_intent_execution_id uuid,
  p_terminal_code text,
  p_error text,
  p_runtime_state jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','public'
as $function$
declare
  v_agent_id uuid;
  v_status text;
  v_error text:=left(coalesce(p_error,'semantic_runtime_terminal'),3000);
  v_class text;
  v_handoff_id uuid;
  v_due timestamptz:=now()+interval '5 minutes';
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if p_terminal_code not in ('SEMANTIC_BUDGET_EXHAUSTED','SEMANTIC_RUNTIME_CYCLE_LOCK') then
    raise exception 'semantic_runtime_terminal_code_invalid';
  end if;
  if p_runtime_state is null or jsonb_typeof(p_runtime_state)<>'object'
     or octet_length(p_runtime_state::text)>16000 then
    raise exception 'semantic_runtime_terminal_state_invalid';
  end if;

  v_class:=case
    when p_terminal_code='SEMANTIC_BUDGET_EXHAUSTED' then 'semantic_runtime_budget_exhausted'
    else 'semantic_runtime_cycle_lock'
  end;

  select q.agent_id,q.status into v_agent_id,v_status
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id
  for update;

  if v_agent_id is null then
    return jsonb_build_object(
      'status','not_found',
      'intent_execution_id',p_intent_execution_id,
      'terminal_code',p_terminal_code
    );
  end if;

  if p_terminal_code='SEMANTIC_BUDGET_EXHAUSTED' then
    if v_status in ('claimed','running','queued') then
      update agent_lab.wake_queue
         set status='failed',
             completed_at=coalesce(completed_at,now()),
             last_error=v_error,
             worker_id=null,
             metadata=(coalesce(metadata,'{}'::jsonb)
               -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
               -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
               ||jsonb_build_object(
                 'failure_class',v_class,
                 'semantic_runtime_terminal',true,
                 'semantic_runtime_terminal_code',p_terminal_code,
                 'semantic_runtime_terminal_at',now(),
                 'semantic_runtime_state',p_runtime_state,
                 'retry_scheduled',false,
                 'branch_terminal',true,
                 'agent_lifecycle_continues',true
               )
       where wake_request_id=p_intent_execution_id;

      insert into agent_lab.wake_queue(
        agent_id,source_kind,trigger_type,priority,status,due_at,payload,metadata
      )
      values(
        v_agent_id,
        'system',
        'semantic_budget_handoff',
        0.95,
        'queued',
        v_due,
        jsonb_build_object(
          'reason','A semantic branch exhausted its admitted budget. Treat that branch as terminal for this epoch. Preserve its durable evidence and checkpoint. Do not replay discovery solely to continue it. Choose a different viable next action, conclude from existing evidence, narrow the requirement, or defer the branch according to your own judgment.',
          'terminal_code',p_terminal_code,
          'terminal_branch_intent_execution_id',p_intent_execution_id,
          'semantic_runtime_state',p_runtime_state,
          'semantic_state_preserved',true,
          'discovery_replay_forbidden_without_material_evidence_change',true
        ),
        jsonb_build_object(
          'autonomous_lifecycle',true,
          'rabbit_transport','aau.intent',
          'protocol_version','next_intent_protocol_v0_1',
          'intent_timing_version','intent_timing_v0_2',
          'semantic_budget_handoff',true,
          'terminal_branch_intent_execution_id',p_intent_execution_id,
          'semantic_runtime_terminal_code',p_terminal_code
        )
      )
      returning wake_request_id into v_handoff_id;
    else
      select q.wake_request_id into v_handoff_id
      from agent_lab.wake_queue q
      where q.agent_id=v_agent_id
        and q.status='queued'
        and q.metadata->>'semantic_budget_handoff'='true'
        and q.metadata->>'terminal_branch_intent_execution_id'=p_intent_execution_id::text
      order by q.created_at desc
      limit 1;
    end if;

    update agent_lab.autonomous_lifecycle_runs
       set status='running',
           next_wake_at=v_due,
           last_error=null,
           metadata=(coalesce(metadata,'{}'::jsonb)-'pause_reason'-'repair_required'-'repair_reason')
             ||jsonb_build_object(
               'semantic_runtime_terminal',true,
               'semantic_runtime_terminal_code',p_terminal_code,
               'semantic_runtime_failure_class',v_class,
               'semantic_runtime_terminal_at',now(),
               'semantic_runtime_state',p_runtime_state,
               'semantic_budget_handoff_pending',v_handoff_id is not null,
               'semantic_budget_handoff_intent_id',v_handoff_id,
               'semantic_budget_handoff_due_at',v_due,
               'semantic_branch_terminal_policy','branch_terminal_agent_continues_v0_1'
             ),
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.agent_existence_accounts
       set account_state='current',
           levy_enabled=true,
           next_due_at=now()+interval '1 minute',
           metadata=(coalesce(metadata,'{}'::jsonb)-'suspended_reason'-'suspended_at')
             ||jsonb_build_object(
               'semantic_branch_terminal_at',now(),
               'semantic_branch_terminal_code',p_terminal_code,
               'resume_rule','agent_continues_after_branch_terminal',
               'semantic_branch_terminal_policy','branch_terminal_agent_continues_v0_1'
             ),
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.state
       set state_payload=(coalesce(state_payload,'{}'::jsonb)-'repair_pause_reason')
             ||jsonb_build_object(
               'system_paused',false,
               'awake',false,
               'sleeping',true,
               'wake_pending',true,
               'intent_pending',true,
               'between_cognition_ticks',true,
               'inactive_between_wakes',true,
               'semantic_runtime_terminal_code',p_terminal_code,
               'semantic_runtime_terminal_at',now(),
               'semantic_budget_handoff_intent_id',v_handoff_id,
               'semantic_budget_handoff_due_at',v_due,
               'semantic_branch_terminal_policy','branch_terminal_agent_continues_v0_1'
             ),
           updated_at=now()
     where agent_id=v_agent_id;

    return jsonb_build_object(
      'status','branch_terminal_handoff',
      'intent_execution_id',p_intent_execution_id,
      'agent_id',v_agent_id,
      'terminal_code',p_terminal_code,
      'failure_class',v_class,
      'retry_scheduled',false,
      'branch_terminal',true,
      'agent_lifecycle_continues',true,
      'handoff_intent_execution_id',v_handoff_id,
      'handoff_due_at',v_due,
      'contract','systemic_semantic_runtime_v0_3_branch_terminal'
    );
  end if;

  if v_status in ('claimed','running','queued') then
    update agent_lab.wake_queue
       set status='failed',
           completed_at=coalesce(completed_at,now()),
           last_error=v_error,
           worker_id=null,
           metadata=(coalesce(metadata,'{}'::jsonb)
             -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
             -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
             ||jsonb_build_object(
               'failure_class',v_class,
               'semantic_runtime_terminal',true,
               'semantic_runtime_terminal_code',p_terminal_code,
               'semantic_runtime_terminal_at',now(),
               'semantic_runtime_state',p_runtime_state,
               'retry_scheduled',false
             )
     where wake_request_id=p_intent_execution_id;
  end if;

  update agent_lab.autonomous_lifecycle_runs
     set status='paused',
         next_wake_at=null,
         last_error=v_error,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'semantic_runtime_terminal',true,
           'semantic_runtime_terminal_code',p_terminal_code,
           'semantic_runtime_failure_class',v_class,
           'semantic_runtime_terminal_at',now(),
           'semantic_runtime_state',p_runtime_state
         ),
         updated_at=now()
   where agent_id=v_agent_id
     and status in ('starting','running','degraded','paused');

  update agent_lab.agent_existence_accounts
     set account_state='suspended',
         levy_enabled=false,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'suspended_reason',v_class,
           'suspended_at',now(),
           'resume_rule','explicit_new_semantic_runtime_epoch_or_operator_resolution'
         ),
         updated_at=now()
   where agent_id=v_agent_id;

  update agent_lab.state
     set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
           'system_paused',true,
           'awake',false,
           'sleeping',false,
           'wake_pending',false,
           'intent_pending',false,
           'repair_pause_reason',v_class,
           'semantic_runtime_terminal_code',p_terminal_code,
           'semantic_runtime_terminal_at',now()
         ),
         updated_at=now()
   where agent_id=v_agent_id;

  return jsonb_build_object(
    'status','terminal_hold',
    'intent_execution_id',p_intent_execution_id,
    'agent_id',v_agent_id,
    'terminal_code',p_terminal_code,
    'failure_class',v_class,
    'retry_scheduled',false,
    'existence_suspended',true,
    'contract','systemic_semantic_runtime_v0_3_branch_terminal'
  );
end;
$function$;
