begin;

create table if not exists agent_lab.model_call_usage (
  call_id uuid primary key default gen_random_uuid(),
  agent_id uuid references agent_lab.agents(agent_id) on delete cascade,
  execution_context text,
  execution_id text,
  assignment_key text,
  node_path text,
  phase text,
  provider text not null,
  model_requested text not null,
  model_returned text,
  runtime_role text,
  call_status text not null,
  finish_reason text,
  requested_output_tokens integer,
  effective_output_tokens integer,
  requested_timeout_ms integer,
  effective_timeout_ms integer,
  thinking boolean,
  json_mode boolean,
  estimated_input_tokens integer,
  input_chars integer,
  prompt_tokens integer,
  cached_prompt_tokens integer,
  completion_tokens integer,
  reasoning_tokens integer,
  total_tokens integer,
  output_chars integer,
  reasoning_chars integer,
  latency_ms integer,
  response_id text,
  provider_status_code integer,
  error_code text,
  usage jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz not null default now(),
  contract text not null default 'model_call_usage_v0_1',
  constraint model_call_usage_status_ck
    check (call_status in ('provider_completed','provider_timeout','provider_error')),
  constraint model_call_usage_token_nonnegative_ck check (
    coalesce(requested_output_tokens,0)>=0 and coalesce(effective_output_tokens,0)>=0
    and coalesce(prompt_tokens,0)>=0 and coalesce(cached_prompt_tokens,0)>=0
    and coalesce(completion_tokens,0)>=0 and coalesce(reasoning_tokens,0)>=0
    and coalesce(total_tokens,0)>=0 and coalesce(estimated_input_tokens,0)>=0
  )
);

create index if not exists model_call_usage_agent_recent_idx
  on agent_lab.model_call_usage(agent_id,completed_at desc);
create index if not exists model_call_usage_execution_idx
  on agent_lab.model_call_usage(execution_context,execution_id,completed_at);
create index if not exists model_call_usage_node_idx
  on agent_lab.model_call_usage(agent_id,assignment_key,node_path,completed_at);
create index if not exists model_call_usage_model_idx
  on agent_lab.model_call_usage(provider,model_requested,completed_at desc);
create index if not exists model_call_usage_status_idx
  on agent_lab.model_call_usage(call_status,completed_at desc);

alter table agent_lab.model_call_usage enable row level security;
revoke all on agent_lab.model_call_usage from public,anon,authenticated;

create or replace function public.aau_bridge_record_model_call_usage(
  p_bridge_token text,
  p_call_id uuid,
  p_agent_id uuid,
  p_execution_context text,
  p_execution_id text,
  p_assignment_key text,
  p_node_path text,
  p_phase text,
  p_provider text,
  p_model_requested text,
  p_model_returned text,
  p_runtime_role text,
  p_call_status text,
  p_finish_reason text,
  p_requested_output_tokens integer,
  p_effective_output_tokens integer,
  p_requested_timeout_ms integer,
  p_effective_timeout_ms integer,
  p_thinking boolean,
  p_json_mode boolean,
  p_estimated_input_tokens integer,
  p_input_chars integer,
  p_prompt_tokens integer,
  p_cached_prompt_tokens integer,
  p_completion_tokens integer,
  p_reasoning_tokens integer,
  p_total_tokens integer,
  p_output_chars integer,
  p_reasoning_chars integer,
  p_latency_ms integer,
  p_response_id text,
  p_provider_status_code integer,
  p_error_code text,
  p_usage jsonb,
  p_metadata jsonb,
  p_started_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','extensions'
as $$
declare
  v_assignment_key text := nullif(btrim(coalesce(p_assignment_key,'')),'');
  v_existing uuid;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if p_call_id is null then raise exception 'model_call_usage_missing_call_id'; end if;
  if p_agent_id is not null and not exists(select 1 from agent_lab.agents where agent_id=p_agent_id) then
    raise exception 'model_call_usage_unknown_agent';
  end if;
  if length(coalesce(p_provider,'')) not between 1 and 80
     or length(coalesce(p_model_requested,'')) not between 1 and 240
     or p_call_status not in ('provider_completed','provider_timeout','provider_error') then
    raise exception 'model_call_usage_invalid_identity';
  end if;
  if p_execution_context is not null and length(p_execution_context)>80 then raise exception 'model_call_usage_execution_context_too_long'; end if;
  if p_execution_id is not null and length(p_execution_id)>240 then raise exception 'model_call_usage_execution_id_too_long'; end if;
  if p_node_path is not null and length(p_node_path)>512 then raise exception 'model_call_usage_node_path_too_long'; end if;
  if p_phase is not null and length(p_phase)>240 then raise exception 'model_call_usage_phase_too_long'; end if;
  if p_usage is null or jsonb_typeof(p_usage)<>'object' or octet_length(p_usage::text)>20000 then
    raise exception 'model_call_usage_invalid_usage';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' or octet_length(p_metadata::text)>30000 then
    raise exception 'model_call_usage_invalid_metadata';
  end if;

  if v_assignment_key is null and p_agent_id is not null and p_node_path is not null and p_execution_id is not null then
    select n.assignment_key into v_assignment_key
    from agent_lab.cognition_requirement_nodes n
    where n.agent_id=p_agent_id
      and n.node_path=p_node_path
      and (
        n.last_wake_request_id::text=p_execution_id
        or n.source_wake_request_id::text=p_execution_id
      )
    order by n.updated_at desc
    limit 1;
  end if;

  select call_id into v_existing from agent_lab.model_call_usage where call_id=p_call_id;
  if v_existing is not null then
    return jsonb_build_object('status','exists','call_id',v_existing,'contract','model_call_usage_v0_1');
  end if;

  insert into agent_lab.model_call_usage(
    call_id,agent_id,execution_context,execution_id,assignment_key,node_path,phase,
    provider,model_requested,model_returned,runtime_role,call_status,finish_reason,
    requested_output_tokens,effective_output_tokens,requested_timeout_ms,effective_timeout_ms,
    thinking,json_mode,estimated_input_tokens,input_chars,
    prompt_tokens,cached_prompt_tokens,completion_tokens,reasoning_tokens,total_tokens,
    output_chars,reasoning_chars,latency_ms,response_id,provider_status_code,error_code,
    usage,metadata,started_at
  ) values (
    p_call_id,p_agent_id,nullif(p_execution_context,''),nullif(p_execution_id,''),v_assignment_key,
    nullif(p_node_path,''),nullif(p_phase,''),p_provider,p_model_requested,nullif(p_model_returned,''),
    nullif(p_runtime_role,''),p_call_status,nullif(p_finish_reason,''),
    p_requested_output_tokens,p_effective_output_tokens,p_requested_timeout_ms,p_effective_timeout_ms,
    p_thinking,p_json_mode,p_estimated_input_tokens,p_input_chars,
    p_prompt_tokens,p_cached_prompt_tokens,p_completion_tokens,p_reasoning_tokens,p_total_tokens,
    p_output_chars,p_reasoning_chars,p_latency_ms,nullif(p_response_id,''),p_provider_status_code,
    nullif(p_error_code,''),coalesce(p_usage,'{}'::jsonb),coalesce(p_metadata,'{}'::jsonb),p_started_at
  );

  return jsonb_build_object('status','recorded','call_id',p_call_id,'contract','model_call_usage_v0_1');
end;
$$;

revoke all on function public.aau_bridge_record_model_call_usage(
  text,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,
  integer,integer,integer,integer,boolean,boolean,integer,integer,
  integer,integer,integer,integer,integer,integer,integer,integer,
  text,integer,text,jsonb,jsonb,timestamptz
) from public;
grant execute on function public.aau_bridge_record_model_call_usage(
  text,uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,
  integer,integer,integer,integer,boolean,boolean,integer,integer,
  integer,integer,integer,integer,integer,integer,integer,integer,
  text,integer,text,jsonb,jsonb,timestamptz
) to anon,authenticated,service_role;

commit;
