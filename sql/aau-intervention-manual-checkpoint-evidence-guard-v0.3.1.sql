
-- Support frozen expertise checkpoint evidence in manual intervention close guard.
-- Retain all existing role, feedback-delivery, model-identity and outcome checks.
CREATE OR REPLACE FUNCTION agent_lab.guard_manual_intervention_complete_v0_3()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'pg_catalog','agent_lab'
AS $body$
DECLARE actual_hash text; delivered text;
BEGIN
 IF NEW.status IS DISTINCT FROM 'manual_review_complete' OR OLD.status='manual_review_complete'
 THEN RETURN NEW; END IF;
 IF NEW.source_file_id IS NOT NULL THEN
  SELECT encode(sha256(convert_to(inline_text,'UTF8')),'hex') INTO actual_hash
  FROM agent_lab.agent_files WHERE file_id=NEW.source_file_id;
 ELSIF nullif(NEW.frozen_evidence->>'verification_run_id','') IS NOT NULL THEN
  SELECT agent_lab.operator_verification_evidence_v0_1(
     (NEW.frozen_evidence->>'verification_run_id')::uuid
   )->>'evidence_sha256' INTO actual_hash;
 ELSE
  RAISE EXCEPTION 'manual_intervention_evidence_source_missing';
 END IF;
 SELECT delivery_status INTO delivered FROM agent_lab.admin_chat_messages
 WHERE message_id=NEW.feedback_message_id;
 IF actual_hash IS DISTINCT FROM NEW.evidence_sha256
 OR NEW.metadata->>'operator_authorized_manual_dual_role' IS DISTINCT FROM 'true'
 OR NEW.metadata->>'independent_model_review' IS DISTINCT FROM 'false'
 OR NEW.metadata->>'official_verdict_unchanged' IS DISTINCT FROM 'true'
 OR NEW.authenticator->>'status' IS DISTINCT FROM 'manual_complete'
 OR NEW.adjudicator->>'status' IS DISTINCT FROM 'manual_complete'
 OR NEW.authenticator->>'review_pass' IS DISTINCT FROM 'authenticator'
 OR NEW.adjudicator->>'review_pass' IS DISTINCT FROM 'adjudicator'
 OR NEW.authenticator->>'evidence_sha256' IS DISTINCT FROM NEW.evidence_sha256
 OR NEW.adjudicator->>'evidence_sha256' IS DISTINCT FROM NEW.evidence_sha256
 OR NULLIF(NEW.authenticator->>'model_id','') IS NULL
 OR NULLIF(NEW.adjudicator->>'model_id','') IS NULL
 OR NEW.authenticator->>'model_id' IS DISTINCT FROM NEW.adjudicator->>'model_id'
 OR NULLIF(NEW.authenticator->>'invocation_ref','') IS NULL
 OR NULLIF(NEW.adjudicator->>'invocation_ref','') IS NULL
 OR NEW.authenticator->>'invocation_ref' IS NOT DISTINCT FROM NEW.adjudicator->>'invocation_ref'
 OR jsonb_typeof(NEW.authenticator->'findings') IS DISTINCT FROM 'array'
 OR jsonb_typeof(NEW.adjudicator->'findings') IS DISTINCT FROM 'array'
 OR jsonb_typeof(NEW.authenticator->'corrective_actions') IS DISTINCT FROM 'array'
 OR jsonb_typeof(NEW.adjudicator->'corrective_actions') IS DISTINCT FROM 'array'
 OR delivered IS DISTINCT FROM 'responded'
 OR jsonb_typeof(NEW.outcome_evidence->'evidence_refs') IS DISTINCT FROM 'array'
 OR jsonb_array_length(NEW.outcome_evidence->'evidence_refs')=0
 THEN RAISE EXCEPTION 'manual_intervention_incomplete_or_misrepresented'; END IF;
 NEW.closed_at:=now();
 RETURN NEW;
END
$body$;
REVOKE ALL ON FUNCTION agent_lab.guard_manual_intervention_complete_v0_3()
 FROM PUBLIC,anon,authenticated;
