-- AAU expertise verifier retry dispatch v0.1
-- Production purpose:
-- 1. Treat request_verifier_retry as a canonical runtime action.
-- 2. Retry a previously admitted verification that failed at runtime without
--    weakening the learning gate for brand-new verification requests.
-- 3. Preserve prior runtime-failure evidence and continue attempt_count.

create or replace function agent_lab.retry_expertise_verification(
  p_agent_id uuid,
  p_expertise_artifact_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'agent_lab', 'extensions'
as $function$
declare
  v_id uuid;
  v_previous_failure jsonb;
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

  select r.verification_run_id into v_id
  from agent_lab.expertise_verification_runs r
  where r.agent_id=p_agent_id
    and r.expertise_artifact_id=p_expertise_artifact_id
    and r.status in ('pending','claimed','running')
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
$function$;

revoke all on function agent_lab.retry_expertise_verification(uuid,uuid,jsonb) from public, anon, authenticated;

create or replace function public.aau_bridge_apply_nvidia_intent_execution(
  p_bridge_token text,
  p_intent_execution_id uuid,
  p_result jsonb,
  p_runtime jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'agent_lab'
as $function$
declare
  v_agent_id uuid;
  v_stage text;
  v_started_at timestamptz;
  v_update jsonb := coalesce(p_result->'embodiment_update','{}'::jsonb);
  v_candidates_at_start integer := 0;
  v_selected_text text;
  v_selected_id uuid;
  v_applied jsonb;
  v_selection jsonb := '{}'::jsonb;
  v_lifecycle jsonb := '{}'::jsonb;
  v_activity_id uuid;
  v_cognition_run_id uuid;
  v_selected_action text := trim(coalesce(p_result->>'selected_action',''));
  v_expertise_artifact_id uuid;
  v_verification_run_id uuid;
  v_verification_dispatch jsonb := jsonb_build_object('status','not_requested');
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.started_at into v_agent_id,v_started_at
  from agent_lab.wake_queue q where q.wake_request_id=p_intent_execution_id;
  if v_agent_id is null then raise exception 'intent_execution_not_found'; end if;

  select current_stage into v_stage from agent_lab.mandatory_lifecycle_states where agent_id=v_agent_id;

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

    if v_candidates_at_start=0 then
      if lower(coalesce(v_update->>'representation_desired','false'))<>'true'
         or lower(coalesce(v_update->>'request_visual_candidates','false'))<>'true'
         or nullif(trim(coalesce(v_update->>'reason','')),'') is null
         or not (
           (jsonb_typeof(coalesce(v_update->'preferences','{}'::jsonb))='object' and coalesce(v_update->'preferences','{}'::jsonb)<>'{}'::jsonb)
           or (jsonb_typeof(coalesce(v_update->'requested_changes','{}'::jsonb))='object' and coalesce(v_update->'requested_changes','{}'::jsonb)<>'{}'::jsonb)
         ) then
        raise exception 'MANDATORY_EMBODIMENT_INITIATION_INCOMPLETE';
      end if;
    else
      v_selected_text:=nullif(trim(coalesce(v_update->>'selected_candidate_asset_id','')),'');
      if v_selected_text is null then raise exception 'MANDATORY_EMBODIMENT_SELECTION_REQUIRED'; end if;
      begin v_selected_id:=v_selected_text::uuid; exception when others then raise exception 'MANDATORY_EMBODIMENT_SELECTION_INVALID_ID'; end;
      if not exists(
        select 1 from agent_lab.embodiment_assets a
        where a.embodiment_asset_id=v_selected_id and a.agent_id=v_agent_id
          and a.asset_role='provisional_source' and a.status='active'
          and a.created_at<=coalesce(v_started_at,now())
          and coalesce((a.metadata->>'operator_smoke_test')::boolean,false)=false
          and coalesce((a.metadata->>'human_embodiment_compliant')::boolean,(a.metadata->'result'->>'human_embodiment_compliant')::boolean,false)=true
          and coalesce(nullif(a.metadata->>'human_embodiment_policy_version',''),nullif(a.metadata->'result'->>'human_embodiment_policy_version',''),'')='human_embodiment_requirement_v0_1'
      ) then raise exception 'MANDATORY_EMBODIMENT_SELECTION_NOT_ELIGIBLE'; end if;
      if nullif(trim(coalesce(v_update->>'reason','')),'') is null then raise exception 'MANDATORY_EMBODIMENT_SELECTION_REASON_REQUIRED'; end if;
    end if;
  end if;

  v_applied := public.aau_bridge_apply_nvidia_experimental_wake(p_bridge_token,p_intent_execution_id,p_result,p_runtime);
  v_activity_id:=nullif(v_applied->>'activity_id','')::uuid;
  v_cognition_run_id:=nullif(v_applied->>'cognition_run_id','')::uuid;

  if v_stage='embodiment_artifact' and v_candidates_at_start>0 then
    v_selection:=agent_lab.select_embodiment_candidate_v0_1(v_agent_id,v_activity_id,v_cognition_run_id,p_intent_execution_id,v_update);
    v_lifecycle:=agent_lab.refresh_mandatory_lifecycle_state(v_agent_id);
  end if;

  if v_selected_action in ('request_independent_verification_of_artifact','request_expertise_verification','request_verifier_retry') then
    select x.expertise_artifact_id into v_expertise_artifact_id
    from agent_lab.expertise_artifacts x
    where x.agent_id=v_agent_id
      and x.status in ('initiated','accepted_for_development')
    order by x.created_at desc
    limit 1;

    if v_expertise_artifact_id is null then
      raise exception 'EXPERTISE_VERIFICATION_REQUEST_REQUIRES_ELIGIBLE_ARTIFACT';
    end if;

    if v_selected_action='request_verifier_retry' then
      v_verification_run_id := agent_lab.retry_expertise_verification(
        v_agent_id,
        v_expertise_artifact_id,
        jsonb_build_object(
          'origin','agent_selected_retry_action_v0_1',
          'source_intent_execution_id',p_intent_execution_id,
          'source_activity_id',v_activity_id,
          'source_cognition_run_id',v_cognition_run_id,
          'selected_action',v_selected_action
        )
      );
      v_verification_dispatch := jsonb_build_object(
        'status','retry_requested',
        'verification_run_id',v_verification_run_id,
        'expertise_artifact_id',v_expertise_artifact_id
      );
    else
      v_verification_run_id := agent_lab.request_expertise_verification(
        v_agent_id,
        v_expertise_artifact_id,
        jsonb_build_object(
          'origin','agent_selected_action_v0_1',
          'source_intent_execution_id',p_intent_execution_id,
          'source_activity_id',v_activity_id,
          'source_cognition_run_id',v_cognition_run_id,
          'selected_action',v_selected_action
        )
      );
      v_verification_dispatch := jsonb_build_object(
        'status','requested',
        'verification_run_id',v_verification_run_id,
        'expertise_artifact_id',v_expertise_artifact_id
      );
    end if;
  end if;

  return coalesce(v_applied,'{}'::jsonb)||jsonb_build_object(
    'intent_execution_id',p_intent_execution_id,
    'protocol_version','next_intent_protocol_v0_1',
    'embodiment_selection',v_selection,
    'mandatory_lifecycle_after_selection',v_lifecycle,
    'expertise_verification_dispatch',v_verification_dispatch
  );
end;
$function$;
