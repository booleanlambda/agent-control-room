-- AAU semantic replay accounting v0.1
-- Kimi-reviewed policy: durable state replay/persistence is metered but does not consume semantic budget.
-- Model calls and node creation remain charged. Finalization reserve is unchanged.

begin;

alter table agent_lab.cognition_runtime_events
  drop constraint if exists cognition_runtime_events_outcome_check;

alter table agent_lab.cognition_runtime_events
  add constraint cognition_runtime_events_outcome_check
  check (outcome = any (array[
    'charged'::text,
    'budget_exhausted'::text,
    'reserved'::text,
    'settled'::text,
    'released'::text,
    'metered'::text
  ]));

create or replace function public.aau_bridge_meter_semantic_runtime_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_assignment_key text,
  p_model text,
  p_epoch_no integer,
  p_event_key text,
  p_event_kind text,
  p_event_fingerprint text default null,
  p_node_path text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','public'
as $function$
declare
  v_bound text;
  v_runtime agent_lab.cognition_assignment_runtime%rowtype;
  v_existing agent_lab.cognition_runtime_events%rowtype;
  v_effective_key text:=p_event_key;
  v_repeat integer:=0;
  v_wake_attempt integer:=0;
  v_material_progress boolean:=false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select primary_model_id into v_bound
  from agent_lab.agents
  where agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'semantic_runtime_meter_bound_model_mismatch';
  end if;

  if length(coalesce(p_assignment_key,'')) not between 1 and 240
     or p_epoch_no not between 1 and 1000000
     or length(coalesce(p_event_key,'')) not between 1 and 220
     or p_event_kind not in ('semantic_transition','wake_resume')
     or p_metadata is null
     or jsonb_typeof(p_metadata)<>'object'
     or octet_length(p_metadata::text)>16000 then
    raise exception 'semantic_runtime_meter_invalid_input';
  end if;

  if p_event_fingerprint is not null
     and (length(p_event_fingerprint)<>64 or p_event_fingerprint !~ '^[0-9a-f]{64}$') then
    raise exception 'semantic_runtime_meter_invalid_fingerprint';
  end if;
  if p_node_path is not null and p_node_path !~ '^R([.][0-9]{3}){0,16}$' then
    raise exception 'semantic_runtime_meter_invalid_node_path';
  end if;

  if not exists(
    select 1
    from agent_lab.wake_queue q
    where q.wake_request_id=p_wake_request_id
      and q.agent_id=p_agent_id
      and q.status in ('claimed','running')
  ) then
    raise exception 'semantic_runtime_meter_wake_not_running';
  end if;

  select * into v_runtime
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id
    and assignment_key=p_assignment_key
    and model_id=p_model
    and epoch_no=p_epoch_no
  for update;
  if not found then raise exception 'semantic_runtime_meter_runtime_missing'; end if;

  if p_event_kind='wake_resume' then
    select greatest(0,coalesce(q.attempts,0)) into v_wake_attempt
    from agent_lab.wake_queue q
    where q.wake_request_id=p_wake_request_id;
    v_effective_key:=left(p_event_key||':attempt:'||v_wake_attempt::text,240);
  end if;

  select * into v_existing
  from agent_lab.cognition_runtime_events
  where runtime_id=v_runtime.runtime_id
    and event_key=v_effective_key;

  if found then
    if v_existing.event_kind is distinct from p_event_kind
       or coalesce(v_existing.node_path,'') is distinct from coalesce(p_node_path,'') then
      raise exception 'semantic_runtime_meter_event_key_conflict';
    end if;
    if p_event_fingerprint is not null then
      select count(*)::integer into v_repeat
      from agent_lab.cognition_runtime_events
      where runtime_id=v_runtime.runtime_id
        and event_kind=p_event_kind
        and event_fingerprint=p_event_fingerprint;
    end if;
    return jsonb_build_object(
      'status','ready',
      'contract','semantic_replay_accounting_v0_1',
      'runtime_id',v_runtime.runtime_id,
      'epoch_no',v_runtime.epoch_no,
      'runtime_status',v_runtime.status,
      'remaining_budget_units',v_runtime.remaining_budget_units,
      'transition_count',v_runtime.transition_count,
      'material_transition_count',v_runtime.material_transition_count,
      'semantic_node_count',v_runtime.semantic_node_count,
      'event_id',v_existing.event_id,
      'event_outcome',v_existing.outcome,
      'fingerprint_repeat_count',v_repeat,
      'wake_attempt',case when p_event_kind='wake_resume' then v_wake_attempt else null end,
      'idempotent',true,
      'metered',true
    );
  end if;

  v_material_progress:=coalesce((p_metadata->>'material_progress')::boolean,false);

  insert into agent_lab.cognition_runtime_events(
    runtime_id,agent_id,wake_request_id,assignment_key,model_id,epoch_no,
    node_path,event_key,event_kind,event_fingerprint,cost_units,
    budget_before,budget_after,outcome,metadata
  ) values (
    v_runtime.runtime_id,p_agent_id,p_wake_request_id,p_assignment_key,p_model,p_epoch_no,
    p_node_path,v_effective_key,p_event_kind,p_event_fingerprint,0,
    v_runtime.remaining_budget_units,v_runtime.remaining_budget_units,'metered',
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'metered_at',now(),
      'semantic_budget_cost_units',0,
      'contract','semantic_replay_accounting_v0_1'
    )
  )
  returning * into v_existing;

  update agent_lab.cognition_assignment_runtime
  set transition_count=transition_count+1,
      material_transition_count=material_transition_count+
        case when v_material_progress then 1 else 0 end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'semantic_replay_accounting_contract','semantic_replay_accounting_v0_1'
      ),
      updated_at=now()
  where runtime_id=v_runtime.runtime_id
  returning * into v_runtime;

  if p_event_fingerprint is not null then
    select count(*)::integer into v_repeat
    from agent_lab.cognition_runtime_events
    where runtime_id=v_runtime.runtime_id
      and event_kind=p_event_kind
      and event_fingerprint=p_event_fingerprint;
  end if;

  return jsonb_build_object(
    'status','ready',
    'contract','semantic_replay_accounting_v0_1',
    'runtime_id',v_runtime.runtime_id,
    'epoch_no',v_runtime.epoch_no,
    'runtime_status',v_runtime.status,
    'remaining_budget_units',v_runtime.remaining_budget_units,
    'transition_count',v_runtime.transition_count,
    'material_transition_count',v_runtime.material_transition_count,
    'semantic_node_count',v_runtime.semantic_node_count,
    'event_id',v_existing.event_id,
    'event_outcome','metered',
    'fingerprint_repeat_count',v_repeat,
    'wake_attempt',case when p_event_kind='wake_resume' then v_wake_attempt else null end,
    'idempotent',false,
    'metered',true
  );
end;
$function$;

revoke all on function public.aau_bridge_meter_semantic_runtime_v0_1(
  text,uuid,uuid,text,text,integer,text,text,text,text,jsonb
) from public,authenticated,service_role;
grant execute on function public.aau_bridge_meter_semantic_runtime_v0_1(
  text,uuid,uuid,text,text,integer,text,text,text,text,jsonb
) to anon;

create or replace function agent_lab.reconcile_semantic_replay_accounting_v0_1(
  p_agent_id uuid,
  p_assignment_key text,
  p_reason text default 'semantic_replay_accounting_reconciliation'
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_runtime agent_lab.cognition_assignment_runtime%rowtype;
  v_credit integer:=0;
  v_count integer:=0;
  v_before integer:=0;
  v_after integer:=0;
begin
  select * into v_runtime
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id
    and assignment_key=p_assignment_key
  order by epoch_no desc
  limit 1
  for update;

  if not found then
    raise exception 'semantic_replay_reconcile_runtime_missing';
  end if;

  if coalesce(v_runtime.metadata->>'semantic_replay_accounting_reconciled_v0_1','false')='true' then
    return jsonb_build_object(
      'status','ready',
      'contract','semantic_replay_accounting_v0_1',
      'idempotent',true,
      'runtime_id',v_runtime.runtime_id,
      'epoch_no',v_runtime.epoch_no,
      'credited_units',0,
      'remaining_budget_units',v_runtime.remaining_budget_units
    );
  end if;

  select coalesce(sum(e.cost_units),0)::integer,count(*)::integer
  into v_credit,v_count
  from agent_lab.cognition_runtime_events e
  where e.runtime_id=v_runtime.runtime_id
    and e.outcome='charged'
    and (
      e.event_kind='wake_resume'
      or (
        e.event_kind='semantic_transition'
        and coalesce(e.metadata->>'phase','')=''
      )
    );

  v_before:=v_runtime.remaining_budget_units;
  v_after:=least(v_runtime.initial_budget_units,v_before+greatest(0,v_credit));

  update agent_lab.cognition_runtime_events e
  set outcome='metered',
      metadata=coalesce(e.metadata,'{}'::jsonb)||jsonb_build_object(
        'reclassified_at',now(),
        'reclassified_from','charged',
        'reclassified_credit_units',e.cost_units,
        'reclassification_contract','semantic_replay_accounting_v0_1'
      )
  where e.runtime_id=v_runtime.runtime_id
    and e.outcome='charged'
    and (
      e.event_kind='wake_resume'
      or (
        e.event_kind='semantic_transition'
        and coalesce(e.metadata->>'phase','')=''
      )
    );

  update agent_lab.cognition_assignment_runtime
  set remaining_budget_units=v_after,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'semantic_replay_accounting_reconciled_v0_1',true,
        'semantic_replay_accounting_reconciled_at',now(),
        'semantic_replay_accounting_credit_units',v_credit,
        'semantic_replay_accounting_reclassified_events',v_count,
        'semantic_replay_accounting_reason',left(coalesce(p_reason,''),500),
        'semantic_replay_accounting_contract','semantic_replay_accounting_v0_1'
      ),
      updated_at=now()
  where runtime_id=v_runtime.runtime_id
  returning * into v_runtime;

  return jsonb_build_object(
    'status','ready',
    'contract','semantic_replay_accounting_v0_1',
    'idempotent',false,
    'runtime_id',v_runtime.runtime_id,
    'epoch_no',v_runtime.epoch_no,
    'reclassified_events',v_count,
    'credited_units',v_credit,
    'remaining_before_units',v_before,
    'remaining_after_units',v_runtime.remaining_budget_units,
    'initial_budget_units',v_runtime.initial_budget_units
  );
end;
$function$;

revoke all on function agent_lab.reconcile_semantic_replay_accounting_v0_1(uuid,text,text)
  from public,anon,authenticated;
grant execute on function agent_lab.reconcile_semantic_replay_accounting_v0_1(uuid,text,text)
  to service_role;

commit;
