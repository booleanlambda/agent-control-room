CREATE OR REPLACE FUNCTION public.aau_bridge_apply_nvidia_intent_execution_pre_eoa_v0_1(p_bridge_token text, p_intent_execution_id uuid, p_result jsonb, p_runtime jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_stage text;
  v_started_at timestamptz;
  v_update jsonb:=coalesce(p_result->'embodiment_update','{}'::jsonb);
  v_identity_update jsonb:=coalesce(p_result->'identity_update','{}'::jsonb);
  v_existing_name text;
  v_existing_gender text;
  v_effective_name text;
  v_effective_gender text;
  v_candidates_at_start integer:=0;
  v_selected_text text;
  v_selected_id uuid;
  v_applied jsonb;
  v_selection jsonb:='{}'::jsonb;
  v_lifecycle jsonb:='{}'::jsonb;
  v_activity_id uuid;
  v_cognition_run_id uuid;
  v_selected_action text:=trim(coalesce(p_result->>'selected_action',''));
  v_expertise_artifact_id uuid;
  v_expertise_contract text;
  v_portfolio_gate jsonb:='{}'::jsonb;
  v_repeat_gate jsonb:='{}'::jsonb;
  v_academic_gate jsonb:='{}'::jsonb;
  v_verification_run_id uuid;
  v_verification_dispatch jsonb:=jsonb_build_object('status','not_requested');
  v_portfolio_submission jsonb:=jsonb_build_object('status','not_applicable');
  v_attention_interrupt boolean:=false;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.started_at,coalesce((q.metadata->>'attention_arbiter')::boolean,false)
  into v_agent_id,v_started_at,v_attention_interrupt
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id;

  if v_agent_id is null then raise exception 'intent_execution_not_found'; end if;

  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states
  where agent_id=v_agent_id;

  if not v_attention_interrupt and v_stage='identity_artifact' then
    select a.public_name,a.gender_identity
    into v_existing_name,v_existing_gender
    from agent_lab.agents a
    where a.agent_id=v_agent_id;

    v_effective_name:=coalesce(nullif(btrim(v_existing_name),''),nullif(btrim(v_identity_update->>'public_name'),''));
    v_effective_gender:=coalesce(nullif(btrim(v_existing_gender),''),nullif(btrim(v_identity_update->>'gender_identity'),''));

    if v_effective_name is null or not agent_lab.is_human_aligned_public_name(v_agent_id,v_effective_name) then
      raise exception 'MANDATORY_IDENTITY_PUBLIC_NAME_REQUIRED';
    end if;
    if v_effective_gender is null then raise exception 'MANDATORY_IDENTITY_GENDER_REQUIRED'; end if;
    if v_existing_gender is null and jsonb_typeof(v_identity_update->'gender_identity') is distinct from 'string' then
      raise exception 'MANDATORY_IDENTITY_GENDER_MUST_BE_SELF_CHOSEN_STRING';
    end if;
  end if;

  if v_stage='embodiment_artifact' then
    select count(*) into v_candidates_at_start
    from agent_lab.embodiment_assets a
    where a.agent_id=v_agent_id
      and a.asset_role='provisional_source'
      and a.status='active'
      and a.created_at<=coalesce(v_started_at,now())
      and coalesce((a.metadata->>'operator_smoke_test')::boolean,false)=false
      and coalesce((a.metadata->>'human_embodiment_compliant')::boolean,(a.metadata->'result'->>'human_embodiment_compliant')::boolean,false)=true
      and coalesce(nullif(a.metadata->>'human_embodiment_policy_version',''),nullif(a.metadata->'result'->>'human_embodiment_policy_version',''),'')='human_embodiment_requirement_v0_1';

    if not v_attention_interrupt then
      if v_candidates_at_start=0 then
        if lower(coalesce(v_update->>'representation_desired','false'))<>'true'
           or lower(coalesce(v_update->>'request_visual_candidates','false'))<>'true'
           or nullif(trim(coalesce(v_update->>'reason','')),'') is null
           or not (
             (jsonb_typeof(coalesce(v_update->'preferences','{}'::jsonb))='object' and coalesce(v_update->'preferences','{}'::jsonb)<>'{}'::jsonb)
             or
             (jsonb_typeof(coalesce(v_update->'requested_changes','{}'::jsonb))='object' and coalesce(v_update->'requested_changes','{}'::jsonb)<>'{}'::jsonb)
           )
        then
          raise exception 'MANDATORY_EMBODIMENT_INITIATION_INCOMPLETE';
        end if;
      else
        v_selected_text:=nullif(trim(coalesce(v_update->>'selected_candidate_asset_id','')),'');
        if v_selected_text is null then raise exception 'MANDATORY_EMBODIMENT_SELECTION_REQUIRED'; end if;
        begin v_selected_id:=v_selected_text::uuid;
        exception when others then raise exception 'MANDATORY_EMBODIMENT_SELECTION_INVALID_ID';
        end;

        if not exists(
          select 1
          from agent_lab.embodiment_assets a
          where a.embodiment_asset_id=v_selected_id
            and a.agent_id=v_agent_id
            and a.asset_role='provisional_source'
            and a.status='active'
            and a.created_at<=coalesce(v_started_at,now())
            and coalesce((a.metadata->>'operator_smoke_test')::boolean,false)=false
            and coalesce((a.metadata->>'human_embodiment_compliant')::boolean,(a.metadata->'result'->>'human_embodiment_compliant')::boolean,false)=true
            and coalesce(nullif(a.metadata->>'human_embodiment_policy_version',''),nullif(a.metadata->'result'->>'human_embodiment_policy_version',''),'')='human_embodiment_requirement_v0_1'
        ) then
          raise exception 'MANDATORY_EMBODIMENT_SELECTION_NOT_ELIGIBLE';
        end if;

        if nullif(trim(coalesce(v_update->>'reason','')),'') is null then
          raise exception 'MANDATORY_EMBODIMENT_SELECTION_REASON_REQUIRED';
        end if;
      end if;
    end if;
  end if;

  v_applied:=public.aau_bridge_apply_nvidia_experimental_wake(
    p_bridge_token,p_intent_execution_id,p_result,p_runtime
  );

  v_activity_id:=nullif(v_applied->>'activity_id','')::uuid;
  v_cognition_run_id:=nullif(v_applied->>'cognition_run_id','')::uuid;

  v_portfolio_submission:=agent_lab.apply_expertise_portfolio_submissions_v0_2(
    v_agent_id,v_activity_id,v_cognition_run_id,p_intent_execution_id,
    coalesce(p_result->'associations','[]'::jsonb)
  );

  v_selected_text:=nullif(trim(coalesce(v_update->>'selected_candidate_asset_id','')),'');
  if v_stage='embodiment_artifact' and v_candidates_at_start>0 and v_selected_text is not null then
    begin v_selected_id:=v_selected_text::uuid;
    exception when others then v_selected_id:=null;
    end;
    if v_selected_id is not null then
      v_selection:=agent_lab.select_embodiment_candidate_v0_1(
        v_agent_id,v_activity_id,v_cognition_run_id,p_intent_execution_id,v_update
      );
      v_lifecycle:=agent_lab.refresh_mandatory_lifecycle_state(v_agent_id);
    end if;
  end if;

  if v_selected_action in (
    'request_independent_verification_of_artifact',
    'request_independent_assessment',
    'request_expertise_verification',
    'request_verifier_retry'
  ) then
    select
      x.expertise_artifact_id,
      coalesce(x.metadata->>'portfolio_contract_version','expertise_portfolio_v0_1_legacy')
    into v_expertise_artifact_id,v_expertise_contract
    from agent_lab.expertise_artifacts x
    where x.agent_id=v_agent_id
      and x.status in ('initiated','accepted_for_development')
    order by x.created_at desc
    limit 1;

    if v_expertise_artifact_id is null then
      v_verification_dispatch:=jsonb_build_object(
        'status','blocked',
        'reason','eligible_expertise_artifact_not_found',
        'selected_action',v_selected_action,
        'retryable',false
      );
    else
      if v_expertise_contract='expertise_portfolio_v0_2' then
        v_portfolio_gate:=agent_lab.evaluate_expertise_portfolio_gate_v0_2(
          v_agent_id,v_expertise_artifact_id
        );
      else
        v_portfolio_gate:=jsonb_build_object(
          'ready_for_verification',true,
          'contract_version',v_expertise_contract,
          'legacy_baseline',true
        );
      end if;

      if coalesce((select (metadata->>'standards_required')::boolean from agent_lab.expertise_artifacts
          where expertise_artifact_id=v_expertise_artifact_id),false) then
        v_academic_gate:=agent_lab.expertise_standard_gate_v0_3(v_agent_id,v_expertise_artifact_id);
      end if;
      if v_selected_action <> 'request_verifier_retry' then
        v_repeat_gate:=agent_lab.evaluate_expertise_reverification_evidence_v0_1(
          v_agent_id,v_expertise_artifact_id
        );
      end if;

      if v_academic_gate<>'{}'::jsonb
         and not coalesce((v_academic_gate->>'ready')::boolean,false) then
        v_verification_dispatch:=jsonb_build_object(
          'status','blocked','reason','AAU_owned_master_standard_not_approved',
          'selected_action',v_selected_action,
          'expertise_artifact_id',v_expertise_artifact_id,
          'academic_standard_gate',v_academic_gate,'retryable',false,
          'agent_action_required',false,'operator_action_required',true
        );
      elsif not coalesce((v_portfolio_gate->>'ready_for_verification')::boolean,false) then
        v_verification_dispatch:=jsonb_build_object(
          'status','blocked',
          'reason','expertise_portfolio_v0_2_incomplete',
          'selected_action',v_selected_action,
          'expertise_artifact_id',v_expertise_artifact_id,
          'portfolio_gate',v_portfolio_gate,
          'retryable',false,
          'agent_action_required',true
        );
      elsif v_selected_action <> 'request_verifier_retry'
        and not coalesce((v_repeat_gate->>'ready_for_new_verification')::boolean,false) then
        v_verification_dispatch:=jsonb_build_object(
          'status','blocked',
          'reason','expertise_reverification_evidence_required',
          'selected_action',v_selected_action,
          'expertise_artifact_id',v_expertise_artifact_id,
          'repeat_verification_gate',v_repeat_gate,
          'retryable',false,
          'agent_action_required',true
        );
      elsif v_selected_action='request_verifier_retry' then
        v_verification_run_id:=agent_lab.retry_expertise_verification(
          v_agent_id,v_expertise_artifact_id,
          jsonb_build_object(
            'origin','agent_selected_retry_action_v0_1',
            'source_intent_execution_id',p_intent_execution_id,
            'source_activity_id',v_activity_id,
            'source_cognition_run_id',v_cognition_run_id,
            'selected_action',v_selected_action
          )
        );
        v_verification_dispatch:=jsonb_build_object(
          'status','retry_requested',
          'verification_run_id',v_verification_run_id,
          'expertise_artifact_id',v_expertise_artifact_id,
          'retryable',false
        );
      else
        v_verification_run_id:=agent_lab.request_expertise_verification(
          v_agent_id,v_expertise_artifact_id,
          jsonb_build_object(
            'origin','agent_selected_action_v0_1',
            'source_intent_execution_id',p_intent_execution_id,
            'source_activity_id',v_activity_id,
            'source_cognition_run_id',v_cognition_run_id,
            'selected_action',v_selected_action
          )
        );
        v_verification_dispatch:=jsonb_build_object(
          'status','requested',
          'verification_run_id',v_verification_run_id,
          'expertise_artifact_id',v_expertise_artifact_id,
          'retryable',false
        );
      end if;
    end if;

    -- Persist runtime feedback into the cognition outcome so the block is part of
    -- the auditable record and available to downstream context builders.
    if v_activity_id is not null then
      update agent_lab.activity_log
      set outcome=jsonb_set(
        coalesce(outcome,'{}'::jsonb),
        '{runtime_feedback}',
        coalesce(outcome->'runtime_feedback','{}'::jsonb)||jsonb_build_object('expertise_verification',v_verification_dispatch),
        true
      )
      where activity_id=v_activity_id;
    end if;
  end if;

  return coalesce(v_applied,'{}'::jsonb)||jsonb_build_object(
    'intent_execution_id',p_intent_execution_id,
    'protocol_version','next_intent_protocol_v0_1',
    'identity_protocol_version','identity_protocol_v0_2',
    'attention_arbiter_version','attention_arbiter_v0_1',
    'attention_interrupt_lifecycle_exemption',v_attention_interrupt,
    'embodiment_selection',v_selection,
    'mandatory_lifecycle_after_selection',v_lifecycle,
    'expertise_verification_dispatch',v_verification_dispatch,
    'expertise_portfolio_submission',v_portfolio_submission
  );
end
$function$
;

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
  v_academic jsonb := '{}'::jsonb;
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
  if coalesce((v_art.metadata->>'standards_required')::boolean,false) then
    v_academic:=agent_lab.expertise_standard_gate_v0_3(p_agent_id,v_art.expertise_artifact_id);
  else
    v_academic:=jsonb_build_object('ready',true,'reason','historical_artifact_not_v0_3_bound');
  end if;
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
      and coalesce((v_repeat->>'ready_for_new_verification')::boolean,false)
      and coalesce((v_academic->>'ready')::boolean,false),
    'academic_standard_gate',v_academic,
    'repeat_verification_gate',v_repeat,
    'last_verification_request_feedback',v_feedback,
    'artifacts',v_items,
    'gate',v_gate
  );
end
$function$
;
