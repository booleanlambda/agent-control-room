-- Allow actual research, honest evidence gaps, and proposal submission in mandatory Stage 3.
-- Only an operator-approved exact-domain proposal requires immediate artifact initiation.
CREATE OR REPLACE FUNCTION agent_lab.apply_cognition_result_with_identity_clock(p_wake_request_id uuid, p_result jsonb, p_runtime jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_applied jsonb; v_agent_id uuid; v_activity_id uuid; v_cognition_run_id uuid; v_embodiment_result jsonb; v_existence_credit_result jsonb; v_expertise_requests jsonb:='[]'::jsonb; v_expertise_result jsonb; v_application_result jsonb; v_lifecycle_result jsonb; v_file_result jsonb; v_attention_result jsonb; v_knowledge_result jsonb:='{}'::jsonb; v_knowledge_enabled boolean:=false; v_stage text; v_req jsonb; v_complete_count integer:=0; v_runtime jsonb; v_result jsonb; v_admin_chat boolean:=false; v_attention_interrupt boolean:=false;
begin
  select coalesce((metadata->>'knowledge_pool_enabled')::boolean,false)
    into v_knowledge_enabled from agent_lab.runtime_config where config_id=1;
  v_result:=coalesce(p_result,'{}'::jsonb); v_runtime:=coalesce(p_runtime,'{}'::jsonb)||jsonb_build_object('compute_cost',0,'research_cost',0,'economic_cost_policy','existence_time_only_v0_1','wake_cognition_compute_charge',0,'wake_cognition_research_charge',0);
  select q.agent_id,coalesce((q.metadata->>'admin_chat')::boolean,false),coalesce((q.metadata->>'attention_arbiter')::boolean,false) into v_agent_id,v_admin_chat,v_attention_interrupt from agent_lab.wake_queue q where q.wake_request_id=p_wake_request_id;
  if v_admin_chat then if nullif(btrim(coalesce(v_result->'outbound_message'->>'message','')),'') is null then raise exception 'ADMIN_CHAT_REPLY_REQUIRED: direct administrator chat wakes must return a nonempty outbound_message.message'; end if; v_result:=jsonb_set(v_result,'{outbound_message,target_agent_id}',to_jsonb('admin_control_room'::text),true); end if;
  if v_agent_id is not null then
    v_stage:=agent_lab.current_mandatory_lifecycle_stage(v_agent_id); v_expertise_requests:=agent_lab.extract_expertise_artifact_initiations(v_result);
    if not v_attention_interrupt and v_stage='expertise_artifact'
      and exists(
        select 1 from agent_lab.expertise_economic_proposals ep
        where ep.agent_id=v_agent_id and ep.status='approved'
      ) then
      if jsonb_typeof(v_expertise_requests)='array' then for v_req in select value from jsonb_array_elements(v_expertise_requests) loop if nullif(trim(coalesce(v_req->>'domain','')),'') is not null and nullif(trim(coalesce(v_req->>'target_standard','')),'') is not null and jsonb_typeof(v_req->'scope')='object' and v_req->'scope'<>'{}'::jsonb and jsonb_typeof(v_req->'competencies')='array' and jsonb_array_length(v_req->'competencies')>0 and jsonb_typeof(v_req->'evidence_requirements')='object' and v_req->'evidence_requirements'<>'{}'::jsonb and jsonb_typeof(v_req->'verification_plan')='object' and v_req->'verification_plan'<>'{}'::jsonb and coalesce((agent_lab.validate_expertise_application_v0_1(v_req->'intended_application',v_req->'economic_viability')->>'ok')::boolean,false) then v_complete_count:=v_complete_count+1; end if; end loop; end if;
      if v_complete_count=0 then raise exception 'MANDATORY_EXPERTISE_ARTIFACT_INCOMPLETE: Stage 3 requires associations[] with origin=expertise_artifact_initiation_v0_1 and nonempty domain,target_standard,scope,competencies,evidence_requirements,verification_plan,intended_application,economic_viability under expertise_application_v0_1'; end if;
    end if;
  end if;
  v_applied:=agent_lab.apply_cognition_result_with_identity_clock_pre_embodiment_v0_1(p_wake_request_id,v_result,v_runtime);
  v_agent_id:=nullif(v_applied->>'agent_id','')::uuid; v_activity_id:=nullif(v_applied->>'activity_id','')::uuid; v_cognition_run_id:=nullif(v_applied->>'cognition_run_id','')::uuid;
  if v_agent_id is not null then
    v_existence_credit_result:=agent_lab.apply_existence_credit_request_decision(v_agent_id,v_activity_id,p_wake_request_id,v_result);
    v_embodiment_result:=agent_lab.apply_embodiment_development_update(v_agent_id,v_activity_id,v_cognition_run_id,p_wake_request_id,coalesce(v_result->'embodiment_update','{}'::jsonb));
    v_expertise_result:=agent_lab.apply_expertise_artifact_initiations(v_agent_id,p_wake_request_id,v_activity_id,v_expertise_requests);
    v_application_result:=agent_lab.apply_expertise_application_updates_v0_1(v_agent_id,v_activity_id,coalesce(v_result->'associations','[]'::jsonb));
    v_file_result:=agent_lab.register_agent_file_outputs_v0_1(v_agent_id,v_activity_id,v_cognition_run_id,p_wake_request_id,coalesce(v_result->'associations','[]'::jsonb));
    v_lifecycle_result:=agent_lab.refresh_mandatory_lifecycle_state(v_agent_id);
    v_attention_result:=agent_lab.finalize_attention_after_cognition_v0_1(v_agent_id,p_wake_request_id,v_result);
    if v_knowledge_enabled then
      v_knowledge_result:=agent_lab.commit_knowledge_pool_wake_v0_1(
        v_agent_id,p_wake_request_id,v_activity_id,v_result
      );
    end if;
  else
    v_existence_credit_result:=jsonb_build_object('status','skipped','reason','agent_id_missing'); v_embodiment_result:=jsonb_build_object('status','skipped','reason','agent_id_missing'); v_expertise_result:=jsonb_build_object('applied',0,'results','[]'::jsonb,'reason','agent_id_missing'); v_application_result:=jsonb_build_object('updated',0,'results','[]'::jsonb); v_file_result:=jsonb_build_object('created',0,'files','[]'::jsonb); v_lifecycle_result:=jsonb_build_object('enrolled',false,'reason','agent_id_missing'); v_attention_result:=jsonb_build_object('status','skipped','reason','agent_id_missing');
  end if;
  return coalesce(v_applied,'{}'::jsonb)||jsonb_build_object('existence_credit_request',coalesce(v_existence_credit_result,'{}'::jsonb),'existence_credit_runtime_version','existence_credit_v0_1','embodiment_development',coalesce(v_embodiment_result,'{}'::jsonb),'embodiment_runtime_version','embodiment_runtime_v0_1','expertise_artifact_initiation',coalesce(v_expertise_result,'{}'::jsonb),'expertise_artifact_runtime_version','expertise_artifact_initiation_v0_1','expertise_application_updates',coalesce(v_application_result,'{}'::jsonb),'expertise_application_contract_version','expertise_application_v0_1','agent_file_outputs',coalesce(v_file_result,'{}'::jsonb),'file_channel_version','agent_file_channel_v0_1','attention_arbiter',coalesce(v_attention_result,'{}'::jsonb),'attention_arbiter_version','attention_arbiter_v0_1','attention_interrupt_lifecycle_exemption',v_attention_interrupt,'admin_chat_reply_gate','admin_chat_reply_required_v0_2','mandatory_lifecycle',coalesce(v_lifecycle_result,'{}'::jsonb),'mandatory_lifecycle_refresh_version','post_cognition_refresh_v0_2','economic_cost_policy','existence_time_only_v0_1','wake_cognition_compute_charge',0,'knowledge_pool_update',v_knowledge_result,'knowledge_pool_version',case when v_knowledge_enabled then 'knowledge_pool_v0_1' else 'disabled' end);
end;
$function$
;
