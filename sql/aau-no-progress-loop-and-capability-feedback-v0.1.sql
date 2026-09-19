-- AAU No-Progress Loop Guard + Capability Feedback v0.1
-- Applied live 2026-09-19.
-- Prevents repeated analysis-only Product/Service Test wakes and surfaces completed
-- build/deploy capability results back into the next cognition.

begin;

do $$
begin
  if to_regprocedure('agent_lab.get_cognition_packet_pre_capability_results_v0_1(uuid,uuid)') is null
     and to_regprocedure('agent_lab.get_cognition_packet(uuid,uuid)') is not null then
    execute 'alter function agent_lab.get_cognition_packet(uuid,uuid) rename to get_cognition_packet_pre_capability_results_v0_1';
  end if;
end
$$;

CREATE OR REPLACE FUNCTION agent_lab.build_recent_capability_results_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
with recent as (
  select
    i.capability_invocation_id,
    i.capability_code,
    i.status,
    i.created_at,
    i.updated_at,
    i.error_code,
    i.error_message,
    i.result_payload,
    row_number() over(order by i.created_at desc) as rn
  from agent_lab.capability_invocations i
  where i.agent_id=p_agent_id
    and i.capability_code in (
      'github.repository.inspect',
      'github.repository.write',
      'vercel.project.inspect',
      'vercel.project.configure',
      'vercel.deployment.inspect',
      'vercel.deployment.create'
    )
    and i.created_at >= now()-interval '2 hours'
),
trimmed as (
  select *
  from recent
  where rn<=12
),
projected as (
  select
    t.capability_invocation_id,
    t.capability_code,
    t.status,
    t.created_at,
    t.updated_at,
    t.error_code,
    t.error_message,
    case
      when t.capability_code='vercel.deployment.inspect' then
        jsonb_build_object(
          'deployment',coalesce(t.result_payload->'deployment','{}'::jsonb),
          'build_events',coalesce((
            select jsonb_agg(value order by ord)
            from jsonb_array_elements(coalesce(t.result_payload->'build_events','[]'::jsonb)) with ordinality e(value,ord)
            where ord<=20
          ),'[]'::jsonb),
          'latest_broker_deployment',coalesce(t.result_payload->'latest_broker_deployment','{}'::jsonb)
        )
      when t.capability_code='github.repository.inspect' then
        jsonb_build_object(
          'repo_full_name',t.result_payload->>'repo_full_name',
          'branch',t.result_payload->>'branch',
          'file_count',t.result_payload->'file_count',
          'files',coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'path',f.value->>'path',
                'sha',f.value->>'sha',
                'content',left(coalesce(f.value->>'content',''),12000),
                'error',f.value->>'error'
              )
              order by f.ord
            )
            from jsonb_array_elements(coalesce(t.result_payload->'files','[]'::jsonb)) with ordinality f(value,ord)
            where f.ord<=4
          ),'[]'::jsonb)
        )
      when t.capability_code in ('vercel.project.inspect','vercel.project.configure') then
        t.result_payload - 'adapter' - 'executor_id'
      when t.capability_code in ('github.repository.write','vercel.deployment.create') then
        t.result_payload - 'adapter' - 'executor_id'
      else '{}'::jsonb
    end as result
  from trimmed t
)
select jsonb_build_object(
  'version','recent_capability_results_v0_1',
  'rule','These are authoritative runtime capability results. status=completed means the action finished. A completed inspection is not pending; use its result before requesting the same inspection again. REQUESTED/queued is not completion.',
  'results',coalesce(jsonb_agg(
    jsonb_build_object(
      'capability_invocation_id',p.capability_invocation_id,
      'capability_code',p.capability_code,
      'status',upper(p.status),
      'created_at',p.created_at,
      'updated_at',p.updated_at,
      'error_code',p.error_code,
      'error_message',p.error_message,
      'result',p.result
    ) order by p.created_at desc
  ),'[]'::jsonb)
)
from projected p
$function$;

CREATE OR REPLACE FUNCTION agent_lab.get_cognition_packet(p_agent_id uuid, p_wake_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'agent_lab', 'public', 'extensions', 'pg_temp'
AS $function$
declare
  v_packet jsonb;
  v_results jsonb;
begin
  v_packet:=agent_lab.get_cognition_packet_pre_capability_results_v0_1(p_agent_id,p_wake_request_id);
  v_results:=agent_lab.build_recent_capability_results_v0_1(p_agent_id);

  return agent_lab.canonicalize_next_intent_json_v0_1(
    v_packet
    || jsonb_build_object(
      'brain_packet_version','brain_packet_v0_38_capability_results',
      'recent_capability_results',v_results,
      'capability_result_system_contract',
      'recent_capability_results is authoritative runtime feedback. If an inspection capability is COMPLETED, its result is available now and must not be described as pending. Use completed evidence before repeating the same inspection.'
    )
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.aau_bridge_apply_nvidia_intent_execution(p_bridge_token text, p_intent_execution_id uuid, p_result jsonb, p_runtime jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_applied jsonb;
  v_product_service jsonb;
  v_stage text;
  v_product_ctx jsonb;
  v_dep_state text;
  v_construct_id uuid;
  v_latest_github_success timestamptz;
  v_latest_deployment_failure timestamptz;
  v_action text := lower(trim(coalesce(p_result->>'selected_action','')));
  v_reason text := lower(trim(coalesce(p_result->>'stated_reason','')));
  v_conflict boolean := false;
  v_repo_claim_conflict boolean := false;
  v_no_progress_loop boolean := false;
  v_last_action text := '';
  v_prior_requested integer := 0;
  v_cap_request_count integer := 0;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id into v_agent_id
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id;
  if v_agent_id is null then raise exception 'intent_execution_not_found'; end if;

  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states
  where agent_id=v_agent_id;

  if v_stage='product_service_test' then
    v_product_ctx := agent_lab.build_product_service_test_context_v0_1(v_agent_id);
    v_dep_state := upper(coalesce(
      v_product_ctx->'external_workflow'->'states'->'production_deployment'->>'durable_state',''
    ));

    select lower(trim(coalesce(s.state_payload->>'last_action',''))),
           coalesce((s.state_payload->'last_capability_request_feedback'->>'requested')::integer,0)
      into v_last_action,v_prior_requested
    from agent_lab.state s
    where s.agent_id=v_agent_id;

    select count(*)
      into v_cap_request_count
    from jsonb_array_elements(coalesce(p_result->'associations','[]'::jsonb)) a
    where a->>'origin'='capability_request_v0_1';

    if v_dep_state='FAILED' then
      v_conflict :=
           v_action ~ '(verify.*deployment|verify.*http|http.*status|submit.*final|final.*verification|final.*adjudication)'
        or v_reason ~ '(re-?initiated|re-?deployed|re-?submitted|retried|deployment has been initiated|deployment is now pending)'
        or (v_reason like '%verify%' and v_reason like '%succeeded%' and v_reason like '%deployment%');

      v_no_progress_loop :=
           v_action <> ''
       and v_action = v_last_action
       and v_prior_requested = 0
       and v_cap_request_count = 0
       and v_action ~ '(analy[sz]e|inspect|review|synthesi[sz]e|diagnos|investigate)';
    end if;

    select t.construct_id into v_construct_id
    from agent_lab.product_service_tests t
    where t.agent_id=v_agent_id
      and t.protocol_version='product_service_test_v0_1'
    order by t.updated_at desc
    limit 1;

    if v_construct_id is not null then
      select max(coalesce(j.finished_at,j.updated_at,j.created_at))
      into v_latest_github_success
      from agent_lab.infrastructure_broker_jobs j
      where j.construct_id=v_construct_id
        and j.provider='github'
        and j.status='succeeded';

      select max(coalesce(j.finished_at,j.updated_at,j.created_at))
      into v_latest_deployment_failure
      from agent_lab.infrastructure_broker_jobs j
      join agent_lab.infrastructure_broker_requests r
        on r.broker_request_id=j.broker_request_id
      where j.construct_id=v_construct_id
        and j.provider='vercel'
        and r.resource_type='deployment'
        and r.operation='deploy'
        and j.status='failed';

      v_repo_claim_conflict :=
        v_reason ~ '(have |already )?(updated|modified|changed|fixed|repaired|rewritten).*(repository|build script|build scripts|file|files|code|package|entrypoint)'
        and (
          v_latest_github_success is null
          or (v_latest_deployment_failure is not null and v_latest_github_success <= v_latest_deployment_failure)
        );
    end if;

    if v_no_progress_loop then
      raise exception 'NO_PROGRESS_EXTERNAL_ACTION_LOOP: repeated analysis/inspection action with requested=0 and unchanged FAILED deployment. Issue an actual capability request or choose a different substantive repair step';
    end if;

    if v_repo_claim_conflict then
      raise exception 'AUTHORITATIVE_EXTERNAL_STATE_CONFLICT: repository_mutation_unconfirmed; no successful GitHub write exists after the latest failed deployment. Issue an actual GitHub capability request and wait for durable success before claiming repository changes were applied';
    end if;

    if v_conflict then
      raise exception 'AUTHORITATIVE_EXTERNAL_STATE_CONFLICT: production_deployment durable_state=FAILED; repair or issue a new runtime action before verification/final submission';
    end if;
  end if;

  v_applied:=public.aau_bridge_apply_nvidia_intent_execution_pre_eoa_v0_1(
    p_bridge_token,p_intent_execution_id,p_result,
    coalesce(p_runtime,'{}'::jsonb)||jsonb_build_object(
      'evidence_of_action_mode','optional_submission_v0_1',
      'product_service_test_contract','product_service_test_v0_1',
      'authoritative_external_state_commit_guard','v0_3',
      'no_progress_loop_guard','v0_1'
    )
  );

  v_product_service:=agent_lab.apply_product_service_test_submission_v0_1(
    v_agent_id,coalesce(p_result->'associations','[]'::jsonb)
  );
  perform agent_lab.refresh_mandatory_lifecycle_state(v_agent_id);

  return coalesce(v_applied,'{}'::jsonb)
    || jsonb_build_object('product_service_test',v_product_service);
end
$function$;

CREATE OR REPLACE FUNCTION public.aau_bridge_fail_nvidia_intent_execution(p_bridge_token text, p_intent_execution_id uuid, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_status text;
  v_error text:=left(coalesce(p_error,'nvidia_intent_execution_failed'),3000);
  v_semantic boolean:=false;
  v_external_state_conflict boolean:=false;
  v_repo_conflict boolean:=false;
  v_no_progress_loop boolean:=false;
  v_released boolean:=false;
  v_rule text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id,q.status into v_agent_id,v_status
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id;

  if v_agent_id is null then
    return jsonb_build_object('intent_execution_id',p_intent_execution_id,'status','not_found','protocol_version','next_intent_protocol_v0_1');
  end if;

  v_external_state_conflict := v_error ilike '%AUTHORITATIVE_EXTERNAL_STATE_CONFLICT%';
  v_repo_conflict := v_error ilike '%repository_mutation_unconfirmed%';
  v_no_progress_loop := v_error ilike '%NO_PROGRESS_EXTERNAL_ACTION_LOOP%';

  if (v_external_state_conflict or v_no_progress_loop) and v_status in ('claimed','running') then
    v_rule:=case
      when v_no_progress_loop then
        'The prior cognition was rejected because it repeated the same analysis/inspection action while requested=0 and durable deployment state remained FAILED. Repeating a promise to analyze is not progress. Choose your own next substantive step, but if it involves GitHub/Vercel inspection, mutation, configuration, or deployment, issue the matching capability_request_v0_1 in the same cognition.'
      when v_repo_conflict then
        'The prior cognition was rejected because it claimed repository/build-script changes without a successful GitHub runtime write after the latest failed deployment. No repository mutation is confirmed. Use an authorized GitHub capability request with the exact agent-authored files if you choose to modify the repository, and do not claim the edit succeeded until durable runtime state confirms it.'
      else
        'The prior cognition was rejected because it treated a FAILED deployment as retried/pending/succeeded without runtime evidence. Acknowledge the failure and autonomously choose a repair, investigation, implementation change, or a new runtime capability action before verification.'
    end;

    v_released:=agent_lab.release_wake_request(p_intent_execution_id,v_error,5,8);

    if v_released then
      update agent_lab.wake_queue
      set payload=coalesce(payload,'{}'::jsonb)||jsonb_build_object(
            case when v_no_progress_loop then 'no_progress_repair' else 'authoritative_state_reconciliation' end,
            jsonb_build_object(
              'required',true,
              'production_deployment_state','FAILED',
              'repository_mutation_confirmed',case when v_repo_conflict then false else null end,
              'prior_action_repetition_blocked',v_no_progress_loop,
              'rule',v_rule,
              'runtime_does_not_choose_repair',true
            )
          ),
          metadata=(coalesce(metadata,'{}'::jsonb)
            -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
            -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
            ||jsonb_build_object(
              'failure_class',case
                when v_no_progress_loop then 'no_progress_external_action_loop'
                when v_repo_conflict then 'authoritative_repository_state_conflict'
                else 'authoritative_external_state_conflict'
              end,
              'reconciliation_retry_at',now(),
              'lifecycle_degradation_suppressed',true
            )
      where wake_request_id=p_intent_execution_id and status='queued';

      update agent_lab.autonomous_lifecycle_runs
      set status='running',
          next_wake_at=(select due_at from agent_lab.wake_queue where wake_request_id=p_intent_execution_id),
          last_error=null,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
            'last_reconciliation_conflict_at',now(),
            'last_reconciliation_conflict_wake_request_id',p_intent_execution_id,
            'authoritative_external_state_guard','v0_3',
            'no_progress_loop_guard','v0_1'
          ),
          updated_at=now()
      where agent_id=v_agent_id;

      update agent_lab.state
      set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
            'wake_pending',true,'intent_pending',true,
            'authoritative_state_reconciliation_pending',not v_no_progress_loop,
            'no_progress_repair_pending',v_no_progress_loop,
            'no_progress_repair_at',case when v_no_progress_loop then now() else null end,
            'authoritative_state_reconciliation_at',case when not v_no_progress_loop then now() else null end
          ),
          updated_at=now()
      where agent_id=v_agent_id;
    end if;

    return jsonb_build_object(
      'intent_execution_id',p_intent_execution_id,'agent_id',v_agent_id,
      'status',case when v_released then 'retry_released' else 'not_released' end,
      'failure_class',case
        when v_no_progress_loop then 'no_progress_external_action_loop'
        when v_repo_conflict then 'authoritative_repository_state_conflict'
        else 'authoritative_external_state_conflict'
      end,
      'retry_scheduled',v_released,'lifecycle_degraded',false,
      'protocol_version','next_intent_protocol_v0_1'
    );
  end if;

  v_semantic:=
       v_error ilike '%stage_contract_incomplete%'
    or v_error ilike '%mandatory_embodiment_%'
    or v_error ilike '%identity_stage_requires_public_name%'
    or v_error ilike '%identity_stage_public_name_not_human_aligned%'
    or v_error ilike '%stage_action_alignment%'
    or v_error ilike '%attention_resolution_contract_incomplete%';

  if v_semantic and v_status in ('claimed','running') then
    update agent_lab.wake_queue
       set status='failed',completed_at=coalesce(completed_at,now()),last_error=v_error,worker_id=null,
           metadata=(coalesce(metadata,'{}'::jsonb)
             -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue'
             -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by')
             ||jsonb_build_object('repair_required',true,'failure_class','semantic_contract','repair_required_at',now(),'protocol_version','next_intent_protocol_v0_1')
     where wake_request_id=p_intent_execution_id;

    update agent_lab.autonomous_lifecycle_runs
       set status='paused',next_wake_at=null,last_error=v_error,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('repair_required',true,'repair_reason','semantic_contract_failure','repair_required_at',now()),
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.agent_existence_accounts
       set account_state='suspended',levy_enabled=false,
           metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('suspended_reason','semantic_contract_failure','suspended_at',now(),'resume_rule','restart_next_due_from_resume_time'),
           updated_at=now()
     where agent_id=v_agent_id;

    update agent_lab.state
       set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object('system_paused',true,'repair_pause_reason','semantic_contract_failure','intent_pending',false,'awake',false,'sleeping',false),
           updated_at=now()
     where agent_id=v_agent_id;

    return jsonb_build_object('intent_execution_id',p_intent_execution_id,'agent_id',v_agent_id,'status','repair_required','failure_class','semantic_contract','retry_scheduled',false,'existence_suspended',true,'protocol_version','next_intent_protocol_v0_1');
  end if;

  v_released:=public.aau_bridge_fail_nvidia_experimental_wake(p_bridge_token,p_intent_execution_id,v_error);

  return jsonb_build_object('intent_execution_id',p_intent_execution_id,'agent_id',v_agent_id,
    'status',case when v_released then 'retry_released' else 'not_released' end,
    'failure_class','transient_or_unclassified','retry_scheduled',v_released,'protocol_version','next_intent_protocol_v0_1');
end
$function$;

commit;
