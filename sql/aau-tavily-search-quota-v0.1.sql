-- Limits authenticated Tavily search to 12 per agent and 30 total over a rolling 24-hour window.
-- This initial counter relies on completed durable research batches; further reservation-based accounting
-- may be required if AAU scales to many concurrent agents. Provider credentials remain in Render only.
create index if not exists idx_aau_web_research_batches_agent_created
  on agent_lab.agent_web_research_batches(agent_id,created_at desc);
CREATE OR REPLACE FUNCTION public.aau_bridge_web_research_quota(p_bridge_token text, p_agent_id uuid, p_requested_queries integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v_agent_count integer;v_global_count integer;v_daily_agent_limit integer:=12;
v_daily_global_limit integer:=30;v_available integer;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 if not exists(select 1 from agent_lab.agents where agent_id=p_agent_id)
 then raise exception 'research_quota_agent_missing';end if;
 select count(*)::int into v_agent_count
 from agent_lab.agent_web_research_batches b
 cross join lateral jsonb_array_elements(coalesce(b.searches,'[]'::jsonb)) s
 where b.agent_id=p_agent_id and b.created_at >= now()-interval '24 hours'
   and s->>'provider'='tavily_authenticated';
 select count(*)::int into v_global_count
 from agent_lab.agent_web_research_batches b
 cross join lateral jsonb_array_elements(coalesce(b.searches,'[]'::jsonb)) s
 where b.created_at >= now()-interval '24 hours'
   and s->>'provider'='tavily_authenticated';
 v_available:=greatest(0,least(v_daily_agent_limit-v_agent_count,
 v_daily_global_limit-v_global_count,greatest(0,least(p_requested_queries,3))));
 return jsonb_build_object('allowed_queries',v_available,
  'agent_searches_24h',v_agent_count,'global_searches_24h',v_global_count,
  'agent_limit_24h',v_daily_agent_limit,'global_limit_24h',v_daily_global_limit,
  'policy','aau_tavily_bounded_budget_v0_1');
end $function$
;
revoke all on function public.aau_bridge_web_research_quota(text,uuid,integer) from public;
grant execute on function public.aau_bridge_web_research_quota(text,uuid,integer) to anon,service_role;
