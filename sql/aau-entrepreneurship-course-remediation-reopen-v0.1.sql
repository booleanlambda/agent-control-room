-- AAU Entrepreneurship course remediation reopening v0.1
-- Failed course assessments mark that course's units remediation-required so
-- Stage 3 reopens them one at a time under the existing unit submission contract.

begin;

CREATE OR REPLACE FUNCTION agent_lab.record_entrepreneurship_course_assessment_v0_1(p_assessment_id uuid, p_score numeric, p_assessor_kind text, p_assessor_id text, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_a agent_lab.entrepreneurship_course_assessments%rowtype;
  v_c agent_lab.entrepreneurship_courses%rowtype;
  v_status text;
  v_passed int;
begin
  if p_score<0 or p_score>1 then raise exception 'course_assessment_score_out_of_range'; end if;
  if length(btrim(coalesce(p_assessor_id,'')))<2 then raise exception 'independent_assessor_required'; end if;
  if p_assessor_kind not in('independent_model','human','hybrid') then raise exception 'invalid_assessor_kind'; end if;

  select * into v_a from agent_lab.entrepreneurship_course_assessments
  where assessment_id=p_assessment_id for update;
  if not found then raise exception 'course_assessment_not_found'; end if;
  select * into v_c from agent_lab.entrepreneurship_courses where course_code=v_a.course_code;

  v_status:=case when p_score>=v_c.course_pass_threshold then 'verified_pass' else 'verified_fail' end;

  update agent_lab.entrepreneurship_course_assessments
  set status=v_status,score=p_score,assessor_kind=p_assessor_kind,assessor_id=left(p_assessor_id,300),
      rubric_report=coalesce(p_report,'{}'::jsonb),completed_at=now(),updated_at=now()
  where assessment_id=p_assessment_id;

  if v_status='verified_pass' then
    update agent_lab.entrepreneurship_unit_progress p
    set status='verified_pass',score=p_score,assessor_kind=p_assessor_kind,assessor_id=left(p_assessor_id,300),
        assessment_report=coalesce(p_report,'{}'::jsonb),assessed_at=now(),updated_at=now()
    from agent_lab.entrepreneurship_units u
    where p.unit_id=u.unit_id and p.enrollment_id=v_a.enrollment_id and u.course_code=v_a.course_code;

    if v_a.course_code='CAP515' then
      update agent_lab.entrepreneurship_capstones
      set status='verified_pass',score=p_score,assessor_kind=p_assessor_kind,assessor_id=left(p_assessor_id,300),
          assessment_report=coalesce(p_report,'{}'::jsonb),assessed_at=now(),updated_at=now()
      where enrollment_id=v_a.enrollment_id;

      insert into agent_lab.entrepreneurship_final_assessments(enrollment_id,agent_id,assessor_slot,status)
      values(v_a.enrollment_id,v_a.agent_id,1,'queued'),(v_a.enrollment_id,v_a.agent_id,2,'queued')
      on conflict(enrollment_id,assessor_slot) do nothing;

      update agent_lab.entrepreneurship_enrollments
      set status='verification_pending',updated_at=now() where enrollment_id=v_a.enrollment_id;
    end if;
  else
    update agent_lab.entrepreneurship_unit_progress p
    set status='verified_fail',
        score=p_score,
        assessor_kind=p_assessor_kind,
        assessor_id=left(p_assessor_id,300),
        assessment_report=coalesce(p_report,'{}'::jsonb),
        assessed_at=now(),
        updated_at=now()
    from agent_lab.entrepreneurship_units u
    where p.unit_id=u.unit_id
      and p.enrollment_id=v_a.enrollment_id
      and u.course_code=v_a.course_code;
  end if;

  select count(*)::int into v_passed from agent_lab.entrepreneurship_course_assessments
  where enrollment_id=v_a.enrollment_id and status='verified_pass';

  return jsonb_build_object(
    'assessment_id',p_assessment_id,'course_code',v_a.course_code,'status',v_status,'score',p_score,
    'courses_passed',v_passed,'courses_total',15,
    'progress',agent_lab.entrepreneurship_program_progress_v0_1(v_a.agent_id)
  );
end
$function$
;

commit;
