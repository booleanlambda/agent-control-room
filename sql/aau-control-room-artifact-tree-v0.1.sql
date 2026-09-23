-- AAU main-card lifecycle artifact tree v0.1
-- Read-only agent-scoped durable study submissions, independent assessments,
-- identity/embodiment decisions, expertise work and product/test reports.
-- The Control Room's existing authenticated agent detail RPC exposes artifact_tree.
begin;

CREATE OR REPLACE FUNCTION agent_lab.operator_agent_artifact_tree_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_status jsonb;
  v_program jsonb := '{}'::jsonb;
  v_stage text;
  v_identity jsonb := '[]'::jsonb;
  v_embodiment jsonb := '[]'::jsonb;
  v_courses jsonb := '[]'::jsonb;
  v_mba_other jsonb := '[]'::jsonb;
  v_expertise jsonb := '[]'::jsonb;
  v_portfolio jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_children jsonb;
  v_course_status text;
  v_course_score numeric;
  c record;
begin
  select to_jsonb(s) into v_status
  from agent_lab.operator_agent_status_intent s where s.agent_id=p_agent_id;
  if v_status is null then return null; end if;
  v_stage:=agent_lab.current_mandatory_lifecycle_stage(p_agent_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id','identity:'||d.decision_id::text,
    'kind','identity_decision',
    'label',replace(initcap(replace(d.field_key,'_',' ')),' Id',' ID'),
    'status',d.status,
    'date',d.created_at,
    'content',jsonb_build_object(
      'decision_type',d.decision_type,'chosen_value',d.chosen_value,
      'reason',d.reason,'source_activity_id',d.source_activity_id
    ),
    'children','[]'::jsonb
  ) order by d.created_at),'[]'::jsonb) into v_identity
  from agent_lab.identity_development_decisions d
  where d.agent_id=p_agent_id and d.status='active';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id','embodiment:'||e.agent_id::text,
    'kind','embodiment_profile',
    'label','Embodiment profile',
    'status',e.embodiment_state,
    'date',e.updated_at,
    'meta',jsonb_build_object('canonical_version',e.canonical_version,'canonical_asset_id',e.canonical_asset_id),
    'content',jsonb_build_object(
      'agent_view',e.last_agent_view,'reason',e.last_reason,
      'preferences',e.current_preferences,'canonical_asset_id',e.canonical_asset_id
    ),
    'children','[]'::jsonb
  )),'[]'::jsonb) into v_embodiment
  from agent_lab.agent_embodiment_profiles e where e.agent_id=p_agent_id;

  if exists(select 1 from agent_lab.entrepreneurship_enrollments where agent_id=p_agent_id) then
    v_program:=agent_lab.entrepreneurship_program_progress_v0_1(p_agent_id);

    for c in
      select co.course_code,co.course_order,co.title,co.program_version,co.required_units,
             (select a.status from agent_lab.entrepreneurship_course_assessments a
              where a.agent_id=p_agent_id and a.course_code=co.course_code
              order by a.attempt_no desc limit 1) latest_status,
             (select a.score from agent_lab.entrepreneurship_course_assessments a
              where a.agent_id=p_agent_id and a.course_code=co.course_code
              order by a.attempt_no desc limit 1) latest_score
      from agent_lab.entrepreneurship_courses co
      where co.program_version=coalesce(v_program->>'program_version','entrepreneurship_masters_v0_1')
      order by co.course_order
    loop
      select coalesce(jsonb_agg(jsonb_build_object(
        'id','unit:'||u.unit_id::text,
        'kind','study_submission',
        'label','Unit '||u.unit_order||' — '||u.title,
        'status',p.status,
        'date',p.submitted_at,
        'meta',jsonb_build_object(
          'attempts',p.attempt_count,'source_activity_id',p.source_activity_id,
          'score',p.score,'study_type',u.unit_type,'unit_order',u.unit_order
        ),
        'content',jsonb_build_object(
          'study_brief',u.study_brief,'assignment_prompt',u.assignment_prompt,
          'submission',p.submission,'evidence',p.evidence,
          'assessment_report',p.assessment_report,
          'source_activity_id',p.source_activity_id,'submitted_at',p.submitted_at
        ),
        'children','[]'::jsonb
      ) order by u.unit_order),'[]'::jsonb) into v_children
      from agent_lab.entrepreneurship_unit_progress p
      join agent_lab.entrepreneurship_units u on u.unit_id=p.unit_id
      where p.agent_id=p_agent_id and u.course_code=c.course_code and p.submitted_at is not null;

      select v_children || coalesce(jsonb_agg(jsonb_build_object(
        'id','course-assessment:'||a.assessment_id::text,
        'kind','independent_assessment',
        'label','Independent assessment · attempt '||a.attempt_no,
        'status',a.status,
        'date',coalesce(a.completed_at,a.queued_at),
        'meta',jsonb_build_object(
          'score',a.score,'assessor_id',a.assessor_id,
          'assessment_kind',a.assessment_kind,'attempt_no',a.attempt_no
        ),
        'content',jsonb_build_object(
          'score',a.score,'assessor',a.assessor_id,'report',a.rubric_report,
          'response_artifact',a.response_artifact,'completed_at',a.completed_at
        ),
        'children','[]'::jsonb
      ) order by a.attempt_no),'[]'::jsonb) into v_children
      from agent_lab.entrepreneurship_course_assessments a
      where a.agent_id=p_agent_id and a.course_code=c.course_code;

      v_course_status:=coalesce(c.latest_status,
        case when v_program#>>'{current_course,course_code}'=c.course_code
             then 'in_progress' else 'not_started' end);
      v_course_score:=c.latest_score;

      v_courses:=v_courses||jsonb_build_array(jsonb_build_object(
        'id','course:'||c.course_code,'kind','course',
        'label',c.course_code||' — '||c.title,
        'status',v_course_status,
        'meta',jsonb_build_object(
          'score',v_course_score,'submitted_units',
          (select count(*) from agent_lab.entrepreneurship_unit_progress p
           join agent_lab.entrepreneurship_units u on u.unit_id=p.unit_id
           where p.agent_id=p_agent_id and u.course_code=c.course_code and p.submitted_at is not null),
          'total_units',c.required_units
        ),
        'children',v_children
      ));
    end loop;

    select coalesce(jsonb_agg(jsonb_build_object(
      'id','capstone:'||x.capstone_id::text,
      'kind','capstone','label','Entrepreneurship capstone',
      'status',x.status,'date',coalesce(x.submitted_at,x.created_at),
      'meta',jsonb_build_object('score',x.score,'source_activity_id',x.source_activity_id),
      'content',jsonb_build_object(
        'submission',x.submission_artifact,'thesis',x.venture_thesis,
        'customer_evidence',x.customer_evidence,'business_model',x.business_model,
        'financial_model',x.financial_model,'go_to_market',x.go_to_market,
        'operations_plan',x.operations_plan,'risk_register',x.risk_register,
        'assessment_report',x.assessment_report
      ),'children','[]'::jsonb
    ) order by x.created_at),'[]'::jsonb) into v_mba_other
    from agent_lab.entrepreneurship_capstones x where x.agent_id=p_agent_id;

    select v_mba_other || coalesce(jsonb_agg(jsonb_build_object(
      'id','final:'||f.final_assessment_id::text,
      'kind','final_assessment','label','Final independent assessment · slot '||f.assessor_slot,
      'status',f.status,'date',coalesce(f.completed_at,f.created_at),
      'meta',jsonb_build_object('score',f.score,'assessor_id',f.assessor_id),
      'content',jsonb_build_object('report',f.report,'score',f.score,'assessor',f.assessor_id),
      'children','[]'::jsonb
    ) order by f.assessor_slot),'[]'::jsonb) into v_mba_other
    from agent_lab.entrepreneurship_final_assessments f where f.agent_id=p_agent_id;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id','expertise:'||x.expertise_artifact_id::text,
    'kind','expertise_artifact','label',x.domain||' · version '||x.artifact_version,
    'status',x.status,'date',x.updated_at,
    'meta',jsonb_build_object('source_activity_id',x.source_activity_id,'standard',x.target_standard),
    'content',jsonb_build_object('scope',x.scope,'competencies',x.competencies,
      'intended_application',x.intended_application,'economic_viability',x.economic_viability,
      'verification_plan',x.verification_plan),
    'children','[]'::jsonb
  ) order by x.created_at),'[]'::jsonb) into v_expertise
  from agent_lab.expertise_artifacts x where x.agent_id=p_agent_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id','portfolio:'||x.portfolio_artifact_id::text,
    'kind','expertise_work','label',x.title,'status',x.admission_status,
    'date',x.created_at,'meta',jsonb_build_object(
      'file_id',x.source_file_id,'source_activity_id',x.source_activity_id,
      'competency',x.competency,'artifact_type',x.artifact_type),
    'content',jsonb_build_object('execution_spec',x.execution_spec,'test_manifest',x.test_manifest,
      'metrics',x.metrics,'admission_reasons',x.admission_reasons),
    'children','[]'::jsonb
  ) order by x.created_at),'[]'::jsonb) into v_portfolio
  from agent_lab.expertise_portfolio_artifacts x where x.agent_id=p_agent_id;

  select v_portfolio || coalesce(jsonb_agg(jsonb_build_object(
    'id','domain-assessment:'||d.assessment_id::text,
    'kind','expertise_assessment','label',d.skill_component||' · '||d.assessment_type,
    'status',case when d.passed then 'verified_pass' else 'verified_fail' end,
    'date',d.assessed_at,
    'meta',jsonb_build_object('score',d.score,'assessor_id',d.evaluator_ref),
    'content',jsonb_build_object('evidence',d.evidence,'difficulty',d.difficulty,
      'reliability_weight',d.reliability_weight),
    'children','[]'::jsonb
  ) order by d.assessed_at),'[]'::jsonb) into v_portfolio
  from agent_lab.domain_assessment_results d where d.agent_id=p_agent_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id','product:'||t.product_service_test_id::text,
    'kind','product_test','label',t.title,'status',t.status,
    'date',coalesce(t.verified_at,t.submitted_at,t.created_at),
    'meta',jsonb_build_object('offering_type',t.offering_type,'target_user',t.target_user),
    'content',jsonb_build_object('problem_statement',t.problem_statement,
      'value_proposition',t.value_proposition,'success_criteria',t.success_criteria,
      'submission',t.submission,'verification_report',t.verification_report),
    'children',coalesce((select jsonb_agg(jsonb_build_object(
      'id','product-run:'||r.product_test_run_id::text,
      'kind','product_test_run','label','Execution test · attempt '||r.attempt_count,
      'status',r.status,'date',coalesce(r.completed_at,r.created_at),
      'meta',jsonb_build_object('executor_id',r.executor_id),
      'content',jsonb_build_object('metrics',r.metrics,'evidence',r.evidence,
        'final_report',r.final_report,'error_code',r.error_code),
      'children','[]'::jsonb
    ) order by r.created_at) from agent_lab.product_test_runs r
    where r.product_service_test_id=t.product_service_test_id),'[]'::jsonb)
  ) order by t.created_at),'[]'::jsonb) into v_products
  from agent_lab.product_service_tests t where t.agent_id=p_agent_id;

  return jsonb_build_object(
    'version','operator_artifact_tree_v0_1',
    'generated_at',now(),
    'summary',jsonb_build_object(
      'lifecycle_stage',v_stage,
      'lifecycle_status',v_status->>'lifecycle_status',
      'units_submitted',coalesce((v_program->>'units_submitted')::int,0),
      'units_total',coalesce((v_program->>'units_total')::int,60),
      'courses_passed',coalesce((v_program->>'courses_passed')::int,0),
      'courses_total',coalesce((v_program->>'courses_total')::int,15),
      'program_status',v_program->>'status'
    ),
    'stages',jsonb_build_array(
      jsonb_build_object('id','stage:identity','label','01 · Identity',
        'kind','lifecycle_stage','status',v_status->>'identity_status',
        'children',v_identity),
      jsonb_build_object('id','stage:embodiment','label','02 · Embodiment',
        'kind','lifecycle_stage','status',v_status->>'embodiment_status',
        'children',v_embodiment),
      jsonb_build_object('id','stage:mba','label','03 · Entrepreneurship Master''s-equivalent',
        'kind','lifecycle_stage','status',coalesce(v_program->>'status','not_started'),
        'meta',jsonb_build_object('units_submitted',coalesce((v_program->>'units_submitted')::int,0),
          'units_total',coalesce((v_program->>'units_total')::int,60),
          'courses_passed',coalesce((v_program->>'courses_passed')::int,0),
          'courses_total',coalesce((v_program->>'courses_total')::int,15)),
        'children',v_courses||v_mba_other),
      jsonb_build_object('id','stage:expertise-viability','label','04 · Expertise viability & selection',
        'kind','lifecycle_stage','status',case when jsonb_array_length(v_expertise)>0 then 'in_progress' else 'not_started' end,
        'children',v_expertise),
      jsonb_build_object('id','stage:expertise-development','label','05 · Expertise development & verification',
        'kind','lifecycle_stage','status',case when jsonb_array_length(v_portfolio)>0 then 'in_progress' else 'not_started' end,
        'children',v_portfolio),
      jsonb_build_object('id','stage:product-test','label','06 · Product/service applied autonomy test',
        'kind','lifecycle_stage','status',case when jsonb_array_length(v_products)>0 then 'in_progress' else 'not_started' end,
        'children',v_products),
      jsonb_build_object('id','stage:open-autonomy','label','07 · Open autonomy',
        'kind','lifecycle_stage','status',case when v_stage='open_autonomy' then 'active' else 'not_started' end,
        'children','[]'::jsonb)
    )
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.operator_agent_detail(p_agent_id uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
with lifecycle as (
  select agent_lab.current_mandatory_lifecycle_stage(p_agent_id) as stage
), assignment as (
  select case
    when stage='mba_entrepreneurship' then (
      select jsonb_build_object(
        'source','authoritative_lifecycle',
        'stage',stage,
        'kind',p->>'next_kind',
        'course_code',p#>>'{current_course,course_code}',
        'course_title',p#>>'{current_course,title}',
        'unit_id',p#>>'{next_unit,unit_id}',
        'unit_order',nullif(p#>>'{next_unit,unit_order}','')::int,
        'unit_title',p#>>'{next_unit,title}',
        'assignment_prompt',p#>>'{next_unit,assignment_prompt}',
        'units_submitted',nullif(p->>'units_submitted','')::int,
        'courses_passed',nullif(p->>'courses_passed','')::int,
        'display_label',concat_ws(' — ',
          nullif(concat_ws(' ',p#>>'{current_course,course_code}',
            case when p#>>'{next_unit,unit_order}' is not null then 'Unit '||(p#>>'{next_unit,unit_order}') else null end),''),
          p#>>'{next_unit,title}'
        )
      )
      from (select agent_lab.entrepreneurship_program_progress_v0_1(p_agent_id) p) x
    )
    else jsonb_build_object(
      'source','authoritative_lifecycle',
      'stage',stage,
      'kind','lifecycle_stage',
      'display_label',replace(initcap(replace(coalesce(stage,'unknown'),'_',' ')),'Mba','MBA')
    )
  end as body
  from lifecycle
)
select jsonb_build_object(
  'version','operator_agent_detail_v0_4_artifact_tree',
  'protocol_version','next_intent_protocol_v0_1',
  'generated_at',now(),
  'status',(select to_jsonb(s) from agent_lab.operator_agent_status_intent s where s.agent_id=p_agent_id),
  'authoritative_assignment',(select body from assignment),
  'artifact_tree',agent_lab.operator_agent_artifact_tree_v0_1(p_agent_id),
  'timeline',coalesce((select jsonb_agg(jsonb_build_object(
    'agent_id',t.agent_id,'occurred_at',t.occurred_at,
    'event_kind',replace(replace(t.event_kind,'autonomous_wake','autonomous_intent'),'first_wake','first_intent'),
    'event_ref',t.event_ref,'title',replace(replace(t.title,'Wake','Intent'),'wake','intent'),
    'detail',replace(replace(t.detail,'Wake','Intent'),'wake','intent'),'context',t.context
  ) order by t.occurred_at desc) from (select * from agent_lab.operator_agent_timeline where agent_id=p_agent_id order by occurred_at desc limit greatest(1,least(coalesce(p_limit,50),500))) t),'[]'::jsonb),
  'next_intents',coalesce((select jsonb_agg(to_jsonb(n) order by n.execute_at asc nulls last,n.created_at asc) from agent_lab.next_intents n where n.agent_id=p_agent_id and n.status='active'),'[]'::jsonb),
  'intent_executions',coalesce((select jsonb_agg(to_jsonb(q) order by q.execute_at desc nulls last,q.created_at desc) from (select * from agent_lab.intent_queue where agent_id=p_agent_id order by execute_at desc nulls last,created_at desc limit 25) q),'[]'::jsonb),
  'interests',coalesce((select jsonb_agg(jsonb_build_object('topic',i.topic,'interest_strength',i.interest_strength,'curiosity_strength',i.curiosity_strength,'last_engaged_at',i.last_engaged_at) order by greatest(i.interest_strength,i.curiosity_strength) desc) from agent_lab.interests i where i.agent_id=p_agent_id),'[]'::jsonb),
  'active_goals',coalesce((select jsonb_agg(to_jsonb(g) order by g.priority desc) from agent_lab.goals g where g.agent_id=p_agent_id and g.status='active'),'[]'::jsonb),
  'active_projects',coalesce((select jsonb_agg(to_jsonb(p) order by p.priority desc) from agent_lab.projects p where p.owner_agent_id=p_agent_id and p.status in ('planned','active','paused')),'[]'::jsonb),
  'evidence_provenance',jsonb_build_object('version','evidence_provenance_v0_1','recent_bundles',agent_lab.build_recent_evidence_context(p_agent_id,6)),
  'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.last_seen_at desc) from agent_lab.operator_alerts a where a.agent_id=p_agent_id and a.status='open'),'[]'::jsonb)
);
$function$
;

commit;
