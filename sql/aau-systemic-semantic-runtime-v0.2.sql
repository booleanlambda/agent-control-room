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

  if p_action not in ('init','get','charge','close') then
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
      'semantic_node_count',v_runtime.semantic_node_count,
      'event_id',v_existing.event_id,'event_outcome','budget_exhausted',
      'fingerprint_repeat_count',0,'idempotent',false,'available',false
    );
  end if;

  v_after:=v_before-p_cost_units;
  update agent_lab.cognition_assignment_runtime
     set remaining_budget_units=v_after,
         transition_count=transition_count+1,
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

commit;
