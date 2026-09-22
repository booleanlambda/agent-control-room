CREATE OR REPLACE FUNCTION agent_lab.materialize_approved_expertise_viability_v0_1(p_proposal_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_case agent_lab.expertise_economic_proposals%rowtype;
  v_report jsonb;
  v_check jsonb;
  v_artifact uuid;
  v_draft uuid;
  v_owned agent_lab.expertise_standard_versions%rowtype;
begin
  select * into v_case
  from agent_lab.expertise_economic_proposals
  where proposal_id=p_proposal_id for update;

  if not found or v_case.status<>'approved' then
    raise exception 'expertise_viability_proposal_not_approved';
  end if;

  v_report:=v_case.report;
  if v_report->>'proposal_contract_version'='expertise_viability_proposal_v0_3' then
    select * into v_owned from agent_lab.expertise_standard_versions
      where proposal_id=p_proposal_id and status='approved' for update;
    if not found or not coalesce((agent_lab.validate_owned_expertise_standard_v0_3(
      v_owned.public_spec,v_owned.private_assessment,v_owned.source_receipts)->>'ok')::boolean,false)
      or v_owned.author_model is null or v_owned.reviewer_model is null
      or v_owned.author_model=v_owned.reviewer_model then
      raise exception 'AAU_owned_academic_standard_not_independently_approved';
    end if;
    v_report:=v_report||jsonb_build_object(
      'target_standard',v_owned.public_spec->>'target_standard',
      'scope',v_owned.public_spec->'scope',
      'competencies',(select jsonb_agg(x.value->>'label' order by x.ord)
        from jsonb_array_elements(v_owned.public_spec->'competencies') with ordinality as x(value,ord)),
      'evidence_requirements',v_owned.public_spec->'evidence_requirements',
      'verification_plan',v_owned.public_spec->'verification_plan');
  end if;
  v_check:=agent_lab.validate_expertise_viability_proposal_v0_1(v_report);
  if not coalesce((v_check->>'ok')::boolean,false) then
    raise exception 'expertise_viability_proposal_invalid:%',v_check->'missing';
  end if;

  select expertise_artifact_id into v_draft
  from agent_lab.expertise_artifacts
  where agent_id=v_case.agent_id
    and status='draft'
    and metadata->>'operator_review_research_mode'='true'
  order by created_at desc limit 1 for update;

  if v_draft is not null then
    update agent_lab.expertise_artifacts
    set domain=v_report->>'domain',
        artifact_version=3,
        status='initiated',
        target_standard=v_report->>'target_standard',
        scope=v_report->'scope',
        competencies=v_report->'competencies',
        evidence_requirements=v_report->'evidence_requirements',
        verification_plan=v_report->'verification_plan',
        intended_application=v_report->'intended_application',
        economic_viability=v_report->'economic_viability',
        source_wake_request_id=v_case.source_wake_request_id,
        metadata=(coalesce(metadata,'{}'::jsonb)
          -'operator_review_research_mode'
          -'operator_economic_approval_status')
          ||jsonb_build_object(
            'origin','expertise_viability_proposal_v0_1',
            'expertise_credit',0,
            'self_selected_field',true,
            'operator_expertise_viability_approval_status','approved',
            'operator_expertise_viability_proposal_id',p_proposal_id,
            'operator_expertise_viability_approval_at',v_case.reviewed_at,
            'unit_approval_contract','expertise_viability_proposal_v0_1',
            'approval_semantics','development_path_authorized_not_competence_or_revenue_verified',
            'economic_evidence_status','operator_accepted_for_development_not_empirically_verified',
            'verification_threshold_policy','runtime_owned_v0_1'
          ),
        updated_at=now()
    where expertise_artifact_id=v_draft
    returning expertise_artifact_id into v_artifact;

    update agent_lab.expertise_economic_proposals
    set status='consumed',artifact_id=v_artifact,updated_at=now()
    where proposal_id=p_proposal_id and status='approved';
  else
    insert into agent_lab.expertise_artifacts(
      agent_id,domain,artifact_version,status,target_standard,scope,competencies,
      evidence_requirements,verification_plan,intended_application,economic_viability,
      source_wake_request_id,source_activity_id,metadata
    ) values(
      v_case.agent_id,v_report->>'domain',3,'initiated',v_report->>'target_standard',
      v_report->'scope',v_report->'competencies',v_report->'evidence_requirements',
      v_report->'verification_plan',v_report->'intended_application',
      v_report->'economic_viability',v_case.source_wake_request_id,null,
      jsonb_build_object(
        'origin','expertise_viability_proposal_v0_1',
        'expertise_credit',0,
        'self_selected_field',true,
        'operator_expertise_viability_approval_status','approved',
        'operator_expertise_viability_proposal_id',p_proposal_id,
        'unit_approval_contract','expertise_viability_proposal_v0_1',
        'approval_semantics','development_path_authorized_not_competence_or_revenue_verified',
        'economic_evidence_status','operator_accepted_for_development_not_empirically_verified',
        'verification_threshold_policy','runtime_owned_v0_1',
        'portfolio_contract_version','expertise_portfolio_v0_2'
      )
    ) returning expertise_artifact_id into v_artifact;
  end if;

  insert into agent_lab.expertise(
    agent_id,domain,actual_competence,perceived_competence,expression_confidence,
    interest_strength,training_units,last_assessed_at,assessment_method,metadata
  ) values(
    v_case.agent_id,v_report->>'domain',0,0,0,0,0,now(),
    'approved_expertise_viability_unit_zero_credit',
    jsonb_build_object(
      'expertise_artifact_id',v_artifact,
      'expertise_credit',0,
      'unit_approval_contract','expertise_viability_proposal_v0_1',
      'portfolio_contract_version','expertise_portfolio_v0_2'
    )
  )
  on conflict(agent_id,domain) do update
  set metadata=agent_lab.expertise.metadata||jsonb_build_object(
    'expertise_artifact_id',v_artifact,
    'unit_approval_contract','expertise_viability_proposal_v0_1',
    'portfolio_contract_version','expertise_portfolio_v0_2'
  );

  if v_owned.standard_id is not null then
    update agent_lab.expertise_standard_versions set artifact_id=v_artifact,updated_at=now()
      where standard_id=v_owned.standard_id;
    update agent_lab.expertise_artifacts set
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'standards_required',true,
        'standards_authority','aau_owned_master_us_v0_3',
        'standards_status','approved',
        'academic_target','leading_us_university_masters_level_demonstrated_competence',
        'standard_id',v_owned.standard_id,
        'standard_sha256',v_owned.specification_sha256,
        'standard_approved_at',v_owned.approved_at,
        'historical_verification_results_preserved',true),
      updated_at=now()
      where expertise_artifact_id=v_artifact;
  end if;
  perform agent_lab.ensure_domain_learning_track_for_artifact(v_case.agent_id,v_artifact);
  perform agent_lab.refresh_mandatory_lifecycle_state(v_case.agent_id);

  return jsonb_build_object(
    'agent_id',v_case.agent_id,
    'proposal_id',p_proposal_id,
    'expertise_artifact_id',v_artifact,
    'domain',v_report->>'domain',
    'status','materialized',
    'expertise_credit',0,
    'contract_version','expertise_viability_proposal_v0_1'
  );
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.request_expertise_verification(p_agent_id uuid, p_expertise_artifact_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_model text;
  v_id uuid;
  v_track uuid;
  v_learning int := 0;
  v_entry_learning int := 1;
  v_art agent_lab.expertise_artifacts%rowtype;
  v_contract text;
  v_gate jsonb;
  v_legacy_files int := 0;
  v_academic_gate jsonb := '{}'::jsonb;
begin
  select coalesce(nullif(a.primary_model_id,''),nullif(a.birth_model_id,''))
  into v_model
  from agent_lab.agents a
  where a.agent_id=p_agent_id;
  if v_model is null then raise exception 'agent_model_not_bound'; end if;

  select * into v_art
  from agent_lab.expertise_artifacts x
  where x.expertise_artifact_id=p_expertise_artifact_id
    and x.agent_id=p_agent_id
    and x.status in ('initiated','accepted_for_development');
  if not found then raise exception 'eligible_expertise_artifact_not_found'; end if;

  if coalesce((v_art.metadata->>'standards_required')::boolean,false) then
    v_academic_gate:=agent_lab.expertise_standard_gate_v0_3(p_agent_id,p_expertise_artifact_id);
    if not coalesce((v_academic_gate->>'ready')::boolean,false)
        or v_academic_gate->>'sha256' is distinct from v_art.metadata->>'standard_sha256' then
      raise exception 'AAU_owned_master_standard_not_ready:%',v_academic_gate::text;
    end if;
  end if;
  if coalesce(v_art.metadata->>'application_contract_version','')='expertise_application_v0_1'
     and not coalesce((agent_lab.validate_expertise_application_v0_1(v_art.intended_application,v_art.economic_viability)->>'ok')::boolean,false) then
    raise exception 'expertise_application_v0_1_incomplete:%',
      agent_lab.validate_expertise_application_v0_1(v_art.intended_application,v_art.economic_viability)::text;
  end if;

  v_contract := coalesce(v_art.metadata->>'portfolio_contract_version','expertise_portfolio_v0_1_legacy');
  v_track := agent_lab.ensure_domain_learning_track_for_artifact(p_agent_id,p_expertise_artifact_id);

  if v_contract='expertise_portfolio_v0_2' then
    v_gate := agent_lab.evaluate_expertise_portfolio_gate_v0_2(p_agent_id,p_expertise_artifact_id);
    if not coalesce((v_gate->>'ready_for_verification')::boolean,false) then
      raise exception 'expertise_portfolio_v0_2_incomplete:%', v_gate::text;
    end if;
  else
    -- Grandfather only pre-v0.2 experimental artifacts. The old capture path failed to
    -- canonicalize study/practice rows, so source files are accepted as the legacy baseline.
    select count(*) into v_learning
    from agent_lab.domain_learning_episodes where track_id=v_track;

    select count(*) into v_legacy_files
    from agent_lab.agent_files
    where agent_id=p_agent_id
      and direction='outbound'
      and purpose='agent_output'
      and created_at>=v_art.created_at;

    if v_learning<1 and v_legacy_files<1 then
      raise exception 'legacy_expertise_development_not_ready:no_learning_or_output_evidence';
    end if;

    v_gate := jsonb_build_object(
      'version','legacy_expertise_entry_baseline_v0_1',
      'contract_version',v_contract,
      'grandfathered',true,
      'learning_episodes',v_learning,
      'agent_output_files',v_legacy_files,
      'reason','pre_v0_2_experiment_preserved_without_retroactive_reclassification'
    );
  end if;

  -- A manual intervention is not a failed competence assessment. Do not
  -- create a replacement run to bypass the frozen checkpoint or alert.
  select r.verification_run_id into v_id
  from agent_lab.expertise_verification_runs r
  where r.agent_id=p_agent_id and r.expertise_artifact_id=p_expertise_artifact_id
    and r.status='manual_required'
  order by r.created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  if exists(
    select 1 from agent_lab.expertise_verification_runs r
    where r.agent_id=p_agent_id
      and r.expertise_artifact_id=p_expertise_artifact_id
      and r.status in ('pending','claimed','running','awaiting_thesis')
  ) then
    select r.verification_run_id into v_id
    from agent_lab.expertise_verification_runs r
    where r.agent_id=p_agent_id
      and r.expertise_artifact_id=p_expertise_artifact_id
      and r.status in ('pending','claimed','running','awaiting_thesis')
    order by r.created_at desc limit 1;
    return v_id;
  end if;

  -- A completed failed assessment requires fresh canonical learning AND practice/artifact
  -- evidence before a new candidate packet can be constructed.
  if not coalesce((
    agent_lab.evaluate_expertise_reverification_evidence_v0_1(p_agent_id,p_expertise_artifact_id)
      ->>'ready_for_new_verification'
  )::boolean,false) then
    raise exception 'expertise_reverification_evidence_required:%',
      agent_lab.evaluate_expertise_reverification_evidence_v0_1(p_agent_id,p_expertise_artifact_id)::text;
  end if;

  insert into agent_lab.expertise_verification_runs(
    agent_id,expertise_artifact_id,candidate_model_id,metadata
  ) values (
    p_agent_id,p_expertise_artifact_id,v_model,
    coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
      'protocol','expertise_verification_runtime_v0_3',
      'provider','nvidia_direct',
      'domain_learning_policy','domain_learning_v0_2',
      'authenticator_policy_version','expertise_authenticator_v0_2',
      'minimum_academic_equivalence','masters_equivalent',
      'threshold_authority','runtime_owned',
      'candidate_thresholds_ignored',true,
      'portfolio_contract_version',v_contract,
      'portfolio_entry_gate',v_gate,
      'academic_standard_version',case when v_academic_gate<>'{}'::jsonb then 'aau_owned_master_us_v0_3' else null end,
      'academic_standard_id',v_academic_gate->>'standard_id',
      'academic_standard_sha256',v_academic_gate->>'sha256'
    )
  ) returning verification_run_id into v_id;

  return v_id;
end
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
