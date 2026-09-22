-- AAU Entrepreneurship submission rejection visibility v0.1
-- Prevents malformed Stage 3 submissions from failing silently.

begin;

create table if not exists agent_lab.entrepreneurship_submission_rejections(
  rejection_id uuid primary key default extensions.gen_random_uuid(),
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  enrollment_id uuid references agent_lab.entrepreneurship_enrollments(enrollment_id) on delete cascade,
  unit_id uuid references agent_lab.entrepreneurship_units(unit_id) on delete set null,
  course_code text,
  source_activity_id uuid references agent_lab.activity_log(activity_id) on delete set null,
  rejection_code text not null,
  rejection_detail text not null,
  expected_contract jsonb not null default '{}'::jsonb,
  received_submission jsonb not null default '{}'::jsonb,
  agent_notified boolean not null default false,
  notification_message_id uuid references agent_lab.admin_chat_messages(message_id) on delete set null,
  created_at timestamptz not null default now(),
  unique(source_activity_id,rejection_code)
);

alter table agent_lab.entrepreneurship_submission_rejections enable row level security;
revoke all on agent_lab.entrepreneurship_submission_rejections from public,anon,authenticated;

CREATE OR REPLACE FUNCTION agent_lab.record_entrepreneurship_submission_rejection_v0_1(p_agent_id uuid, p_enrollment_id uuid, p_unit_id uuid, p_course_code text, p_source_activity_id uuid, p_rejection_code text, p_rejection_detail text, p_expected_contract jsonb, p_received_submission jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_rejection_id uuid;
begin
  insert into agent_lab.entrepreneurship_submission_rejections(
    agent_id,enrollment_id,unit_id,course_code,source_activity_id,
    rejection_code,rejection_detail,expected_contract,received_submission
  )
  values(
    p_agent_id,p_enrollment_id,p_unit_id,p_course_code,p_source_activity_id,
    p_rejection_code,left(coalesce(p_rejection_detail,''),2000),
    coalesce(p_expected_contract,'{}'::jsonb),
    coalesce(p_received_submission,'{}'::jsonb)
  )
  on conflict(source_activity_id,rejection_code) do update
  set rejection_detail=excluded.rejection_detail,
      expected_contract=excluded.expected_contract,
      received_submission=excluded.received_submission
  returning rejection_id into v_rejection_id;

  return v_rejection_id;
end
$function$
;

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
          'Independently grade graduate-level mastery. Do not reward verbosity. Check conceptual accuracy, quantitative reasoning, application, evidence discipline, and whether the work would survive a demanding business-school case discussion. Return score 0..1 and rubric findings.'
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

commit;
