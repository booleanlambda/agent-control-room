-- Semantic branch-terminal fresh epoch handoff v0.2
-- Budget exhaustion closes only the current semantic epoch/branch.
-- The next 5-minute handoff runs against one idempotently-created fresh epoch.
-- Prior checkpoints/evidence remain durable history. Cycle locks still pause globally.

CREATE OR REPLACE FUNCTION agent_lab.ensure_semantic_runtime_epoch_after_terminal_v0_1(p_agent_id uuid, p_runtime_id uuid, p_reason text DEFAULT 'automatic_branch_terminal_handoff'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'public'
AS $function$
declare
  v_terminal agent_lab.cognition_assignment_runtime%rowtype;
  v_latest agent_lab.cognition_assignment_runtime%rowtype;
  v_renewed jsonb;
begin
  select * into v_terminal
  from agent_lab.cognition_assignment_runtime
  where runtime_id=p_runtime_id
    and agent_id=p_agent_id
  for update;

  if not found then
    raise exception 'semantic_terminal_runtime_missing';
  end if;

  select * into v_latest
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id
    and assignment_key=v_terminal.assignment_key
    and model_id=v_terminal.model_id
  order by epoch_no desc
  limit 1
  for update;

  if not found then
    raise exception 'semantic_terminal_assignment_missing';
  end if;

  if v_latest.status='active' then
    return jsonb_build_object(
      'status','already_active',
      'assignment_key',v_latest.assignment_key,
      'runtime_id',v_latest.runtime_id,
      'epoch_no',v_latest.epoch_no,
      'initial_budget_units',v_latest.initial_budget_units,
      'remaining_budget_units',v_latest.remaining_budget_units,
      'runtime_status',v_latest.status,
      'terminal_runtime_id',v_terminal.runtime_id,
      'terminal_epoch_no',v_terminal.epoch_no,
      'history_preserved',true,
      'idempotent',true
    );
  end if;

  if v_latest.status not in ('budget_exhausted','blocked') then
    raise exception 'semantic_latest_runtime_not_renewable:%',v_latest.status;
  end if;

  v_renewed:=agent_lab.renew_cognition_assignment_runtime_epoch(
    p_agent_id,
    v_latest.assignment_key,
    left(coalesce(nullif(btrim(p_reason),''),'automatic_branch_terminal_handoff'),500)
  );

  return coalesce(v_renewed,'{}'::jsonb)
    || jsonb_build_object(
      'terminal_runtime_id',v_terminal.runtime_id,
      'terminal_epoch_no',v_terminal.epoch_no,
      'history_preserved',true,
      'idempotent',false
    );
end;
$function$
;

revoke all on function agent_lab.ensure_semantic_runtime_epoch_after_terminal_v0_1(uuid,uuid,text)
  from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.aau_bridge_hold_semantic_runtime_terminal_v0_2(p_bridge_token text, p_intent_execution_id uuid, p_terminal_code text, p_error text, p_runtime_state jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'public'
AS $function$
declare
  v_agent_id uuid;
  v_status text;
  v_error text:=left(coalesce(p_error,'semantic_runtime_terminal'),3000);
  v_class text;
  v_handoff_id uuid;
  v_due timestamptz:=now()+interval '5 minutes';
  v_terminal_runtime_id uuid;
  v_renewal jsonb:='{}'::jsonb;
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
    begin
      v_terminal_runtime_id:=nullif(p_runtime_state->>'runtime_id','')::uuid;
    exception when others then
      v_terminal_runtime_id:=null;
    end;

    if v_terminal_runtime_id is null then
      select r.runtime_id into v_terminal_runtime_id
      from agent_lab.cognition_assignment_runtime r
      where r.agent_id=v_agent_id
        and r.status='budget_exhausted'
      order by r.updated_at desc
      limit 1;
    end if;

    if v_terminal_runtime_id is null then
      raise exception 'semantic_budget_terminal_runtime_unresolved';
    end if;

    v_renewal:=agent_lab.ensure_semantic_runtime_epoch_after_terminal_v0_1(
      v_agent_id,
      v_terminal_runtime_id,
      'automatic_branch_terminal_handoff_v0_2'
    );

    if coalesce(v_renewal->>'runtime_status','')<>'active' then
      raise exception 'semantic_budget_handoff_epoch_not_active';
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
                 'retry_scheduled',false,
                 'branch_terminal',true,
                 'agent_lifecycle_continues',true,
                 'handoff_active_runtime_id',v_renewal->>'runtime_id',
                 'handoff_active_epoch_no',v_renewal->>'epoch_no',
                 'handoff_epoch_renewal_status',v_renewal->>'status'
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
          'reason','A semantic branch exhausted its admitted budget. The exhausted epoch is closed and a fresh semantic epoch is active. Preserve durable evidence and checkpoints from the prior epoch as read-only history. Do not replay discovery solely to continue the exhausted branch. Choose a different viable next action, conclude from existing evidence, narrow the requirement, or defer the branch according to your own judgment.',
          'terminal_code',p_terminal_code,
          'terminal_branch_intent_execution_id',p_intent_execution_id,
          'terminal_runtime_id',v_terminal_runtime_id,
          'terminal_semantic_runtime_state',p_runtime_state,
          'active_runtime_id',v_renewal->>'runtime_id',
          'active_epoch_no',v_renewal->>'epoch_no',
          'semantic_state_preserved',true,
          'prior_epoch_read_only',true,
          'discovery_replay_forbidden_without_material_evidence_change',true
        ),
        jsonb_build_object(
          'autonomous_lifecycle',true,
          'rabbit_transport','aau.intent',
          'protocol_version','next_intent_protocol_v0_1',
          'intent_timing_version','intent_timing_v0_2',
          'semantic_budget_handoff',true,
          'semantic_budget_handoff_version','fresh_epoch_v0_2',
          'terminal_branch_intent_execution_id',p_intent_execution_id,
          'terminal_runtime_id',v_terminal_runtime_id,
          'active_runtime_id',v_renewal->>'runtime_id',
          'active_epoch_no',v_renewal->>'epoch_no',
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
           metadata=(
             coalesce(metadata,'{}'::jsonb)
             -'pause_reason'-'repair_required'-'repair_reason'
             -'semantic_runtime_terminal'-'semantic_runtime_terminal_code'
             -'semantic_runtime_failure_class'-'semantic_runtime_terminal_at'
             -'semantic_runtime_state'
           ) || jsonb_build_object(
               'last_semantic_branch_terminal_code',p_terminal_code,
               'last_semantic_branch_terminal_at',now(),
               'last_semantic_branch_terminal_runtime_id',v_terminal_runtime_id,
               'semantic_runtime_active_epoch',v_renewal->>'epoch_no',
               'semantic_runtime_active_runtime_id',v_renewal->>'runtime_id',
               'semantic_budget_handoff_pending',v_handoff_id is not null,
               'semantic_budget_handoff_intent_id',v_handoff_id,
               'semantic_budget_handoff_due_at',v_due,
               'semantic_branch_terminal_policy','branch_terminal_fresh_epoch_v0_2'
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
               'resume_rule','agent_continues_in_fresh_semantic_epoch',
               'semantic_branch_terminal_policy','branch_terminal_fresh_epoch_v0_2',
               'semantic_runtime_active_runtime_id',v_renewal->>'runtime_id',
               'semantic_runtime_active_epoch',v_renewal->>'epoch_no'
             ),
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.state
       set state_payload=(
             coalesce(state_payload,'{}'::jsonb)
             -'repair_pause_reason'-'semantic_runtime_terminal_code'-'semantic_runtime_terminal_at'
           ) ||jsonb_build_object(
               'system_paused',false,
               'awake',false,
               'sleeping',true,
               'wake_pending',true,
               'intent_pending',true,
               'between_cognition_ticks',true,
               'inactive_between_wakes',true,
               'last_semantic_branch_terminal_code',p_terminal_code,
               'last_semantic_branch_terminal_at',now(),
               'last_semantic_branch_terminal_runtime_id',v_terminal_runtime_id,
               'semantic_runtime_active_runtime_id',v_renewal->>'runtime_id',
               'semantic_runtime_active_epoch',v_renewal->>'epoch_no',
               'semantic_budget_handoff_intent_id',v_handoff_id,
               'semantic_budget_handoff_due_at',v_due,
               'semantic_branch_terminal_policy','branch_terminal_fresh_epoch_v0_2'
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
      'terminal_runtime_id',v_terminal_runtime_id,
      'active_runtime_id',v_renewal->>'runtime_id',
      'active_epoch_no',v_renewal->>'epoch_no',
      'epoch_renewal_status',v_renewal->>'status',
      'handoff_intent_execution_id',v_handoff_id,
      'handoff_due_at',v_due,
      'contract','systemic_semantic_runtime_v0_4_branch_terminal_fresh_epoch'
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
           'resume_rule','explicit_operator_resolution_for_cycle_lock'
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
    'contract','systemic_semantic_runtime_v0_4_branch_terminal_fresh_epoch'
  );
end;
$function$
;

revoke all on function public.aau_bridge_hold_semantic_runtime_terminal_v0_2(text,uuid,text,text,jsonb)
  from public,authenticated,service_role;
grant execute on function public.aau_bridge_hold_semantic_runtime_terminal_v0_2(text,uuid,text,text,jsonb)
  to anon;
