
CREATE OR REPLACE FUNCTION agent_lab.operator_release_cap515_preflight_v0_1(
  p_agent_id uuid,p_operator_ref text
) RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog','agent_lab'
AS $function$
declare
  v_pf jsonb;
  v_work uuid;
  v_last agent_lab.entrepreneurship_course_assessments%rowtype;
  v_enrollment uuid;
begin
  if length(btrim(coalesce(p_operator_ref,'')))<3 then raise exception 'operator_ref_required'; end if;
  v_pf:=agent_lab.cap515_reconciliation_preflight_v0_1(p_agent_id);
  if coalesce((v_pf->>'ready_for_operator_review')::boolean,false) is not true then
    raise exception 'cap515_preflight_not_ready: %',v_pf;
  end if;

  select work_id into v_work from agent_lab.complex_work_pilots
  where agent_id=p_agent_id
    and metadata->>'assessment_release_state'='held_pending_operator_preflight'
  order by created_at desc limit 1;
  if v_work is null then raise exception 'cap515_preflight_work_not_found'; end if;

  select * into v_last from agent_lab.entrepreneurship_course_assessments
  where agent_id=p_agent_id and course_code='CAP515' and status='verified_fail'
  order by completed_at desc nulls last,created_at desc limit 1;
  if not found then raise exception 'cap515_prior_failed_assessment_required'; end if;
  v_enrollment:=v_last.enrollment_id;

  delete from agent_lab.entrepreneurship_course_assessments
   where agent_id=p_agent_id and course_code='CAP515'
     and status='queued' and assessor_id is null;

  update agent_lab.entrepreneurship_unit_progress p
  set status='verified_fail',
      score=v_last.score,
      assessor_kind=v_last.assessor_kind,
      assessor_id=v_last.assessor_id,
      assessment_report=v_last.rubric_report,
      assessed_at=v_last.completed_at,
      updated_at=now()
  from agent_lab.entrepreneurship_units u
  where p.unit_id=u.unit_id and p.enrollment_id=v_enrollment and u.course_code='CAP515';

  update agent_lab.entrepreneurship_enrollments
  set status='in_progress',current_course_code='CAP515',current_unit_order=1,updated_at=now()
  where enrollment_id=v_enrollment;

  update agent_lab.complex_work_steps
  set status=case when step_key='operator' then 'submitted' else status end,
      checkpoint=coalesce(checkpoint,'{}'::jsonb)||case when step_key='operator' then
        jsonb_build_object('operator_release_at',now(),'operator_ref',left(p_operator_ref,300),
          'preflight',v_pf,'release_rule','One bounded final four-unit resubmission sequence is authorized; independent grading still required.')
        else '{}'::jsonb end,
      updated_at=now()
  where work_id=v_work;

  update agent_lab.complex_work_pilots
  set status='submitted',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'assessment_release_state','released_for_final_resubmission',
        'preflight_released_at',now(),
        'preflight_released_by',left(p_operator_ref,300),
        'released_preflight',v_pf,
        'final_resubmission_sequence_authorized',true),
      updated_at=now()
  where work_id=v_work;

  return jsonb_build_object(
    'status','released_for_final_resubmission',
    'agent_id',p_agent_id,'work_id',v_work,'preflight',v_pf,
    'progress',agent_lab.entrepreneurship_program_progress_v0_1(p_agent_id),
    'rule','Release authorizes one clean four-unit remediation sequence only. It does not award CAP515 or guarantee a pass.'
  );
end;
$function$;
REVOKE ALL ON FUNCTION agent_lab.operator_release_cap515_preflight_v0_1(uuid,text) FROM PUBLIC,anon,authenticated;
