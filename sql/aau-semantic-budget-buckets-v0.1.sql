-- AAU semantic budget bucket admission v0.1
-- Separates reasoning / verification / retry / orchestration spend and protects
-- a finalization reserve. Canonical total budget remains authoritative.

create or replace function public.aau_bridge_semantic_budget_admission_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_assignment_key text,
  p_model text,
  p_epoch_no integer,
  p_event_key text,
  p_budget_bucket text,
  p_request_units integer,
  p_finalization_reserve_units integer
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','public'
as $function$
declare
  v_bound text;
  v_runtime agent_lab.cognition_assignment_runtime%rowtype;
  v_existing agent_lab.cognition_runtime_events%rowtype;
  v_bucket text:=lower(coalesce(p_budget_bucket,''));
  v_reserve integer;
  v_spendable integer;
  v_verification_limit integer;
  v_orchestration_limit integer;
  v_retry_limit integer;
  v_reasoning_limit integer;
  v_bucket_limit integer;
  v_bucket_spent integer:=0;
  v_existing_reserve integer;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select primary_model_id into v_bound
  from agent_lab.agents where agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'semantic_budget_admission_bound_model_mismatch';
  end if;

  if length(coalesce(p_assignment_key,'')) not between 1 and 240
     or p_epoch_no not between 1 and 1000000
     or length(coalesce(p_event_key,'')) not between 1 and 240
     or v_bucket not in ('reasoning','verification','transport_retry','orchestration','finalization')
     or p_request_units not between 1 and 1000000
     or p_finalization_reserve_units not between 0 and 1000000 then
    raise exception 'semantic_budget_admission_invalid_input';
  end if;

  select * into v_runtime
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id and assignment_key=p_assignment_key
    and model_id=p_model and epoch_no=p_epoch_no
  for update;
  if not found then raise exception 'semantic_budget_admission_runtime_missing'; end if;

  if p_finalization_reserve_units>v_runtime.initial_budget_units then
    raise exception 'semantic_budget_admission_reserve_exceeds_initial_budget';
  end if;

  if not exists(
    select 1
    from agent_lab.wake_queue q
    join agent_lab.autonomous_lifecycle_runs r on r.agent_id=q.agent_id
    where q.wake_request_id=p_wake_request_id
      and q.agent_id=p_agent_id
      and q.status in ('claimed','running')
      and r.status in ('starting','running','degraded')
  ) then
    raise exception 'semantic_budget_admission_wake_not_running';
  end if;

  select * into v_existing
  from agent_lab.cognition_runtime_events
  where runtime_id=v_runtime.runtime_id and event_key=p_event_key;
  if found and v_existing.outcome in ('charged','reserved','settled','released') then
    return jsonb_build_object(
      'status','ready','contract','semantic_budget_buckets_v0_1',
      'admitted',true,'reason','idempotent_existing_event','idempotent',true,
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status',v_runtime.status,
      'remaining_budget_units',v_runtime.remaining_budget_units,
      'budget_bucket',v_bucket,'event_key',p_event_key
    );
  end if;

  if coalesce(v_runtime.metadata->>'semantic_budget_contract','')='' then
    update agent_lab.cognition_assignment_runtime
       set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
         'semantic_budget_contract','semantic_budget_buckets_v0_1',
         'finalization_reserve_units',p_finalization_reserve_units,
         'semantic_budget_plan_pinned_at',now()
       ),
       updated_at=now()
     where runtime_id=v_runtime.runtime_id
     returning * into v_runtime;
  elsif v_runtime.metadata->>'semantic_budget_contract'<>'semantic_budget_buckets_v0_1' then
    raise exception 'semantic_budget_admission_contract_conflict';
  end if;

  if coalesce(v_runtime.metadata->>'finalization_reserve_units','')~'^[0-9]+$' then
    v_existing_reserve:=(v_runtime.metadata->>'finalization_reserve_units')::integer;
    if v_existing_reserve<>p_finalization_reserve_units then
      raise exception 'semantic_budget_admission_reserve_mismatch';
    end if;
  end if;

  v_reserve:=p_finalization_reserve_units;
  v_spendable:=greatest(0,v_runtime.initial_budget_units-v_reserve);
  v_verification_limit:=floor(v_spendable*0.20)::integer;
  v_orchestration_limit:=floor(v_spendable*0.10)::integer;
  v_retry_limit:=floor(v_spendable*0.08)::integer;
  v_reasoning_limit:=greatest(
    0,v_spendable-v_verification_limit-v_orchestration_limit-v_retry_limit
  );

  v_bucket_limit:=case v_bucket
    when 'reasoning' then v_reasoning_limit
    when 'verification' then v_verification_limit
    when 'transport_retry' then v_retry_limit
    when 'orchestration' then v_orchestration_limit
    when 'finalization' then v_reserve
    else 0
  end;

  select greatest(0,coalesce(sum(
    case
      when e.event_kind='model_call_reservation' and e.outcome='reserved'
        then e.cost_units
      when e.event_kind='model_call_settlement' and e.outcome in ('settled','released')
        then -case
          when coalesce(e.metadata->>'refund_units','')~'^[0-9]+$'
            then (e.metadata->>'refund_units')::integer
          else 0
        end
      when e.event_kind not in ('model_call_reservation','model_call_settlement')
           and e.outcome='charged'
        then e.cost_units
      else 0
    end
  ),0)::integer)
  into v_bucket_spent
  from agent_lab.cognition_runtime_events e
  where e.runtime_id=v_runtime.runtime_id
    and e.metadata->>'budget_contract'='semantic_budget_buckets_v0_1'
    and e.metadata->>'budget_bucket'=v_bucket;

  if v_runtime.status<>'active' then
    return jsonb_build_object(
      'status','ready','contract','semantic_budget_buckets_v0_1',
      'admitted',false,'reason','runtime_not_active',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status',v_runtime.status,
      'remaining_budget_units',v_runtime.remaining_budget_units,
      'budget_bucket',v_bucket,'bucket_spent_units',v_bucket_spent,
      'bucket_limit_units',v_bucket_limit,
      'finalization_reserve_units',v_reserve
    );
  end if;

  if p_request_units>v_runtime.remaining_budget_units then
    return jsonb_build_object(
      'status','ready','contract','semantic_budget_buckets_v0_1',
      'admitted',false,'reason','total_budget_exhausted',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status',v_runtime.status,
      'remaining_budget_units',v_runtime.remaining_budget_units,
      'budget_bucket',v_bucket,'bucket_spent_units',v_bucket_spent,
      'bucket_limit_units',v_bucket_limit,
      'finalization_reserve_units',v_reserve
    );
  end if;

  if v_bucket_spent+p_request_units>v_bucket_limit then
    return jsonb_build_object(
      'status','ready','contract','semantic_budget_buckets_v0_1',
      'admitted',false,'reason','bucket_limit_exhausted',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status',v_runtime.status,
      'remaining_budget_units',v_runtime.remaining_budget_units,
      'budget_bucket',v_bucket,'bucket_spent_units',v_bucket_spent,
      'bucket_limit_units',v_bucket_limit,
      'finalization_reserve_units',v_reserve
    );
  end if;

  if v_bucket<>'finalization'
     and v_runtime.remaining_budget_units-p_request_units<v_reserve then
    return jsonb_build_object(
      'status','ready','contract','semantic_budget_buckets_v0_1',
      'admitted',false,'reason','finalization_reserve_protected',
      'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
      'runtime_status',v_runtime.status,
      'remaining_budget_units',v_runtime.remaining_budget_units,
      'budget_bucket',v_bucket,'bucket_spent_units',v_bucket_spent,
      'bucket_limit_units',v_bucket_limit,
      'finalization_reserve_units',v_reserve
    );
  end if;

  return jsonb_build_object(
    'status','ready','contract','semantic_budget_buckets_v0_1',
    'admitted',true,'reason','admitted','idempotent',false,
    'runtime_id',v_runtime.runtime_id,'epoch_no',v_runtime.epoch_no,
    'runtime_status',v_runtime.status,
    'remaining_budget_units',v_runtime.remaining_budget_units,
    'remaining_after_units',v_runtime.remaining_budget_units-p_request_units,
    'budget_bucket',v_bucket,'bucket_spent_units',v_bucket_spent,
    'bucket_limit_units',v_bucket_limit,
    'finalization_reserve_units',v_reserve,
    'nonfinal_spendable_units',v_spendable,
    'limits',jsonb_build_object(
      'reasoning',v_reasoning_limit,
      'verification',v_verification_limit,
      'transport_retry',v_retry_limit,
      'orchestration',v_orchestration_limit,
      'finalization',v_reserve
    )
  );
end;
$function$;

revoke all on function public.aau_bridge_semantic_budget_admission_v0_1(
  text,uuid,uuid,text,text,integer,text,text,integer,integer
) from public,authenticated,service_role;
grant execute on function public.aau_bridge_semantic_budget_admission_v0_1(
  text,uuid,uuid,text,text,integer,text,text,integer,integer
) to anon;
