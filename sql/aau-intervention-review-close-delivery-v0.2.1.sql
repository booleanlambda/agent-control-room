CREATE OR REPLACE FUNCTION agent_lab.guard_intervention_review_close_v0_2()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog','agent_lab' AS $close$
DECLARE v_source_sha text; v_delivery text;
BEGIN
 IF NEW.status <> 'closed' OR OLD.status='closed' THEN RETURN NEW; END IF;
 IF NEW.source_file_id IS NOT NULL THEN
  SELECT encode(sha256(convert_to(inline_text,'UTF8')),'hex') INTO v_source_sha
  FROM agent_lab.agent_files WHERE file_id=NEW.source_file_id;
  IF v_source_sha IS DISTINCT FROM NEW.evidence_sha256 THEN
   RAISE EXCEPTION 'intervention_review_frozen_evidence_changed';
  END IF;
 END IF;
 SELECT delivery_status INTO v_delivery FROM agent_lab.admin_chat_messages WHERE message_id=NEW.feedback_message_id;
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
  OR NEW.feedback_message_id IS NULL
  OR v_delivery IS DISTINCT FROM 'responded'
  OR jsonb_typeof(NEW.outcome_evidence->'evidence_refs') IS DISTINCT FROM 'array'
  OR jsonb_array_length(NEW.outcome_evidence->'evidence_refs')=0 THEN
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
