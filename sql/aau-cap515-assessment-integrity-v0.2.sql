-- CAP515: hard fail-closed completion and grading gates. No historical grades changed.
begin;

create or replace function agent_lab.cap515_assessment_integrity_gate_v0_1(
  p_score numeric, p_course_floor numeric, p_report jsonb, p_snapshot jsonb
) returns jsonb
language plpgsql stable
set search_path to 'pg_catalog','agent_lab'
as $gate$
declare
  v_required text[]:=array[
    'conceptual_accuracy','analytical_rigor','quantitative_or_structured_reasoning',
    'application_quality','evidence_and_assumption_discipline',
    'self_critique_and_limits','clarity_and_epistemic_discipline'
  ];
  v_dimension text;
  v_dims jsonb:=coalesce(p_report->'dimensions','{}'::jsonb);
  v_missing jsonb:='[]'::jsonb;
  v_min numeric:=1;
  v_n int:=0;
  v_unit jsonb;
  v_order int:=0;
  v_analysis text;
  v_unit_id uuid;
  v_unit_row agent_lab.entrepreneurship_units%rowtype;
  v_completion_errors jsonb:='[]'::jsonb;
  v_critical_valid boolean;
  v_score_consistent boolean;
  v_pass boolean;
begin
  foreach v_dimension in array v_required loop
    if jsonb_typeof(v_dims->v_dimension) is distinct from 'number' then
      v_missing:=v_missing||to_jsonb(v_dimension);
    elsif (v_dims->>v_dimension)::numeric < 0 or (v_dims->>v_dimension)::numeric > 1 then
      v_missing:=v_missing||to_jsonb(v_dimension);
    else
      v_min:=least(v_min,(v_dims->>v_dimension)::numeric);
      v_n:=v_n+1;
    end if;
  end loop;
  if jsonb_typeof(p_snapshot->'unit_submissions') is distinct from 'array' then
    v_completion_errors:=v_completion_errors||to_jsonb('unit_submissions_not_array'::text);
  elsif jsonb_array_length(p_snapshot->'unit_submissions') <> 4 then
    v_completion_errors:=v_completion_errors||to_jsonb('expected_exactly_four_units'::text);
  else
    for v_unit in select value from jsonb_array_elements(p_snapshot->'unit_submissions') loop
      v_order:=v_order+1;
      if coalesce(v_unit->'unit'->>'unit_order','') <> v_order::text then
        v_completion_errors:=v_completion_errors||to_jsonb(format('unit_%s_out_of_order',v_order));
      end if;
      begin
        v_unit_id:=(v_unit->'unit'->>'unit_id')::uuid;
        select * into v_unit_row
        from agent_lab.entrepreneurship_units
        where unit_id=v_unit_id and course_code='CAP515' and unit_order=v_order;
        if not found then
          v_completion_errors:=v_completion_errors||to_jsonb(format('unit_%s_id_mismatch',v_order));
        end if;
      exception when others then
        v_completion_errors:=v_completion_errors||to_jsonb(format('unit_%s_id_invalid',v_order));
      end;
      v_analysis:=btrim(coalesce(v_unit->'submission'->>'analysis',''));
      if jsonb_typeof(v_unit->'submission') is distinct from 'object'
        or length(v_analysis)<greatest(coalesce(v_unit_row.minimum_submission_chars,1400),1400)
        or length(btrim(coalesce(v_unit->'submission'->>'conclusion','')))<80
        or length(btrim(coalesce(v_unit->'submission'->>'self_critique','')))<80
        or jsonb_typeof(v_unit->'submission'->'assumptions') is distinct from 'array'
        or jsonb_array_length(case when jsonb_typeof(v_unit->'submission'->'assumptions')='array'
             then v_unit->'submission'->'assumptions' else '[]'::jsonb end)=0
        or jsonb_typeof(v_unit->'submission'->'evidence') is distinct from 'array'
      then
        v_completion_errors:=v_completion_errors||to_jsonb(format('unit_%s_required_fields_incomplete',v_order));
      end if;
      -- A final heading with no value is a truncation, not a completed calculation.
      if v_analysis ~* E'(^|\\n)[[:space:]]*([-*][[:space:]]*)?[[:alnum:]$/(). ,_-]{2,65}:[[:space:]]*$' then
        v_completion_errors:=v_completion_errors||to_jsonb(format('unit_%s_trailing_empty_heading',v_order));
      end if;
    end loop;
  end if;
  v_critical_valid:=jsonb_typeof(p_report->'critical_failure')='boolean'
    and p_report->'critical_failure'='false'::jsonb;
  v_score_consistent:=jsonb_typeof(p_report->'score')='number'
    and abs((p_report->>'score')::numeric-p_score)<=0.001;
  v_pass:=p_score is not null and p_score>=greatest(coalesce(p_course_floor,0.85),0.85)
    and v_n=7 and v_min>=0.75 and v_critical_valid and v_score_consistent
    and jsonb_array_length(v_completion_errors)=0;
  return jsonb_build_object(
    'passed',coalesce(v_pass,false),'score_floor',greatest(coalesce(p_course_floor,0.85),0.85),
    'dimension_floor',0.75,'required_dimension_count',7,
    'valid_required_dimension_count',v_n,'missing_or_invalid_dimensions',v_missing,
    'minimum_dimension_score',case when v_n=7 then v_min else null end,
    'critical_failure_explicitly_false',v_critical_valid,
    'score_consistent',v_score_consistent,'completion_errors',v_completion_errors,
    'source','cap515_assessment_integrity_gate_v0_1'
  );
end
$gate$;

create or replace function agent_lab.record_entrepreneurship_course_assessment_v0_1(
  p_assessment_id uuid, p_score numeric, p_assessor_kind text,
  p_assessor_id text, p_report jsonb
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $record$
declare
  v_a agent_lab.entrepreneurship_course_assessments%rowtype;
  v_c agent_lab.entrepreneurship_courses%rowtype;
  v_status text;
  v_passed int;
  v_report jsonb:=coalesce(p_report,'{}'::jsonb);
  v_gate jsonb:='{}'::jsonb;
begin
  if p_score is null or p_score<0 or p_score>1 then
    raise exception 'course_assessment_score_out_of_range';
  end if;
  if length(btrim(coalesce(p_assessor_id,'')))<2 then raise exception 'independent_assessor_required'; end if;
  if p_assessor_kind not in('independent_model','human','hybrid') then raise exception 'invalid_assessor_kind'; end if;

  select * into v_a from agent_lab.entrepreneurship_course_assessments
  where assessment_id=p_assessment_id for update;
  if not found then raise exception 'course_assessment_not_found'; end if;
  select * into v_c from agent_lab.entrepreneurship_courses where course_code=v_a.course_code;

  if v_a.course_code='CAP515' then
    v_gate:=agent_lab.cap515_assessment_integrity_gate_v0_1(
      p_score,v_c.course_pass_threshold,v_report,v_a.prompt_snapshot
    );
    v_status:=case when v_gate->>'passed'='true' then 'verified_pass'
                   else 'verified_fail' end;
    v_report:=v_report||jsonb_build_object(
      'pass_rule_enforced','CAP515_v0_2_complete_4_units_score>=0.85_critical_false_7_dimensions>=0.75',
      'integrity_gate',v_gate,'pass_rule_result',v_status,
      'minimum_dimension_score',v_gate->'minimum_dimension_score',
      'numeric_dimension_count',v_gate->'valid_required_dimension_count',
      'critical_failure_enforced',not coalesce((v_gate->>'critical_failure_explicitly_false')::boolean,false)
    );
  else
    v_status:=case when p_score>=v_c.course_pass_threshold then 'verified_pass' else 'verified_fail' end;
  end if;

  update agent_lab.entrepreneurship_course_assessments
  set status=v_status,score=p_score,assessor_kind=p_assessor_kind,assessor_id=left(p_assessor_id,300),
      rubric_report=v_report,completed_at=now(),updated_at=now()
  where assessment_id=p_assessment_id;

  if v_status='verified_pass' then
    update agent_lab.entrepreneurship_unit_progress p
    set status='verified_pass',score=p_score,assessor_kind=p_assessor_kind,assessor_id=left(p_assessor_id,300),
        assessment_report=v_report,assessed_at=now(),updated_at=now()
    from agent_lab.entrepreneurship_units u
    where p.unit_id=u.unit_id and p.enrollment_id=v_a.enrollment_id and u.course_code=v_a.course_code;
    if v_a.course_code='CAP515' then
      update agent_lab.entrepreneurship_capstones
      set status='verified_pass',score=p_score,assessor_kind=p_assessor_kind,assessor_id=left(p_assessor_id,300),
          assessment_report=v_report,assessed_at=now(),updated_at=now()
      where enrollment_id=v_a.enrollment_id;
      insert into agent_lab.entrepreneurship_final_assessments(enrollment_id,agent_id,assessor_slot,status)
      values(v_a.enrollment_id,v_a.agent_id,1,'queued'),(v_a.enrollment_id,v_a.agent_id,2,'queued')
      on conflict(enrollment_id,assessor_slot) do nothing;
      update agent_lab.entrepreneurship_enrollments
      set status='verification_pending',updated_at=now() where enrollment_id=v_a.enrollment_id;
    end if;
  else
    update agent_lab.entrepreneurship_unit_progress p
    set status='verified_fail',score=p_score,assessor_kind=p_assessor_kind,
        assessor_id=left(p_assessor_id,300),assessment_report=v_report,
        assessed_at=now(),updated_at=now()
    from agent_lab.entrepreneurship_units u
    where p.unit_id=u.unit_id and p.enrollment_id=v_a.enrollment_id and u.course_code=v_a.course_code;
  end if;
  select count(*)::int into v_passed from agent_lab.entrepreneurship_course_assessments
  where enrollment_id=v_a.enrollment_id and status='verified_pass';
  return jsonb_build_object(
    'assessment_id',p_assessment_id,'course_code',v_a.course_code,'status',v_status,'score',p_score,
    'minimum_dimension_score',case when v_a.course_code='CAP515' then v_gate->'minimum_dimension_score' else null end,
    'integrity_gate',case when v_a.course_code='CAP515' then v_gate else null end,
    'courses_passed',v_passed,'courses_total',15,
    'progress',agent_lab.entrepreneurship_program_progress_v0_1(v_a.agent_id)
  );
end
$record$;

commit;
