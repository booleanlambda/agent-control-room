-- AAU independent-test retry: evidence-preserving, explicit agent dispatch, two bounded generations.

-- Original failed run preserved in retry_history before clearing current attempt; no bypass of frozen contract or live deployment evidence.

begin;

-- agent_lab.request_product_test_execution_v0_1
CREATE OR REPLACE FUNCTION agent_lab.request_product_test_execution_v0_1(p_agent_id uuid, p_activity_id uuid DEFAULT NULL::uuid, p_wake_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
 v_eligibility jsonb;
 v_run agent_lab.product_test_runs%rowtype;
 v_generation integer;
 v_history jsonb;
begin
 if agent_lab.current_mandatory_lifecycle_stage(p_agent_id)<>'product_service_test' then
   return jsonb_build_object('ok',false,'status','blocked','reason','product_service_stage_required');
 end if;
 v_eligibility:=agent_lab.ensure_product_test_run_v0_2(p_agent_id);
 if not coalesce((v_eligibility->>'ok')::boolean,false) then
   return v_eligibility||jsonb_build_object('status','blocked');
 end if;
 select * into v_run from agent_lab.product_test_runs
 where product_test_run_id=(v_eligibility->>'product_test_run_id')::uuid
 for update;
 if not found then raise exception 'eligible_product_test_run_missing'; end if;
 if v_run.status<>'failed' then
   return v_eligibility||jsonb_build_object('disposition','existing_'||v_run.status,
     'retry_requested',false);
 end if;
 v_generation:=coalesce((v_run.metadata->>'retry_generation')::integer,0);
 if v_run.error_code<>'product_test_executor_error' then
   return v_eligibility||jsonb_build_object('ok',false,'status','blocked',
     'reason','only_runtime_executor_failure_retryable','previous_error_code',v_run.error_code);
 end if;
 if v_generation>=2 then
   return v_eligibility||jsonb_build_object('ok',false,'status','blocked',
     'reason','runtime_retry_limit_reached','retry_generation',v_generation);
 end if;
 v_history:=coalesce(v_run.metadata->'retry_history','[]'::jsonb);
 v_history:=v_history||jsonb_build_array(jsonb_build_object(
   'previous_attempt_count',v_run.attempt_count,
   'previous_error_code',v_run.error_code,
   'previous_error_message',v_run.error_message,
   'previous_status',v_run.status,
   'previous_started_at',v_run.started_at,
   'previous_evidence',v_run.evidence,
   'previous_metrics',v_run.metrics,
   'previous_final_report',v_run.final_report,
   'retry_requested_at',now(),
   'source_activity_id',p_activity_id,
   'source_wake_request_id',p_wake_request_id
 ));
 update agent_lab.product_test_runs
 set status='queued',attempt_count=0,executor_id=null,started_at=null,completed_at=null,
     error_code=null,error_message=null,evidence='{}'::jsonb,metrics='{}'::jsonb,final_report='{}'::jsonb,
     metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
       'retry_generation',v_generation+1,
       'retry_history',v_history,
       'retry_origin','agent_explicit_request_v0_1',
       'last_retry_requested_at',now()),
     updated_at=now()
 where product_test_run_id=v_run.product_test_run_id;
 return v_eligibility||jsonb_build_object('ok',true,'status','queued',
   'disposition','runtime_retry_enqueued','retry_requested',true,
   'retry_generation',v_generation+1,
   'prior_attempt_count',v_run.attempt_count,
   'previous_error_code',v_run.error_code);
end
$function$


-- public.aau_bridge_apply_nvidia_intent_execution
CREATE OR REPLACE FUNCTION public.aau_bridge_apply_nvidia_intent_execution(p_bridge_token text, p_intent_execution_id uuid, p_result jsonb, p_runtime jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_applied jsonb;
  v_product_service jsonb:=jsonb_build_object('status','not_submitted_this_cognition');
  v_stage text;
  v_dep_state text:='';
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
  v_has_product_submission boolean:=false;
  v_test_dispatch jsonb:=jsonb_build_object('requested',false,'status','not_requested');
  v_group_result jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select q.agent_id into v_agent_id
  from agent_lab.wake_queue q
  where q.wake_request_id=p_intent_execution_id;
  if v_agent_id is null then raise exception 'intent_execution_not_found'; end if;

  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states
  where agent_id=v_agent_id;

  select exists(
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_result->'associations','[]'::jsonb))='array'
           then coalesce(p_result->'associations','[]'::jsonb)
           else '[]'::jsonb end
    ) a
    where a->>'origin'='product_service_test_submission_v0_1'
  ) into v_has_product_submission;

  if v_stage='product_service_test' then
    select t.construct_id into v_construct_id
    from agent_lab.product_service_tests t
    where t.agent_id=v_agent_id
      and t.protocol_version='product_service_test_v0_1'
    limit 1;

    if v_construct_id is not null then
      select
        case
          when j.status='failed' then 'FAILED'
          when j.status='succeeded' then upper(coalesce(
            j.result_payload->'deployment'->>'readyState',
            j.result_payload->'deployment'->>'status',
            j.result_payload->>'ready_state',
            j.result_payload->>'status',
            'SUCCEEDED'
          ))
          else upper(coalesce(j.status,''))
        end
      into v_dep_state
      from agent_lab.infrastructure_broker_jobs j
      join agent_lab.infrastructure_broker_requests r
        on r.broker_request_id=j.broker_request_id
      where j.construct_id=v_construct_id
        and j.provider='vercel'
        and r.resource_type='deployment'
        and r.operation='deploy'
      order by j.created_at desc
      limit 1;

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
    end if;

    select lower(trim(coalesce(s.state_payload->>'last_action',''))),
           coalesce((s.state_payload->'last_capability_request_feedback'->>'requested')::integer,0)
      into v_last_action,v_prior_requested
    from agent_lab.state s
    where s.agent_id=v_agent_id;

    select count(*)
      into v_cap_request_count
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_result->'associations','[]'::jsonb))='array'
           then coalesce(p_result->'associations','[]'::jsonb)
           else '[]'::jsonb end
    ) a
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

    if v_construct_id is not null then
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

  -- Validate the entire batch before the legacy executor may write anything.
  perform agent_lab.validate_next_intent_group_v0_1(coalesce(p_result->'next_intents','[]'::jsonb));
  v_applied:=public.aau_bridge_apply_nvidia_intent_execution_pre_eoa_v0_1(
    p_bridge_token,p_intent_execution_id,p_result,
    coalesce(p_runtime,'{}'::jsonb)||jsonb_build_object(
      'evidence_of_action_mode','optional_submission_v0_1',
      'product_service_test_contract','product_service_test_v0_1',
      'authoritative_external_state_commit_guard','v0_4_direct_state',
      'no_progress_loop_guard','v0_1'
    )
  );

  if v_action='request_product_test_execution' then
    v_test_dispatch:=agent_lab.request_product_test_execution_v0_1(
      v_agent_id,nullif(v_applied->>'activity_id','')::uuid,p_intent_execution_id
    );
  end if;
  if v_has_product_submission then
    v_product_service:=agent_lab.apply_product_service_test_submission_v0_1(
      v_agent_id,coalesce(p_result->'associations','[]'::jsonb)
    );
    perform agent_lab.refresh_mandatory_lifecycle_state(v_agent_id);
  end if;

  -- Members are agent-declared; the runtime executes only allowlisted existing operations.
  v_group_result:=agent_lab.execute_next_intent_group_v0_1(
    v_agent_id,p_intent_execution_id,nullif(v_applied->>'activity_id','')::uuid,p_result
  );
  return coalesce(v_applied,'{}'::jsonb)
    || jsonb_build_object(
      'intent_group_execution',v_group_result,
      'product_test_execution_dispatch',v_test_dispatch,
      'product_service_test',v_product_service,
      'product_service_evaluation_mode',
      case when v_has_product_submission then 'submission_triggered' else 'skipped_no_submission' end
    );
end
$function$


-- agent_lab.execute_next_intent_group_v0_1
CREATE OR REPLACE FUNCTION agent_lab.execute_next_intent_group_v0_1(p_agent_id uuid, p_wake_request_id uuid, p_activity_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
 v_group jsonb;
 v_member jsonb;
 v_action text;
 v_response jsonb;
 v_result jsonb;
 v_results jsonb:='[]'::jsonb;
 v_state text;
 v_states text[]:='{}';
 v_gid uuid;
 v_status text;
begin
 v_group:=agent_lab.validate_next_intent_group_v0_1(coalesce(p_result->'next_intents','[]'::jsonb));
 if v_group is null then return jsonb_build_object('declared',false,'status','none'); end if;
 if not exists(select 1 from agent_lab.wake_queue q where q.wake_request_id=p_wake_request_id and q.agent_id=p_agent_id) then
   raise exception 'intent_group_agent_wake_mismatch';
 end if;
 select intent_group_execution_id,member_results,status into v_gid,v_results,v_status
 from agent_lab.intent_group_executions
 where agent_id=p_agent_id and wake_request_id=p_wake_request_id and group_key=v_group->>'group_id';
 if v_gid is not null then
   return jsonb_build_object('declared',true,'idempotent_replay',true,
    'intent_group_execution_id',v_gid,'status',v_status,'member_results',v_results);
 end if;
 insert into agent_lab.intent_group_executions
  (agent_id,wake_request_id,group_key,declared_members,status)
 values (p_agent_id,p_wake_request_id,v_group->>'group_id',v_group->'members','declared')
 returning intent_group_execution_id into v_gid;
 v_results:='[]'::jsonb;
 for v_member in select value from jsonb_array_elements(v_group->'members') loop
   v_action:=v_member->>'action';
   begin
   if v_action='request_existence_renewal' then
     v_response:=agent_lab.submit_existence_credit_request(
       p_agent_id,'renewal',null,null,
       coalesce(nullif(v_member->>'reason',''),p_result->>'stated_reason'),
       p_activity_id,p_wake_request_id
     );
     v_state:=case when v_response->>'status' in ('pending','duplicate_pending') then 'awaiting_external'
       when v_response->>'status' in ('executed','approved') then 'completed' else 'blocked' end;
   elsif v_action='request_product_test_execution' then
     if agent_lab.current_mandatory_lifecycle_stage(p_agent_id)<>'product_service_test' then
       raise exception 'product_test_group_member_requires_product_service_stage';
     end if;
     v_response:=agent_lab.request_product_test_execution_v0_1(p_agent_id,p_activity_id,p_wake_request_id);
     v_state:=case when coalesce((v_response->>'ok')::boolean,false)=false then 'blocked'
       when upper(coalesce(v_response->>'status','')) in ('VERIFIED_PASS','COMPLETED') then 'completed'
       when upper(coalesce(v_response->>'status','')) in ('VERIFIED_FAIL','ERROR','FAILED') then 'blocked'
       else 'awaiting_external' end;
   elsif v_action='review_independent_test_result' then
     v_response:=agent_lab.get_product_test_run_context_v0_2(p_agent_id);
     v_state:=case when v_response->>'status'='VERIFIED_PASS' then 'completed'
       when v_response->>'status' in ('VERIFIED_FAIL','ERROR','FAILED') then 'blocked'
       when v_response->>'status' in ('RUNNING','QUEUED','PENDING') then 'awaiting_external'
       else 'blocked' end;
   elsif v_action='inspect_resource_state' then
     v_response:=agent_lab.build_existence_context(p_agent_id);
     v_state:='completed';
   else
     raise exception 'unvalidated_intent_group_action';
   end if;
   exception when others then
     v_state:='blocked';
     v_response:=jsonb_build_object('ok',false,'error_code','INTENT_GROUP_MEMBER_RUNTIME_ERROR','message',left(sqlerrm,350));
   end;
   v_states:=array_append(v_states,v_state);
   v_results:=v_results||jsonb_build_array(jsonb_build_object(
     'id',v_member->>'id','action',v_action,'status',v_state,
     'result',v_response,'recorded_at',now()
   ));
 end loop;
 v_status:=case
   when 'awaiting_external'=any(v_states) then 'awaiting_external'
   when 'blocked'=any(v_states) and 'completed'=any(v_states) then 'partial'
   when 'blocked'=any(v_states) then 'blocked'
   when 'awaiting_external'=any(v_states) then 'awaiting_external'
   else 'completed' end;
 update agent_lab.intent_group_executions
 set member_results=v_results,status=v_status,updated_at=now()
 where intent_group_execution_id=v_gid;
 return jsonb_build_object('declared',true,'intent_group_execution_id',v_gid,
   'group_id',v_group->>'group_id','status',v_status,
   'member_results',v_results,
   'continuation','on_result_or_blocker','fallback_after_minutes',5);
end
$function$


commit;