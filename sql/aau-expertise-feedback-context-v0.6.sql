CREATE OR REPLACE FUNCTION agent_lab.build_expertise_portfolio_context_v0_2(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_art agent_lab.expertise_artifacts%rowtype;
  v_gate jsonb;
  v_items jsonb;
  v_feedback jsonb := '{}'::jsonb;
  v_repeat jsonb := '{}'::jsonb;
begin
  select * into v_art
  from agent_lab.expertise_artifacts
  where agent_id=p_agent_id
  order by created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'version','expertise_portfolio_context_v0_2',
      'active',false,
      'reason','no_expertise_artifact'
    );
  end if;

  v_gate := agent_lab.evaluate_expertise_portfolio_gate_v0_2(
    p_agent_id,v_art.expertise_artifact_id
  );
  v_repeat := agent_lab.evaluate_expertise_reverification_evidence_v0_1(
    p_agent_id,v_art.expertise_artifact_id
  );

  select coalesce(
    a.outcome #> '{runtime_feedback,expertise_verification}',
    '{}'::jsonb
  )
  into v_feedback
  from agent_lab.activity_log a
  where a.agent_id=p_agent_id
    and a.outcome #> '{runtime_feedback,expertise_verification}' is not null
  order by a.created_at desc
  limit 1;

  v_feedback := coalesce(v_feedback,'{}'::jsonb);
  -- Historical dispatches made before feedback persistence was repaired are
  -- not authoritative receipts. Explicitly disclose that and expose the
  -- current gate so the agent does not invent a pending exam.
  if v_feedback='{}'::jsonb and exists(
    select 1 from agent_lab.activity_log a
    where a.agent_id=p_agent_id
      and a.selected_action in ('request_expertise_verification',
        'request_independent_verification_of_artifact','request_independent_assessment')
      and a.created_at>coalesce((v_repeat->>'last_failed_at')::timestamptz,'epoch'::timestamptz)
  ) then
    v_feedback:=jsonb_build_object(
      'status','historical_dispatch_unobserved',
      'currently_allowed',coalesce((v_repeat->>'ready_for_new_verification')::boolean,false)
        and coalesce((v_gate->>'ready_for_verification')::boolean,false),
      'current_eligibility',v_repeat,
      'latest_verification_run',coalesce((
        select jsonb_build_object('verification_run_id',r.verification_run_id,
          'status',r.status,'created_at',r.created_at)
        from agent_lab.expertise_verification_runs r where r.agent_id=p_agent_id
          and r.expertise_artifact_id=v_art.expertise_artifact_id
        order by r.created_at desc limit 1
      ),'{}'::jsonb),
      'rule','Do not infer a scheduled or running exam from an attempted request. Historical dispatch receipt was not persisted; current eligibility is authoritative.'
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'portfolio_artifact_id',p.portfolio_artifact_id,
    'competency',p.competency,
    'artifact_type',p.artifact_type,
    'title',p.title,
    'source_file_id',p.source_file_id,
    'admission_status',p.admission_status,
    'original_work',p.original_work,
    'execution_spec',p.execution_spec,
    'tests',p.test_manifest,
    'metrics',p.metrics,
    'admission_reasons',p.admission_reasons,
    'admitted_at',p.admitted_at,
    'created_at',p.created_at
  ) order by p.created_at desc),'[]'::jsonb)
  into v_items
  from agent_lab.expertise_portfolio_artifacts p
  where p.agent_id=p_agent_id
    and p.expertise_artifact_id=v_art.expertise_artifact_id;

  return jsonb_build_object(
    'version','expertise_portfolio_context_v0_2',
    'active',true,
    'expertise_artifact_id',v_art.expertise_artifact_id,
    'domain',v_art.domain,
    'contract_version',coalesce(
      v_art.metadata->>'portfolio_contract_version',
      'expertise_portfolio_v0_1_legacy'
    ),
    'definitions',jsonb_build_object(
      'learning_material','Study notes, summaries, and research sessions. These do not count as portfolio artifacts.',
      'supporting_analysis','Technical reports describing behavior, methods, results, and failure modes. These support evidence but are not implementations.',
      'evidence','Persisted measurable practice, benchmark, implementation, or independent-assessment records.',
      'portfolio_artifact','An admitted original implementation with a source file, reproducibility instructions, tests, metrics, provenance, and competency mapping.'
    ),
    'submission_contract',jsonb_build_object(
      'origin','expertise_portfolio_submission_v0_2',
      'required_fields',jsonb_build_array(
        'filename','title','competency','artifact_type',
        'original_work','execution_spec','tests','metrics'
      ),
      'artifact_type_required','implementation',
      'same_cognition_file_requirement','The filename must refer to an agent_file_output_v0_1 file created in the same cognition.',
      'code_file_extensions',jsonb_build_array('.py','.js','.ts','.sql','.json','.csv')
    ),
    'completion_rule','Do not describe the portfolio as complete unless gate.ready_for_verification is true. Reports alone never satisfy portfolio coverage under v0.2.',
    'verification_request_allowed',
      coalesce((v_gate->>'ready_for_verification')::boolean,false)
      and coalesce((v_repeat->>'ready_for_new_verification')::boolean,false),
    'repeat_verification_gate',v_repeat,
    'last_verification_request_feedback',v_feedback,
    'artifacts',v_items,
    'gate',v_gate
  );
end
$function$
;
