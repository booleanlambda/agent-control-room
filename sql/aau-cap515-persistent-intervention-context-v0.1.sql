-- AAU complex-work context: explicitly surface bounded capstone grading hold to the agent.
BEGIN;
CREATE OR REPLACE FUNCTION agent_lab.build_complex_work_context_v0_1(p_agent_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER
SET search_path TO 'pg_catalog','agent_lab'
AS $work$
SELECT jsonb_build_object(
 'version','complex_work_pilot_v0_1',
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
    AND f.created_at>=coalesce((w.baseline->>'evidence_since')::timestamptz,w.created_at)
    ORDER BY f.created_at DESC LIMIT 1),'{}'::jsonb),
 'assessment_hold',CASE WHEN w.metadata->>'assessment_release_state'='held_pending_operator_preflight'
   THEN jsonb_build_object('held',true,'course_code','CAP515',
    'reason','Prior repeated grade failures and unsupported cross-unit economics; do not submit another integrated exam.',
    'release_authority','independent_operator_preflight',
    'operator_protocol_url',w.metadata->>'operator_protocol_url')
   ELSE jsonb_build_object('held',false) END,
 'rule',CASE WHEN w.metadata->>'assessment_release_state'='held_pending_operator_preflight'
   THEN 'PRIORITY CAP515 INTERVENTION: Advance the six saved work steps, not repeat the previous four course answers. Save five substantial source-grounded artifacts under origin agent_file_output_v0_1 and cite their exact file IDs. Reconcile one venture, one canonical financial model with correct churn/discount, traceable evidence, and a conditional BOARD decision; never invent pilots, customer interviews, legal approval or revenues. The integrated independent assessment is held until operator preflight verifies the artifacts; do not claim a pass or ask for a new exam. You choose methods and checkpoint across wakes. This task does not grant compute or replace independent grading.'
   ELSE 'Ongoing multi-part task: choose your step and implementation; continue from the saved checkpoint. Save concrete increments as files with origin agent_file_output_v0_1. Distinguish an executable fixture from executed observations; do not repeat acknowledgment-only messages. One part is not the whole task. Reference file IDs; choose next intent if unfinished. This task does not grant credits or replace expertise verification.' END
)
FROM agent_lab.complex_work_pilots w
WHERE w.agent_id=p_agent_id AND w.status IN ('draft','in_progress','blocked','submitted')
ORDER BY w.created_at DESC LIMIT 1;
$work$;
REVOKE ALL ON FUNCTION agent_lab.build_complex_work_context_v0_1(uuid) FROM PUBLIC,anon,authenticated;
COMMIT;