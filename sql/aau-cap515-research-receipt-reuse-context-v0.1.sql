
BEGIN;

CREATE OR REPLACE FUNCTION agent_lab.build_complex_work_context_v0_1(p_agent_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'pg_catalog','agent_lab'
AS $work$
SELECT jsonb_build_object(
 'version','complex_work_pilot_v0_3_research_receipt_reuse',
 'work_id',w.work_id,'title',w.title,'objective',w.objective,
 'status',w.status,'acceptance_criteria',w.acceptance_criteria,
 'steps',coalesce((SELECT jsonb_agg(jsonb_build_object(
      'step_key',s.step_key,'step_order',s.step_order,'title',s.title,
      'acceptance',s.acceptance,'status',s.status,
      'evidence_file_ids',to_jsonb(s.evidence_file_ids),'checkpoint',s.checkpoint
   ) ORDER BY s.step_order) FROM agent_lab.complex_work_steps s
   WHERE s.work_id=w.work_id),'[]'::jsonb),
 'latest_artifact',coalesce((SELECT jsonb_build_object(
      'file_id',f.file_id,'filename',f.filename,'sha256',f.sha256,
      'created_at',f.created_at,'text_excerpt',left(coalesce(f.inline_text,''),1900)
   ) FROM agent_lab.agent_files f WHERE f.agent_id=p_agent_id
    AND f.direction='outbound' AND f.purpose='agent_output'
    AND length(btrim(coalesce(f.inline_text,'')))>0
    AND coalesce((f.metadata->>'invalid_empty_output')::boolean,false)=false
    AND f.created_at>=coalesce((w.baseline->>'evidence_since')::timestamptz,w.created_at)
    ORDER BY f.created_at DESC LIMIT 1),'{}'::jsonb),
 'latest_research',coalesce((
   SELECT jsonb_build_object(
     'batch_id',b.batch_id,'created_at',b.created_at,'status',b.status,
     'queries',b.queries,
     'receipt_count',jsonb_array_length(coalesce(b.receipts,'[]'::jsonb)),
     'fetched_receipts',coalesce((
       SELECT jsonb_agg(x.item ORDER BY x.priority,x.url)
       FROM (
         SELECT
           case
             when r->>'url' ~* '(occ.gov|fdic.gov|federalreserve.gov|eba.europa.eu|fca.org.uk|ec.europa.eu|nist.gov|consumerfinance.gov)' then 0
             else 1
           end priority,
           r->>'url' url,
           jsonb_build_object(
             'url',r->>'url','title',r->>'title','query',r->>'query',
             'sha256',r->>'sha256','fetch_status',r->>'fetch_status',
             'coverage',r->>'coverage','published_at',r->>'published_at',
             'excerpt_preview',left(coalesce(r->>'excerpt_preview',''),900)
           ) item
         FROM jsonb_array_elements(coalesce(b.receipts,'[]'::jsonb)) r
         WHERE r->>'fetch_status'='fetched_text'
           AND coalesce(r->>'url','') ~* '^https://'
           AND coalesce(r->>'sha256','') ~ '^[a-fA-F0-9]{64}$'
         ORDER BY priority,url
         LIMIT 16
       ) x
     ),'[]'::jsonb)
   )
   FROM agent_lab.agent_web_research_batches b
   WHERE b.agent_id=p_agent_id AND b.created_at>=w.created_at
   ORDER BY b.created_at DESC LIMIT 1
 ),'{}'::jsonb),
 'preflight',agent_lab.cap515_reconciliation_preflight_v0_1(p_agent_id),
 'assessment_hold',CASE WHEN w.metadata->>'assessment_release_state'='held_pending_operator_preflight'
   THEN jsonb_build_object('held',true,'course_code','CAP515',
    'reason','Prior repeated grade failures and unsupported cross-unit economics; do not submit another integrated exam.',
    'release_authority','independent_operator_preflight',
    'operator_protocol_url',w.metadata->>'operator_protocol_url')
   ELSE jsonb_build_object('held',false) END,
 'rule',CASE WHEN w.metadata->>'assessment_release_state'='held_pending_operator_preflight'
   THEN 'PRIORITY CAP515 INTERVENTION: The live preflight and latest_research are authoritative. If receipt-backed evidence is missing and latest_research already contains >=3 fetched receipts, REUSE those exact receipt URLs and hashes to persist a substantive CLAIM_EVIDENCE_REGISTER; do not repeat the search. Only request new web research when fewer than 3 usable fetched receipts exist or when the existing receipts cannot support the material claim. Save complete non-empty file contents. Then persist a new substantive canonical model matching corrected financial math and regenerate downstream reconciliation/board files against its actual database file ID. The independent assessment remains held until operator preflight verifies the package.'
   ELSE 'Ongoing multi-part task: choose your step and implementation; continue from the saved checkpoint. Save concrete increments as files with origin agent_file_output_v0_1.' END
)
FROM agent_lab.complex_work_pilots w
WHERE w.agent_id=p_agent_id AND w.status IN ('draft','in_progress','blocked','submitted')
ORDER BY w.created_at DESC LIMIT 1;
$work$;

REVOKE ALL ON FUNCTION agent_lab.build_complex_work_context_v0_1(uuid) FROM PUBLIC,anon,authenticated;
COMMIT;
