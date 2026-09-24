BEGIN;

CREATE OR REPLACE FUNCTION agent_lab.build_entrepreneurship_remediation_context_v0_1(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'pg_catalog','agent_lab','extensions'
AS $function$
declare
  v_progress jsonb;
  v_unit uuid;
  v_order integer;
  v_title text;
  v_course text;
  v_up agent_lab.entrepreneurship_unit_progress%rowtype;
  v_course_assessment agent_lab.entrepreneurship_course_assessments%rowtype;
  v_all_remediation jsonb:='[]'::jsonb;
  v_all_weaknesses jsonb:='[]'::jsonb;
  v_unit_remediation jsonb:='[]'::jsonb;
  v_unit_weaknesses jsonb:='[]'::jsonb;
  v_integrated_snapshot jsonb:='[]'::jsonb;
begin
  v_progress:=agent_lab.entrepreneurship_program_progress_v0_1(p_agent_id);
  if coalesce(v_progress->>'status','')<>'in_progress'
     or nullif(v_progress#>>'{next_unit,unit_id}','') is null then
    return jsonb_build_object('active',false,'version','entrepreneurship_remediation_context_v0_2_integrated');
  end if;

  v_unit:=(v_progress#>>'{next_unit,unit_id}')::uuid;
  v_order:=coalesce((v_progress#>>'{next_unit,unit_order}')::integer,0);
  v_title:=v_progress#>>'{next_unit,title}';
  v_course:=v_progress#>>'{current_course,course_code}';

  select * into v_up from agent_lab.entrepreneurship_unit_progress
   where agent_id=p_agent_id and unit_id=v_unit;
  if not found or v_up.status<>'verified_fail' or v_up.assessment_report is null then
    return jsonb_build_object(
      'active',false,'version','entrepreneurship_remediation_context_v0_2_integrated',
      'unit_id',v_unit,'unit_status',coalesce(v_up.status,'not_started')
    );
  end if;

  select * into v_course_assessment
   from agent_lab.entrepreneurship_course_assessments
   where agent_id=p_agent_id and course_code=v_course and status='verified_fail'
   order by completed_at desc nulls last,created_at desc limit 1;

  v_all_remediation:=coalesce(v_course_assessment.rubric_report->'remediation','[]'::jsonb);
  v_all_weaknesses:=coalesce(v_course_assessment.rubric_report->'weaknesses','[]'::jsonb);
  v_integrated_snapshot:=coalesce(v_course_assessment.prompt_snapshot->'unit_submissions','[]'::jsonb);

  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_unit_remediation
    from jsonb_array_elements_text(v_all_remediation)
    where value ~* ('^Unit[[:space:]]+'||v_order::text||':');
  select coalesce(jsonb_agg(value),'[]'::jsonb) into v_unit_weaknesses
    from jsonb_array_elements_text(v_all_weaknesses)
    where value ~* ('^Unit[[:space:]]+'||v_order::text||':');

  return jsonb_build_object(
    'active',true,
    'version','entrepreneurship_remediation_context_v0_2_integrated',
    'authority','independent_course_assessment',
    'course_code',v_course,
    'unit_id',v_unit,
    'unit_order',v_order,
    'unit_title',v_title,
    'unit_status',v_up.status,
    'unit_attempt_count',v_up.attempt_count,
    'unit_score',v_up.score,
    'assessed_at',v_up.assessed_at,
    'course_attempt_no',v_course_assessment.attempt_no,
    'course_score',v_course_assessment.score,
    'course_status',v_course_assessment.status,
    'assessment_model',v_course_assessment.assessor_id,
    'weaknesses',v_unit_weaknesses,
    'required_remediation',v_unit_remediation,
    'course_level_weaknesses',v_all_weaknesses,
    'course_level_required_remediation',v_all_remediation,
    'latest_integrated_snapshot',v_integrated_snapshot,
    'integration_rule',
      'This is one integrated course retry. Current-unit edits must remain consistent with the latest frozen submissions for every other unit. Carry forward all course-level feedback, including unprefixed and cross-unit feedback. If a load-bearing venture or financial assumption changes, explicitly reconcile or retire the conflicting value before another integrated assessment.',
    'rule',
      'Revise the CURRENT assigned unit against both its unit-specific feedback and the full persisted course-level assessment. Do not resubmit unchanged work. Do not treat missing Unit N prefixes as absence of feedback.'
  );
end;
$function$;
REVOKE ALL ON FUNCTION agent_lab.build_entrepreneurship_remediation_context_v0_1(uuid) FROM PUBLIC,anon,authenticated;


CREATE OR REPLACE FUNCTION agent_lab.record_entrepreneurship_course_assessment_v0_1(
 p_assessment_id uuid,p_score numeric,p_assessor_kind text,p_assessor_id text,p_report jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'pg_catalog','agent_lab'
AS $function$
declare
  v_a agent_lab.entrepreneurship_course_assessments%rowtype;
  v_c agent_lab.entrepreneurship_courses%rowtype;
  v_status text;
  v_passed int;
  v_report jsonb:=coalesce(p_report,'{}'::jsonb);
  v_min_dimension numeric;
  v_dimension_count int:=0;
  v_critical boolean:=false;
begin
  if p_score<0 or p_score>1 then raise exception 'course_assessment_score_out_of_range'; end if;
  if length(btrim(coalesce(p_assessor_id,'')))<2 then raise exception 'independent_assessor_required'; end if;
  if p_assessor_kind not in('independent_model','human','hybrid') then raise exception 'invalid_assessor_kind'; end if;

  select * into v_a from agent_lab.entrepreneurship_course_assessments
   where assessment_id=p_assessment_id for update;
  if not found then raise exception 'course_assessment_not_found'; end if;
  select * into v_c from agent_lab.entrepreneurship_courses where course_code=v_a.course_code;

  if v_a.course_code='CAP515' then
    select count(*),min(value::numeric)
      into v_dimension_count,v_min_dimension
    from jsonb_each_text(
      case when jsonb_typeof(v_report->'dimensions')='object'
        then v_report->'dimensions' else '{}'::jsonb end
    )
    where value ~ '^[0-9]+([.][0-9]+)?$';
    v_critical:=lower(coalesce(v_report->>'critical_failure','false'))='true';

    v_status:=case
      when p_score>=v_c.course_pass_threshold
       and not v_critical
       and v_dimension_count>0
       and v_min_dimension>=0.75
      then 'verified_pass' else 'verified_fail' end;

    v_report:=v_report||jsonb_build_object(
      'pass_rule_enforced','CAP515_score>=0.85_critical_failure=false_all_dimensions>=0.75',
      'minimum_dimension_score',v_min_dimension,
      'numeric_dimension_count',v_dimension_count,
      'critical_failure_enforced',v_critical,
      'pass_rule_result',v_status
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
    'minimum_dimension_score',case when v_a.course_code='CAP515' then v_min_dimension else null end,
    'critical_failure',case when v_a.course_code='CAP515' then v_critical else null end,
    'courses_passed',v_passed,'courses_total',15,
    'progress',agent_lab.entrepreneurship_program_progress_v0_1(v_a.agent_id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION agent_lab.capture_entrepreneurship_unit_submission_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_stage text;
  v_assoc jsonb;
  v_unit_id uuid;
  v_unit agent_lab.entrepreneurship_units%rowtype;
  v_course agent_lab.entrepreneurship_courses%rowtype;
  v_eid uuid;
  v_expected jsonb;
  v_submission jsonb;
  v_evidence jsonb;
  v_analysis text;
  v_assumptions jsonb;
  v_conclusion text;
  v_critique text;
  v_submitted int:=0;
  v_rejection_detail text;
begin
  v_stage:=agent_lab.current_mandatory_lifecycle_stage(new.agent_id);
  if v_stage<>'mba_entrepreneurship' then return new; end if;

  select x.value into v_assoc
  from jsonb_array_elements(coalesce(new.outcome->'associations','[]'::jsonb)) x(value)
  where x.value->>'origin'='entrepreneurship_unit_submission_v0_1'
  limit 1;
  if v_assoc is null then return new; end if;

  begin
    v_unit_id:=(v_assoc->>'unit_id')::uuid;
  exception when others then
    perform agent_lab.record_entrepreneurship_submission_rejection_v0_1(
      new.agent_id,null,null,v_assoc->>'course_code',new.activity_id,
      'unit_id_invalid',
      'The entrepreneurship submission was rejected because unit_id was missing or invalid.',
      jsonb_build_object('unit_id','valid UUID','course_code','current course','submission','object'),
      v_assoc
    );
    return new;
  end;

  select * into v_unit from agent_lab.entrepreneurship_units where unit_id=v_unit_id;
  if not found then
    perform agent_lab.record_entrepreneurship_submission_rejection_v0_1(
      new.agent_id,null,v_unit_id,v_assoc->>'course_code',new.activity_id,
      'unit_not_found',
      'The entrepreneurship submission was rejected because the supplied unit_id does not exist.',
      jsonb_build_object('unit_id','existing entrepreneurship unit UUID'),
      v_assoc
    );
    return new;
  end if;

  select * into v_course from agent_lab.entrepreneurship_courses where course_code=v_unit.course_code;
  v_eid:=agent_lab.ensure_entrepreneurship_enrollment_v0_1(new.agent_id);

  -- A CAP515 preflight hold is authoritative over the ordinary unit-submission loop.
  -- Preserve the activity log, but do not mutate academic progress or create another exam.
  if v_unit.course_code='CAP515' and exists(
    select 1 from agent_lab.complex_work_pilots w
    where w.agent_id=new.agent_id
      and w.metadata->>'assessment_release_state'='held_pending_operator_preflight'
      and w.status in('draft','in_progress','blocked','submitted')
  ) then
    perform agent_lab.record_entrepreneurship_submission_rejection_v0_1(
      new.agent_id,v_eid,v_unit_id,v_unit.course_code,new.activity_id,
      'capstone_preflight_hold_active',
      'CAP515 unit submission ignored while the integrated evidence/financial preflight hold is active. Continue the bounded complex-work artifacts instead.',
      jsonb_build_object(
        'allowed_origin','agent_file_output_v0_1',
        'assessment_release_state','held_pending_operator_preflight'
      ),
      v_assoc
    );
    return new;
  end if;

  v_expected:=agent_lab.entrepreneurship_program_progress_v0_1(new.agent_id);

  if coalesce(v_expected->>'next_kind','')<>'study_unit'
     or coalesce(v_expected->'next_unit'->>'unit_id','')<>v_unit_id::text then
    perform agent_lab.record_entrepreneurship_submission_rejection_v0_1(
      new.agent_id,v_eid,v_unit_id,v_unit.course_code,new.activity_id,
      'wrong_or_out_of_sequence_unit',
      'The entrepreneurship submission was rejected because it was not the currently assigned unit.',
      jsonb_build_object(
        'expected_next_kind',v_expected->>'next_kind',
        'expected_unit_id',v_expected->'next_unit'->>'unit_id',
        'expected_course_code',v_expected->'current_course'->>'course_code'
      ),
      v_assoc
    );
    return new;
  end if;

  v_submission:=case when jsonb_typeof(v_assoc->'submission')='object' then v_assoc->'submission' else '{}'::jsonb end;
  v_analysis:=btrim(coalesce(v_submission->>'analysis',''));
  v_assumptions:=coalesce(v_submission->'assumptions','[]'::jsonb);
  v_conclusion:=btrim(coalesce(v_submission->>'conclusion',''));
  v_critique:=btrim(coalesce(v_submission->>'self_critique',''));
  v_evidence:=coalesce(v_submission->'evidence','[]'::jsonb);

  v_rejection_detail:=null;
  if jsonb_typeof(v_assoc->'submission') is distinct from 'object' then
    v_rejection_detail:='submission must be a JSON object';
  elsif length(v_analysis)<v_unit.minimum_submission_chars then
    v_rejection_detail:=format('analysis must contain at least %s characters; received %s',v_unit.minimum_submission_chars,length(v_analysis));
  elsif jsonb_typeof(v_assumptions)<>'array' or jsonb_array_length(v_assumptions)=0 then
    v_rejection_detail:='assumptions must be a non-empty JSON array';
  elsif length(v_conclusion)<80 then
    v_rejection_detail:=format('conclusion must contain at least 80 characters; received %s',length(v_conclusion));
  elsif length(v_critique)<80 then
    v_rejection_detail:=format('self_critique must contain at least 80 characters; received %s',length(v_critique));
  elsif jsonb_typeof(v_evidence)<>'array' then
    v_rejection_detail:=format('evidence must be a JSON array; received JSON type %s',coalesce(jsonb_typeof(v_evidence),'null'));
  end if;

  if v_rejection_detail is not null then
    perform agent_lab.record_entrepreneurship_submission_rejection_v0_1(
      new.agent_id,v_eid,v_unit_id,v_unit.course_code,new.activity_id,
      'submission_contract_invalid',
      v_rejection_detail,
      jsonb_build_object(
        'origin','entrepreneurship_unit_submission_v0_1',
        'unit_id',v_unit_id,
        'course_code',v_unit.course_code,
        'submission',jsonb_build_object(
          'analysis',format('string >= %s chars',v_unit.minimum_submission_chars),
          'assumptions','non-empty JSON array',
          'conclusion','string >= 80 chars',
          'self_critique','string >= 80 chars',
          'evidence','JSON array'
        )
      ),
      v_submission
    );
    return new;
  end if;

  insert into agent_lab.entrepreneurship_unit_progress(
    enrollment_id,agent_id,unit_id,status,attempt_count,submission,evidence,
    source_activity_id,submitted_at,updated_at
  ) values(
    v_eid,new.agent_id,v_unit_id,'submitted',1,v_submission,v_evidence,
    new.activity_id,now(),now()
  )
  on conflict(enrollment_id,unit_id) do update set
    status='submitted',
    attempt_count=agent_lab.entrepreneurship_unit_progress.attempt_count+1,
    submission=excluded.submission,
    evidence=excluded.evidence,
    source_activity_id=excluded.source_activity_id,
    submitted_at=now(),
    score=null,
    assessor_kind=null,
    assessor_id=null,
    assessment_report='{}'::jsonb,
    assessed_at=null,
    updated_at=now();

  select count(*)::int into v_submitted
  from agent_lab.entrepreneurship_unit_progress p
  join agent_lab.entrepreneurship_units u on u.unit_id=p.unit_id
  where p.enrollment_id=v_eid and u.course_code=v_unit.course_code
    and p.status in('submitted','verified_pass');

  if v_unit.course_code='CAP515' then
    update agent_lab.entrepreneurship_capstones
    set status=case when v_submitted>=4 then 'submitted' else 'in_progress' end,
        submission_artifact=jsonb_build_object(
          'course_code','CAP515',
          'unit_submissions',(select jsonb_agg(jsonb_build_object(
            'unit_id',u2.unit_id,'unit_order',u2.unit_order,'title',u2.title,
            'submission',p2.submission,'evidence',p2.evidence
          ) order by u2.unit_order)
          from agent_lab.entrepreneurship_unit_progress p2
          join agent_lab.entrepreneurship_units u2 on u2.unit_id=p2.unit_id
          where p2.enrollment_id=v_eid and u2.course_code='CAP515')
        ),
        source_activity_id=new.activity_id,
        submitted_at=case when v_submitted>=4 then now() else submitted_at end,
        updated_at=now()
    where enrollment_id=v_eid;
  end if;

  if v_submitted>=v_course.required_units then
    insert into agent_lab.entrepreneurship_course_assessments(
      enrollment_id,agent_id,course_code,attempt_no,status,assessment_kind,prompt_snapshot
    )
    select v_eid,new.agent_id,v_unit.course_code,
      coalesce((select max(a.attempt_no)+1
                from agent_lab.entrepreneurship_course_assessments a
                where a.enrollment_id=v_eid and a.course_code=v_unit.course_code),1),
      'queued','independent_course_exam',
      jsonb_build_object(
        'course',to_jsonb(v_course),
        'unit_submissions',(select jsonb_agg(jsonb_build_object(
          'unit',jsonb_build_object('unit_id',u2.unit_id,'unit_order',u2.unit_order,'title',u2.title,'rubric',u2.rubric),
          'submission',p2.submission,'evidence',p2.evidence
        ) order by u2.unit_order)
        from agent_lab.entrepreneurship_unit_progress p2
        join agent_lab.entrepreneurship_units u2 on u2.unit_id=p2.unit_id
        where p2.enrollment_id=v_eid and u2.course_code=v_unit.course_code),
        'assessment_instruction',
          'Independently grade graduate-level mastery. Do not reward verbosity. For CAP515, grade the four units as ONE venture case: require a single reconciled venture identity, target segment, pricing architecture, CAC, gross-margin definition, churn/retention convention, discounting convention, LTV/CAC, revenue ramp, financing/runway model, and evidence-backed BUILD/REVISE/KILL decision. Recompute material arithmetic and distinguish recurring revenue from one-time fees, gross margin from operating margin, and assumptions from independently sourced observations. CAC and R&D are not gross-margin COGS unless directly attributable to delivery. A REVISE decision is legitimate when customer, regulatory, or market evidence is missing; never require fabricated pilots/interviews. Evidence marked verified must have traceable provenance. Return score 0..1, critical_failure boolean, and numeric dimensions including conceptual_accuracy, analytical_rigor, quantitative_or_structured_reasoning, application_quality, evidence_and_assumption_discipline, self_critique_and_limits, clarity_and_epistemic_discipline. CAP515 passes only if score>=0.85, critical_failure=false, and every returned dimension is >=0.75.'
      )
    where not exists(
      select 1 from agent_lab.entrepreneurship_course_assessments a
      where a.enrollment_id=v_eid and a.course_code=v_unit.course_code
        and a.status in('queued','running','verified_pass')
    );
  end if;

  update agent_lab.entrepreneurship_enrollments
  set current_course_code=v_unit.course_code,current_unit_order=v_unit.unit_order,updated_at=now()
  where enrollment_id=v_eid;

  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.try_parse_jsonb_v0_1(p_text text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'pg_catalog'
AS $function$
begin
  if p_text is null then return null; end if;
  return p_text::jsonb;
exception when others then
  return null;
end;
$function$;
REVOKE ALL ON FUNCTION agent_lab.try_parse_jsonb_v0_1(text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION agent_lab.capture_cap515_complex_work_file_v0_1()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'pg_catalog','agent_lab'
AS $function$
declare
  v_work uuid;
  v_step text;
begin
  if new.agent_id is null or new.purpose<>'agent_output' then return new; end if;
  select work_id into v_work
  from agent_lab.complex_work_pilots
  where agent_id=new.agent_id
    and status in('draft','in_progress','blocked','submitted')
    and metadata->>'assessment_release_state'='held_pending_operator_preflight'
  order by created_at desc limit 1;
  if v_work is null then return new; end if;

  v_step:=case
    when upper(new.filename) like 'CANONICAL_VENTURE_MODEL%' then 'canonical'
    when upper(new.filename) like 'FINANCIAL_CHECKS%' then 'math'
    when upper(new.filename) like 'CLAIM_EVIDENCE_REGISTER%' then 'evidence'
    when upper(new.filename) like 'CROSS_UNIT_RECONCILIATION%' then 'alignment'
    when upper(new.filename) like 'BOARD_DECISION%' then 'board'
    else null end;
  if v_step is null then return new; end if;

  update agent_lab.complex_work_steps
  set status='submitted',
      evidence_file_ids=case when new.file_id=any(evidence_file_ids) then evidence_file_ids
        else array_append(evidence_file_ids,new.file_id) end,
      checkpoint=coalesce(checkpoint,'{}'::jsonb)||jsonb_build_object(
        'latest_agent_file_id',new.file_id,'latest_filename',new.filename,
        'latest_sha256',new.sha256,'agent_submitted_at',new.created_at,
        'verification_status','operator_preflight_required'),
      updated_at=now()
  where work_id=v_work and step_key=v_step;
  return new;
end;
$function$;
DROP TRIGGER IF EXISTS trg_capture_cap515_complex_work_file_v0_1 ON agent_lab.agent_files;
CREATE TRIGGER trg_capture_cap515_complex_work_file_v0_1
AFTER INSERT ON agent_lab.agent_files
FOR EACH ROW EXECUTE FUNCTION agent_lab.capture_cap515_complex_work_file_v0_1();
REVOKE ALL ON FUNCTION agent_lab.capture_cap515_complex_work_file_v0_1() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION agent_lab.cap515_reconciliation_preflight_v0_1(p_agent_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path TO 'pg_catalog','agent_lab'
AS $function$
declare
  v_work agent_lab.complex_work_pilots%rowtype;
  v_canon_file uuid; v_fin_file uuid; v_ev_file uuid; v_cross_file uuid; v_board_file uuid;
  v_canon jsonb; v_fin jsonb; v_ev jsonb; v_cross jsonb; v_board jsonb;
  v_discount numeric:=0;
  v_formula text:='';
  v_unbacked_verified int:=0;
  v_external_sources int:=0;
  v_missing int:=0;
  v_failures text[]:='{}';
  v_ready boolean:=false;
begin
  select * into v_work from agent_lab.complex_work_pilots
   where agent_id=p_agent_id
     and metadata->>'assessment_release_state'='held_pending_operator_preflight'
     and status in('draft','in_progress','blocked','submitted')
   order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('ready_for_operator_review',false,'reason','no_active_cap515_preflight_work');
  end if;

  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_canon_file,v_canon
   from agent_lab.agent_files where agent_id=p_agent_id and created_at>=v_work.created_at
     and upper(filename) like 'CANONICAL_VENTURE_MODEL%' order by created_at desc limit 1;
  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_fin_file,v_fin
   from agent_lab.agent_files where agent_id=p_agent_id and created_at>=v_work.created_at
     and upper(filename) like 'FINANCIAL_CHECKS%' order by created_at desc limit 1;
  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_ev_file,v_ev
   from agent_lab.agent_files where agent_id=p_agent_id and created_at>=v_work.created_at
     and upper(filename) like 'CLAIM_EVIDENCE_REGISTER%' order by created_at desc limit 1;
  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_cross_file,v_cross
   from agent_lab.agent_files where agent_id=p_agent_id and created_at>=v_work.created_at
     and upper(filename) like 'CROSS_UNIT_RECONCILIATION%' order by created_at desc limit 1;
  select file_id,agent_lab.try_parse_jsonb_v0_1(inline_text) into v_board_file,v_board
   from agent_lab.agent_files where agent_id=p_agent_id and created_at>=v_work.created_at
     and upper(filename) like 'BOARD_DECISION%' order by created_at desc limit 1;

  v_missing:=(case when v_canon_file is null then 1 else 0 end)
    +(case when v_fin_file is null then 1 else 0 end)
    +(case when v_ev_file is null then 1 else 0 end)
    +(case when v_cross_file is null then 1 else 0 end)
    +(case when v_board_file is null then 1 else 0 end);
  if v_missing>0 then v_failures:=array_append(v_failures,'required_artifacts_missing'); end if;

  if coalesce(v_canon#>>'{unit_economics,discount_rate}','') ~ '^[0-9]+([.][0-9]+)?$' then
    v_discount:=(v_canon#>>'{unit_economics,discount_rate}')::numeric;
  end if;
  v_formula:=lower(coalesce(v_fin#>>'{checks,ltv_calculation,formula}',''));
  if v_fin_file is not null and v_discount>0
     and v_formula not like '%discount%' and v_formula not like '%present value%' then
    v_failures:=array_append(v_failures,'ltv_formula_omits_stated_discount_rate');
  end if;

  if v_ev is not null and jsonb_typeof(v_ev->'evidence_entries')='array' then
    select count(*) into v_unbacked_verified
    from jsonb_array_elements(v_ev->'evidence_entries') e
    where upper(coalesce(e->>'verification_status',''))='VERIFIED'
      and lower(coalesce(e->>'classification','')) not in('arithmetic_derivation','internal_calculation')
      and (
        nullif(btrim(coalesce(e#>>'{source,url}','')),'') is null
        or upper(btrim(coalesce(e#>>'{source,url}','')))='N/A'
        or lower(coalesce(e#>>'{source,url}','')) like 'file_id:%'
        or lower(coalesce(e#>>'{source,publisher}','')) like 'internal%'
        or lower(coalesce(e#>>'{source,publisher}','')) in('agent','general industry standard')
      );

    select count(*) into v_external_sources
    from jsonb_array_elements(v_ev->'evidence_entries') e
    where nullif(btrim(coalesce(e#>>'{source,url}','')),'') is not null
      and upper(btrim(coalesce(e#>>'{source,url}','')))<>'N/A'
      and lower(coalesce(e#>>'{source,url}','')) not like 'file_id:%'
      and lower(coalesce(e#>>'{source,publisher}','')) not like 'internal%'
      and lower(coalesce(e#>>'{source,publisher}','')) not in('agent','general industry standard');
  end if;

  if v_unbacked_verified>0 then
    v_failures:=array_append(v_failures,'verified_claims_without_independent_provenance');
  end if;
  if v_ev_file is not null and v_external_sources<3 then
    v_failures:=array_append(v_failures,'fewer_than_three_traceable_external_sources');
  end if;

  if v_cross_file is not null and (v_cross is null or jsonb_typeof(v_cross)<>'object') then
    v_failures:=array_append(v_failures,'cross_unit_reconciliation_not_valid_json');
  end if;
  if v_board_file is not null and (v_board is null or jsonb_typeof(v_board)<>'object') then
    v_failures:=array_append(v_failures,'board_decision_not_valid_json');
  end if;

  v_ready:=coalesce(array_length(v_failures,1),0)=0;

  return jsonb_build_object(
    'version','cap515_reconciliation_preflight_v0_1',
    'work_id',v_work.work_id,
    'ready_for_operator_review',v_ready,
    'failures',to_jsonb(v_failures),
    'files',jsonb_build_object(
      'canonical',v_canon_file,'financial',v_fin_file,'evidence',v_ev_file,
      'cross_unit',v_cross_file,'board',v_board_file),
    'checks',jsonb_build_object(
      'stated_discount_rate',v_discount,
      'ltv_formula_mentions_discount',case when v_discount<=0 then true else (v_formula like '%discount%' or v_formula like '%present value%') end,
      'unbacked_verified_claims',v_unbacked_verified,
      'traceable_external_source_count',v_external_sources),
    'rule','This preflight checks minimum mechanical/evidence integrity only. Passing it does not award CAP515 or release the assessment hold; independent academic grading remains required.'
  );
end;
$function$;
REVOKE ALL ON FUNCTION agent_lab.cap515_reconciliation_preflight_v0_1(uuid) FROM PUBLIC,anon,authenticated;

COMMIT;