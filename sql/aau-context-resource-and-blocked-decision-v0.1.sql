-- AAU context-resource / BLOCKED decision support v0.1
-- Applied to production before this file was committed.

ALTER TABLE agent_lab.cognition_requirement_nodes
  DROP CONSTRAINT IF EXISTS cognition_requirement_nodes_decision_type_check;

ALTER TABLE agent_lab.cognition_requirement_nodes
  ADD CONSTRAINT cognition_requirement_nodes_decision_type_check
  CHECK (
    decision_type IS NULL
    OR decision_type = ANY (
      ARRAY['ATOMIC'::text,'SPLIT'::text,'NEED_CONTEXT'::text,'BLOCKED'::text]
    )
  );

DO $migration$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public'
    AND p.proname='aau_bridge_cognition_requirement_node_v0_1';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'aau_bridge_cognition_requirement_node_v0_1_missing';
  END IF;

  v_def:=replace(
    v_def,
    'p_decision_type not in (''ATOMIC'',''SPLIT'',''NEED_CONTEXT'')',
    'p_decision_type not in (''ATOMIC'',''SPLIT'',''NEED_CONTEXT'',''BLOCKED'')'
  );

  EXECUTE v_def;
END
$migration$;
