-- AAU intervention closure requires genuine, distinct reviewer records and delivered feedback.
CREATE OR REPLACE FUNCTION agent_lab.intervention_review_ready_v0_2(p_case_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'pg_catalog','agent_lab' AS $review$
SELECT jsonb_build_object(
 'case_id',c.case_id,'status',c.status,
 'frozen_evidence_matches',c.source_file_id IS NULL OR c.evidence_sha256=(
  SELECT encode(sha256(convert_to(f.inline_text,'UTF8')),'hex')
  FROM agent_lab.agent_files f WHERE f.file_id=c.source_file_id),
 'authenticator_assessed',
    c.authenticator->>'status'='completed' AND
    nullif(c.authenticator->>'model_id','') IS NOT NULL AND
    nullif(c.authenticator->>'invocation_ref','') IS NOT NULL AND
    c.authenticator->>'evidence_sha256'=c.evidence_sha256 AND
    jsonb_typeof(c.authenticator->'findings')='array',
 'adjudicator_assessed',
    c.adjudicator->>'status'='completed' AND
    nullif(c.adjudicator->>'model_id','') IS NOT NULL AND
    nullif(c.adjudicator->>'invocation_ref','') IS NOT NULL AND
    c.adjudicator->>'evidence_sha256'=c.evidence_sha256 AND
    jsonb_typeof(c.adjudicator->'findings')='array' AND
    c.adjudicator->>'model_id' IS DISTINCT FROM c.authenticator->>'model_id' AND
    c.adjudicator->>'invocation_ref' IS DISTINCT FROM c.authenticator->>'invocation_ref',
 'feedback_delivered', c.feedback_message_id IS NOT NULL,
 'outcome_evidence_present',c.outcome_evidence<>'{}'::jsonb,
 'official_verdict_changed',false
)
FROM agent_lab.intervention_review_cases c WHERE c.case_id=p_case_id;
$review$;
REVOKE ALL ON FUNCTION agent_lab.intervention_review_ready_v0_2(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION agent_lab.guard_intervention_review_close_v0_2()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog','agent_lab' AS $close$
DECLARE v_source_sha text;
BEGIN
 IF NEW.status <> 'closed' OR OLD.status='closed' THEN RETURN NEW; END IF;
 IF NEW.source_file_id IS NOT NULL THEN
  SELECT encode(sha256(convert_to(inline_text,'UTF8')),'hex') INTO v_source_sha
  FROM agent_lab.agent_files WHERE file_id=NEW.source_file_id;
  IF v_source_sha IS DISTINCT FROM NEW.evidence_sha256 THEN
   RAISE EXCEPTION 'intervention_review_frozen_evidence_changed';
  END IF;
 END IF;
 IF NEW.authenticator->>'status' IS DISTINCT FROM 'completed'
  OR NEW.adjudicator->>'status' IS DISTINCT FROM 'completed'
  OR NEW.authenticator->>'evidence_sha256' IS DISTINCT FROM NEW.evidence_sha256
  OR NEW.adjudicator->>'evidence_sha256' IS DISTINCT FROM NEW.evidence_sha256
  OR nullif(NEW.authenticator->>'model_id','') IS NULL
  OR nullif(NEW.adjudicator->>'model_id','') IS NULL
  OR NEW.authenticator->>'model_id' = NEW.adjudicator->>'model_id'
  OR nullif(NEW.authenticator->>'invocation_ref','') IS NULL
  OR nullif(NEW.adjudicator->>'invocation_ref','') IS NULL
  OR NEW.authenticator->>'invocation_ref' = NEW.adjudicator->>'invocation_ref'
  OR jsonb_typeof(NEW.authenticator->'findings') IS DISTINCT FROM 'array'
  OR jsonb_typeof(NEW.adjudicator->'findings') IS DISTINCT FROM 'array'
  OR NEW.feedback_message_id IS NULL OR NEW.outcome_evidence='{}'::jsonb THEN
   RAISE EXCEPTION 'intervention_review_incomplete_authenticator_adjudicator_feedback_or_outcome';
 END IF;
 NEW.closed_at:=now();
 RETURN NEW;
END;
$close$;
REVOKE ALL ON FUNCTION agent_lab.guard_intervention_review_close_v0_2() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS aau_intervention_review_close_guard_v0_2 ON agent_lab.intervention_review_cases;
CREATE TRIGGER aau_intervention_review_close_guard_v0_2
BEFORE UPDATE OF status ON agent_lab.intervention_review_cases
FOR EACH ROW EXECUTE FUNCTION agent_lab.guard_intervention_review_close_v0_2();
