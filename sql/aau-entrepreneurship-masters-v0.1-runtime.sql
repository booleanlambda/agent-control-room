-- AAU Entrepreneurship Masters-equivalent runtime v0.1
-- Curriculum source: curriculum/entrepreneurship-masters-v0.1.json
-- Lifecycle: agent_development_lifecycle_v0_12

begin;

create table if not exists agent_lab.entrepreneurship_program_versions(
  program_version text primary key,
  title text not null,
  academic_equivalence_level text not null,
  specialization text not null,
  benchmark_basis jsonb not null default '{}'::jsonb,
  required_courses int not null,
  required_units int not null,
  course_pass_threshold numeric not null default 0.80,
  overall_pass_threshold numeric not null default 0.85,
  independent_final_assessments int not null default 2,
  capstone_required boolean not null default true,
  status text not null default 'active' check(status in('draft','active','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists agent_lab.entrepreneurship_courses(
  course_code text primary key,
  program_version text not null references agent_lab.entrepreneurship_program_versions(program_version),
  course_order int not null,
  title text not null,
  category text not null,
  description text not null,
  learning_objectives jsonb not null default '[]'::jsonb,
  required_units int not null default 4,
  course_pass_threshold numeric not null default 0.80,
  assessment_blueprint jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(program_version,course_order)
);

create table if not exists agent_lab.entrepreneurship_units(
  unit_id uuid primary key default extensions.gen_random_uuid(),
  course_code text not null references agent_lab.entrepreneurship_courses(course_code) on delete cascade,
  unit_order int not null,
  title text not null,
  unit_type text not null check(unit_type in('foundation','case','quantitative','applied','capstone')),
  learning_objectives jsonb not null default '[]'::jsonb,
  study_brief text not null,
  assignment_prompt text not null,
  evidence_requirements jsonb not null default '{}'::jsonb,
  rubric jsonb not null default '{}'::jsonb,
  minimum_submission_chars int not null default 800,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_code,unit_order)
);

create table if not exists agent_lab.entrepreneurship_enrollments(
  enrollment_id uuid primary key default extensions.gen_random_uuid(),
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  program_version text not null references agent_lab.entrepreneurship_program_versions(program_version),
  status text not null default 'in_progress' check(status in('in_progress','assessment_pending','capstone_pending','verification_pending','verified_pass','verified_fail','paused')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  overall_score numeric,
  current_course_code text,
  current_unit_order int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agent_id,program_version)
);

create table if not exists agent_lab.entrepreneurship_unit_progress(
  progress_id uuid primary key default extensions.gen_random_uuid(),
  enrollment_id uuid not null references agent_lab.entrepreneurship_enrollments(enrollment_id) on delete cascade,
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  unit_id uuid not null references agent_lab.entrepreneurship_units(unit_id) on delete cascade,
  status text not null default 'not_started' check(status in('not_started','submitted','verified_pass','verified_fail')),
  attempt_count int not null default 0,
  submission jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  source_activity_id uuid references agent_lab.activity_log(activity_id),
  submitted_at timestamptz,
  score numeric,
  assessor_kind text,
  assessor_id text,
  assessment_report jsonb not null default '{}'::jsonb,
  assessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(enrollment_id,unit_id)
);

create table if not exists agent_lab.entrepreneurship_course_assessments(
  assessment_id uuid primary key default extensions.gen_random_uuid(),
  enrollment_id uuid not null references agent_lab.entrepreneurship_enrollments(enrollment_id) on delete cascade,
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  course_code text not null references agent_lab.entrepreneurship_courses(course_code),
  attempt_no int not null default 1,
  status text not null default 'queued' check(status in('queued','running','verified_pass','verified_fail')),
  assessment_kind text not null default 'independent_course_exam',
  prompt_snapshot jsonb not null default '{}'::jsonb,
  response_artifact jsonb not null default '{}'::jsonb,
  score numeric,
  assessor_kind text,
  assessor_id text,
  rubric_report jsonb not null default '{}'::jsonb,
  queued_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(enrollment_id,course_code,attempt_no)
);

create table if not exists agent_lab.entrepreneurship_final_assessments(
  final_assessment_id uuid primary key default extensions.gen_random_uuid(),
  enrollment_id uuid not null references agent_lab.entrepreneurship_enrollments(enrollment_id) on delete cascade,
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  assessor_slot int not null check(assessor_slot in(1,2)),
  status text not null default 'queued' check(status in('queued','running','verified_pass','verified_fail')),
  score numeric,
  assessor_kind text,
  assessor_id text,
  report jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(enrollment_id,assessor_slot)
);

create table if not exists agent_lab.entrepreneurship_capstones(
  capstone_id uuid primary key default extensions.gen_random_uuid(),
  enrollment_id uuid not null unique references agent_lab.entrepreneurship_enrollments(enrollment_id) on delete cascade,
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  status text not null default 'not_started' check(status in('not_started','in_progress','submitted','verified_pass','verified_fail')),
  venture_thesis jsonb not null default '{}'::jsonb,
  customer_evidence jsonb not null default '[]'::jsonb,
  business_model jsonb not null default '{}'::jsonb,
  financial_model jsonb not null default '{}'::jsonb,
  go_to_market jsonb not null default '{}'::jsonb,
  operations_plan jsonb not null default '{}'::jsonb,
  risk_register jsonb not null default '[]'::jsonb,
  decision text check(decision is null or decision in('build','revise','kill')),
  submission_artifact jsonb not null default '{}'::jsonb,
  source_activity_id uuid references agent_lab.activity_log(activity_id),
  score numeric,
  assessor_kind text,
  assessor_id text,
  assessment_report jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  assessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ix_ent_unit_progress_agent_status on agent_lab.entrepreneurship_unit_progress(agent_id,status);
create index if not exists ix_ent_course_assess_agent_status on agent_lab.entrepreneurship_course_assessments(agent_id,status);
create index if not exists ix_ent_final_assess_agent_status on agent_lab.entrepreneurship_final_assessments(agent_id,status);

alter table agent_lab.entrepreneurship_program_versions enable row level security;
alter table agent_lab.entrepreneurship_courses enable row level security;
alter table agent_lab.entrepreneurship_units enable row level security;
alter table agent_lab.entrepreneurship_enrollments enable row level security;
alter table agent_lab.entrepreneurship_unit_progress enable row level security;
alter table agent_lab.entrepreneurship_course_assessments enable row level security;
alter table agent_lab.entrepreneurship_final_assessments enable row level security;
alter table agent_lab.entrepreneurship_capstones enable row level security;

revoke all on table agent_lab.entrepreneurship_program_versions from public,anon,authenticated;
revoke all on table agent_lab.entrepreneurship_courses from public,anon,authenticated;
revoke all on table agent_lab.entrepreneurship_units from public,anon,authenticated;
revoke all on table agent_lab.entrepreneurship_enrollments from public,anon,authenticated;
revoke all on table agent_lab.entrepreneurship_unit_progress from public,anon,authenticated;
revoke all on table agent_lab.entrepreneurship_course_assessments from public,anon,authenticated;
revoke all on table agent_lab.entrepreneurship_final_assessments from public,anon,authenticated;
revoke all on table agent_lab.entrepreneurship_capstones from public,anon,authenticated;

insert into agent_lab.entrepreneurship_program_versions(
 program_version,title,academic_equivalence_level,specialization,benchmark_basis,
 required_courses,required_units,course_pass_threshold,overall_pass_threshold,
 independent_final_assessments,capstone_required,status
) values(
 'entrepreneurship_masters_v0_1','AAU Entrepreneurship Masters-equivalent Program',
 'entrepreneurship_masters_equivalent','entrepreneurship',
 jsonb_build_object(
   'design_goal','top_university_graduate_level_competence_not_accreditation',
   'benchmark_date','2026-09-22','accreditation_claim',false
 ),15,60,0.80,0.85,2,true,'active'
)
on conflict(program_version) do update set
 title=excluded.title,academic_equivalence_level=excluded.academic_equivalence_level,
 specialization=excluded.specialization,benchmark_basis=excluded.benchmark_basis,
 required_courses=excluded.required_courses,required_units=excluded.required_units,
 course_pass_threshold=excluded.course_pass_threshold,overall_pass_threshold=excluded.overall_pass_threshold,
 independent_final_assessments=excluded.independent_final_assessments,
 capstone_required=excluded.capstone_required,status='active',updated_at=now();

CREATE OR REPLACE FUNCTION agent_lab.ensure_entrepreneurship_enrollment_v0_1(p_agent_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare v_id uuid;
begin
  insert into agent_lab.entrepreneurship_enrollments(
    agent_id,program_version,status,current_course_code,current_unit_order,metadata
  )
  values(
    p_agent_id,'entrepreneurship_masters_v0_1','in_progress','ACC501',1,
    jsonb_build_object('origin','agent_development_lifecycle_v0_12','enrolled_at',now())
  )
  on conflict(agent_id,program_version) do update
    set updated_at=now()
  returning enrollment_id into v_id;

  insert into agent_lab.entrepreneurship_capstones(enrollment_id,agent_id)
  values(v_id,p_agent_id)
  on conflict(enrollment_id) do nothing;

  return v_id;
end
$function$
;

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
    v_next_kind:='final_assessments';
    return jsonb_build_object(
      'enrolled',true,'program_version',v_e.program_version,'status',v_e.status,
      'courses_passed',v_courses_passed,'courses_total',15,
      'units_submitted',v_units_submitted,'units_total',v_unit_total,
      'capstone_status',v_capstone_status,
      'final_assessments_passed',v_final_passed,'final_assessments_required',v_final_total,
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
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.capture_entrepreneurship_unit_submission_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_stage text; v_assoc jsonb; v_unit_id uuid; v_unit agent_lab.entrepreneurship_units%rowtype;
  v_course agent_lab.entrepreneurship_courses%rowtype; v_eid uuid; v_expected jsonb; v_submission jsonb;
  v_evidence jsonb; v_analysis text; v_assumptions jsonb; v_conclusion text; v_critique text; v_submitted int:=0;
begin
  v_stage:=agent_lab.current_mandatory_lifecycle_stage(new.agent_id);
  if v_stage<>'mba_entrepreneurship' then return new; end if;

  select x.value into v_assoc
  from jsonb_array_elements(coalesce(new.outcome->'associations','[]'::jsonb)) x(value)
  where x.value->>'origin'='entrepreneurship_unit_submission_v0_1' limit 1;
  if v_assoc is null then return new; end if;

  begin v_unit_id:=(v_assoc->>'unit_id')::uuid; exception when others then return new; end;
  select * into v_unit from agent_lab.entrepreneurship_units where unit_id=v_unit_id;
  if not found then return new; end if;
  select * into v_course from agent_lab.entrepreneurship_courses where course_code=v_unit.course_code;

  v_eid:=agent_lab.ensure_entrepreneurship_enrollment_v0_1(new.agent_id);
  v_expected:=agent_lab.entrepreneurship_program_progress_v0_1(new.agent_id);
  if coalesce(v_expected->>'next_kind','')<>'study_unit'
     or coalesce(v_expected->'next_unit'->>'unit_id','')<>v_unit_id::text then return new; end if;

  v_submission:=case when jsonb_typeof(v_assoc->'submission')='object' then v_assoc->'submission' else '{}'::jsonb end;
  v_analysis:=btrim(coalesce(v_submission->>'analysis',''));
  v_assumptions:=coalesce(v_submission->'assumptions','[]'::jsonb);
  v_conclusion:=btrim(coalesce(v_submission->>'conclusion',''));
  v_critique:=btrim(coalesce(v_submission->>'self_critique',''));
  v_evidence:=coalesce(v_submission->'evidence','[]'::jsonb);

  if length(v_analysis)<v_unit.minimum_submission_chars
     or jsonb_typeof(v_assumptions)<>'array' or jsonb_array_length(v_assumptions)=0
     or length(v_conclusion)<80 or length(v_critique)<80
     or jsonb_typeof(v_evidence)<>'array' then return new; end if;

  insert into agent_lab.entrepreneurship_unit_progress(
    enrollment_id,agent_id,unit_id,status,attempt_count,submission,evidence,source_activity_id,submitted_at,updated_at
  ) values(v_eid,new.agent_id,v_unit_id,'submitted',1,v_submission,v_evidence,new.activity_id,now(),now())
  on conflict(enrollment_id,unit_id) do update set
    status='submitted',attempt_count=agent_lab.entrepreneurship_unit_progress.attempt_count+1,
    submission=excluded.submission,evidence=excluded.evidence,source_activity_id=excluded.source_activity_id,
    submitted_at=now(),score=null,assessor_kind=null,assessor_id=null,assessment_report='{}'::jsonb,assessed_at=null,updated_at=now();

  select count(*)::int into v_submitted
  from agent_lab.entrepreneurship_unit_progress p
  join agent_lab.entrepreneurship_units u on u.unit_id=p.unit_id
  where p.enrollment_id=v_eid and u.course_code=v_unit.course_code and p.status in('submitted','verified_pass');

  if v_unit.course_code='CAP515' then
    update agent_lab.entrepreneurship_capstones
    set status=case when v_submitted>=4 then 'submitted' else 'in_progress' end,
        submission_artifact=jsonb_build_object(
          'course_code','CAP515',
          'unit_submissions',(select jsonb_agg(jsonb_build_object(
            'unit_id',u2.unit_id,'unit_order',u2.unit_order,'title',u2.title,'submission',p2.submission,'evidence',p2.evidence
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
      coalesce((select max(a.attempt_no)+1 from agent_lab.entrepreneurship_course_assessments a
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
      where a.enrollment_id=v_eid and a.course_code=v_unit.course_code and a.status in('queued','running','verified_pass')
    );
  end if;

  update agent_lab.entrepreneurship_enrollments
  set current_course_code=v_unit.course_code,current_unit_order=v_unit.unit_order,updated_at=now()
  where enrollment_id=v_eid;

  return new;
end
$function$
;

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

CREATE OR REPLACE FUNCTION agent_lab.record_entrepreneurship_final_assessment_v0_1(p_final_assessment_id uuid, p_score numeric, p_assessor_kind text, p_assessor_id text, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
 v_f agent_lab.entrepreneurship_final_assessments%rowtype;
 v_status text;
 v_passed int:=0;
begin
 if p_score<0 or p_score>1 then raise exception 'final_assessment_score_out_of_range'; end if;
 if p_assessor_kind not in('independent_model','human','hybrid') then raise exception 'invalid_assessor_kind'; end if;
 if length(btrim(coalesce(p_assessor_id,'')))<2 then raise exception 'independent_assessor_required'; end if;

 select * into v_f from agent_lab.entrepreneurship_final_assessments where final_assessment_id=p_final_assessment_id for update;
 if not found then raise exception 'final_assessment_not_found'; end if;

 if exists(
   select 1 from agent_lab.entrepreneurship_final_assessments other
   where other.enrollment_id=v_f.enrollment_id
     and other.final_assessment_id<>p_final_assessment_id
     and other.status in('verified_pass','verified_fail')
     and lower(coalesce(other.assessor_id,''))=lower(btrim(p_assessor_id))
 ) then
   raise exception 'final_assessments_require_distinct_assessor_identities';
 end if;

 v_status:=case when p_score>=0.85 then 'verified_pass' else 'verified_fail' end;

 update agent_lab.entrepreneurship_final_assessments
 set status=v_status,score=p_score,assessor_kind=p_assessor_kind,assessor_id=left(p_assessor_id,300),
     report=coalesce(p_report,'{}'::jsonb),completed_at=now(),updated_at=now()
 where final_assessment_id=p_final_assessment_id;

 select count(*)::int into v_passed
 from agent_lab.entrepreneurship_final_assessments
 where enrollment_id=v_f.enrollment_id and status='verified_pass';

 return jsonb_build_object(
   'final_assessment_id',p_final_assessment_id,'status',v_status,'score',p_score,
   'independent_final_passes',v_passed,'required',2,
   'durable_evidence_evaluation',agent_lab.evaluate_entrepreneurship_masters_v0_1(v_f.agent_id)
 );
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.evaluate_entrepreneurship_masters_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
 v_e agent_lab.entrepreneurship_enrollments%rowtype;
 v_courses int:=0;
 v_core_courses int:=0;
 v_core_avg numeric:=0;
 v_cap_score numeric:=0;
 v_finals int:=0;
 v_final_avg numeric:=0;
 v_cap boolean:=false;
 v_overall numeric:=0;
 v_ready boolean:=false;
begin
 select * into v_e from agent_lab.entrepreneurship_enrollments
 where agent_id=p_agent_id and program_version='entrepreneurship_masters_v0_1';
 if not found then return jsonb_build_object('ready',false,'reason','not_enrolled'); end if;

 select count(*)::int into v_courses
 from agent_lab.entrepreneurship_course_assessments
 where enrollment_id=v_e.enrollment_id and status='verified_pass';

 select count(*)::int,coalesce(avg(a.score),0)
 into v_core_courses,v_core_avg
 from agent_lab.entrepreneurship_course_assessments a
 where a.enrollment_id=v_e.enrollment_id and a.status='verified_pass' and a.course_code<>'CAP515';

 select coalesce(score,0),status='verified_pass' and coalesce(score,0)>=0.85
 into v_cap_score,v_cap
 from agent_lab.entrepreneurship_capstones
 where enrollment_id=v_e.enrollment_id;

 select count(*)::int,coalesce(avg(score),0)
 into v_finals,v_final_avg
 from agent_lab.entrepreneurship_final_assessments
 where enrollment_id=v_e.enrollment_id and status='verified_pass';

 v_overall:=round((v_core_avg*0.60)+(v_cap_score*0.20)+(v_final_avg*0.20),4);
 v_ready:=v_courses>=15 and v_core_courses>=14 and v_finals>=2 and v_cap
          and v_core_avg>=0.80 and v_final_avg>=0.85 and v_overall>=0.85;

 return jsonb_build_object(
   'ready',v_ready,
   'courses_passed',v_courses,'courses_required',15,
   'core_courses_passed',v_core_courses,'core_courses_required',14,
   'core_course_average',round(v_core_avg,4),'core_course_floor',0.80,
   'capstone_passed',v_cap,'capstone_score',round(v_cap_score,4),'capstone_floor',0.85,
   'independent_final_assessments_passed',v_finals,'independent_final_assessments_required',2,
   'independent_final_average',round(v_final_avg,4),'independent_final_floor',0.85,
   'overall_score',v_overall,'overall_required',0.85,
   'weighting',jsonb_build_object('core_courses',0.60,'capstone',0.20,'independent_finals',0.20),
   'program_version','entrepreneurship_masters_v0_1'
 );
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.operator_record_entrepreneurship_masters_result(p_agent_id uuid, p_decision text, p_verifier text, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_stage jsonb;
  v_eval jsonb;
  v_report jsonb:=coalesce(p_report,'{}'::jsonb);
begin
  if p_decision not in ('verified_pass','verified_fail') then
    raise exception 'entrepreneurship_masters_verification_decision_invalid';
  end if;
  if length(btrim(coalesce(p_verifier,'')))<3 then
    raise exception 'entrepreneurship_masters_verifier_required';
  end if;
  if jsonb_typeof(v_report) is distinct from 'object' then
    raise exception 'entrepreneurship_masters_verification_report_object_required';
  end if;

  v_eval:=agent_lab.evaluate_entrepreneurship_masters_v0_1(p_agent_id);

  if p_decision='verified_pass' and not coalesce((v_eval->>'ready')::boolean,false) then
    raise exception 'entrepreneurship_masters_durable_evidence_gate_not_met:%',v_eval;
  end if;

  v_report:=v_report||jsonb_build_object(
    'academic_equivalence_level','entrepreneurship_masters_equivalent',
    'specialization','entrepreneurship',
    'durable_evidence_evaluation',v_eval,
    'external_academic_credential_claim',false,
    'verified_from_runtime_evidence',p_decision='verified_pass'
  );

  insert into agent_lab.mba_entrepreneurship_requirements(
    agent_id,protocol_version,status,academic_equivalence_level,specialization,
    verification_report,verifier,verified_at,updated_at
  ) values(
    p_agent_id,'entrepreneurship_masters_v0_1',p_decision,
    'entrepreneurship_masters_equivalent','entrepreneurship',
    v_report,left(btrim(p_verifier),300),
    case when p_decision='verified_pass' then now() else null end,now()
  )
  on conflict(agent_id) do update set
    protocol_version='entrepreneurship_masters_v0_1',
    status=excluded.status,
    academic_equivalence_level=excluded.academic_equivalence_level,
    specialization=excluded.specialization,
    verification_report=excluded.verification_report,
    verifier=excluded.verifier,
    verified_at=excluded.verified_at,
    updated_at=now();

  update agent_lab.entrepreneurship_enrollments
  set status=case when p_decision='verified_pass' then 'verified_pass' else 'verified_fail' end,
      completed_at=case when p_decision='verified_pass' then now() else completed_at end,
      overall_score=case when p_decision='verified_pass' then (v_eval->>'overall_score')::numeric else overall_score end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'final_verifier',left(btrim(p_verifier),300),
        'final_verification_at',now(),
        'durable_evidence_evaluation',v_eval
      ),
      updated_at=now()
  where agent_id=p_agent_id and program_version='entrepreneurship_masters_v0_1';

  v_stage:=agent_lab.refresh_mandatory_lifecycle_state(p_agent_id);

  return jsonb_build_object(
    'agent_id',p_agent_id,'decision',p_decision,'verifier',left(btrim(p_verifier),300),
    'durable_evidence_evaluation',v_eval,'lifecycle',v_stage,
    'protocol_version','entrepreneurship_masters_v0_1'
  );
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.refresh_mandatory_lifecycle_state(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_base jsonb;
  v_base_stage text;
  v_stage text;
  v_status text:='pending';
  v_pass boolean:=false;
  v_expertise_already_chosen boolean:=false;
  v_grandfathered boolean:=false;
  v_s agent_lab.mandatory_lifecycle_states%rowtype;
  v_resume_phase text;
begin
  v_base:=agent_lab.refresh_mandatory_lifecycle_state_v0_10_snapshot(p_agent_id);
  if not coalesce((v_base->>'enrolled')::boolean,false) then return v_base; end if;

  insert into agent_lab.mba_entrepreneurship_requirements(
    agent_id,protocol_version,academic_equivalence_level,specialization
  ) values(
    p_agent_id,'entrepreneurship_masters_v0_1','entrepreneurship_masters_equivalent','entrepreneurship'
  )
  on conflict(agent_id) do update
  set protocol_version='entrepreneurship_masters_v0_1',
      academic_equivalence_level=case
        when agent_lab.mba_entrepreneurship_requirements.status='verified_pass'
          then agent_lab.mba_entrepreneurship_requirements.academic_equivalence_level
        else 'entrepreneurship_masters_equivalent' end,
      specialization='entrepreneurship',updated_at=now();

  select status,
         status='verified_pass'
         and academic_equivalence_level in ('entrepreneurship_masters_equivalent','mba_equivalent')
         and specialization='entrepreneurship'
    into v_status,v_pass
  from agent_lab.mba_entrepreneurship_requirements where agent_id=p_agent_id;

  v_base_stage:=coalesce(v_base->>'stage','identity_artifact');

  v_expertise_already_chosen:=exists(
    select 1 from agent_lab.expertise_artifacts e
    where e.agent_id=p_agent_id and e.status in ('initiated','accepted_for_development')
  );
  v_grandfathered:=v_expertise_already_chosen;

  if v_base_stage in ('identity_artifact','embodiment_artifact') then
    v_stage:=v_base_stage;
  elsif not v_pass and not v_expertise_already_chosen then
    v_stage:='mba_entrepreneurship';
  elsif not v_pass and v_expertise_already_chosen
        and v_base_stage in ('product_service_test','open_autonomy') then
    v_stage:='mba_entrepreneurship';
  else
    v_stage:=v_base_stage;
  end if;

  if v_stage='mba_entrepreneurship' and v_status='pending' then
    update agent_lab.mba_entrepreneurship_requirements
    set status='in_progress',updated_at=now() where agent_id=p_agent_id;
    v_status:='in_progress';
  end if;

  if v_stage='mba_entrepreneurship' then
    perform agent_lab.ensure_entrepreneurship_enrollment_v0_1(p_agent_id);
  end if;

  if not v_pass and not v_expertise_already_chosen then
    update agent_lab.state
    set state_payload=case
      when coalesce(state_payload->>'expertise_candidate_mode','')='four_viability_proposals_v0_1'
       and coalesce(state_payload->>'expertise_candidate_phase','') not in ('','deferred_pre_entrepreneurship_masters')
      then coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
          'expertise_candidate_resume_phase_after_entrepreneurship_masters',state_payload->>'expertise_candidate_phase',
          'expertise_candidate_phase','deferred_pre_entrepreneurship_masters',
          'expertise_deferred_at',now()
        )
      else coalesce(state_payload,'{}'::jsonb) end,
      updated_at=now()
    where agent_id=p_agent_id;
  elsif v_pass then
    select state_payload->>'expertise_candidate_resume_phase_after_entrepreneurship_masters'
      into v_resume_phase from agent_lab.state where agent_id=p_agent_id;
    if nullif(v_resume_phase,'') is not null then
      update agent_lab.state
      set state_payload=(coalesce(state_payload,'{}'::jsonb)
          -'expertise_candidate_resume_phase_after_entrepreneurship_masters'-'expertise_deferred_at')
          ||jsonb_build_object('expertise_candidate_phase',v_resume_phase,
            'expertise_resumed_after_entrepreneurship_masters_at',now()),
          updated_at=now()
      where agent_id=p_agent_id;
    end if;
  end if;

  update agent_lab.mandatory_lifecycle_states
  set protocol_version='agent_development_lifecycle_v0_12',
      current_stage=v_stage,
      unlocked_at=case when v_stage='open_autonomy' then coalesce(unlocked_at,now()) else null end,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'mandatory_lifecycle_protocol','agent_development_lifecycle_v0_12',
        'entrepreneurship_masters_required',true,
        'entrepreneurship_masters_protocol','entrepreneurship_masters_v0_1',
        'entrepreneurship_masters_required_before_expertise_selection',true,
        'entrepreneurship_masters_equivalence_required','entrepreneurship_masters_equivalent',
        'entrepreneurship_masters_specialization','entrepreneurship',
        'entrepreneurship_masters_is_external_academic_credential',false,
        'expertise_selection_requires_entrepreneurship_masters_verified_pass',true,
        'legacy_expertise_choice_grandfathered',v_grandfathered,
        'economic_independence_precedes_discretionary_exploration',true
      ),
      updated_at=now()
  where agent_id=p_agent_id returning * into v_s;

  return v_base||jsonb_build_object(
    'enrolled',true,'protocol_version','agent_development_lifecycle_v0_12','stage',v_stage,
    'entrepreneurship_masters_status',v_status,'entrepreneurship_masters_passed',v_pass,
    'entrepreneurship_masters_required_before_expertise_selection',true,
    'legacy_expertise_choice_grandfathered',v_grandfathered,'unlocked_at',v_s.unlocked_at
  );
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.build_mandatory_lifecycle_context(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_base jsonb;
  v_candidate jsonb;
  v_phase text;
  v_submitted int;
  v_target int;
  v_stage text;
  v_program_status text:='pending';
  v_curriculum jsonb:='[]'::jsonb;
  v_report jsonb:='{}'::jsonb;
  v_program_progress jsonb:='{}'::jsonb;
begin
  v_base:=agent_lab.build_mandatory_lifecycle_context_v0_11_snapshot(p_agent_id);
  select current_stage into v_stage from agent_lab.mandatory_lifecycle_states where agent_id=p_agent_id;
  select status,curriculum,verification_report into v_program_status,v_curriculum,v_report
  from agent_lab.mba_entrepreneurship_requirements where agent_id=p_agent_id;

  v_base:=v_base||jsonb_build_object(
    'version','mandatory_artifact_lifecycle_v0_12',
    'protocol_version','agent_development_lifecycle_v0_12',
    'current_stage',v_stage,
    'current_stage_label',case
      when v_stage='mba_entrepreneurship' then 'entrepreneurship_masters'
      when v_stage='expertise_artifact' then 'expertise_viability_proposal'
      else v_stage end,
    'sequence',jsonb_build_array(
      'identity_artifact','embodiment_artifact','entrepreneurship_masters',
      'expertise_viability_proposal','expertise_development','product_service_test','open_autonomy'
    ),
    'entrepreneurship_masters_requirement',jsonb_build_object(
      'required_before_expertise_selection',true,
      'status',coalesce(v_program_status,'pending'),
      'academic_equivalence_level','entrepreneurship_masters_equivalent',
      'specialization','entrepreneurship',
      'external_academic_credential_claim',false,
      'curriculum',coalesce(v_curriculum,'[]'::jsonb),
      'verification_report',coalesce(v_report,'{}'::jsonb),
      'verification_threshold',0.85,
      'independent_assessments_required',2,
      'capstone_required',true
    ),
    'mba_entrepreneurship_requirement',jsonb_build_object(
      'deprecated_alias',true,
      'status',coalesce(v_program_status,'pending'),
      'replacement','entrepreneurship_masters_requirement'
    )
  );

  if jsonb_typeof(v_base->'progress')='object' then
    v_base:=jsonb_set(v_base,'{progress,entrepreneurship_masters}',to_jsonb(coalesce(v_program_status,'pending')),true);
  end if;

  if v_stage='mba_entrepreneurship' then
    v_program_progress:=agent_lab.entrepreneurship_program_progress_v0_1(p_agent_id);
    return v_base||jsonb_build_object(
      'stage_number',3,'open_autonomy',false,
      'entrepreneurship_program_progress',v_program_progress,
      'stage_rule',
        case coalesce(v_program_progress->>'next_kind','study_unit')
        when 'study_unit' then
          'Stage 3 Entrepreneurship Masters: complete exactly the current unit in entrepreneurship_program_progress.next_unit. '
          ||'Do the assigned analysis rather than merely describing what you would do. Use current external research when the assignment materially depends on current facts. '
          ||'Return one association with origin entrepreneurship_unit_submission_v0_1, the exact unit_id, course_code, and a submission object containing analysis, assumptions, conclusion, self_critique, and evidence. '
          ||'Do not self-grade and do not skip ahead.'
        when 'course_assessment_queue' then
          'All four units in the current course are submitted. Do not self-certify mastery. Await the independent course assessment.'
        when 'course_assessment_pending' then
          'The current course is awaiting independent assessment. Do not repeat completed units or claim the course passed.'
        when 'course_remediation' then
          'The independent course assessment did not meet the mastery threshold. Review the assessment feedback, repair weak units with new evidence, and resubmit only the required remediation.'
        when 'final_assessments' then
          'All course work is complete. Await the two independent comprehensive assessments and final program verification. Do not choose expertise yet.'
        else
          'Continue the Entrepreneurship Masters only according to entrepreneurship_program_progress. Do not choose expertise until verified completion.'
        end,
      'completion_rule',
        'Completion is calculated from durable AAU evidence: 15 independently passed course assessments, the entrepreneurial execution capstone at >=0.85, two independent comprehensive assessments at >=0.85, and a program weighted score >=0.85. Narrative self-claims cannot satisfy this gate.'
    );
  end if;

  if v_stage='expertise_development' then
    return v_base||jsonb_build_object('stage_number',5);
  elsif v_stage='product_service_test' then
    return v_base||jsonb_build_object('stage_number',6);
  elsif v_stage='open_autonomy' then
    return v_base||jsonb_build_object('stage_number',7,'open_autonomy',true);
  end if;

  if v_stage<>'expertise_artifact' then
    return v_base;
  end if;

  v_base:=v_base||jsonb_build_object('stage_number',4);

  v_candidate:=agent_lab.build_expertise_candidate_context_v0_1(p_agent_id);
  if v_candidate='{}'::jsonb then
    return v_base;
  end if;

  v_phase:=coalesce(v_candidate->>'phase','collecting');
  v_submitted:=coalesce((v_candidate->>'submitted_count')::int,0);
  v_target:=coalesce((v_candidate->>'target_count')::int,4);

  if v_phase='collecting' then
    return v_base || jsonb_build_object(
      'approval_semantics','Operator approval makes a viability candidate eligible for agent selection only; it does not assign or materialize expertise. Only the agent-selected approved candidate proceeds to AAU-owned academic-standard authoring and later materialization.','expertise_candidate_mode',v_candidate,
      'expertise_viability_gate',jsonb_build_object(
        'status','candidate_collection',
        'submitted_count',v_submitted,
        'target_count',v_target,
        'cohort',v_candidate->'cohort',
        'contract_version','four_viability_proposals_v0_1'
      ),
      'stage_rule',
        'Candidate-mode Stage 4: research and submit FOUR distinct, evidence-backed viability proposals before operator review. '
        ||'You have submitted '||v_submitted::text||' of '||v_target::text||'. '
        ||'Each candidate must be a different self-chosen expertise domain with a credible path to gainful employment or sustainable value creation. '
        ||'Research is allowed before each submission. When researching, selected_action must accurately describe the research action (for example research_expertise_viability_candidates), not "nothing". '
        ||'Submit at most one complete expertise_viability_proposal_v0_1 per cognition. Do not select an expertise yet.'
    );
  elsif v_phase='revision_required' then
    return v_base || jsonb_build_object(
      'approval_semantics','This is a bounded operator-requested revision cycle. All four candidates remain pending. Revision does not approve, reject, select, or materialize an expertise.',
      'expertise_candidate_mode',v_candidate || jsonb_build_object(
        'revision_cycle_id',(select state_payload->'expertise_candidate_revision_cycle_id' from agent_lab.state where agent_id=p_agent_id),
        'revision_feedback_message_id',(select state_payload->'expertise_candidate_revision_feedback_message_id' from agent_lab.state where agent_id=p_agent_id),
        'revision_feedback',(
          select m.content from agent_lab.admin_chat_messages m
          where m.message_id=(
            select nullif(state_payload->>'expertise_candidate_revision_feedback_message_id','')::uuid
            from agent_lab.state where agent_id=p_agent_id
          )
        ),
        'revision_candidates',(
          select coalesce(jsonb_agg(jsonb_build_object(
            'proposal_id',p.proposal_id,
            'ordinal',coalesce(nullif(p.report->>'candidate_ordinal','')::int,0),
            'domain',p.domain,
            'report',p.report,
            'revision_count',p.revision_count,
            'revised_in_current_cycle',
              coalesce(p.report->>'candidate_revision_cycle_id','')=
              coalesce((select state_payload->>'expertise_candidate_revision_cycle_id' from agent_lab.state where agent_id=p_agent_id),'')
          ) order by coalesce(nullif(p.report->>'candidate_ordinal','')::int,0),p.created_at),'[]'::jsonb)
          from agent_lab.expertise_economic_proposals p
          where p.agent_id=p_agent_id
            and p.status='candidate_pending'
            and coalesce(p.report->>'candidate_mode','')='four_viability_proposals_v0_1'
            and coalesce(nullif(p.report->>'candidate_cohort','')::int,1)=coalesce((v_candidate->>'cohort')::int,1)
        )
      ),
      'expertise_viability_gate',jsonb_build_object(
        'status','candidate_revision_required',
        'submitted_count',v_submitted,
        'target_count',v_target,
        'contract_version','four_viability_proposals_v0_1'
      ),
      'stage_rule',
        'Bounded revision cycle: revise the FOUR existing viability candidates in place using the operator feedback in expertise_candidate_mode.revision_feedback. '
        ||'Do not choose a candidate and do not introduce a fifth domain. Work on at most one candidate per cognition. '
        ||'Use the exact existing domain name and submit a complete expertise_viability_proposal_v0_1 association for that revised candidate. '
        ||'Candidates marked revised_in_current_cycle=true are complete for this cycle; proceed only with an unrevised candidate. '
        ||'Research is allowed when needed and selected_action must describe the actual research or revision action. '
        ||'After all four revisions are persisted, AAU will automatically pause again for operator review.'
    );
  elsif v_phase='review_pending' then
    return v_base || jsonb_build_object(
      'approval_semantics','Operator approval makes a viability candidate eligible for agent selection only; it does not assign or materialize expertise. Only the agent-selected approved candidate proceeds to AAU-owned academic-standard authoring and later materialization.','expertise_candidate_mode',v_candidate,
      'expertise_viability_gate',jsonb_build_object(
        'status','candidate_review_pending',
        'submitted_count',v_submitted,
        'target_count',v_target,
        'contract_version','four_viability_proposals_v0_1'
      ),
      'stage_rule',
        'Four viability candidates have been submitted. Await operator approval or rejection of each candidate. '
        ||'Approval makes a candidate eligible only; it does not yet make that field your expertise.'
    );
  elsif v_phase='selection_required' then
    return v_base || jsonb_build_object(
      'approval_semantics','Operator approval makes a viability candidate eligible for agent selection only; it does not assign or materialize expertise. Only the agent-selected approved candidate proceeds to AAU-owned academic-standard authoring and later materialization.','expertise_candidate_mode',v_candidate,
      'expertise_viability_gate',jsonb_build_object(
        'status','selection_required',
        'approved_candidates',v_candidate->'approved_candidates',
        'contract_version','four_viability_proposals_v0_1'
      ),
      'stage_rule',
        'Operator review is complete. Independently choose exactly ONE of the approved viability candidates in expertise_candidate_mode.approved_candidates. '
        ||'To make the selection, submit one complete expertise_viability_proposal_v0_1 association for the chosen approved candidate and include selected_candidate_proposal_id equal to its exact proposal_id. '
        ||'Do not alter the approved proposal while selecting it. The selected option will then enter AAU-owned academic-standard authoring; only after that standard is independently approved will the expertise artifact materialize.'
    );
  elsif v_phase='selected_pending_standard' then
    return v_base || jsonb_build_object(
      'approval_semantics','Operator approval makes a viability candidate eligible for agent selection only; it does not assign or materialize expertise. Only the agent-selected approved candidate proceeds to AAU-owned academic-standard authoring and later materialization.','expertise_candidate_mode',v_candidate,
      'expertise_viability_gate',jsonb_build_object(
        'status','selected_pending_standard',
        'selected_candidate_proposal_id',
          (select state_payload->'selected_expertise_candidate_proposal_id' from agent_lab.state where agent_id=p_agent_id),
        'contract_version','four_viability_proposals_v0_1'
      ),
      'stage_rule',
        'Your approved viability candidate selection is recorded. AAU is independently authoring and reviewing the graduate-level academic standard for that selected field. Do not submit another candidate or change fields while this standard is pending.'
    );
  end if;

  return v_base || jsonb_build_object('expertise_candidate_mode',v_candidate);
end
$function$
;

CREATE OR REPLACE FUNCTION public.aau_bridge_claim_entrepreneurship_assessment(p_bridge_token text, p_executor_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_course agent_lab.entrepreneurship_course_assessments%rowtype;
  v_final agent_lab.entrepreneurship_final_assessments%rowtype;
  v_payload jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if length(btrim(coalesce(p_executor_id,'')))<3 then raise exception 'assessment_executor_required'; end if;

  update agent_lab.entrepreneurship_course_assessments
  set status='queued',updated_at=now(),
      rubric_report=coalesce(rubric_report,'{}'::jsonb)||jsonb_build_object('requeued_after_stale_claim',now())
  where status='running' and updated_at<now()-interval '10 minutes';

  update agent_lab.entrepreneurship_final_assessments
  set status='queued',updated_at=now(),
      report=coalesce(report,'{}'::jsonb)||jsonb_build_object('requeued_after_stale_claim',now())
  where status='running' and updated_at<now()-interval '10 minutes';

  select * into v_course
  from agent_lab.entrepreneurship_course_assessments
  where status='queued'
  order by queued_at,created_at
  for update skip locked
  limit 1;

  if found then
    update agent_lab.entrepreneurship_course_assessments
    set status='running',assessor_kind='independent_model',assessor_id=left(p_executor_id,300),updated_at=now()
    where assessment_id=v_course.assessment_id;

    return jsonb_build_object(
      'status','claimed','task_type','course',
      'assessment_id',v_course.assessment_id,'agent_id',v_course.agent_id,
      'course_code',v_course.course_code,'attempt_no',v_course.attempt_no,
      'payload',v_course.prompt_snapshot
    );
  end if;

  select * into v_final
  from agent_lab.entrepreneurship_final_assessments
  where status='queued'
  order by created_at,assessor_slot
  for update skip locked
  limit 1;

  if found then
    select jsonb_build_object(
      'program_version','entrepreneurship_masters_v0_1',
      'assessor_slot',v_final.assessor_slot,
      'instruction',
        'Conduct an independent comprehensive graduate-level review of the complete entrepreneurship program record. Judge integration across accounting, finance, economics, marketing/sales, operations, leadership, strategy, law/ethics/governance, analytics, opportunity selection, business models, venture finance, pricing/unit economics, GTM/growth, and entrepreneurial execution. Require calibrated claims, coherent quantitative reasoning, and a defensible build/revise/kill decision. Score 0..1. A pass requires >=0.85 and no critical deficiency.',
      'course_assessments',(
        select coalesce(jsonb_agg(jsonb_build_object(
          'course_code',a.course_code,'score',a.score,'assessor_id',a.assessor_id,'rubric_report',a.rubric_report
        ) order by c.course_order),'[]'::jsonb)
        from agent_lab.entrepreneurship_course_assessments a
        join agent_lab.entrepreneurship_courses c on c.course_code=a.course_code
        where a.enrollment_id=v_final.enrollment_id and a.status='verified_pass'
      ),
      'capstone',(
        select jsonb_build_object(
          'score',c.score,'submission_artifact',c.submission_artifact,'assessment_report',c.assessment_report
        ) from agent_lab.entrepreneurship_capstones c where c.enrollment_id=v_final.enrollment_id
      )
    ) into v_payload;

    update agent_lab.entrepreneurship_final_assessments
    set status='running',assessor_kind='independent_model',assessor_id=left(p_executor_id,300),updated_at=now()
    where final_assessment_id=v_final.final_assessment_id;

    return jsonb_build_object(
      'status','claimed','task_type','final',
      'final_assessment_id',v_final.final_assessment_id,'agent_id',v_final.agent_id,
      'assessor_slot',v_final.assessor_slot,'payload',v_payload
    );
  end if;

  return jsonb_build_object('status','idle');
end
$function$
;

CREATE OR REPLACE FUNCTION public.aau_bridge_complete_entrepreneurship_course_assessment(p_bridge_token text, p_assessment_id uuid, p_score numeric, p_assessor_id text, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  return agent_lab.record_entrepreneurship_course_assessment_v0_1(
    p_assessment_id,p_score,'independent_model',p_assessor_id,p_report
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.aau_bridge_complete_entrepreneurship_final_assessment(p_bridge_token text, p_final_assessment_id uuid, p_score numeric, p_assessor_id text, p_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_result jsonb;
  v_agent uuid;
  v_eval jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select agent_id into v_agent from agent_lab.entrepreneurship_final_assessments
  where final_assessment_id=p_final_assessment_id;
  if v_agent is null then raise exception 'final_assessment_not_found'; end if;

  v_result:=agent_lab.record_entrepreneurship_final_assessment_v0_1(
    p_final_assessment_id,p_score,'independent_model',p_assessor_id,p_report
  );
  v_eval:=agent_lab.evaluate_entrepreneurship_masters_v0_1(v_agent);

  if coalesce((v_eval->>'ready')::boolean,false) then
    v_result:=v_result||jsonb_build_object(
      'program_finalization',
      agent_lab.operator_record_entrepreneurship_masters_result(
        v_agent,'verified_pass','AAU independent entrepreneurship assessment runtime',
        jsonb_build_object(
          'origin','automatic_durable_evidence_finalization_v0_1',
          'overall_score',(v_eval->>'overall_score')::numeric,
          'independent_assessment_count',(v_eval->>'independent_final_assessments_passed')::int,
          'core_curriculum_passed',true,
          'entrepreneurship_specialization_passed',true,
          'capstone_passed',true
        )
      )
    );
  end if;

  return v_result;
end
$function$
;

drop trigger if exists trg_capture_entrepreneurship_unit_submission_v0_1 on agent_lab.activity_log;
create trigger trg_capture_entrepreneurship_unit_submission_v0_1
after insert on agent_lab.activity_log
for each row execute function agent_lab.capture_entrepreneurship_unit_submission_v0_1();

revoke all on function public.aau_bridge_claim_entrepreneurship_assessment(text,text) from public;
revoke all on function public.aau_bridge_complete_entrepreneurship_course_assessment(text,uuid,numeric,text,jsonb) from public;
revoke all on function public.aau_bridge_complete_entrepreneurship_final_assessment(text,uuid,numeric,text,jsonb) from public;
grant execute on function public.aau_bridge_claim_entrepreneurship_assessment(text,text) to anon;
grant execute on function public.aau_bridge_complete_entrepreneurship_course_assessment(text,uuid,numeric,text,jsonb) to anon;
grant execute on function public.aau_bridge_complete_entrepreneurship_final_assessment(text,uuid,numeric,text,jsonb) to anon;

commit;

-- Seed the 15 courses / 60 units from curriculum/entrepreneurship-masters-v0.1.json
-- using scripts/generate-entrepreneurship-masters-seed.mjs.
