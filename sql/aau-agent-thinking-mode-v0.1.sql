-- AAU agent-authored thinking-mode telemetry v0.1
begin;

create or replace function public.aau_bridge_model_runtime_facts_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_model text,
  p_node_path text default null,
  p_limit integer default 12
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_limit integer:=greatest(1,least(coalesce(p_limit,12),32));
  v_rows jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.started_at desc),'[]'::jsonb)
    into v_rows
  from (
    select
      m.call_status,
      m.provider_status_code,
      m.error_code,
      m.latency_ms,
      m.thinking,
      m.estimated_input_tokens,
      m.requested_output_tokens,
      m.effective_output_tokens,
      m.requested_timeout_ms,
      m.effective_timeout_ms,
      m.prompt_tokens,
      m.completion_tokens,
      m.reasoning_tokens,
      m.total_tokens,
      m.phase,
      m.node_path,
      m.started_at,
      m.completed_at
    from agent_lab.model_call_usage m
    where m.agent_id=p_agent_id
      and m.model_requested=p_model
      and (p_node_path is null or m.node_path=p_node_path)
    order by m.started_at desc
    limit v_limit
  ) t;

  return jsonb_build_object(
    'status','ready',
    'agent_id',p_agent_id,
    'model',p_model,
    'node_path',p_node_path,
    'observations',v_rows,
    'observation_count',jsonb_array_length(v_rows),
    'contract','agent_thinking_mode_runtime_facts_v0_1'
  );
end;
$function$;

revoke all on function public.aau_bridge_model_runtime_facts_v0_1(text,uuid,text,text,integer)
  from public;
grant execute on function public.aau_bridge_model_runtime_facts_v0_1(text,uuid,text,text,integer)
  to anon,authenticated,service_role;

commit;
