-- AAU cognitive self-remediation v0.1
-- Level 1: the bound agent may diagnose and repair its own durable cognitive state.
-- Runtime authority remains mechanical and bounded.

CREATE TABLE IF NOT EXISTS agent_lab.cognition_remediation_episodes (
  remediation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agent_lab.agents(agent_id) ON DELETE CASCADE,
  assignment_key text NOT NULL,
  node_path text NOT NULL,
  model_id text NOT NULL,
  attempt_no integer NOT NULL CHECK (attempt_no BETWEEN 1 AND 2),
  status text NOT NULL CHECK (status IN ('proposed','applied','verifying','succeeded','failed')),
  observed_anomaly text NOT NULL,
  prior_belief text NOT NULL,
  contradicting_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  diagnosis text NOT NULL,
  repair_type text NOT NULL CHECK (repair_type IN ('INVALIDATE_DISCOVERY_CHECKPOINT','REFRESH_SIBLING_EVIDENCE')),
  repair_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_criterion text NOT NULL,
  pre_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  post_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_wake_request_id uuid NOT NULL REFERENCES agent_lab.wake_queue(wake_request_id),
  last_wake_request_id uuid NOT NULL REFERENCES agent_lab.wake_queue(wake_request_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(agent_id,assignment_key,node_path,model_id,attempt_no)
);

CREATE INDEX IF NOT EXISTS cognition_remediation_node_idx
  ON agent_lab.cognition_remediation_episodes(agent_id,assignment_key,node_path,model_id,created_at DESC);

ALTER TABLE agent_lab.cognition_remediation_episodes ENABLE ROW LEVEL SECURITY;

ALTER TABLE agent_lab.cognition_requirement_nodes
  DROP CONSTRAINT IF EXISTS cognition_requirement_nodes_decision_type_check;
ALTER TABLE agent_lab.cognition_requirement_nodes
  ADD CONSTRAINT cognition_requirement_nodes_decision_type_check
  CHECK (decision_type IS NULL OR decision_type IN ('ATOMIC','SPLIT','NEED_CONTEXT','BLOCKED','REMEDIATE'));

DO $$
DECLARE vdef text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO vdef
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='aau_bridge_cognition_requirement_node_v0_1'
  LIMIT 1;
  IF vdef IS NULL THEN RAISE EXCEPTION 'requirement_node_bridge_missing'; END IF;
  IF position('''REMEDIATE''' in vdef)=0 THEN
    vdef:=replace(
      vdef,
      'p_decision_type not in (''ATOMIC'',''SPLIT'',''NEED_CONTEXT'',''BLOCKED'')',
      'p_decision_type not in (''ATOMIC'',''SPLIT'',''NEED_CONTEXT'',''BLOCKED'',''REMEDIATE'')'
    );
    EXECUTE vdef;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.aau_bridge_cognition_remediation_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_assignment_key text,
  p_node_path text,
  p_model text,
  p_action text,
  p_episode jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','agent_lab','extensions'
AS $function$
DECLARE
  v_bound text;
  v_id uuid;
  v_attempt integer;
  v_status text;
  v_repair_type text;
  v_row agent_lab.cognition_remediation_episodes%rowtype;
BEGIN
  PERFORM agent_lab.assert_broker_bridge_token(p_bridge_token);

  IF p_action NOT IN ('list','create','update') THEN
    RAISE EXCEPTION 'cognition_remediation_invalid_action';
  END IF;
  IF length(coalesce(p_assignment_key,'')) NOT BETWEEN 1 AND 240
     OR p_node_path !~ '^R([.][0-9]{3}){0,16}$' THEN
    RAISE EXCEPTION 'cognition_remediation_invalid_identity';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM agent_lab.wake_queue w
    WHERE w.agent_id=p_agent_id AND w.wake_request_id=p_wake_request_id
      AND w.status IN ('running','claimed')
  ) THEN
    RAISE EXCEPTION 'cognition_remediation_wake_not_running';
  END IF;

  SELECT primary_model_id INTO v_bound
  FROM agent_lab.agents WHERE agent_id=p_agent_id;
  IF v_bound IS NULL OR v_bound IS DISTINCT FROM p_model THEN
    RAISE EXCEPTION 'cognition_remediation_bound_model_mismatch';
  END IF;

  IF p_action='list' THEN
    RETURN jsonb_build_object(
      'status','ready',
      'version','cognitive_self_remediation_v0_1',
      'episodes',coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'remediation_id',e.remediation_id,
          'attempt_no',e.attempt_no,
          'status',e.status,
          'observed_anomaly',e.observed_anomaly,
          'prior_belief',e.prior_belief,
          'contradicting_evidence',e.contradicting_evidence,
          'diagnosis',e.diagnosis,
          'repair_type',e.repair_type,
          'repair_payload',e.repair_payload,
          'verification_criterion',e.verification_criterion,
          'pre_state',e.pre_state,
          'post_state',e.post_state,
          'verification_result',e.verification_result,
          'created_at',e.created_at,
          'updated_at',e.updated_at
        ) ORDER BY e.attempt_no)
        FROM agent_lab.cognition_remediation_episodes e
        WHERE e.agent_id=p_agent_id
          AND e.assignment_key=p_assignment_key
          AND e.node_path=p_node_path
          AND e.model_id=p_model
      ),'[]'::jsonb)
    );
  END IF;

  IF p_episode IS NULL OR jsonb_typeof(p_episode)<>'object'
     OR octet_length(p_episode::text)>18000 THEN
    RAISE EXCEPTION 'cognition_remediation_invalid_payload';
  END IF;

  IF p_action='create' THEN
    v_attempt:=coalesce((p_episode->>'attempt_no')::integer,0);
    v_repair_type:=upper(coalesce(p_episode->>'repair_type',''));
    IF v_attempt NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'cognition_remediation_attempt_limit'; END IF;
    IF v_repair_type NOT IN ('INVALIDATE_DISCOVERY_CHECKPOINT','REFRESH_SIBLING_EVIDENCE') THEN
      RAISE EXCEPTION 'cognition_remediation_repair_not_allowed';
    END IF;
    IF length(btrim(coalesce(p_episode->>'observed_anomaly','')))<8
       OR length(btrim(coalesce(p_episode->>'prior_belief','')))<3
       OR length(btrim(coalesce(p_episode->>'diagnosis','')))<8
       OR length(btrim(coalesce(p_episode->>'verification_criterion','')))<8 THEN
      RAISE EXCEPTION 'cognition_remediation_required_reasoning_missing';
    END IF;
    IF jsonb_typeof(coalesce(p_episode->'contradicting_evidence','[]'::jsonb))<>'array'
       OR jsonb_array_length(coalesce(p_episode->'contradicting_evidence','[]'::jsonb))>16 THEN
      RAISE EXCEPTION 'cognition_remediation_evidence_invalid';
    END IF;

    INSERT INTO agent_lab.cognition_remediation_episodes(
      agent_id,assignment_key,node_path,model_id,attempt_no,status,
      observed_anomaly,prior_belief,contradicting_evidence,diagnosis,
      repair_type,repair_payload,verification_criterion,pre_state,
      source_wake_request_id,last_wake_request_id
    ) VALUES (
      p_agent_id,p_assignment_key,p_node_path,p_model,v_attempt,'proposed',
      left(p_episode->>'observed_anomaly',2400),
      left(p_episode->>'prior_belief',2400),
      coalesce(p_episode->'contradicting_evidence','[]'::jsonb),
      left(p_episode->>'diagnosis',3000),
      v_repair_type,
      coalesce(p_episode->'repair_payload','{}'::jsonb),
      left(p_episode->>'verification_criterion',2400),
      coalesce(p_episode->'pre_state','{}'::jsonb),
      p_wake_request_id,p_wake_request_id
    )
    ON CONFLICT(agent_id,assignment_key,node_path,model_id,attempt_no) DO NOTHING
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      SELECT * INTO v_row FROM agent_lab.cognition_remediation_episodes
      WHERE agent_id=p_agent_id AND assignment_key=p_assignment_key
        AND node_path=p_node_path AND model_id=p_model AND attempt_no=v_attempt;
    END IF;

    RETURN jsonb_build_object(
      'status','ready','version','cognitive_self_remediation_v0_1',
      'remediation_id',v_row.remediation_id,'attempt_no',v_row.attempt_no,
      'episode_status',v_row.status,'repair_type',v_row.repair_type
    );
  END IF;

  BEGIN
    v_id:=(p_episode->>'remediation_id')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'cognition_remediation_id_invalid';
  END;
  v_status:=lower(coalesce(p_episode->>'status',''));
  IF v_status NOT IN ('applied','verifying','succeeded','failed') THEN
    RAISE EXCEPTION 'cognition_remediation_status_invalid';
  END IF;

  UPDATE agent_lab.cognition_remediation_episodes
  SET status=v_status,
      post_state=CASE WHEN p_episode ? 'post_state'
                      THEN coalesce(p_episode->'post_state','{}'::jsonb)
                      ELSE post_state END,
      verification_result=CASE WHEN p_episode ? 'verification_result'
                               THEN coalesce(p_episode->'verification_result','{}'::jsonb)
                               ELSE verification_result END,
      last_wake_request_id=p_wake_request_id,
      updated_at=now()
  WHERE remediation_id=v_id
    AND agent_id=p_agent_id
    AND assignment_key=p_assignment_key
    AND node_path=p_node_path
    AND model_id=p_model
  RETURNING * INTO v_row;

  IF NOT FOUND THEN RAISE EXCEPTION 'cognition_remediation_not_found'; END IF;

  RETURN jsonb_build_object(
    'status','ready','version','cognitive_self_remediation_v0_1',
    'remediation_id',v_row.remediation_id,'attempt_no',v_row.attempt_no,
    'episode_status',v_row.status,'repair_type',v_row.repair_type,
    'updated_at',v_row.updated_at
  );
END
$function$;

REVOKE ALL ON FUNCTION public.aau_bridge_cognition_remediation_v0_1(
  text,uuid,uuid,text,text,text,text,jsonb
) FROM public;
