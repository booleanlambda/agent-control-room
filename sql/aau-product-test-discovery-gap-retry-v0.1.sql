-- AAU: exact-route discovery omission is a test-harness gap, not a demonstrated product failure.

-- Reexecute only when prior test had zero functional requests and omitted a previously runtime-verified canonical operation.

-- Preserve prior VERIFIED_FAIL, report and attempt count in retry_history; cap retry generations.

begin;

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
 v_discovery_gap boolean:=false;
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
 v_discovery_gap := v_run.status='verified_fail'
   and v_run.metrics#>>'{load,reason}'='execution_plan_not_executable'
   and coalesce((v_run.evidence->'execution_plan'->>'executable')::boolean,true)=false
   and jsonb_array_length(coalesce(v_run.evidence->'functional_results','[]'::jsonb))=0
   and not exists (select 1 from jsonb_array_elements(coalesce(v_run.evidence->'service_discovery','[]'::jsonb)) x
     where x->>'path'=v_eligibility#>>'{canonical_operation_evidence,operation_path}'
       and coalesce(x->>'method','GET')=v_eligibility#>>'{canonical_operation_evidence,operation_method}');
 if v_run.status<>'failed' and not v_discovery_gap then
   return v_eligibility||jsonb_build_object('disposition','existing_'||v_run.status,
     'retry_requested',false);
 end if;
 v_generation:=coalesce((v_run.metadata->>'retry_generation')::integer,0);
 if not v_discovery_gap and v_run.error_code<>'product_test_executor_error' then
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
       'retry_origin',case when p_activity_id is null then 'operator_runtime_harness_remediation_v0_1' else 'agent_explicit_request_v0_1' end,
       'retry_reason',case when v_discovery_gap then 'verified_operation_omitted_from_test_discovery' else 'executor_runtime_failure' end,
       'last_retry_requested_at',now()),
     updated_at=now()
 where product_test_run_id=v_run.product_test_run_id;
 return v_eligibility||jsonb_build_object('ok',true,'status','queued',
   'disposition','runtime_retry_enqueued','retry_requested',true,
   'retry_generation',v_generation+1,
   'prior_attempt_count',v_run.attempt_count,
   'previous_error_code',v_run.error_code,
   'harness_discovery_gap',v_discovery_gap);
end
$function$


commit;