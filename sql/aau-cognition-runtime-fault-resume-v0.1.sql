create or replace function agent_lab.resume_cognition_runtime_fault_v0_1(
  p_agent_id uuid,
  p_reason text default 'runtime repair completed'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_run_id uuid;
  v_wake_id uuid;
  v_prior_error text;
begin
  select r.run_id,r.last_error
    into v_run_id,v_prior_error
  from agent_lab.autonomous_lifecycle_runs r
  where r.agent_id=p_agent_id
    and r.status='paused'
    and coalesce(r.metadata->>'repair_reason','')='cognition_runtime_fault'
  for update;

  if v_run_id is null then
    raise exception 'cognition_runtime_fault_resume_not_applicable';
  end if;

  update agent_lab.autonomous_lifecycle_runs
     set status='running',
         next_wake_at=now(),
         last_error=null,
         metadata=(
           coalesce(metadata,'{}'::jsonb)
           -'repair_required'
           -'repair_reason'
           -'repair_required_at'
           -'failed_wake_request_id'
         ) || jsonb_build_object(
           'runtime_fault_resumed_at',now(),
           'runtime_fault_resume_reason',left(coalesce(p_reason,'runtime repair completed'),1000),
           'runtime_fault_prior_error',left(coalesce(v_prior_error,''),2000),
           'runtime_fault_resume_contract','cognition_runtime_fault_resume_v0_1',
           'semantic_state_preserved',true
         ),
         updated_at=now()
   where run_id=v_run_id;

  update agent_lab.state
     set state_payload=(
           coalesce(state_payload,'{}'::jsonb)
           -'repair_pause_reason'
           -'failed_wake_request_id'
         ) || jsonb_build_object(
           'system_paused',false,
           'awake',true,
           'sleeping',false,
           'inactive_between_wakes',false,
           'between_cognition_ticks',false,
           'intent_pending',true,
           'wake_pending',true,
           'intent_pending_since',now(),
           'wake_pending_since',now(),
           'runtime_fault_resumed_at',now()
         ),
         updated_at=now()
   where agent_id=p_agent_id;

  update agent_lab.agent_existence_accounts
     set account_state='current',
         levy_enabled=true,
         next_due_at=now()+interval '1 minute',
         metadata=(
           coalesce(metadata,'{}'::jsonb)
           -'suspended_reason'
           -'suspended_at'
           -'failed_wake_request_id'
           -'resume_rule'
         ) || jsonb_build_object(
           'resumed_at',now(),
           'resume_reason','cognition_runtime_fault_repaired',
           'runtime_fault_resume_contract','cognition_runtime_fault_resume_v0_1'
         ),
         updated_at=now()
   where agent_id=p_agent_id;

  select q.wake_request_id
    into v_wake_id
  from agent_lab.wake_queue q
  where q.agent_id=p_agent_id
    and q.status in ('queued','claimed','running')
    and coalesce((q.metadata->>'autonomous_lifecycle')::boolean,false)=true
  order by q.created_at desc
  limit 1;

  if v_wake_id is null then
    insert into agent_lab.wake_queue(
      agent_id,source_kind,trigger_type,priority,status,due_at,payload,metadata
    ) values (
      p_agent_id,
      'system',
      'runtime_repair_resume',
      1,
      'queued',
      now(),
      jsonb_build_object(
        'reason',left(coalesce(p_reason,'Resume preserved cognition after runtime repair.'),1000)
      ),
      jsonb_build_object(
        'autonomous_lifecycle',true,
        'lifecycle_run_id',v_run_id,
        'rabbit_transport','aau.intent',
        'protocol_version','next_intent_protocol_v0_1',
        'runtime_repair_resume',true,
        'runtime_fault_resume_contract','cognition_runtime_fault_resume_v0_1',
        'semantic_state_preserved',true
      )
    )
    returning wake_request_id into v_wake_id;
  end if;

  return jsonb_build_object(
    'status','resumed',
    'agent_id',p_agent_id,
    'run_id',v_run_id,
    'wake_request_id',v_wake_id,
    'semantic_state_preserved',true,
    'contract','cognition_runtime_fault_resume_v0_1'
  );
end;
$function$;

revoke all on function agent_lab.resume_cognition_runtime_fault_v0_1(uuid,text) from public,anon,authenticated;
