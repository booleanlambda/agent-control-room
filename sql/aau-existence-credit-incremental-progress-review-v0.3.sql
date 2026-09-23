-- AAU existence-credit incremental-progress review v0.3
-- Non-retroactive: grants already executed remain valid. No automatic approvals.
CREATE OR REPLACE FUNCTION agent_lab.renewal_progress_snapshot_v0_3(p_agent_id uuid)
RETURNS jsonb LANGUAGE sql STABLE
SET search_path TO 'pg_catalog','agent_lab'
AS $fn$
WITH prior AS (
 SELECT request_id,executed_at,usefulness_assessment
 FROM agent_lab.existence_credit_requests
 WHERE agent_id=p_agent_id AND request_kind='renewal'
   AND status='executed' AND executed_at IS NOT NULL
 ORDER BY executed_at DESC LIMIT 1
), u AS (
 SELECT count(*)::int total,
 count(*) FILTER (WHERE assessed_at > (SELECT executed_at FROM prior))::int newly_verified
 FROM agent_lab.entrepreneurship_unit_progress
 WHERE agent_id=p_agent_id AND status='verified_pass'
), c AS (
 SELECT count(*)::int total,
 count(*) FILTER (WHERE completed_at > (SELECT executed_at FROM prior))::int newly_verified
 FROM (
  SELECT DISTINCT ON (course_code) course_code,status,completed_at
  FROM agent_lab.entrepreneurship_course_assessments
  WHERE agent_id=p_agent_id AND status='verified_pass'
  ORDER BY course_code,completed_at DESC
 ) t
), r AS (
 SELECT count(*) FILTER (WHERE verified_at > (SELECT executed_at FROM prior))::int newly_verified
 FROM agent_lab.reward_events
 WHERE agent_id=p_agent_id AND verification_state IN ('verified','approved')
), x AS (
 SELECT count(*) FILTER (WHERE completed_at > (SELECT executed_at FROM prior))::int newly_completed
 FROM agent_lab.external_actions
 WHERE agent_id=p_agent_id AND status='completed'
), i AS (
 SELECT count(*) FILTER (WHERE coalesce(verified_at,settled_at) > (SELECT executed_at FROM prior))::int new_receipts
 FROM agent_lab.real_usd_income_receipts
 WHERE agent_id=p_agent_id AND status IN ('verified','settled')
)
SELECT jsonb_build_object(
 'policy_version','existence_credit_v0_3_incremental_progress',
 'as_of',now(),
 'prior_executed_grant_id',(SELECT request_id FROM prior),
 'prior_executed_at',(SELECT executed_at FROM prior),
 'initial_renewal',(SELECT count(*) FROM prior)=0,
 'verified_mba_units_total',u.total,
 'verified_mba_units_at_last_grant',(SELECT CASE WHEN usefulness_assessment->>'verified_mba_units_passed_at_review' ~ '^[0-9]+$' THEN (usefulness_assessment->>'verified_mba_units_passed_at_review')::int ELSE NULL END FROM prior),
 'verified_mba_units_since_last_grant',u.newly_verified,
 'verified_mba_courses_total',c.total,
 'verified_mba_courses_since_last_grant',c.newly_verified,
 'verified_contribution_events_since_last_grant',r.newly_verified,
 'completed_external_actions_since_last_grant',x.newly_completed,
 'verified_income_receipts_since_last_grant',i.new_receipts,
 'has_new_recorded_evidence',((u.newly_verified+c.newly_verified+r.newly_verified+x.newly_completed+i.new_receipts)>0),
 'interpretation','Timestamped records support review, not automatic approval. Counts are zero for an initial renewal with no prior grant; missing historical baseline is unknown, not zero.'
)
FROM u CROSS JOIN c CROSS JOIN r CROSS JOIN x CROSS JOIN i;
$fn$;

CREATE OR REPLACE FUNCTION agent_lab.attach_renewal_progress_snapshot_v0_3()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog','agent_lab'
AS $fn$
BEGIN
 IF NEW.request_kind='renewal' THEN
   NEW.usefulness_evidence:=coalesce(NEW.usefulness_evidence,'{}'::jsonb)
      || jsonb_build_object('incremental_progress_snapshot',agent_lab.renewal_progress_snapshot_v0_3(NEW.agent_id),
                            'standing_review_policy','existence_credit_v0_3_incremental_progress');
 END IF;
 RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_attach_renewal_progress_snapshot_v0_3
 ON agent_lab.existence_credit_requests;
CREATE TRIGGER trg_attach_renewal_progress_snapshot_v0_3
 BEFORE INSERT ON agent_lab.existence_credit_requests FOR EACH ROW
 EXECUTE FUNCTION agent_lab.attach_renewal_progress_snapshot_v0_3();

CREATE OR REPLACE FUNCTION agent_lab.enforce_incremental_renewal_review_v0_3()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog','agent_lab'
AS $fn$
DECLARE
 v_prior uuid;
 v_snapshot jsonb;
 v_assessment jsonb:=coalesce(NEW.usefulness_assessment,'{}'::jsonb);
 v_recent boolean;
 v_exception boolean;
 v_refs int;
BEGIN
 IF NEW.request_kind <> 'renewal' THEN RETURN NEW; END IF;
 SELECT r.request_id INTO v_prior
 FROM agent_lab.existence_credit_requests r
 WHERE r.agent_id=NEW.agent_id AND r.request_kind='renewal'
   AND r.status='executed' AND r.executed_at IS NOT NULL
   AND r.executed_at < NEW.created_at AND r.request_id<>NEW.request_id
 ORDER BY r.executed_at DESC LIMIT 1;
 v_snapshot:=agent_lab.renewal_progress_snapshot_v0_3(NEW.agent_id);
 IF v_prior IS NOT NULL THEN
   IF lower(coalesce(v_assessment->>'incremental_progress_reviewed',''))<>'true'
      OR v_assessment->>'prior_executed_grant_id' IS DISTINCT FROM v_prior::text
      OR char_length(btrim(coalesce(v_assessment->>'new_progress_since_grant','')))<24
   THEN
     RAISE EXCEPTION 'repeat_renewal_requires_independent_since_last_grant_review';
   END IF;
   v_recent:=lower(coalesce(v_assessment->>'recent_progress_supported',''))='true';
   v_exception:=lower(coalesce(v_assessment->>'exceptional_admin_approval',''))='true';
   v_refs:=CASE WHEN jsonb_typeof(v_assessment->'additional_verified_evidence_refs')='array'
     THEN jsonb_array_length(v_assessment->'additional_verified_evidence_refs') ELSE 0 END;
   IF NOT v_recent AND NOT (v_exception AND
       char_length(btrim(coalesce(v_assessment->>'exception_rationale','')))>=40) THEN
     RAISE EXCEPTION 'repeat_renewal_requires_recent_progress_or_documented_admin_exception';
   END IF;
   IF v_recent AND NOT coalesce((v_snapshot->>'has_new_recorded_evidence')::boolean,false)
      AND NOT (v_refs>0 AND lower(coalesce(v_assessment->>'additional_evidence_independently_verified',''))='true')
   THEN
     RAISE EXCEPTION 'repeat_renewal_requires_new_verified_source_evidence';
   END IF;
 END IF;
 NEW.usefulness_assessment:=v_assessment||jsonb_build_object(
   'standing_review_policy','existence_credit_v0_3_incremental_progress',
   'prior_executed_grant_id',v_prior,
   'incremental_progress_snapshot_at_review',v_snapshot,
   'repeat_renewal',v_prior IS NOT NULL);
 RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enforce_incremental_renewal_review_v0_3
 ON agent_lab.existence_credit_requests;
CREATE TRIGGER trg_enforce_incremental_renewal_review_v0_3
 BEFORE UPDATE OF status ON agent_lab.existence_credit_requests
 FOR EACH ROW WHEN (NEW.status='approved' AND OLD.status IN ('pending','blocked'))
 EXECUTE FUNCTION agent_lab.enforce_incremental_renewal_review_v0_3();

UPDATE agent_lab.existence_credit_policies
SET metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
 'standing_review_policy','existence_credit_v0_3_incremental_progress',
 'standing_review_policy_adopted_at','2026-09-23',
 'repeat_renewal_primary_basis','new_independently_verified_progress_since_previous_executed_grant',
 'cumulative_progress_role','context_not_repeat_credit',
 'renewal_requires_approval',true,
 'policy_reference','docs/AAU_EXISTENCE_CREDIT_RENEWAL_POLICY_v0.3.md',
 'preserve_existing_grants',true
 ),updated_at=now()
WHERE active=true AND effective_to IS NULL;

REVOKE ALL ON FUNCTION agent_lab.renewal_progress_snapshot_v0_3(uuid)
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION agent_lab.attach_renewal_progress_snapshot_v0_3()
 FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION agent_lab.enforce_incremental_renewal_review_v0_3()
 FROM PUBLIC,anon,authenticated;
