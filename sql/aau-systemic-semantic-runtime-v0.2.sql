-- AAU systemic semantic runtime budget + transition ledger v0.2
-- Separates semantic requirement nodes from runtime work/recovery accounting.
-- A wake restart never replenishes the assignment epoch budget.
begin;

create table if not exists agent_lab.cognition_assignment_runtime (
  runtime_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  assignment_key text not null,
  model_id text not null,
  epoch_no integer not null default 1 check (epoch_no between 1 and 1000000),
  budget_quantum_tokens integer not null default 1000 check (budget_quantum_tokens between 100 and 100000),
  initial_budget_units integer not null check (initial_budget_units between 1 and 10000000),
  remaining_budget_units integer not null check (remaining_budget_units between 0 and 10000000),
  transition_count integer not null default 0 check (transition_count >= 0),
  material_transition_count integer not null default 0 check (material_transition_count >= 0),
  semantic_node_count integer not null default 0 check (semantic_node_count >= 0),
  status text not null default 'active'
    check (status in ('active','complete','blocked','budget_exhausted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agent_id,assignment_key,model_id,epoch_no)
);

create table if not exists agent_lab.cognition_runtime_events (
  event_id uuid primary key default gen_random_uuid(),
  runtime_id uuid not null references agent_lab.cognition_assignment_runtime(runtime_id) on delete cascade,
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  wake_request_id uuid references agent_lab.wake_queue(wake_request_id),
  assignment_key text not null,
  model_id text not null,
  epoch_no integer not null,
  node_path text,
  event_key text not null,
  event_kind text not null,
  event_fingerprint text,
  cost_units integer not null default 0 check (cost_units >= 0),
  budget_before integer not null check (budget_before >= 0),
  budget_after integer not null check (budget_after >= 0),
  outcome text not null check (outcome in ('charged','budget_exhausted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(runtime_id,event_key)
);

create index if not exists cognition_assignment_runtime_agent_idx
  on agent_lab.cognition_assignment_runtime(agent_id,updated_at desc);
create index if not exists cognition_runtime_events_assignment_idx
  on agent_lab.cognition_runtime_events(agent_id,assignment_key,epoch_no,created_at desc);
create index if not exists cognition_runtime_events_fingerprint_idx
  on agent_lab.cognition_runtime_events(runtime_id,event_fingerprint,created_at desc)
  where event_fingerprint is not null;

alter table agent_lab.cognition_assignment_runtime enable row level security;
alter table agent_lab.cognition_runtime_events enable row level security;
revoke all on agent_lab.cognition_assignment_runtime from public,anon,authenticated;
revoke all on agent_lab.cognition_runtime_events from public,anon,authenticated;

create or replace function public.aau_bridge_cognition_assignment_runtime_v0_2(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_assignment_key text,
  p_model text,
  p_action text,
  p_epoch_no integer default 1,
  p_initial_budget_units integer default null,
  p_quantum_tokens integer default 1000,
  p_event_key text default null,
  p_event_kind text default null,
  p_event_fingerprint text default null,
  p_cost_units integer default 0,
  p_node_path text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare
  v_bound text;
  v_runtime agent_lab.cognition_assignment_runtime%rowtype;
  v_existing agent_lab.cognition_runtime_events%rowtype;
  v_before integer;
  v_after integer;
  v_repeat integer:=0;
  v_close_status text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select primary_model_id into v_bound
  from agent_lab.agents
  where agent_id=p_agent_id;

  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'cognition_assignment_runtime_bound_model_mismatch';
  end if;

  if p_action not in ('resolve','init','get','charge','close') then
    raise exception 'cognition_assignment_runtime_invalid_action';
  end if;
  if length(coalesce(p_assignment_key,'')) not between 1 and 240
     or p_epoch_no not between 1 and 1000000 then
    raise exception 'cognition_assignment_runtime_invalid_identity';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object'
     or octet_length(p_metadata::text)>16000 then
    raise exception 'cognition_assignment_runtime_invalid_metadata';
  end if;
  if p_node_path is not null and p_node_path !~ '^R([.][0-9]{3}){0,16}$' then
    raise exception 'cognition_assignment_runtime_invalid_node_path';
  end if;

  if p_action='resolve' then
    select * into v_runtime
    from agent_lab.cognition_assignment_runtime
    where agent_id=p_agent_id and assignment_key=p_assignment_key
      and model_id=p_model
    order by epoch_no desc
    limit 1;

    if not found then
      return jsonb_build_object(
        'status','ready','contract','systemic_semantic_runtime_v0_2',
        'runtime_found',false,'epoch_no',1
      );
    end if;

    return jsonb_build_object(
      'status','ready','contract','systemic_semantic_runtime_v0_2',
      'runtime_found',true,
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'budget_quantum_tokens',v_runtime.budget_quantum_tokens,
      'initial_budget_units',v_runtime.initial_budget_units,
      'remaining_budget_units',v_runtime.remaining_budget_units,
      'transition_count',v_runtime.transition_count,
      'material_transition_count',v_runtime.material_transition_count,
      'semantic_node_count',v_runtime.semantic_node_count,
      'runtime_status',v_runtime.status
    );
  end if;

  if p_action='init' then
    if p_initial_budget_units is null or p_initial_budget_units not between 1 and 10000000
       or p_quantum_tokens not between 100 and 100000 then
      raise exception 'cognition_assignment_runtime_invalid_budget';
    end if;

    insert into agent_lab.cognition_assignment_runtime(
      agent_id,assignment_key,model_id,epoch_no,budget_quantum_tokens,
      initial_budget_units,remaining_budget_units,metadata
    ) values (
      p_agent_id,p_assignment_key,p_model,p_epoch_no,p_quantum_tokens,
      p_initial_budget_units,p_initial_budget_units,coalesce(p_metadata,'{}'::jsonb)
    )
    on conflict(agent_id,assignment_key,model_id,epoch_no) do nothing;

    select * into v_runtime
    from agent_lab.cognition_assignment_runtime
    where agent_id=p_agent_id and assignment_key=p_assignment_key
      and model_id=p_model and epoch_no=p_epoch_no;

    return jsonb_build_object(
      'status','ready','contract','systemic_semantic_runtime_v0_2',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'budget_quantum_tokens',v_runtime.budget_quantum_tokens,
      'initial_budget_units',v_runtime.initial_budget_units,
      'remaining_budget_units',v_runtime.remaining_budget_units,
      'transition_count',v_runtime.transition_count,
      'material_transition_count',v_runtime.material_transition_count,
      'semantic_node_count',v_runtime.semantic_node_count,
      'runtime_status',v_runtime.status,'idempotent',true
    );
  end if;

  select * into v_runtime
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id and assignment_key=p_assignment_key
    and model_id=p_model and epoch_no=p_epoch_no
  for update;

  if not found then
    raise exception 'cognition_assignment_runtime_not_initialized';
  end if;

  if p_action='get' then
    return jsonb_build_object(
      'status','ready','contract','systemic_semantic_runtime_v0_2',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'budget_quantum_tokens',v_runtime.budget_quantum_tokens,
      'initial_budget_units',v_runtime.initial_budget_units,
      'remaining_budget_units',v_runtime.remaining_budget_units,
      'transition_count',v_runtime.transition_count,
      'material_transition_count',v_runtime.material_transition_count,
      'semantic_node_count',v_runtime.semantic_node_count,
      'runtime_status',v_runtime.status
    );
  end if;

  if p_action='close' then
    v_close_status:=coalesce(nullif(p_metadata->>'status',''),'complete');
    if v_close_status not in ('complete','blocked','budget_exhausted') then
      raise exception 'cognition_assignment_runtime_invalid_close_status';
    end if;
    update agent_lab.cognition_assignment_runtime
       set status=v_close_status,
           metadata=metadata || (p_metadata - 'status'),
           updated_at=now()
     where runtime_id=v_runtime.runtime_id
     returning * into v_runtime;
    return jsonb_build_object(
      'status','ready','contract','systemic_semantic_runtime_v0_2',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'remaining_budget_units',v_runtime.remaining_budget_units,
      'transition_count',v_runtime.transition_count,
      'material_transition_count',v_runtime.material_transition_count,
      'semantic_node_count',v_runtime.semantic_node_count,
      'runtime_status',v_runtime.status
    );
  end if;

  if length(coalesce(p_event_key,'')) not between 1 and 240
     or length(coalesce(p_event_kind,'')) not between 1 and 120
     or p_cost_units not between 1 and 1000000 then
    raise exception 'cognition_assignment_runtime_invalid_charge';
  end if;
  if p_event_fingerprint is not null
     and (length(p_event_fingerprint)<>64 or p_event_fingerprint !~ '^[0-9a-f]{64}$') then
    raise exception 'cognition_assignment_runtime_invalid_fingerprint';
  end if;

  select * into v_existing
  from agent_lab.cognition_runtime_events
  where runtime_id=v_runtime.runtime_id and event_key=p_event_key;

  if found then
    if v_existing.event_kind is distinct from p_event_kind
       or v_existing.cost_units is distinct from p_cost_units
       or coalesce(v_existing.node_path,'') is distinct from coalesce(p_node_path,'') then
      raise exception 'cognition_assignment_runtime_event_key_conflict';
    end if;
    if p_event_fingerprint is not null then
      select count(*)::integer into v_repeat
      from agent_lab.cognition_runtime_events
      where runtime_id=v_runtime.runtime_id
        and event_fingerprint=p_event_fingerprint;
    end if;
    return jsonb_build_object(
      'status','ready','contract','systemic_semantic_runtime_v0_2',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status',v_runtime.status,
      'remaining_budget_units',v_runtime.remaining_budget_units,
      'transition_count',v_runtime.transition_count,
      'material_transition_count',v_runtime.material_transition_count,
      'semantic_node_count',v_runtime.semantic_node_count,
      'event_id',v_existing.event_id,'event_outcome',v_existing.outcome,
      'fingerprint_repeat_count',v_repeat,'idempotent',true,
      'available',v_existing.outcome='charged'
    );
  end if;

  v_before:=v_runtime.remaining_budget_units;

  if v_runtime.status<>'active' or v_before<p_cost_units then
    update agent_lab.cognition_assignment_runtime
       set status='budget_exhausted',updated_at=now()
     where runtime_id=v_runtime.runtime_id
     returning * into v_runtime;
    insert into agent_lab.cognition_runtime_events(
      runtime_id,agent_id,wake_request_id,assignment_key,model_id,epoch_no,
      node_path,event_key,event_kind,event_fingerprint,cost_units,
      budget_before,budget_after,outcome,metadata
    ) values (
      v_runtime.runtime_id,p_agent_id,p_wake_request_id,p_assignment_key,p_model,p_epoch_no,
      p_node_path,p_event_key,p_event_kind,p_event_fingerprint,0,
      v_before,v_before,'budget_exhausted',coalesce(p_metadata,'{}'::jsonb)
    ) returning * into v_existing;

    return jsonb_build_object(
      'status','ready','contract','systemic_semantic_runtime_v0_2',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status','budget_exhausted',
      'remaining_budget_units',v_before,
      'transition_count',v_runtime.transition_count,
      'material_transition_count',v_runtime.material_transition_count,
      'semantic_node_count',v_runtime.semantic_node_count,
      'event_id',v_existing.event_id,'event_outcome','budget_exhausted',
      'fingerprint_repeat_count',0,'idempotent',false,'available',false
    );
  end if;

  v_after:=v_before-p_cost_units;
  update agent_lab.cognition_assignment_runtime
     set remaining_budget_units=v_after,
         transition_count=transition_count+1,
         material_transition_count=material_transition_count+
           case when p_event_kind in ('semantic_transition','semantic_node_created') then 1 else 0 end,
         semantic_node_count=semantic_node_count+
           case when p_event_kind='semantic_node_created' then 1 else 0 end,
         updated_at=now()
   where runtime_id=v_runtime.runtime_id
   returning * into v_runtime;

  insert into agent_lab.cognition_runtime_events(
    runtime_id,agent_id,wake_request_id,assignment_key,model_id,epoch_no,
    node_path,event_key,event_kind,event_fingerprint,cost_units,
    budget_before,budget_after,outcome,metadata
  ) values (
    v_runtime.runtime_id,p_agent_id,p_wake_request_id,p_assignment_key,p_model,p_epoch_no,
    p_node_path,p_event_key,p_event_kind,p_event_fingerprint,p_cost_units,
    v_before,v_after,'charged',coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v_existing;

  if p_event_fingerprint is not null then
    select count(*)::integer into v_repeat
    from agent_lab.cognition_runtime_events
    where runtime_id=v_runtime.runtime_id
      and event_fingerprint=p_event_fingerprint;
  end if;

  return jsonb_build_object(
    'status','ready','contract','systemic_semantic_runtime_v0_2',
    'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
    'runtime_status',v_runtime.status,
    'remaining_budget_units',v_runtime.remaining_budget_units,
    'transition_count',v_runtime.transition_count,
    'semantic_node_count',v_runtime.semantic_node_count,
    'event_id',v_existing.event_id,'event_outcome','charged',
    'fingerprint_repeat_count',v_repeat,'idempotent',false,'available',true
  );
end;
$function$;

revoke all on function public.aau_bridge_cognition_assignment_runtime_v0_2(
  text,uuid,uuid,text,text,text,integer,integer,integer,text,text,text,integer,text,jsonb
) from public,authenticated,service_role;
grant execute on function public.aau_bridge_cognition_assignment_runtime_v0_2(
  text,uuid,uuid,text,text,text,integer,integer,integer,text,text,text,integer,text,jsonb
) to anon;


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
         -- Preserve next_due_at because the column is NOT NULL; levy_enabled=false is the pause gate.
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
    'contract','systemic_semantic_runtime_v0_2'
  );
end;
$function$;

revoke all on function public.aau_bridge_hold_semantic_runtime_terminal_v0_2(
  text,uuid,text,text,jsonb
) from public,authenticated,service_role;
grant execute on function public.aau_bridge_hold_semantic_runtime_terminal_v0_2(
  text,uuid,text,text,jsonb
) to anon;

create or replace function agent_lab.renew_cognition_assignment_runtime_epoch(
  p_agent_id uuid,
  p_reason text default 'operator_renewal'
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare
  v_prev agent_lab.cognition_assignment_runtime%rowtype;
  v_next agent_lab.cognition_assignment_runtime%rowtype;
  v_reason text:=left(coalesce(nullif(btrim(p_reason),''),'operator_renewal'),500);
begin
  select * into v_prev
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id
  order by updated_at desc,epoch_no desc
  limit 1
  for update;

  if not found then
    raise exception 'cognition_assignment_runtime_renewal_missing_prior_epoch';
  end if;
  if v_prev.status not in ('budget_exhausted','blocked') then
    raise exception 'cognition_assignment_runtime_renewal_requires_terminal_epoch:%',v_prev.status;
  end if;
  if v_prev.epoch_no>=1000000 then
    raise exception 'cognition_assignment_runtime_epoch_limit';
  end if;

  insert into agent_lab.cognition_assignment_runtime(
    agent_id,assignment_key,model_id,epoch_no,budget_quantum_tokens,
    initial_budget_units,remaining_budget_units,status,metadata
  ) values (
    v_prev.agent_id,v_prev.assignment_key,v_prev.model_id,v_prev.epoch_no+1,
    v_prev.budget_quantum_tokens,v_prev.initial_budget_units,v_prev.initial_budget_units,
    'active',
    jsonb_build_object(
      'contract','systemic_semantic_runtime_v0_2',
      'renewal_reason',v_reason,
      'renewed_at',now(),
      'renewed_from_runtime_id',v_prev.runtime_id,
      'renewed_from_epoch_no',v_prev.epoch_no,
      'renewed_from_status',v_prev.status,
      'renewed_from_remaining_budget_units',v_prev.remaining_budget_units,
      'history_preserved',true
    )
  )
  returning * into v_next;

  return jsonb_build_object(
    'status','renewed',
    'agent_id',p_agent_id,
    'runtime_id',v_next.runtime_id,
    'epoch_no',v_next.epoch_no,
    'initial_budget_units',v_next.initial_budget_units,
    'remaining_budget_units',v_next.remaining_budget_units,
    'runtime_status',v_next.status,
    'previous_runtime_id',v_prev.runtime_id,
    'previous_epoch_no',v_prev.epoch_no,
    'previous_status',v_prev.status,
    'history_preserved',true
  );
end;
$function$;

revoke all on function agent_lab.renew_cognition_assignment_runtime_epoch(uuid,text)
  from public,anon,authenticated;
grant execute on function agent_lab.renew_cognition_assignment_runtime_epoch(uuid,text)
  to service_role;

commit;
