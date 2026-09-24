-- Per-agent CAP515 preflight hold. Other agents' queued assessments remain eligible.
BEGIN;
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
    -- Bounded per-agent CAP515 intervention: do not consume model reviews during preflight hold.
    and not (
      course_code='CAP515'
      and exists (
        select 1 from agent_lab.complex_work_pilots hold_work
        where hold_work.agent_id=agent_lab.entrepreneurship_course_assessments.agent_id
          and hold_work.metadata->>'assessment_release_state'='held_pending_operator_preflight'
      )
    )
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



-- Defense in depth: a direct grader may not bypass the preflight-held claim queue.
CREATE OR REPLACE FUNCTION agent_lab.guard_capstone_preflight_assessment_v0_1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'agent_lab'
AS $fn$
BEGIN
  IF NEW.course_code='CAP515'
    AND NEW.status IN ('running','verified_pass','verified_fail')
    AND OLD.status IS DISTINCT FROM NEW.status
    AND EXISTS (
      SELECT 1 FROM agent_lab.complex_work_pilots w
      WHERE w.agent_id=NEW.agent_id
        AND w.metadata->>'assessment_release_state'='held_pending_operator_preflight'
    )
  THEN
    RAISE EXCEPTION 'cap515_preflight_hold_active: independent reconciliation required before grading';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_capstone_preflight_assessment_v0_1
 ON agent_lab.entrepreneurship_course_assessments;
CREATE TRIGGER trg_guard_capstone_preflight_assessment_v0_1
 BEFORE UPDATE OF status ON agent_lab.entrepreneurship_course_assessments
 FOR EACH ROW
 EXECUTE FUNCTION agent_lab.guard_capstone_preflight_assessment_v0_1();

REVOKE ALL ON FUNCTION agent_lab.guard_capstone_preflight_assessment_v0_1()
 FROM PUBLIC,anon,authenticated;

COMMIT;
