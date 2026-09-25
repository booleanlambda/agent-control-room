-- Operator-certified Entrepreneurship Master's pass v0.1
-- Narrow lifecycle override: preserves the v0.2 integrity hold and does not
-- relabel historical independent reviews as provenance-compliant.
begin;

create or replace function agent_lab.operator_certify_entrepreneurship_masters_override_v0_1(
  p_agent_id uuid,
  p_operator_id text,
  p_reason text
) returns jsonb
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_eval jsonb;
  v_stage jsonb;
  v_score numeric;
  v_core_avg numeric;
  v_final_avg numeric;
begin
  if length(btrim(coalesce(p_operator_id,'')))<3 then
    raise exception 'operator_certification_operator_required';
  end if;
  if length(btrim(coalesce(p_reason,'')))<20 then
    raise exception 'operator_certification_reason_required';
  end if;

  v_eval:=agent_lab.evaluate_entrepreneurship_masters_v0_1(p_agent_id);
  if coalesce(v_eval->>'reason','')='not_enrolled' then
    raise exception 'operator_certification_agent_not_enrolled';
  end if;

  v_score:=coalesce((v_eval->>'overall_score')::numeric,0);
  v_core_avg:=coalesce((v_eval->>'core_course_average')::numeric,0);
  v_final_avg:=coalesce((v_eval->>'independent_final_average')::numeric,0);

  -- This path may override only the provenance/integrity hold, never a
  -- substantive academic shortfall.
  if coalesce((v_eval->>'courses_passed')::int,0)<15
     or coalesce((v_eval->>'core_courses_passed')::int,0)<14
     or not coalesce((v_eval->>'capstone_passed')::boolean,false)
     or coalesce((v_eval->>'independent_final_assessments_passed')::int,0)<2
     or v_core_avg<0.80
     or v_final_avg<0.85
     or v_score<0.85 then
    raise exception 'operator_certification_substantive_threshold_not_met:%',v_eval;
  end if;

  insert into agent_lab.mba_entrepreneurship_requirements(
    agent_id,protocol_version,status,academic_equivalence_level,specialization,
    verification_report,verifier,verified_at,updated_at
  ) values(
    p_agent_id,
    'entrepreneurship_masters_v0_1',
    'verified_pass',
    'entrepreneurship_masters_equivalent',
    'entrepreneurship',
    jsonb_build_object(
      'origin','operator_certified_pass_v0_1',
      'certification_kind','operator_certified_pass',
      'operator_id',left(btrim(p_operator_id),300),
      'operator_reason',left(btrim(p_reason),6000),
      'overall_score',v_score,
      'academic_equivalence_level','entrepreneurship_masters_equivalent',
      'specialization','entrepreneurship',
      'core_curriculum_passed',true,
      'entrepreneurship_specialization_passed',true,
      'capstone_passed',true,
      'historical_independent_assessment_count',
        coalesce((v_eval->>'independent_final_assessments_passed')::int,0),
      'historical_integrity_status',v_eval->>'program_integrity_status',
      'historical_integrity_hold_preserved',
        coalesce((v_eval->>'independent_final_integrity_hold')::boolean,false),
      'durable_evidence_evaluation',v_eval,
      'verified_from_runtime_evidence',false,
      'operator_certification_override',true,
      'override_scope','lifecycle_advancement_only',
      'external_academic_credential_claim',false
    ),
    left('operator-certified:'||btrim(p_operator_id),300),
    now(),
    now()
  )
  on conflict(agent_id) do update set
    protocol_version=excluded.protocol_version,
    status='verified_pass',
    academic_equivalence_level=excluded.academic_equivalence_level,
    specialization=excluded.specialization,
    verification_report=excluded.verification_report,
    verifier=excluded.verifier,
    verified_at=excluded.verified_at,
    updated_at=now();

  update agent_lab.entrepreneurship_enrollments
  set status='verified_pass',
      completed_at=coalesce(completed_at,now()),
      overall_score=v_score,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'operator_certified_pass',true,
        'operator_certified_pass_at',now(),
        'operator_certification_contract','operator_certified_pass_v0_1',
        'operator_id',left(btrim(p_operator_id),300),
        'operator_reason',left(btrim(p_reason),6000),
        'historical_integrity_audit_preserved',true,
        'historical_integrity_status',v_eval->>'program_integrity_status',
        'verified_from_runtime_evidence',false,
        'lifecycle_advancement_authorized',true
      ),
      updated_at=now()
  where agent_id=p_agent_id
    and program_version='entrepreneurship_masters_v0_1';

  v_stage:=agent_lab.refresh_mandatory_lifecycle_state(p_agent_id);

  return jsonb_build_object(
    'status','operator_certified_pass',
    'agent_id',p_agent_id,
    'operator_id',left(btrim(p_operator_id),300),
    'overall_score',v_score,
    'historical_integrity_status',v_eval->>'program_integrity_status',
    'verified_from_runtime_evidence',false,
    'lifecycle',v_stage,
    'contract','operator_certified_pass_v0_1'
  );
end;
$function$;

commit;
