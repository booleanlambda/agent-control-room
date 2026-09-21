-- AAU shared public-web research capability: accessible to any agent from birth without identity, expertise, or tool-grant unlock.
-- All externally fetched content remains untrusted and is not independently verified competence.
CREATE TABLE IF NOT EXISTS agent_lab.agent_web_research_batches (
 batch_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agent_id uuid NOT NULL REFERENCES agent_lab.agents(agent_id),
 wake_request_id uuid NOT NULL REFERENCES agent_lab.wake_queue(wake_request_id),
 status text NOT NULL CHECK(status IN ('fetched_text','metadata_only','blocked')),
 queries jsonb NOT NULL DEFAULT '[]'::jsonb,
 searches jsonb NOT NULL DEFAULT '[]'::jsonb,
 receipts jsonb NOT NULL DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(wake_request_id)
);
ALTER TABLE agent_lab.agent_web_research_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agent_lab.agent_web_research_batches FROM PUBLIC,anon,authenticated;
GRANT SELECT ON agent_lab.agent_web_research_batches TO service_role;
INSERT INTO agent_lab.capability_definitions (capability_code,display_name,provider,route_mode,side_effect_level,durability_required,grant_required,autonomous_default,approval_policy,queue_name,timeout_class,retry_policy,idempotency_required,cost_class,execution_adapter,version,enabled,metadata)
VALUES ('web.research','Search and fetch public web sources','aau','sync_runtime','external',true,false,true,'none',null,'medium','{"max_attempts":1}'::jsonb,true,'variable','nvidia_research_tool_v0_1','v0_1',true,'{"category":"research","scope":"all_agents_from_inception","legal_gate_required":false,"max_queries_per_wake":3,"max_sources_per_wake":4,"no_inferred_mastery":true}'::jsonb)
ON CONFLICT(capability_code) DO UPDATE SET enabled=true,autonomous_default=true,grant_required=false,metadata=agent_lab.capability_definitions.metadata || EXCLUDED.metadata,updated_at=now();
CREATE OR REPLACE FUNCTION public.aau_bridge_record_web_research(p_bridge_token text, p_agent_id uuid, p_wake_request_id uuid, p_research jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
DECLARE v_id uuid;v_status text;v_receipts jsonb;
BEGIN
 PERFORM agent_lab.assert_broker_bridge_token(p_bridge_token);
 IF NOT EXISTS(SELECT 1 FROM agent_lab.wake_queue WHERE wake_request_id=p_wake_request_id AND agent_id=p_agent_id AND status IN('running','claimed'))
 THEN RAISE EXCEPTION 'web_research_wake_not_running_or_agent_mismatch';END IF;
 IF p_research IS NULL OR jsonb_typeof(p_research)<>'object' OR octet_length(p_research::text)>90000
  OR jsonb_typeof(p_research->'requested_queries')<>'array' OR jsonb_array_length(p_research->'requested_queries')>3
  OR jsonb_typeof(p_research->'sources')<>'array' OR jsonb_array_length(p_research->'sources')>4
 THEN RAISE EXCEPTION 'web_research_invalid_payload';END IF;
 v_status:=p_research->>'status';
 IF v_status NOT IN('fetched_text','metadata_only','blocked') THEN RAISE EXCEPTION 'web_research_invalid_status';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'url',left(s->>'url',1200),'query',left(s->>'query',180),
  'title',left(coalesce(s->>'title',s->>'search_title'),350),
  'discovery',left(s->>'discovery',100),'fetch_status',left(s->>'fetch_status',100),
  'coverage',left(s->>'coverage',100),'sha256',left(s->>'sha256',64),
  'bytes',left(s->>'bytes',16),'published_at',left(coalesce(s->>'published_at',s->>'search_publication_date'),80),
  'fetch_error',left(s->>'fetch_error',160),'excerpt_preview',left(s->>'excerpt',280)
 )),'[]'::jsonb) INTO v_receipts FROM jsonb_array_elements(p_research->'sources') s;
 INSERT INTO agent_lab.agent_web_research_batches(agent_id,wake_request_id,status,queries,searches,receipts)
 VALUES(p_agent_id,p_wake_request_id,v_status,p_research->'requested_queries',p_research->'searches',v_receipts)
 ON CONFLICT(wake_request_id) DO UPDATE SET status=EXCLUDED.status,queries=EXCLUDED.queries,
 searches=EXCLUDED.searches,receipts=EXCLUDED.receipts
 RETURNING batch_id INTO v_id;
 RETURN v_id;
END $function$
;
REVOKE ALL ON FUNCTION public.aau_bridge_record_web_research(text,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aau_bridge_record_web_research(text,uuid,uuid,jsonb) TO anon,service_role;
