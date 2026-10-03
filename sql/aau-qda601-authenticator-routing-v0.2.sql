-- QDA-601 authenticator remediation handoff v0.2
-- Keep one stable cognition assignment across repeated independent-review failures
-- for the same unit, and allow a completed semantic epoch to reopen only when
-- the latest independent authenticator has explicitly rejected that unit.
begin;

create or replace function public.aau_bridge_complete_qda601_authenticator_review(
 p_bridge_token text,p_review_id uuid,p_executor_id text,p_model_returned text,p_score numeric,p_verdict text,p_report jsonb
) returns jsonb language plpgsql security definer
set search_path to 'pg_catalog','public','agent_lab' as $function$
declare
 v agent_lab.qda601_authenticator_reviews%rowtype;
 v_action_unit text;
 v_existing_unit text;
 v_existing_anchor text;
 v_active_remediation agent_lab.cognition_remediation_episodes%rowtype;
begin
 perform agent_lab.assert_broker_bridge_token(p_bridge_token);
 select * into v from agent_lab.qda601_authenticator_reviews where review_id=p_review_id for update;
 if not found then raise exception 'qda_authenticator_review_not_found'; end if;
 if v.status<>'claimed' then raise exception 'qda_authenticator_review_not_claimed'; end if;
 if v.claimed_by is distinct from p_executor_id then raise exception 'qda_authenticator_claim_owner_mismatch'; end if;
 if p_verdict not in ('verified_pass','verified_fail') then raise exception 'qda_authenticator_verdict_invalid'; end if;
 if p_score is null or p_score<0 or p_score>1 then raise exception 'qda_authenticator_score_invalid'; end if;
 if p_report is null or jsonb_typeof(p_report)<>'object' or octet_length(p_report::text)>30000 then
   raise exception 'qda_authenticator_report_invalid';
 end if;

 v_action_unit:=regexp_replace(
   regexp_replace(upper(v.unit_code),'-M0*([0-9]+)','-M\1'),
   '-U0*([0-9]+)','-U\1'
 );

 update agent_lab.qda601_authenticator_reviews set
   status='completed',authenticator_model_returned=p_model_returned,
   score=p_score,verdict=p_verdict,report=p_report,
   completed_at=now(),updated_at=now(),last_error=null
 where review_id=p_review_id returning * into v;

 update agent_lab.agent_files set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
   'qda601_authenticator_review_id',v.review_id,'qda601_authenticator_status',v.verdict,
   'qda601_authenticator_score',v.score,'qda601_authenticator_model',v.authenticator_model_returned,
   'qda601_authenticator_artifact_sha256',v.artifact_sha256),updated_at=now()
 where file_id=v.file_id;

 select state_payload->>'qda_601_remediation_unit',
        state_payload->>'qda_601_remediation_anchor_review_id'
 into v_existing_unit,v_existing_anchor
 from agent_lab.state
 where agent_id=v.agent_id
 for update;

 -- If a self-remediation episode was intentionally left at the independent
 -- authenticator boundary, this review is its authoritative final verifier.
 select * into v_active_remediation
 from agent_lab.cognition_remediation_episodes e
 where e.agent_id=v.agent_id
   and e.node_path='R'
   and e.repair_type='REBUILD_SYNTHESIS_FROM_RESOLVED_EVIDENCE'
   and e.status='verifying'
   and e.verification_result->>'verification_boundary'='POST_INDEPENDENT_AUTHENTICATOR'
 order by e.created_at desc
 limit 1
 for update;

 if found then
   update agent_lab.cognition_remediation_episodes
   set status=case when p_verdict='verified_pass' then 'succeeded' else 'failed' end,
       verification_result=coalesce(verification_result,'{}'::jsonb)||jsonb_build_object(
         'status',case when p_verdict='verified_pass' then 'VERIFIED' else 'FAILED' end,
         'independent_authenticator_review_id',v.review_id,
         'independent_authenticator_file_id',v.file_id,
         'independent_authenticator_artifact_sha256',v.artifact_sha256,
         'independent_authenticator_score',v.score,
         'independent_authenticator_verdict',v.verdict,
         'independent_authenticator_report',p_report,
         'external_verification_completed_at',now()
       ),
       last_wake_request_id=coalesce(last_wake_request_id,source_wake_request_id),
       updated_at=now()
   where remediation_id=v_active_remediation.remediation_id;
 end if;

 if p_verdict='verified_pass' then
   update agent_lab.state
   set state_payload=(
       coalesce(state_payload,'{}'::jsonb)
       - 'qda_601_remediation_required'
       - 'qda_601_remediation_unit'
       - 'qda_601_remediation_reason'
       - 'qda_601_authenticator_failure_report'
       - 'qda_601_authenticator_failure_artifact_sha256'
       - 'qda_601_authenticator_failure_score'
       - 'qda_601_remediation_anchor_review_id'
       - 'qda_601_last_rejected_file_id'
     ) || jsonb_build_object(
       'last_action','qda601_complete_'||v_action_unit,
       'qda_601_last_verified_unit',v_action_unit,
       'qda_601_last_verified_review_id',v.review_id,
       'qda_601_last_verified_artifact_sha256',v.artifact_sha256,
       'qda_601_last_authenticator_review_id',v.review_id,
       'qda_601_last_authenticator_verdict',v.verdict,
       'qda_601_last_authenticator_unit',v_action_unit
     ),
     current_focus='QDA-601 '||v_action_unit||' independently verified; progression may advance to the next canonical unit.',
     updated_at=now()
   where agent_id=v.agent_id;
 else
   update agent_lab.state
   set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
       'last_action','qda601_submit_'||v_action_unit,
       'qda_601_remediation_required',true,
       'qda_601_remediation_unit',v_action_unit,
       'qda_601_remediation_reason','independent_authenticator_verified_fail',
       'qda_601_remediation_anchor_review_id',
         case
           when coalesce(v_existing_unit,'')=v_action_unit and coalesce(v_existing_anchor,'')<>''
             then v_existing_anchor
           else v.review_id::text
         end,
       'qda_601_last_rejected_file_id',v.file_id,
       'qda_601_last_authenticator_review_id',v.review_id,
       'qda_601_last_authenticator_verdict',v.verdict,
       'qda_601_last_authenticator_unit',v_action_unit,
       'qda_601_authenticator_failure_artifact_sha256',v.artifact_sha256,
       'qda_601_authenticator_failure_score',v.score,
       'qda_601_authenticator_failure_report',p_report
     ),
     current_focus='QDA-601 '||v_action_unit||' failed independent verification; remediate the rejected artifact using preserved verified unit evidence before progression.',
     updated_at=now()
   where agent_id=v.agent_id;
 end if;

 return jsonb_build_object(
   'ok',true,'review_id',v.review_id,'unit_code',v.unit_code,'action_unit',v_action_unit,
   'verdict',v.verdict,'score',v.score,'authenticator_model',v.authenticator_model_returned,
   'artifact_sha256',v.artifact_sha256,
   'remediation_episode_finalized',
     case when v_active_remediation.remediation_id is null then null else v_active_remediation.remediation_id end
 );
end
$function$;

revoke all on function public.aau_bridge_complete_qda601_authenticator_review(
  text,uuid,text,text,numeric,text,jsonb
) from public;
grant execute on function public.aau_bridge_complete_qda601_authenticator_review(
  text,uuid,text,text,numeric,text,jsonb
) to anon,authenticated;

create or replace function public.aau_bridge_reopen_qda_assignment_for_auth_review_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_assignment_key text,
  p_model text,
  p_review_id uuid,
  p_unit_code text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','public','extensions'
as $function$
declare
  v_bound text;
  v_state jsonb;
  v_review agent_lab.qda601_authenticator_reviews%rowtype;
  v_prev agent_lab.cognition_assignment_runtime%rowtype;
  v_next agent_lab.cognition_assignment_runtime%rowtype;
  v_unit text:=upper(btrim(coalesce(p_unit_code,'')));
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select primary_model_id into v_bound from agent_lab.agents where agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'qda_remediation_runtime_bound_model_mismatch';
  end if;

  if not exists(
    select 1 from agent_lab.wake_queue
    where agent_id=p_agent_id and wake_request_id=p_wake_request_id
      and status in ('running','claimed')
  ) then raise exception 'qda_remediation_runtime_wake_not_running'; end if;

  select state_payload into v_state
  from agent_lab.state where agent_id=p_agent_id for update;
  if coalesce((v_state->>'qda_601_remediation_required')::boolean,false)<>true
     or upper(coalesce(v_state->>'qda_601_remediation_unit',''))<>v_unit
     or coalesce(v_state->>'qda_601_remediation_reason','')<>'independent_authenticator_verified_fail'
     or coalesce(v_state->>'qda_601_last_authenticator_review_id','')<>p_review_id::text
  then raise exception 'qda_remediation_runtime_state_mismatch'; end if;

  select * into v_review from agent_lab.qda601_authenticator_reviews
  where review_id=p_review_id and agent_id=p_agent_id;
  if not found or v_review.verdict<>'verified_fail' or v_review.status<>'completed' then
    raise exception 'qda_remediation_runtime_review_not_verified_fail';
  end if;

  select * into v_prev
  from agent_lab.cognition_assignment_runtime
  where agent_id=p_agent_id and assignment_key=p_assignment_key and model_id=p_model
  order by epoch_no desc limit 1 for update;
  if not found then raise exception 'qda_remediation_runtime_prior_epoch_missing'; end if;

  if v_prev.status='active' then
    return jsonb_build_object(
      'status','ready','idempotent',true,'runtime_id',v_prev.runtime_id,
      'epoch_no',v_prev.epoch_no,'runtime_status',v_prev.status,
      'remaining_budget_units',v_prev.remaining_budget_units
    );
  end if;
  if v_prev.status<>'complete' then
    raise exception 'qda_remediation_runtime_requires_completed_epoch:%',v_prev.status;
  end if;

  insert into agent_lab.cognition_assignment_runtime(
    agent_id,assignment_key,model_id,epoch_no,budget_quantum_tokens,
    initial_budget_units,remaining_budget_units,status,metadata
  ) values (
    v_prev.agent_id,v_prev.assignment_key,v_prev.model_id,v_prev.epoch_no+1,
    v_prev.budget_quantum_tokens,v_prev.initial_budget_units,v_prev.initial_budget_units,
    'active',
    jsonb_build_object(
      'contract','qda_external_authenticator_remediation_epoch_v0_1',
      'renewal_reason','independent_authenticator_verified_fail',
      'authenticator_review_id',p_review_id,
      'unit_code',v_unit,
      'renewed_at',now(),
      'renewed_from_runtime_id',v_prev.runtime_id,
      'renewed_from_epoch_no',v_prev.epoch_no,
      'renewed_from_status',v_prev.status,
      'history_preserved',true
    )
  )
  returning * into v_next;

  update agent_lab.state
  set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
        'semantic_runtime_active_runtime_id',v_next.runtime_id,
        'semantic_runtime_active_epoch',v_next.epoch_no,
        'semantic_runtime_active_assignment_key',v_next.assignment_key,
        'qda_601_authenticator_remediation_epoch',v_next.epoch_no,
        'qda_601_authenticator_remediation_epoch_at',now()
      ),
      updated_at=now()
  where agent_id=p_agent_id;

  return jsonb_build_object(
    'status','ready','idempotent',false,'runtime_id',v_next.runtime_id,
    'epoch_no',v_next.epoch_no,'runtime_status',v_next.status,
    'initial_budget_units',v_next.initial_budget_units,
    'remaining_budget_units',v_next.remaining_budget_units,
    'history_preserved',true
  );
end
$function$;

revoke all on function public.aau_bridge_reopen_qda_assignment_for_auth_review_v0_1(
  text,uuid,uuid,text,text,uuid,text
) from public,authenticated,service_role;
grant execute on function public.aau_bridge_reopen_qda_assignment_for_auth_review_v0_1(
  text,uuid,uuid,text,text,uuid,text
) to anon;

drop function if exists public.aau_bridge_reopen_completed_cognition_assignment_for_qda_review(
  text,uuid,uuid,text,text,uuid,text
);

commit;
