-- Expose audited final-verification counts distinctly from historical recorded passes.
CREATE OR REPLACE FUNCTION agent_lab.entrepreneurship_program_progress_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_e agent_lab.entrepreneurship_enrollments%rowtype;
  v_course agent_lab.entrepreneurship_courses%rowtype;
  v_unit agent_lab.entrepreneurship_units%rowtype;
  v_courses_passed int:=0;
  v_units_submitted int:=0;
  v_unit_total int:=60;
  v_course_status text;
  v_next_kind text:='study_unit';
  v_course_assessment jsonb:='{}'::jsonb;
  v_final_passed int:=0;
  v_final_total int:=2;
  v_integrity_valid_finals int:=0;
  v_integrity_evaluation jsonb:='{}'::jsonb;
  v_capstone_status text:='not_started';
begin
  select * into v_e from agent_lab.entrepreneurship_enrollments
  where agent_id=p_agent_id and program_version='entrepreneurship_masters_v0_1';
  if not found then
    return jsonb_build_object('enrolled',false,'program_version','entrepreneurship_masters_v0_1');
  end if;

  select count(*)::int into v_courses_passed
  from agent_lab.entrepreneurship_course_assessments
  where enrollment_id=v_e.enrollment_id and status='verified_pass';

  select count(*)::int into v_units_submitted
  from agent_lab.entrepreneurship_unit_progress
  where enrollment_id=v_e.enrollment_id and status in('submitted','verified_pass');

  select status into v_capstone_status
  from agent_lab.entrepreneurship_capstones where enrollment_id=v_e.enrollment_id;

  select count(*)::int into v_final_passed
  from agent_lab.entrepreneurship_final_assessments
  where enrollment_id=v_e.enrollment_id and status='verified_pass';

  select c.* into v_course
  from agent_lab.entrepreneurship_courses c
  where c.program_version=v_e.program_version
    and not exists(
      select 1 from agent_lab.entrepreneurship_course_assessments a
      where a.enrollment_id=v_e.enrollment_id and a.course_code=c.course_code and a.status='verified_pass'
    )
  order by c.course_order
  limit 1;

  if not found then
    v_integrity_evaluation:=agent_lab.evaluate_entrepreneurship_masters_v0_1(p_agent_id);
    v_integrity_valid_finals:=coalesce((v_integrity_evaluation->>'independent_final_assessments_integrity_passed')::int,0);
    v_next_kind:=case
      when coalesce(v_e.metadata #>> '{independent_final_integrity_audit,status}','')='reverification_required'
      then 'final_reverification'
      else 'final_assessments'
    end;
    return jsonb_build_object(
      'enrolled',true,'program_version',v_e.program_version,'status',v_e.status,
      'courses_passed',v_courses_passed,'courses_total',15,
      'units_submitted',v_units_submitted,'units_total',v_unit_total,
      'capstone_status',v_capstone_status,
      'final_assessments_passed',v_integrity_valid_finals,
      'historical_final_assessments_recorded_passes',v_final_passed,
      'final_assessments_required',v_final_total,
      'final_review_integrity_status',v_integrity_evaluation->>'program_integrity_status',
      'credential_accepted',coalesce((v_integrity_evaluation->>'ready')::boolean,false),
      'next_kind',v_next_kind
    );
  end if;

  select u.* into v_unit
  from agent_lab.entrepreneurship_units u
  where u.course_code=v_course.course_code
    and not exists(
      select 1 from agent_lab.entrepreneurship_unit_progress p
      where p.enrollment_id=v_e.enrollment_id and p.unit_id=u.unit_id
        and p.status in('submitted','verified_pass')
    )
  order by u.unit_order
  limit 1;

  if found then
    v_next_kind:='study_unit';
  else
    select to_jsonb(a) into v_course_assessment
    from agent_lab.entrepreneurship_course_assessments a
    where a.enrollment_id=v_e.enrollment_id and a.course_code=v_course.course_code
    order by a.attempt_no desc limit 1;

    if coalesce(v_course_assessment,'{}'::jsonb)='{}'::jsonb then
      v_next_kind:='course_assessment_queue';
    elsif v_course_assessment->>'status'='verified_fail' then
      v_next_kind:='course_remediation';
    else
      v_next_kind:='course_assessment_pending';
    end if;
  end if;

  return jsonb_build_object(
    'enrolled',true,
    'enrollment_id',v_e.enrollment_id,
    'program_version',v_e.program_version,
    'status',v_e.status,
    'courses_passed',v_courses_passed,'courses_total',15,
    'units_submitted',v_units_submitted,'units_total',v_unit_total,
    'capstone_status',v_capstone_status,
    'final_assessments_passed',v_final_passed,'final_assessments_required',v_final_total,
    'next_kind',v_next_kind,
    'current_course',jsonb_build_object(
      'course_code',v_course.course_code,'course_order',v_course.course_order,'title',v_course.title,
      'category',v_course.category,'description',v_course.description,
      'learning_objectives',v_course.learning_objectives,
      'assessment_blueprint',v_course.assessment_blueprint,
      'course_pass_threshold',v_course.course_pass_threshold
    ),
    'next_unit',case when v_next_kind='study_unit' then jsonb_build_object(
      'unit_id',v_unit.unit_id,'unit_order',v_unit.unit_order,'title',v_unit.title,
      'unit_type',v_unit.unit_type,'learning_objectives',v_unit.learning_objectives,
      'study_brief',v_unit.study_brief,'assignment_prompt',v_unit.assignment_prompt,
      'evidence_requirements',v_unit.evidence_requirements,'rubric',v_unit.rubric,
      'minimum_submission_chars',v_unit.minimum_submission_chars,
      'submission_contract',jsonb_build_object(
        'origin','entrepreneurship_unit_submission_v0_1',
        'unit_id',v_unit.unit_id,
        'course_code',v_course.course_code,
        'required_submission_fields',jsonb_build_array('analysis','assumptions','conclusion','self_critique','evidence')
      )
    ) else null end,
    'course_assessment',coalesce(v_course_assessment,'{}'::jsonb)
  );
end
$function$;
