-- AAU Broker Bridge v0.1
-- DB-first materialization for async infrastructure capability events.

create or replace function public.aau_materialize_infrastructure_broker_job(
  p_capability_invocation_id uuid,
  p_message_id text default null
)
returns jsonb
language plpgsql
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_inv agent_lab.capability_invocations%rowtype;
  v_def agent_lab.capability_definitions%rowtype;
  v_provider text;
  v_resource_type text;
  v_queue_name text;
  v_action_type text;
  v_external_action_id uuid;
  v_broker_request_id uuid;
  v_broker_job_id uuid;
  v_job_status text;
  v_max_attempts integer;
  v_broker_key text;
begin
  select * into v_inv
  from agent_lab.capability_invocations
  where capability_invocation_id = p_capability_invocation_id
  for update;

  if not found then raise exception 'capability_invocation_not_found'; end if;
  if v_inv.route_mode <> 'async_broker' then raise exception 'capability_not_async_broker:%', v_inv.route_mode; end if;
  if v_inv.authorization_state <> 'allowed' then raise exception 'capability_not_authorized:%', v_inv.authorization_state; end if;
  if v_inv.approval_state not in ('not_required','approved') then raise exception 'capability_not_approved:%', v_inv.approval_state; end if;
  if v_inv.construct_id is null then raise exception 'construct_required'; end if;

  select * into v_def
  from agent_lab.capability_definitions
  where capability_code = v_inv.capability_code and enabled = true;
  if not found then raise exception 'capability_definition_missing'; end if;

  case v_inv.capability_code
    when 'github.repository.create' then
      v_provider := 'github';
      v_resource_type := 'repository';
      v_queue_name := 'aau.infrastructure.github';
      v_action_type := 'github_repository_create';
    when 'vercel.project.create' then
      v_provider := 'vercel';
      v_resource_type := 'project';
      v_queue_name := 'aau.infrastructure.vercel';
      v_action_type := 'vercel_project_create';
    else
      raise exception 'unsupported_infrastructure_capability:%', v_inv.capability_code;
  end case;

  if v_inv.route_queue is distinct from v_queue_name then
    raise exception 'capability_queue_mismatch:%:%', v_inv.route_queue, v_queue_name;
  end if;

  v_max_attempts := greatest(1, coalesce((v_def.retry_policy->>'max_attempts')::integer, 3));
  v_broker_key := 'capability:' || v_inv.capability_invocation_id::text;

  if v_inv.external_action_id is null then
    insert into agent_lab.external_actions(
      agent_id, construct_id, action_type, description, target_system,
      status, risk_tier, human_approval_required, approval_state,
      execution_payload, approved_at, metadata
    ) values (
      v_inv.agent_id, v_inv.construct_id, v_action_type,
      'AAU infrastructure capability ' || v_inv.capability_code,
      v_provider,
      'approved', 1, false, 'not_required',
      coalesce(v_inv.requested_payload,'{}'::jsonb), now(),
      jsonb_build_object(
        'capability_invocation_id', v_inv.capability_invocation_id,
        'capability_code', v_inv.capability_code,
        'message_id', p_message_id,
        'bridge_version', 'broker_bridge_v0_1'
      )
    ) returning external_action_id into v_external_action_id;
  else
    v_external_action_id := v_inv.external_action_id;
  end if;

  if v_inv.broker_request_id is null then
    insert into agent_lab.infrastructure_broker_requests(
      construct_id, requesting_agent_id, external_action_id,
      provider, resource_type, operation, requested_config,
      estimated_cost, currency, risk_tier, human_approval_required,
      approval_state, policy_result, status, idempotency_key, approved_at, metadata
    ) values (
      v_inv.construct_id, v_inv.agent_id, v_external_action_id,
      v_provider, v_resource_type, 'create', coalesce(v_inv.requested_payload,'{}'::jsonb),
      0, 'USD', 1, false,
      'not_required', jsonb_build_object('source','capability_router','authorization_state',v_inv.authorization_state),
      'queued', v_broker_key, now(),
      jsonb_build_object(
        'capability_invocation_id', v_inv.capability_invocation_id,
        'capability_code', v_inv.capability_code,
        'message_id', p_message_id,
        'bridge_version', 'broker_bridge_v0_1'
      )
    )
    on conflict (construct_id, idempotency_key) do update
      set updated_at = now()
    returning broker_request_id into v_broker_request_id;
  else
    v_broker_request_id := v_inv.broker_request_id;
  end if;

  if v_inv.broker_job_id is null then
    select broker_job_id, status into v_broker_job_id, v_job_status
    from agent_lab.infrastructure_broker_jobs
    where broker_request_id = v_broker_request_id
    order by created_at asc
    limit 1;

    if v_broker_job_id is null then
      insert into agent_lab.infrastructure_broker_jobs(
        broker_request_id, construct_id, provider, executor_kind, queue_name,
        status, max_attempts, request_payload, metadata
      ) values (
        v_broker_request_id, v_inv.construct_id, v_provider, 'vercel_function', v_queue_name,
        'queued', v_max_attempts, coalesce(v_inv.requested_payload,'{}'::jsonb),
        jsonb_build_object(
          'capability_invocation_id', v_inv.capability_invocation_id,
          'capability_code', v_inv.capability_code,
          'message_id', p_message_id,
          'bridge_version', 'broker_bridge_v0_1'
        )
      ) returning broker_job_id, status into v_broker_job_id, v_job_status;
    end if;
  else
    v_broker_job_id := v_inv.broker_job_id;
    select status into v_job_status
    from agent_lab.infrastructure_broker_jobs
    where broker_job_id = v_broker_job_id;
    if v_job_status is null then raise exception 'broker_job_reference_missing'; end if;
  end if;

  update agent_lab.capability_invocations
  set external_action_id = v_external_action_id,
      broker_request_id = v_broker_request_id,
      broker_job_id = v_broker_job_id,
      status = case
        when v_job_status = 'succeeded' then 'completed'
        when v_job_status in ('failed','dead_lettered','cancelled') then 'failed'
        when v_job_status in ('claimed','executing') then 'executing'
        else 'queued'
      end,
      started_at = case when v_job_status in ('claimed','executing') then coalesce(started_at,now()) else started_at end,
      completed_at = case when v_job_status = 'succeeded' then coalesce(completed_at,now()) else completed_at end,
      updated_at = now(),
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('broker_bridge_materialized_at',now(),'broker_bridge_message_id',p_message_id)
  where capability_invocation_id = v_inv.capability_invocation_id;

  return jsonb_build_object(
    'ok', true,
    'capability_invocation_id', v_inv.capability_invocation_id,
    'capability_code', v_inv.capability_code,
    'provider', v_provider,
    'queue_name', v_queue_name,
    'external_action_id', v_external_action_id,
    'broker_request_id', v_broker_request_id,
    'broker_job_id', v_broker_job_id,
    'job_status', v_job_status,
    'max_attempts', v_max_attempts,
    'message_id', p_message_id
  );
end;
$function$;

revoke all on function public.aau_materialize_infrastructure_broker_job(uuid,text) from public;
revoke all on function public.aau_materialize_infrastructure_broker_job(uuid,text) from anon;
revoke all on function public.aau_materialize_infrastructure_broker_job(uuid,text) from authenticated;
grant execute on function public.aau_materialize_infrastructure_broker_job(uuid,text) to service_role;

create or replace function agent_lab.sync_capability_invocation_from_broker_job()
returns trigger
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
begin
  update agent_lab.capability_invocations
  set status = case
        when new.status = 'succeeded' then 'completed'
        when new.status in ('failed','dead_lettered') then 'failed'
        when new.status = 'cancelled' then 'cancelled'
        when new.status in ('claimed','executing') then 'executing'
        else 'queued'
      end,
      started_at = case when new.status in ('claimed','executing','succeeded','failed','dead_lettered') then coalesce(started_at,new.started_at,now()) else started_at end,
      completed_at = case when new.status in ('succeeded','failed','dead_lettered','cancelled') then coalesce(completed_at,new.finished_at,now()) else completed_at end,
      error_code = case when new.status in ('failed','dead_lettered') then new.error_code else null end,
      error_message = case when new.status in ('failed','dead_lettered') then new.error_message else null end,
      result_payload = case when new.status = 'succeeded' then coalesce(new.result_payload,'{}'::jsonb) else result_payload end,
      updated_at = now()
  where broker_job_id = new.broker_job_id;

  update agent_lab.external_actions ea
  set status = case
        when new.status in ('claimed','executing') then 'executing'
        when new.status = 'succeeded' then 'completed'
        when new.status in ('failed','dead_lettered') then 'failed'
        when new.status = 'cancelled' then 'cancelled'
        else ea.status
      end,
      executed_at = case when new.status in ('claimed','executing','succeeded','failed','dead_lettered') then coalesce(ea.executed_at,new.started_at,now()) else ea.executed_at end,
      completed_at = case when new.status in ('succeeded','failed','dead_lettered','cancelled') then coalesce(ea.completed_at,new.finished_at,now()) else ea.completed_at end,
      result_payload = case when new.status = 'succeeded' then coalesce(ea.result_payload,'{}'::jsonb) || coalesce(new.result_payload,'{}'::jsonb) else ea.result_payload end,
      updated_at = now()
  from agent_lab.infrastructure_broker_requests br
  where br.broker_request_id = new.broker_request_id
    and br.external_action_id = ea.external_action_id;

  return new;
end;
$function$;

drop trigger if exists trg_sync_capability_invocation_from_broker_job on agent_lab.infrastructure_broker_jobs;
create trigger trg_sync_capability_invocation_from_broker_job
after insert or update of status, result_payload, error_code, error_message on agent_lab.infrastructure_broker_jobs
for each row execute function agent_lab.sync_capability_invocation_from_broker_job();
