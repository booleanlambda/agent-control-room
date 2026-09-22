-- AAU Entrepreneurship assessor claim/release recovery v0.1
-- Durable source for immediate failed-worker release with retry backoff.

begin;

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
    and (
      not (coalesce(rubric_report,'{}'::jsonb) ? 'worker_retry_after')
      or nullif(rubric_report->>'worker_retry_after','')::timestamptz<=now()
    )
  order by queued_at,created_at
  for update skip locked
  limit 1;

  if found then
    update agent_lab.entrepreneurship_course_assessments
    set status='running',assessor_kind='independent_model',
        assessor_id=left(p_executor_id,300),updated_at=now()
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
    and (
      not (coalesce(report,'{}'::jsonb) ? 'worker_retry_after')
      or nullif(report->>'worker_retry_after','')::timestamptz<=now()
    )
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
    set status='running',assessor_kind='independent_model',
        assessor_id=left(p_executor_id,300),updated_at=now()
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

CREATE OR REPLACE FUNCTION public.aau_bridge_release_entrepreneurship_assessment(p_bridge_token text, p_task_type text, p_assessment_id uuid, p_executor_id text, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_count int:=0;
  v_retry_at timestamptz:=now()+interval '1 minute';
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if length(btrim(coalesce(p_executor_id,'')))<3 then
    raise exception 'assessment_executor_required';
  end if;

  if p_task_type='course' then
    update agent_lab.entrepreneurship_course_assessments
    set status='queued',
        assessor_kind=null,
        assessor_id=null,
        updated_at=now(),
        rubric_report=coalesce(rubric_report,'{}'::jsonb)
          ||jsonb_build_object(
            'last_worker_failure',left(coalesce(p_error,'unknown_worker_failure'),1200),
            'last_worker_failure_at',now(),
            'worker_retry_after',v_retry_at,
            'released_by_executor',left(p_executor_id,300)
          )
    where assessment_id=p_assessment_id
      and status='running'
      and assessor_id=left(p_executor_id,300);
    get diagnostics v_count=row_count;

  elsif p_task_type='final' then
    update agent_lab.entrepreneurship_final_assessments
    set status='queued',
        assessor_kind=null,
        assessor_id=null,
        updated_at=now(),
        report=coalesce(report,'{}'::jsonb)
          ||jsonb_build_object(
            'last_worker_failure',left(coalesce(p_error,'unknown_worker_failure'),1200),
            'last_worker_failure_at',now(),
            'worker_retry_after',v_retry_at,
            'released_by_executor',left(p_executor_id,300)
          )
    where final_assessment_id=p_assessment_id
      and status='running'
      and assessor_id=left(p_executor_id,300);
    get diagnostics v_count=row_count;
  else
    raise exception 'invalid_assessment_task_type';
  end if;

  return jsonb_build_object(
    'status',case when v_count=1 then 'released' else 'not_owned_or_not_running' end,
    'task_type',p_task_type,
    'assessment_id',p_assessment_id,
    'retry_after',case when v_count=1 then v_retry_at else null end
  );
end
$function$
;

revoke all on function public.aau_bridge_release_entrepreneurship_assessment(text,text,uuid,text,text) from public;
grant execute on function public.aau_bridge_release_entrepreneurship_assessment(text,text,uuid,text,text) to anon,authenticated;

commit;
