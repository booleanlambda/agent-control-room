CREATE OR REPLACE FUNCTION agent_lab.reconcile_complex_work_file_v0_2(p_file_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
DECLARE
 v_file agent_lab.agent_files%rowtype;
 v_work agent_lab.complex_work_pilots%rowtype;
 v_step agent_lab.complex_work_steps%rowtype;
 v_step_key text;
 v_kind text;
 v_status text;
BEGIN
 SELECT * INTO v_file FROM agent_lab.agent_files WHERE file_id=p_file_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','file_not_found'); END IF;
 IF v_file.direction IS DISTINCT FROM 'outbound'
    OR v_file.sender_kind IS DISTINCT FROM 'agent'
    OR v_file.purpose IS DISTINCT FROM 'agent_output' THEN
   RETURN jsonb_build_object('ok',false,'reason','not_agent_output');
 END IF;
 SELECT * INTO v_work FROM agent_lab.complex_work_pilots
 WHERE agent_id=v_file.agent_id
  AND status IN ('draft','in_progress','blocked','submitted')
  AND v_file.created_at>=COALESCE((baseline->>'evidence_since')::timestamptz,created_at)
 ORDER BY created_at DESC LIMIT 1;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','no_active_scoped_work'); END IF;

 -- Exact filenames and work ID are intentionally scoped to Julian's test,
 -- not a global heuristic for arbitrary agents/files.
 IF v_work.work_id='527020ee-222d-465b-ba96-24850c38e149'::uuid THEN
   CASE v_file.filename
     WHEN 'efra_t4_drift_normalization_test.py' THEN
       v_step_key:='T4_FIXTURE'; v_kind:='unexecuted_test_fixture';
     WHEN 'efra_t1_grounding_test.py' THEN
       v_step_key:='T1_EVIDENCE'; v_kind:='simulated_oracle_test_fixture';
     WHEN 'efra_thesis_acceptance_criteria.md' THEN
       v_step_key:='AUDIT'; v_kind:='acceptance_criteria_draft';
     WHEN 'efra_integrated_research_artifact_v1_1.md' THEN
       v_step_key:='INTEGRATION'; v_kind:='integrated_research_revision_unverified';
     WHEN 'efra_integrated_research_artifact_v1.md' THEN
       v_step_key:='INTEGRATION'; v_kind:='integrated_research_draft_unverified';
     WHEN 'efra_research_thesis_v4.md' THEN
       v_step_key:='INTEGRATION'; v_kind:='integrated_research_draft';
     ELSE
       RETURN jsonb_build_object('ok',false,'reason','unmapped_filename','file_id',p_file_id);
   END CASE;
 ELSE
   RETURN jsonb_build_object('ok',false,'reason','not_pilot_work');
 END IF;

 SELECT * INTO v_step FROM agent_lab.complex_work_steps
 WHERE work_id=v_work.work_id AND step_key=v_step_key FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','step_not_found'); END IF;
 IF p_file_id=ANY(v_step.evidence_file_ids) THEN
   RETURN jsonb_build_object('ok',true,'action','already_reconciled','step_key',v_step_key,'file_id',p_file_id);
 END IF;
 -- Never alter completed/verified, cancelled, or intentionally skipped work.
 IF v_step.status IN ('verified_complete','skipped') THEN
   RETURN jsonb_build_object('ok',false,'reason','terminal_step','step_key',v_step_key);
 END IF;
 v_status:= CASE WHEN v_step_key='T4_FIXTURE' THEN 'submitted'
                 ELSE 'in_progress' END;
 UPDATE agent_lab.complex_work_steps
    SET evidence_file_ids=array_append(evidence_file_ids,p_file_id),
        status=v_status,
        checkpoint=checkpoint || jsonb_build_object(
          'latest_evidence_file_id',p_file_id,
          'latest_evidence_filename',v_file.filename,
          'latest_evidence_created_at',v_file.created_at,
          'latest_evidence_kind',v_kind,
          'execution_verified',false,
          'independently_verified',false,
          'reconciliation_version','complex_work_file_reconciliation_v0_2',
          'reconciliation_scope','registration_only',
          'next',CASE
            WHEN v_step_key='AUDIT' THEN 'Compare acceptance criteria with actual test results; self-audit and independent review remain pending.'
            WHEN v_step_key='INTEGRATION' THEN 'Check supporting executed evidence and limitations before requesting independent review.'
            WHEN v_step_key='T1_EVIDENCE' THEN 'Execute fixture with traceable outputs; simulated oracle cannot certify external provenance.'
            ELSE 'Execute the fixture and save observed numeric results; fixture-only submission does not establish test completion.'
          END
        ),
        updated_at=now()
  WHERE step_id=v_step.step_id;
 UPDATE agent_lab.complex_work_pilots SET updated_at=now(),
   metadata=metadata || jsonb_build_object('last_reconciled_file_id',p_file_id,
     'last_reconciled_at',now(),'reconciliation_version','complex_work_file_reconciliation_v0_2')
   WHERE work_id=v_work.work_id;
 RETURN jsonb_build_object('ok',true,'action','evidence_registered','work_id',v_work.work_id,
   'step_key',v_step_key,'step_status',v_status,'file_id',p_file_id,'evidence_kind',v_kind,
   'verified',false);
END;
$function$
;
