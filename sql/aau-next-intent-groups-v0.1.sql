-- AAU next-intent group v0.1 — initial rollout September 19, 2026.

-- One group per cognition, one fallback time intent; only allowlisted independent existing operations.

-- Trigger-based reconciliation preserves original per-member proof and never wakes a paused agent.

-- Re-apply in a transaction. This migration intentionally does not reset any agent or grant compute.

begin;

create table if not exists agent_lab.intent_group_executions (
 intent_group_execution_id uuid primary key default extensions.gen_random_uuid(),
 agent_id uuid not null,
 wake_request_id uuid not null,
 group_key text not null,
 declared_members jsonb not null,
 member_results jsonb not null default '[]'::jsonb,
 status text not null default 'declared'
  check (status in ('declared','completed','awaiting_external','partial','blocked')),
 continuation text not null default 'on_result_or_blocker',
 fallback_after_minutes integer not null default 5,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(agent_id,wake_request_id,group_key)
);

create index if not exists ix_intent_group_executions_agent_recent on agent_lab.intent_group_executions(agent_id,created_at desc);

revoke all on agent_lab.intent_group_executions from public,anon,authenticated;

-- agent_lab.validate_next_intent_group_v0_1
CREATE OR REPLACE FUNCTION agent_lab.validate_next_intent_group_v0_1(p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
 v_group jsonb;
 v_item jsonb;
 v_count integer:=0;
 v_member_count integer:=0;
 v_member jsonb;
 v_member_id text;
 v_action text;
 v_seen text[]:='{}';
 v_seen_actions text[]:='{}';
begin
 if jsonb_typeof(p_value)<>'array' then raise exception 'next_intents_array_required'; end if;
 for v_item in select value from jsonb_array_elements(p_value) loop
   if v_item->>'intent_kind'<>'group' then continue; end if;
   v_count:=v_count+1;
   if v_count>1 then raise exception 'at_most_one_intent_group_per_cognition'; end if;
   v_group:=v_item;
 end loop;
 if v_count=0 then return null; end if;
 if length(coalesce(v_group->>'group_id',''))<2 or length(v_group->>'group_id')>80
    or v_group->>'group_id' !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$' then
   raise exception 'intent_group_invalid_group_id';
 end if;
 if coalesce(v_group->>'execution','independent_members_together')<>'independent_members_together'
    or coalesce(v_group->>'continuation','on_result_or_blocker')<>'on_result_or_blocker' then
   raise exception 'intent_group_unsupported_execution_or_continuation';
 end if;
 if coalesce(v_group->>'fallback_after_minutes','5')<>'5' then
   raise exception 'intent_group_fallback_must_be_five_minutes';
 end if;
 if jsonb_typeof(v_group->'members')<>'array' then
   raise exception 'intent_group_members_array_required';
 end if;
 v_member_count:=jsonb_array_length(v_group->'members');
 if v_member_count<1 or v_member_count>4 then
   raise exception 'intent_group_requires_one_to_four_members';
 end if;
 for v_member in select value from jsonb_array_elements(v_group->'members') loop
   if jsonb_typeof(v_member)<>'object' then raise exception 'intent_group_member_object_required'; end if;
   v_member_id:=v_member->>'id';
   v_action:=v_member->>'action';
   if v_member_id is null or length(v_member_id)>64 or v_member_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]*$'
      or v_member_id=any(v_seen) then raise exception 'intent_group_member_id_invalid_or_duplicate'; end if;
   if v_action is null or v_action not in (
     'request_existence_renewal','request_product_test_execution',
     'review_independent_test_result','inspect_resource_state'
   ) then raise exception 'intent_group_action_not_supported:%',coalesce(v_action,'NULL'); end if;
   if v_action=any(v_seen_actions) then raise exception 'intent_group_duplicate_action:%',v_action; end if;
   if v_member ? 'depends_on' and v_member->'depends_on'<>'[]'::jsonb then
     raise exception 'intent_group_v0_1_supports_only_independent_members';
   end if;
   v_seen:=array_append(v_seen,v_member_id);
   v_seen_actions:=array_append(v_seen_actions,v_action);
 end loop;
 return v_group;
end
$function$



-- agent_lab.normalize_next_intents_v0_1
CREATE OR REPLACE FUNCTION agent_lab.normalize_next_intents_v0_1(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
 v_result jsonb:=coalesce(p_result,'{}'::jsonb);
 v_intents jsonb;
 v_legacy jsonb:='[]'::jsonb;
 v_item jsonb;
 v_group jsonb;
 v_kind text;
begin
 v_intents:=v_result->'next_intents';
 if jsonb_typeof(v_intents)='array' then
   v_group:=agent_lab.validate_next_intent_group_v0_1(v_intents);
   for v_item in select value from jsonb_array_elements(v_intents) loop
     v_kind:=coalesce(v_item->>'intent_kind',v_item->>'wake_kind');
     if v_kind='group' then
       continue; -- group is executed during this cognition, never scheduled as a fake future wake
     end if;
     if v_kind='time' and v_group is not null then
       continue; -- exactly one fallback time intent for the entire group
     end if;
     v_legacy:=v_legacy||jsonb_build_array(jsonb_build_object(
       'wake_kind',v_kind,
       'after_minutes',case when v_kind='time' then '5'::jsonb else v_item->'after_minutes' end,
       'trigger_type',v_item->>'trigger_type',
       'trigger_payload',coalesce(v_item->'trigger_payload','{}'::jsonb),
       'reason',coalesce(v_item->>'intent_reason',v_item->>'reason'),
       'priority',coalesce(v_item->'priority','0.5'::jsonb),
       'estimated_cost',coalesce(v_item->'estimated_cost','0'::jsonb)
     ));
   end loop;
   if v_group is not null then
     v_legacy:=v_legacy||jsonb_build_array(jsonb_build_object(
       'wake_kind','time','after_minutes',5,
       'reason',coalesce(nullif(v_group->>'intent_reason',''),'Review group results and next independent steps.'),
       'priority',coalesce(v_group->'priority','0.5'::jsonb),'estimated_cost',0,
       'trigger_payload',jsonb_build_object('intent_group_id',v_group->>'group_id')
     ));
   end if;
   v_result:=jsonb_set(v_result,'{next_wakes}',v_legacy,true);
 end if;
 return v_result;
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
     v_response:=agent_lab.ensure_product_test_run_v0_2(p_agent_id);
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



-- agent_lab.refresh_intent_group_execution_v0_1
CREATE OR REPLACE FUNCTION agent_lab.refresh_intent_group_execution_v0_1(p_group_execution_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
 v_row agent_lab.intent_group_executions%rowtype;
 v_item jsonb;
 v_result jsonb;
 v_new jsonb:='[]'::jsonb;
 v_response jsonb;
 v_action text;
 v_next_status text;
 v_states text[]:='{}';
 v_group_status text;
 v_credit_status text;
 v_rid uuid;
 v_attention uuid;
 v_arb jsonb;
begin
 select * into v_row from agent_lab.intent_group_executions
 where intent_group_execution_id=p_group_execution_id for update;
 if not found then return jsonb_build_object('found',false); end if;
 if v_row.status<>'awaiting_external' then return jsonb_build_object('found',true,'status',v_row.status,'changed',false); end if;
 for v_item in select value from jsonb_array_elements(v_row.member_results) loop
   v_next_status:=v_item->>'status';
   v_response:=null;
   v_action:=v_item->>'action';
   if v_next_status='awaiting_external' then
     if v_action='request_existence_renewal' then
       begin v_rid:=(v_item#>>'{result,request_id}')::uuid;
       exception when others then v_rid:=null;
       end;
       select status into v_credit_status from agent_lab.existence_credit_requests
       where request_id=v_rid and agent_id=v_row.agent_id;
       if v_credit_status='executed' then
         v_next_status:='completed';
       elsif v_credit_status in ('denied','blocked') then
         v_next_status:='blocked';
       end if;
       v_response:=jsonb_build_object('current_request_status',v_credit_status);
     elsif v_action in ('review_independent_test_result','request_product_test_execution') then
       v_response:=agent_lab.get_product_test_run_context_v0_2(v_row.agent_id);
       if v_response->>'status'='VERIFIED_PASS' then
         v_next_status:='completed';
       elsif v_response->>'status' in ('VERIFIED_FAIL','ERROR','FAILED') then
         v_next_status:='blocked';
       end if;
     end if;
   end if;
   v_states:=array_append(v_states,v_next_status);
   v_result:=case when v_next_status is distinct from v_item->>'status' then
     v_item||jsonb_build_object('status',v_next_status,
       'resolution',v_response,'resolved_at',now())
     else v_item end;
   v_new:=v_new||jsonb_build_array(v_result);
 end loop;
 v_group_status:=case
    when 'awaiting_external'=any(v_states) then 'awaiting_external'
    when 'blocked'=any(v_states) and 'completed'=any(v_states) then 'partial'
    when 'blocked'=any(v_states) then 'blocked'
    when 'awaiting_external'=any(v_states) then 'awaiting_external'
    else 'completed' end;
 if v_new is distinct from v_row.member_results or v_group_status<>v_row.status then
   update agent_lab.intent_group_executions
   set member_results=v_new,status=v_group_status,updated_at=now()
   where intent_group_execution_id=p_group_execution_id;
 end if;
 if v_group_status<>v_row.status and v_group_status in ('completed','blocked','partial')
   and exists(select 1 from agent_lab.autonomous_lifecycle_runs
     where agent_id=v_row.agent_id and status='running') then
   begin
   v_attention:=agent_lab.enqueue_attention_item_v0_1(
     v_row.agent_id,'system_event',p_group_execution_id::text,'intent_group_result',
     0.78,0.82,0.55,0,0,1,'boundary',
     jsonb_build_object('intent_group_execution_id',p_group_execution_id,
       'group_id',v_row.group_key,'status',v_group_status,
       'member_results',v_new),
     jsonb_build_object('origin','intent_group_result_v0_1')
   );
   v_arb:=agent_lab.arbitrate_attention_v0_1(v_row.agent_id);
   exception when others then
     v_arb:=jsonb_build_object('status','failed','reason',left(sqlerrm,250));
   end;
 end if;
 return jsonb_build_object('found',true,'status',v_group_status,
   'changed',v_group_status<>v_row.status,'member_results',v_new,
   'attention_item_id',v_attention,'attention_arbiter',v_arb);
end
$function$



-- agent_lab.refresh_awaiting_intent_groups_after_external_result_v0_1
CREATE OR REPLACE FUNCTION agent_lab.refresh_awaiting_intent_groups_after_external_result_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_gid uuid;
begin
 if new.status is not distinct from old.status then return new; end if;
 for v_gid in
   select intent_group_execution_id from agent_lab.intent_group_executions
   where agent_id=new.agent_id and status='awaiting_external'
   order by created_at desc limit 15
 loop
   begin
     perform agent_lab.refresh_intent_group_execution_v0_1(v_gid);
   exception when others then
     raise warning 'intent_group_refresh_failed:%:%',v_gid,left(sqlerrm,250);
   end;
 end loop;
 return new;
end
$function$



-- agent_lab.build_next_intent_context_v0_1
CREATE OR REPLACE FUNCTION agent_lab.build_next_intent_context_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
select jsonb_build_object(
  'protocol_version','next_intent_protocol_v0_1',
  'timing_policy_version','intent_timing_v0_2',
  'minimum_time_intent_delay_minutes',5,
  'core_rule','An agent does not schedule an awakening. At the end of cognition it declares what it intends to do next; the runtime executes that intent when its timing or trigger condition is satisfied.',
  'required_output_key','next_intents',
  'group_contract',jsonb_build_object(
    'version','next_intent_group_v0_1',
    'max_groups_per_cognition',1,'max_members',4,
    'execution','independent_members_together',
    'continuation','on_result_or_blocker',
    'fallback_after_minutes',5,
    'supported_member_actions',jsonb_build_array('request_existence_renewal','request_product_test_execution','review_independent_test_result','inspect_resource_state'),
    'rule','Group members execute as independent authorized operations in this cognition, never as multiple wakeups. Grouped external requests retain their separate approval and result states. Only one fallback time intent is generated.'),
  'recent_group_executions',coalesce((select jsonb_agg(g.obj order by g.created_at desc) from (
    select created_at,jsonb_build_object('group_id',group_key,'status',status,'member_results',member_results,'created_at',created_at) obj
    from agent_lab.intent_group_executions where agent_id=p_agent_id order by created_at desc limit 3
  ) g),'[]'::jsonb),
  'intent_kinds',jsonb_build_array('time','event','condition','group'),
  'awake_continuity','While sleep is not eligible, an extended idle intent is invalid; a time-based continuation intent executes at the minimum supported five-minute interval.',
  'sleep_boundary','Sleep remains a separate homeostatic state and is not represented by the absence of an intent.',
  'canonical_terms',jsonb_build_object(
    'next_intent_id','persistent declaration identifier',
    'intent_execution_id','one execution attempt of an intent',
    'intent_kind','time, event, or condition',
    'execute_at','time intent due timestamp',
    'intent_execution_count','completed cognition/intent executions'
  )
);
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
      'product_service_test',v_product_service,
      'product_service_evaluation_mode',
      case when v_has_product_submission then 'submission_triggered' else 'skipped_no_submission' end
    );
end
$function$



drop trigger if exists trg_refresh_intent_groups_product_test_v0_1 on agent_lab.product_test_runs;

create trigger trg_refresh_intent_groups_product_test_v0_1 after update of status on agent_lab.product_test_runs for each row execute function agent_lab.refresh_awaiting_intent_groups_after_external_result_v0_1();

drop trigger if exists trg_refresh_intent_groups_credit_v0_1 on agent_lab.existence_credit_requests;

create trigger trg_refresh_intent_groups_credit_v0_1 after update of status on agent_lab.existence_credit_requests for each row execute function agent_lab.refresh_awaiting_intent_groups_after_external_result_v0_1();

commit;