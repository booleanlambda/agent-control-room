CREATE OR REPLACE FUNCTION public.aau_bridge_complete_expertise_verification(p_bridge_token text, p_verification_run_id uuid, p_executor_id text, p_overall_result text, p_overall_score numeric, p_challenge_packet jsonb, p_candidate_answers jsonb, p_authenticator_grades jsonb, p_adjudicator_grades jsonb, p_final_report jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab', 'extensions'
AS $function$
declare
  v_run agent_lab.expertise_verification_runs%rowtype;
  v_domain text;
  v_gate jsonb;
  v_owned_master_gate jsonb:='{}'::jsonb;
  v_gate_pass boolean:=false;
  v_authoritative_result text;
  v_effective_result text;
  v_effective_equivalence text;
  v_authoritative_score numeric:=0;
  v_final_report jsonb;
  v_badge_id uuid;
  v_manual_review boolean:=false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if p_overall_result not in ('verified_pass','verified_fail') then raise exception 'invalid_verification_result'; end if;
  if p_overall_score is null or p_overall_score<0 or p_overall_score>1 then raise exception 'invalid_overall_score'; end if;
  select * into v_run from agent_lab.expertise_verification_runs where verification_run_id=p_verification_run_id for update;
  if not found then raise exception 'verification_run_not_found'; end if;
  if v_run.status not in ('claimed','running') then raise exception 'verification_run_not_claimed'; end if;
  if coalesce(v_run.metadata->>'claimed_by','')<>coalesce(p_executor_id,'') then raise exception 'verification_claim_owner_mismatch'; end if;
  select domain into v_domain from agent_lab.expertise_artifacts where expertise_artifact_id=v_run.expertise_artifact_id;
  v_manual_review:=exists(select 1 from jsonb_array_elements(coalesce(p_authenticator_grades,'[]'::jsonb)) where value->>'source'='operator_attested_model_review_v0_1')
     or exists(select 1 from jsonb_array_elements(coalesce(p_adjudicator_grades,'[]'::jsonb)) where value->>'source'='operator_attested_model_review_v0_1');

  v_gate:=agent_lab.evaluate_masters_equivalent_gate_v0_1(coalesce(p_challenge_packet,'{}'::jsonb),coalesce(p_final_report,'{}'::jsonb));
  begin v_gate_pass:=coalesce((v_gate->>'passed')::boolean,false); exception when others then v_gate_pass:=false; end;
  if v_run.metadata->>'academic_standard_version'='aau_owned_master_us_v0_3' then
    v_owned_master_gate:=agent_lab.evaluate_owned_master_completion_v0_3(
      p_verification_run_id,p_challenge_packet,p_final_report
    );
    v_gate_pass:=v_gate_pass
      and coalesce((v_owned_master_gate->>'passed')::boolean,false);
    v_gate:=v_gate||jsonb_build_object('passed',v_gate_pass,
      'aau_owned_master_gate',v_owned_master_gate);
  end if;
  begin v_authoritative_score:=coalesce((v_gate->>'mean_score')::numeric,0); exception when others then v_authoritative_score:=0; end;
  v_authoritative_result:=case when p_overall_result='verified_pass' and v_gate_pass then 'verified_pass' else 'verified_fail' end;
  v_final_report:=coalesce(p_final_report,'{}'::jsonb)||jsonb_build_object(
    'worker_reported_result',p_overall_result,'worker_reported_score',p_overall_score,
    'overall_result',v_authoritative_result,'overall_score',v_authoritative_score,
    'runtime_owned_master_gate',v_gate,
    'academic_equivalence_level',case when v_authoritative_result='verified_pass' then 'masters_equivalent' else 'below_masters_equivalent' end,
    'minimum_academic_equivalence','masters_equivalent','equivalence_is_not_academic_credential',true,
    'authenticator_policy_version','expertise_authenticator_v0_2','threshold_authority','runtime_owned',
    'manual_review_used',v_manual_review
  );

  update agent_lab.expertise_verification_runs set
    status=v_authoritative_result,overall_score=v_authoritative_score,challenge_packet=coalesce(p_challenge_packet,'{}'::jsonb),candidate_answers=coalesce(p_candidate_answers,'[]'::jsonb),
    authenticator_grades=coalesce(p_authenticator_grades,'[]'::jsonb),adjudicator_grades=coalesce(p_adjudicator_grades,'[]'::jsonb),final_report=v_final_report,
    verified_at=now(),updated_at=now(),metadata=(metadata-'claim_expires_at')||jsonb_build_object(
      'completed_by',p_executor_id,'completed_at',now(),'authenticator_policy_version','expertise_authenticator_v0_2',
      'minimum_academic_equivalence','masters_equivalent','threshold_authority','runtime_owned','worker_reported_result',p_overall_result,'worker_reported_score',p_overall_score,'manual_review_used',v_manual_review
    )
  where verification_run_id=p_verification_run_id
  returning status into v_effective_result;

  v_effective_equivalence:=case when v_effective_result='verified_pass' then 'masters_equivalent'
    when v_effective_result='awaiting_thesis' then 'awaiting_thesis' else 'below_masters_equivalent' end;

  if v_effective_result<>'awaiting_thesis' then
  update agent_lab.expertise set
    actual_competence=round((v_authoritative_score*10)::numeric,4),last_assessed_at=now(),assessment_method=case when v_manual_review then 'external_independent_manual_review_v0_1_masters_equivalent' else 'external_nvidia_multi_model_verification_v0_2_masters_equivalent' end,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('verification_run_id',p_verification_run_id,'verification_status',v_effective_result,'verified_score',v_authoritative_score,'academic_equivalence_level',v_effective_equivalence,'authenticator_model',v_run.authenticator_model,'authenticator_policy_version','expertise_authenticator_v0_2','manual_review_used',v_manual_review)
  where agent_id=v_run.agent_id and domain=v_domain;

  end if;

  update agent_lab.expertise_artifacts set
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('latest_verification_run_id',p_verification_run_id,'verification_status',v_effective_result,'technical_result',v_authoritative_result,'verified_score',v_authoritative_score,'academic_equivalence_level',v_effective_equivalence,'verified_at',case when v_effective_result='awaiting_thesis' then null else now() end,'authenticator_model',v_run.authenticator_model,'authenticator_policy_version','expertise_authenticator_v0_2'),updated_at=now()
  where expertise_artifact_id=v_run.expertise_artifact_id;

  update agent_lab.verification_intervention_alerts
    set status='resolved',updated_at=now(),resolved_at=now(),
        metadata=metadata||jsonb_build_object(
          'final_verdict',v_authoritative_result,
          'resolved_by',p_executor_id,
          'final_report_sha256',encode(sha256(convert_to(v_final_report::text,'UTF8')),'hex'))
    where verification_run_id=p_verification_run_id
      and status in ('open','operator_requested');

  select badge_id into v_badge_id from agent_lab.universe_recognition_badges where verification_run_id=p_verification_run_id;
  return jsonb_build_object('ok',true,'verification_run_id',p_verification_run_id,'result',v_effective_result,'technical_result',v_authoritative_result,'thesis_pending',(v_effective_result='awaiting_thesis'),'score',v_authoritative_score,'academic_equivalence_level',v_effective_equivalence,'universe_badge_id',v_badge_id,'runtime_owned_master_gate',v_gate);
end;
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.retry_expertise_verification(p_agent_id uuid, p_expertise_artifact_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_id uuid;
  v_previous_failure jsonb;
  v_art agent_lab.expertise_artifacts%rowtype;
  v_std jsonb;
begin
  if not exists (
    select 1
    from agent_lab.expertise_artifacts x
    where x.expertise_artifact_id=p_expertise_artifact_id
      and x.agent_id=p_agent_id
      and x.status in ('initiated','accepted_for_development')
  ) then
    raise exception 'eligible_expertise_artifact_not_found';
  end if;

  select * into v_art from agent_lab.expertise_artifacts where agent_id=p_agent_id
     and expertise_artifact_id=p_expertise_artifact_id;
  if coalesce((v_art.metadata->>'standards_required')::boolean,false) then
     v_std:=agent_lab.expertise_standard_gate_v0_3(p_agent_id,p_expertise_artifact_id);
     if not coalesce((v_std->>'ready')::boolean,false) then
       raise exception 'AAU_owned_master_standard_not_ready:%',v_std::text;
     end if;
  end if;
  select r.verification_run_id into v_id
  from agent_lab.expertise_verification_runs r
  where r.agent_id=p_agent_id and r.expertise_artifact_id=p_expertise_artifact_id
    and r.status='manual_required'
  order by r.created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  select r.verification_run_id into v_id
  from agent_lab.expertise_verification_runs r
  where r.agent_id=p_agent_id
    and r.expertise_artifact_id=p_expertise_artifact_id
    and r.status in ('pending','claimed','running','awaiting_thesis')
  order by r.created_at desc
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  select r.verification_run_id,
         jsonb_build_object(
           'error_code',r.metadata->>'last_error_code',
           'error_message',r.metadata->>'last_error_message',
           'error_at',r.metadata->>'last_error_at',
           'executor_id',r.metadata->>'last_executor_id',
           'attempt_count',coalesce((r.metadata->>'attempt_count')::integer,0),
           'recorded_at',now()
         )
    into v_id,v_previous_failure
  from agent_lab.expertise_verification_runs r
  where r.agent_id=p_agent_id
    and r.expertise_artifact_id=p_expertise_artifact_id
    and r.status='failed'
    and r.overall_score is null
    and r.verified_at is null
  order by r.updated_at desc,r.created_at desc
  limit 1
  for update;

  if v_id is null then
    raise exception 'retryable_runtime_failed_verification_not_found';
  end if;
  if coalesce((v_art.metadata->>'standards_required')::boolean,false)
    and not exists(select 1 from agent_lab.expertise_verification_runs r
       where r.verification_run_id=v_id
         and r.metadata->>'academic_standard_version'='aau_owned_master_us_v0_3'
         and r.metadata->>'academic_standard_sha256'=v_std->>'sha256') then
    raise exception 'historical_runtime_retry_not_bound_to_new_academic_standard';
  end if;

  update agent_lab.expertise_verification_runs r
  set status='pending',
      challenge_packet='{}'::jsonb,
      candidate_answers='[]'::jsonb,
      authenticator_grades='[]'::jsonb,
      adjudicator_grades='[]'::jsonb,
      final_report='{}'::jsonb,
      overall_score=null,
      verified_at=null,
      updated_at=now(),
      metadata=(coalesce(r.metadata,'{}'::jsonb)
        - 'claim_expires_at'
        - 'claimed_by'
        - 'claimed_at'
        - 'retry_after_at'
        - 'last_error_code'
        - 'last_error_message'
        - 'last_error_at'
        - 'last_executor_id')
        || jsonb_build_object(
          'previous_runtime_failures',coalesce(r.metadata->'previous_runtime_failures','[]'::jsonb) || jsonb_build_array(v_previous_failure),
          'retry_requested_at',now(),
          'retry_request_count',coalesce((r.metadata->>'retry_request_count')::integer,0)+1,
          'retry_origin','agent_selected_retry_action_v0_1'
        )
        || coalesce(p_metadata,'{}'::jsonb)
  where r.verification_run_id=v_id;

  return v_id;
end;
$function$
;
