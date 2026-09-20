-- Preserve HTTP 403/404 as explicit source failures; defer retries for 24 hours.
CREATE OR REPLACE FUNCTION public.aau_bridge_knowledge_refresh_due_v0_3(p_bridge_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
BEGIN
 PERFORM agent_lab.assert_broker_bridge_token(p_bridge_token);
 IF NOT EXISTS (SELECT 1 FROM agent_lab.runtime_config
   WHERE config_id=1 AND coalesce((metadata->>'knowledge_pool_enabled')::boolean,false)) THEN
   RETURN jsonb_build_object('enabled',false,'sources','[]'::jsonb);
 END IF;
 RETURN jsonb_build_object('enabled',true,
   'sources',coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM (
      SELECT source_key,endpoint,adapter,max_items,source_host,component,topic
      FROM agent_lab.knowledge_refresh_sources
      WHERE enabled=true AND (last_checked_at IS NULL OR
         last_checked_at+make_interval(secs=>(CASE WHEN last_error ~ '^knowledge_source_http_(403|404)$' THEN greatest(poll_interval_seconds,86400) WHEN consecutive_failures>=3 THEN least(greatest(poll_interval_seconds*4,3600),86400) ELSE poll_interval_seconds END))<=now())
      ORDER BY source_key LIMIT 3
    ) x),'[]'::jsonb));
END
$function$;
