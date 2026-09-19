-- AAU Product Build Access Bundle v0.1
-- Applied live 2026-09-19.
--
-- Purpose:
--   Give explicitly granted Product/Service Test agents construct-scoped tools
--   to inspect, repair, configure, deploy and diagnose their current offering.
--   Provider credentials remain broker-held and are never returned to agents.
--
-- This migration intentionally does NOT grant these capabilities to a specific
-- agent. Governance grants remain separate per-agent records.

begin;

insert into agent_lab.capability_definitions(
  capability_code,display_name,provider,route_mode,side_effect_level,
  durability_required,grant_required,autonomous_default,approval_policy,
  queue_name,timeout_class,retry_policy,idempotency_required,cost_class,
  execution_adapter,version,enabled,metadata
)
values
('github.repository.inspect','Inspect Construct GitHub Repository','github','async_broker','external',true,true,false,'policy',
 'aau.infrastructure.github','short','{"backoff":"exponential","max_attempts":3}'::jsonb,true,'low',
 'broker_bridge_github_inspect_v0_1','v0_1',true,
 '{"category":"infrastructure","resource_type":"repository","operation":"inspect","construct_required":true,"legal_gate_candidate":false,"legal_audit_required":true}'::jsonb),
('github.repository.write','Write Construct GitHub Repository','github','async_broker','external',true,true,false,'policy',
 'aau.infrastructure.github','medium','{"backoff":"exponential","max_attempts":3}'::jsonb,true,'low',
 'broker_bridge_github_write_v0_1','v0_1',true,
 '{"category":"infrastructure","resource_type":"repository","operation":"write","construct_required":true,"legal_gate_candidate":true,"legal_audit_required":true}'::jsonb),
('vercel.project.inspect','Inspect Construct Vercel Project','vercel','async_broker','external',true,true,false,'policy',
 'aau.infrastructure.vercel','short','{"backoff":"exponential","max_attempts":3}'::jsonb,true,'low',
 'broker_bridge_vercel_project_inspect_v0_1','v0_1',true,
 '{"category":"infrastructure","resource_type":"project","operation":"inspect","construct_required":true,"legal_gate_candidate":false,"legal_audit_required":true}'::jsonb),
('vercel.project.configure','Configure Construct Vercel Project','vercel','async_broker','external',true,true,false,'policy',
 'aau.infrastructure.vercel','medium','{"backoff":"exponential","max_attempts":3}'::jsonb,true,'low',
 'broker_bridge_vercel_project_configure_v0_1','v0_1',true,
 '{"category":"infrastructure","resource_type":"project","operation":"configure","construct_required":true,"legal_gate_candidate":true,"legal_audit_required":true}'::jsonb),
('vercel.deployment.inspect','Inspect Construct Vercel Deployment','vercel','async_broker','external',true,true,false,'policy',
 'aau.infrastructure.vercel','short','{"backoff":"exponential","max_attempts":3}'::jsonb,true,'low',
 'broker_bridge_vercel_deployment_inspect_v0_1','v0_1',true,
 '{"category":"infrastructure","resource_type":"deployment","operation":"inspect","construct_required":true,"legal_gate_candidate":false,"legal_audit_required":true}'::jsonb)
on conflict (capability_code) do update set
  display_name=excluded.display_name,
  provider=excluded.provider,
  route_mode=excluded.route_mode,
  side_effect_level=excluded.side_effect_level,
  durability_required=excluded.durability_required,
  grant_required=excluded.grant_required,
  approval_policy=excluded.approval_policy,
  queue_name=excluded.queue_name,
  timeout_class=excluded.timeout_class,
  retry_policy=excluded.retry_policy,
  idempotency_required=excluded.idempotency_required,
  cost_class=excluded.cost_class,
  execution_adapter=excluded.execution_adapter,
  version=excluded.version,
  enabled=true,
  metadata=excluded.metadata,
  updated_at=now();

alter table agent_lab.infrastructure_broker_requests
  drop constraint if exists infrastructure_broker_requests_operation_check;
alter table agent_lab.infrastructure_broker_requests
  add constraint infrastructure_broker_requests_operation_check
  check (operation = any(array[
    'create'::text,'configure'::text,'update'::text,'deploy'::text,
    'pause'::text,'resume'::text,'delete'::text,'attach'::text,'detach'::text,
    'inspect'::text,'write'::text
  ]));

do $$
begin
  if to_regprocedure('public.aau_materialize_infrastructure_broker_job_pre_product_build_access_v0_1(uuid,text)') is null
     and to_regprocedure('public.aau_materialize_infrastructure_broker_job(uuid,text)') is not null then
    execute 'alter function public.aau_materialize_infrastructure_broker_job(uuid,text) rename to aau_materialize_infrastructure_broker_job_pre_product_build_access_v0_1';
  end if;
end
$$;

CREATE OR REPLACE FUNCTION public.aau_route_capability_request(p_agent_id uuid, p_capability_code text, p_payload jsonb DEFAULT '{}'::jsonb, p_construct_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'agent_lab', 'code_bank', 'extensions'
AS $function$
declare
  v_stage text;
  v_offering_construct uuid;
begin
  v_stage:=agent_lab.current_mandatory_lifecycle_stage(p_agent_id);

  if v_stage='product_service_test'
     and p_capability_code in (
       'github.repository.create','github.repository.inspect','github.repository.write',
       'vercel.project.create','vercel.project.inspect','vercel.project.configure',
       'vercel.deployment.create','vercel.deployment.inspect'
     ) then
    select pst.construct_id into v_offering_construct
    from agent_lab.product_service_tests pst
    where pst.agent_id=p_agent_id
      and pst.protocol_version='product_service_test_v0_1'
      and pst.construct_id is not null
    order by pst.updated_at desc
    limit 1;

    if v_offering_construct is null then
      raise exception 'product_service_test_offering_construct_required';
    end if;
    if p_construct_id is distinct from v_offering_construct then
      raise exception 'product_service_test_capability_must_target_current_offering_construct';
    end if;
  end if;

  if v_stage not in ('open_autonomy','legacy_unenrolled') then
    if p_capability_code not in (
      'memory.read','memory.write','resource.balance.read','wake.schedule','intent.schedule','model.generate'
    )
    and not (
      v_stage in ('expertise_artifact','expertise_development')
      and p_capability_code='research.long_run'
    )
    and not (
      v_stage='product_service_test'
      and p_capability_code in (
        'github.repository.create',
        'github.repository.inspect',
        'github.repository.write',
        'vercel.project.create',
        'vercel.project.inspect',
        'vercel.project.configure',
        'vercel.deployment.create',
        'vercel.deployment.inspect'
      )
    )
    then
      raise exception 'mandatory_lifecycle_gate_blocks_capability:%:stage=%',p_capability_code,v_stage;
    end if;
  end if;

  return public.aau_route_capability_request_pre_lifecycle_v0_4(
    p_agent_id,p_capability_code,p_payload,p_construct_id,p_idempotency_key
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.build_agent_capability_surface(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'agent_lab', 'code_bank', 'pg_temp'
AS $function$
with gate as (
  select agent_lab.current_mandatory_lifecycle_stage(p_agent_id) stage
),
participant as (
  select p.participant_id
  from code_bank.participants p
  where p.source_namespace='agent_lab'
    and p.source_subject=p_agent_id::text
    and p.status='active'
  order by p.created_at asc
  limit 1
),
grants as (
  select distinct on (g.capability_code)
    g.capability_code,g.capability_grant_id,g.autonomous_execution,
    g.per_transaction_limit,g.daily_limit
  from code_bank.capability_grants g
  join participant p on p.participant_id=g.participant_id
  where g.status='active'
    and g.valid_from<=now()
    and (g.valid_until is null or g.valid_until>now())
  order by g.capability_code,g.created_at desc
),
available as (
  select d.*,
    case when not d.grant_required then true else g.capability_grant_id is not null end authorized,
    case when not d.grant_required then d.autonomous_default else coalesce(g.autonomous_execution,false) end autonomous_execution,
    g.per_transaction_limit,g.daily_limit,
    (select stage from gate) lifecycle_stage
  from agent_lab.capability_definitions d
  left join grants g on g.capability_code=d.capability_code
  where d.enabled=true
),
visible as (
  select * from available a
  where a.authorized and (
    a.lifecycle_stage in ('open_autonomy','legacy_unenrolled')
    or a.capability_code in (
      'memory.read','memory.write','resource.balance.read','wake.schedule','intent.schedule','model.generate'
    )
    or (
      a.lifecycle_stage in ('expertise_artifact','expertise_development')
      and a.capability_code='research.long_run'
    )
    or (
      a.lifecycle_stage='product_service_test'
      and a.capability_code in (
        'github.repository.create',
        'github.repository.inspect',
        'github.repository.write',
        'vercel.project.create',
        'vercel.project.inspect',
        'vercel.project.configure',
        'vercel.deployment.create',
        'vercel.deployment.inspect'
      )
    )
  )
)
select jsonb_build_object(
  'version','capability_surface_v0_4_product_build_bundle',
  'lifecycle_stage',(select stage from gate),
  'rule','During product_service_test, the agent may inspect, build, repair, configure, deploy, and inspect deployment diagnostics for its own Construct. Credentials remain broker-held and are never returned to the model.',
  'request_transport',jsonb_build_object(
    'field','associations','origin','capability_request_v0_1',
    'rule','Request only a capability shown in this surface. Use construct_ref=offering for the current Product/Service Test Construct.'
  ),
  'capabilities',coalesce(
    jsonb_agg(
      jsonb_build_object(
        'capability_code',a.capability_code,
        'display_name',a.display_name,
        'provider',a.provider,
        'route_mode',a.route_mode,
        'side_effect_level',a.side_effect_level,
        'authorized',true,
        'autonomous_execution',a.autonomous_execution,
        'approval_policy',a.approval_policy,
        'idempotency_required',a.idempotency_required,
        'construct_required',coalesce((a.metadata->>'construct_required')::boolean,false),
        'operation',a.metadata->>'operation',
        'resource_type',a.metadata->>'resource_type',
        'per_transaction_limit',a.per_transaction_limit,
        'daily_limit',a.daily_limit
      ) order by a.capability_code
    ),
    '[]'::jsonb
  )
)
from visible a;
$function$;

CREATE OR REPLACE FUNCTION agent_lab.apply_capability_elevation_v0_1(p_agent_id uuid, p_capability_codes text[], p_source text, p_grant_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'code_bank', 'extensions'
AS $function$
declare
  v_stage text;
  v_codes text[];
  v_item uuid;
  v_arb jsonb;
  v_surface jsonb;
begin
  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states where agent_id=p_agent_id;

  if coalesce(v_stage,'') not in ('product_service_test','open_autonomy') then
    return jsonb_build_object('status','not_elevated','reason','agent_not_in_post_expertise_capability_stage','stage',v_stage,'version','capability_auto_elevation_v0_3');
  end if;

  select coalesce(array_agg(distinct d.capability_code order by d.capability_code),array[]::text[])
    into v_codes
  from agent_lab.capability_definitions d
  where d.enabled=true
    and d.capability_code=any(coalesce(p_capability_codes,array[]::text[]))
    and (
      v_stage='open_autonomy'
      or d.capability_code in (
        'github.repository.create','github.repository.inspect','github.repository.write',
        'vercel.project.create','vercel.project.inspect','vercel.project.configure',
        'vercel.deployment.create','vercel.deployment.inspect'
      )
    )
    and (
      not d.grant_required
      or exists(
        select 1
        from code_bank.participants p
        join code_bank.capability_grants g on g.participant_id=p.participant_id
        where p.source_namespace='agent_lab'
          and p.source_subject=p_agent_id::text
          and p.status='active'
          and g.capability_code=d.capability_code
          and g.status='active'
          and g.valid_from<=now()
          and (g.valid_until is null or g.valid_until>now())
      )
    );

  if coalesce(array_length(v_codes,1),0)=0 then
    return jsonb_build_object('status','not_elevated','reason','no_currently_authorized_capabilities','stage',v_stage,'version','capability_auto_elevation_v0_3');
  end if;

  v_surface:=agent_lab.build_agent_capability_surface(p_agent_id);

  update agent_lab.mandatory_lifecycle_states
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'capability_elevation_mode','automatic_after_active_grant',
        'capability_elevation_version','capability_auto_elevation_v0_3',
        'last_capability_elevation_at',now(),
        'last_capability_elevation_source',coalesce(p_source,'unknown'),
        'last_capability_elevation_stage',v_stage,
        'last_capability_elevation_codes',to_jsonb(v_codes),
        'last_capability_grant_id',p_grant_id
      ),
      updated_at=now()
  where agent_id=p_agent_id;

  update agent_lab.state
  set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
        'capability_surface_elevated',true,
        'capability_elevation_pending_awareness',true,
        'capability_elevation_version','capability_auto_elevation_v0_3',
        'last_capability_elevation_at',now(),
        'last_capability_elevation_stage',v_stage,
        'last_capability_elevation_codes',to_jsonb(v_codes),
        'last_capability_grant_id',p_grant_id
      ),
      updated_at=now()
  where agent_id=p_agent_id;

  v_item:=agent_lab.enqueue_attention_item_v0_1(
    p_agent_id,
    'system_event',
    'capability-elevation-'||extensions.gen_random_uuid()::text,
    'capability_surface_elevated',
    0.90,0.95,0.90,0,0,1,
    'mandatory_boundary',
    jsonb_build_object(
      'capability_codes',to_jsonb(v_codes),
      'grant_id',p_grant_id,
      'elevation_source',coalesce(p_source,'unknown'),
      'lifecycle_stage',v_stage,
      'capability_surface',v_surface,
      'rule','The capability grant is authoritative. During product_service_test, the agent may inspect/build/repair/configure/deploy only its own Construct through broker-held credentials.'
    ),
    jsonb_build_object('origin','capability_auto_elevation_v0_3','grant_is_governance_boundary',true,'elevation_is_automatic_after_grant',true)
  );

  v_arb:=agent_lab.arbitrate_attention_v0_1(p_agent_id);

  return jsonb_build_object(
    'status','elevated',
    'agent_id',p_agent_id,
    'stage',v_stage,
    'capability_codes',to_jsonb(v_codes),
    'attention_item_id',v_item,
    'arbiter_result',v_arb,
    'version','capability_auto_elevation_v0_3'
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.apply_capability_requests(p_agent_id uuid, p_wake_request_id uuid, p_activity_id uuid, p_requests jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'public', 'extensions'
AS $function$
declare
  v_stage text;
  v_design jsonb;
  v_req jsonb;
  v_idx integer := 0;
  v_code text;
  v_allowed jsonb := '[]'::jsonb;
  v_blocked jsonb := '[]'::jsonb;
  v_base jsonb;
  v_feedback jsonb;
begin
  if jsonb_typeof(p_requests)<>'array' then
    return agent_lab.apply_capability_requests_v0_3_pre_test_design(p_agent_id,p_wake_request_id,p_activity_id,p_requests);
  end if;

  v_stage := agent_lab.current_mandatory_lifecycle_stage(p_agent_id);
  if v_stage<>'product_service_test' then
    return agent_lab.apply_capability_requests_v0_3_pre_test_design(p_agent_id,p_wake_request_id,p_activity_id,p_requests);
  end if;

  v_design := agent_lab.get_product_test_design_context_v0_2(p_agent_id);
  if coalesce(v_design->>'status','')='FROZEN' then
    return agent_lab.apply_capability_requests_v0_3_pre_test_design(p_agent_id,p_wake_request_id,p_activity_id,p_requests);
  end if;

  for v_req in select value from jsonb_array_elements(p_requests)
  loop
    v_idx := v_idx + 1;
    v_code := left(trim(coalesce(v_req->>'capability_code','')),160);

    if v_code in (
      'github.repository.create','github.repository.write',
      'vercel.project.create','vercel.project.configure',
      'vercel.deployment.create'
    ) then
      v_blocked := v_blocked || jsonb_build_array(jsonb_build_object(
        'index',v_idx,'capability_code',v_code,'status','rejected','durable_state','REJECTED',
        'success_confirmed',false,'reason','product_test_specification_not_frozen',
        'test_design_status',coalesce(v_design->>'status','MISSING'),
        'repair_hint','Wait for the independent Product Test Designer to freeze the acceptance specification. Read-only inspection capabilities remain available.'
      ));
    else
      v_allowed := v_allowed || jsonb_build_array(v_req);
    end if;
  end loop;

  if jsonb_array_length(v_allowed)>0 then
    v_base := agent_lab.apply_capability_requests_v0_3_pre_test_design(p_agent_id,p_wake_request_id,p_activity_id,v_allowed);
  else
    v_base := jsonb_build_object('version','capability_apply_v0_3_persistent_construct_ref','requested',0,'results','[]'::jsonb,'constructs','{}'::jsonb);
  end if;

  v_feedback := jsonb_build_object(
    'version','capability_apply_v0_5_product_build_bundle',
    'requested',jsonb_array_length(p_requests),
    'results',coalesce(v_base->'results','[]'::jsonb)||v_blocked,
    'constructs',coalesce(v_base->'constructs','{}'::jsonb),
    'product_test_design',v_design,
    'rule','Write/configure/deploy capabilities require a FROZEN Product Test specification. Read-only construct inspection remains available.'
  );

  update agent_lab.state
  set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
        'last_capability_request_feedback',v_feedback,
        'last_capability_request_feedback_at',now()
      ),
      updated_at=now()
  where agent_id=p_agent_id;

  return v_feedback;
end
$function$;

CREATE OR REPLACE FUNCTION public.aau_materialize_product_build_access_job_v0_1(p_capability_invocation_id uuid, p_message_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'agent_lab', 'extensions'
AS $function$
declare
  v_inv agent_lab.capability_invocations%rowtype;
  v_def agent_lab.capability_definitions%rowtype;
  v_provider text;
  v_resource_type text;
  v_operation text;
  v_queue_name text;
  v_action_type text;
  v_external_action_id uuid;
  v_broker_request_id uuid;
  v_broker_job_id uuid;
  v_job_status text;
  v_max_attempts integer;
  v_broker_key text;
begin
  select * into v_inv from agent_lab.capability_invocations
  where capability_invocation_id=p_capability_invocation_id for update;
  if not found then raise exception 'capability_invocation_not_found'; end if;
  if v_inv.route_mode<>'async_broker' then raise exception 'capability_not_async_broker:%',v_inv.route_mode; end if;
  if v_inv.authorization_state<>'allowed' then raise exception 'capability_not_authorized:%',v_inv.authorization_state; end if;
  if v_inv.approval_state not in ('not_required','approved') then raise exception 'capability_not_approved:%',v_inv.approval_state; end if;
  if v_inv.construct_id is null then raise exception 'construct_required'; end if;

  select * into v_def from agent_lab.capability_definitions
  where capability_code=v_inv.capability_code and enabled=true;
  if not found then raise exception 'capability_definition_missing'; end if;

  case v_inv.capability_code
    when 'github.repository.inspect' then
      v_provider:='github'; v_resource_type:='repository'; v_operation:='inspect'; v_queue_name:='aau.infrastructure.github'; v_action_type:='github_repository_inspect';
    when 'github.repository.write' then
      v_provider:='github'; v_resource_type:='repository'; v_operation:='write'; v_queue_name:='aau.infrastructure.github'; v_action_type:='github_repository_write';
    when 'vercel.project.inspect' then
      v_provider:='vercel'; v_resource_type:='project'; v_operation:='inspect'; v_queue_name:='aau.infrastructure.vercel'; v_action_type:='vercel_project_inspect';
    when 'vercel.project.configure' then
      v_provider:='vercel'; v_resource_type:='project'; v_operation:='configure'; v_queue_name:='aau.infrastructure.vercel'; v_action_type:='vercel_project_configure';
    when 'vercel.deployment.inspect' then
      v_provider:='vercel'; v_resource_type:='deployment'; v_operation:='inspect'; v_queue_name:='aau.infrastructure.vercel'; v_action_type:='vercel_deployment_inspect';
    else
      raise exception 'unsupported_product_build_capability:%',v_inv.capability_code;
  end case;

  if v_inv.route_queue is distinct from v_queue_name then
    raise exception 'capability_queue_mismatch:%:%',v_inv.route_queue,v_queue_name;
  end if;

  v_max_attempts:=greatest(1,coalesce((v_def.retry_policy->>'max_attempts')::integer,3));
  v_broker_key:='capability:'||v_inv.capability_invocation_id::text;

  if v_inv.external_action_id is null then
    insert into agent_lab.external_actions(
      agent_id,construct_id,action_type,description,target_system,status,risk_tier,
      human_approval_required,approval_state,execution_payload,approved_at,metadata
    ) values (
      v_inv.agent_id,v_inv.construct_id,v_action_type,
      'AAU product build capability '||v_inv.capability_code,v_provider,
      'approved',1,false,'not_required',coalesce(v_inv.requested_payload,'{}'::jsonb),now(),
      jsonb_build_object('capability_invocation_id',v_inv.capability_invocation_id,'capability_code',v_inv.capability_code,'message_id',p_message_id,'bridge_version','product_build_access_v0_1')
    ) returning external_action_id into v_external_action_id;
  else
    v_external_action_id:=v_inv.external_action_id;
  end if;

  if v_inv.broker_request_id is null then
    insert into agent_lab.infrastructure_broker_requests(
      construct_id,requesting_agent_id,external_action_id,provider,resource_type,operation,
      requested_config,estimated_cost,currency,risk_tier,human_approval_required,approval_state,
      policy_result,status,idempotency_key,approved_at,metadata
    ) values (
      v_inv.construct_id,v_inv.agent_id,v_external_action_id,v_provider,v_resource_type,v_operation,
      coalesce(v_inv.requested_payload,'{}'::jsonb),0,'USD',1,false,'not_required',
      jsonb_build_object('source','capability_router','authorization_state',v_inv.authorization_state),
      'queued',v_broker_key,now(),
      jsonb_build_object('capability_invocation_id',v_inv.capability_invocation_id,'capability_code',v_inv.capability_code,'message_id',p_message_id,'bridge_version','product_build_access_v0_1')
    )
    on conflict (construct_id,idempotency_key) do update set updated_at=now()
    returning broker_request_id into v_broker_request_id;
  else
    v_broker_request_id:=v_inv.broker_request_id;
  end if;

  if v_inv.broker_job_id is null then
    select broker_job_id,status into v_broker_job_id,v_job_status
    from agent_lab.infrastructure_broker_jobs
    where broker_request_id=v_broker_request_id
    order by created_at asc limit 1;

    if v_broker_job_id is null then
      insert into agent_lab.infrastructure_broker_jobs(
        broker_request_id,construct_id,provider,executor_kind,queue_name,status,max_attempts,request_payload,metadata
      ) values (
        v_broker_request_id,v_inv.construct_id,v_provider,'worker',v_queue_name,'queued',v_max_attempts,
        coalesce(v_inv.requested_payload,'{}'::jsonb),
        jsonb_build_object('capability_invocation_id',v_inv.capability_invocation_id,'capability_code',v_inv.capability_code,'message_id',p_message_id,'bridge_version','product_build_access_v0_1')
      ) returning broker_job_id,status into v_broker_job_id,v_job_status;
    end if;
  else
    v_broker_job_id:=v_inv.broker_job_id;
    select status into v_job_status from agent_lab.infrastructure_broker_jobs where broker_job_id=v_broker_job_id;
  end if;

  update agent_lab.capability_invocations
  set external_action_id=v_external_action_id,
      broker_request_id=v_broker_request_id,
      broker_job_id=v_broker_job_id,
      status=case
        when v_job_status='succeeded' then 'completed'
        when v_job_status in ('failed','dead_lettered','cancelled') then 'failed'
        when v_job_status in ('claimed','executing') then 'executing'
        else 'queued'
      end,
      updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('product_build_access_materialized_at',now(),'broker_bridge_message_id',p_message_id)
  where capability_invocation_id=v_inv.capability_invocation_id;

  return jsonb_build_object(
    'ok',true,'capability_invocation_id',v_inv.capability_invocation_id,'capability_code',v_inv.capability_code,
    'provider',v_provider,'resource_type',v_resource_type,'operation',v_operation,'queue_name',v_queue_name,
    'external_action_id',v_external_action_id,'broker_request_id',v_broker_request_id,'broker_job_id',v_broker_job_id,
    'job_status',v_job_status,'max_attempts',v_max_attempts,'message_id',p_message_id
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.aau_materialize_infrastructure_broker_job(p_capability_invocation_id uuid, p_message_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare v_code text;
begin
  select capability_code into v_code
  from agent_lab.capability_invocations
  where capability_invocation_id=p_capability_invocation_id;

  if v_code in (
    'github.repository.inspect','github.repository.write',
    'vercel.project.inspect','vercel.project.configure','vercel.deployment.inspect'
  ) then
    return public.aau_materialize_product_build_access_job_v0_1(p_capability_invocation_id,p_message_id);
  end if;

  return public.aau_materialize_infrastructure_broker_job_pre_product_build_access_v0_1(
    p_capability_invocation_id,p_message_id
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.aau_bridge_claim_product_build_job(p_bridge_token text, p_broker_job_id uuid, p_executor_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_job agent_lab.infrastructure_broker_jobs%rowtype;
  v_req agent_lab.infrastructure_broker_requests%rowtype;
  v_construct agent_lab.agent_constructs%rowtype;
  v_repo agent_lab.construct_assets%rowtype;
  v_project agent_lab.construct_assets%rowtype;
  v_latest_deployment jsonb:='{}'::jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select * into v_job from agent_lab.infrastructure_broker_jobs
  where broker_job_id=p_broker_job_id for update;
  if not found then raise exception 'broker_job_not_found'; end if;
  if v_job.status<>'queued' then raise exception 'job_not_claimable:%',v_job.status; end if;
  if v_job.attempt_count>=v_job.max_attempts then raise exception 'max_attempts_exhausted'; end if;

  select * into v_req from agent_lab.infrastructure_broker_requests
  where broker_request_id=v_job.broker_request_id for update;
  if not found then raise exception 'broker_request_not_found'; end if;
  if (v_req.provider,v_req.resource_type,v_req.operation) not in (
    ('github','repository','inspect'),
    ('github','repository','write'),
    ('vercel','project','inspect'),
    ('vercel','project','configure'),
    ('vercel','deployment','inspect')
  ) then raise exception 'unsupported_product_build_request'; end if;

  select * into v_construct from agent_lab.agent_constructs where construct_id=v_job.construct_id;
  if not found then raise exception 'construct_not_found'; end if;

  select * into v_repo from agent_lab.construct_assets
  where construct_id=v_job.construct_id and provider='github' and asset_type='repository' and status='active'
  order by is_primary desc,created_at asc limit 1;

  select * into v_project from agent_lab.construct_assets
  where construct_id=v_job.construct_id and provider='vercel' and asset_type='deployment_project' and status='active'
  order by is_primary desc,created_at desc limit 1;

  if v_req.provider='github' and v_repo.construct_asset_id is null then
    raise exception 'active_github_repository_required';
  end if;
  if v_req.provider='vercel' and v_project.construct_asset_id is null then
    raise exception 'active_vercel_project_required';
  end if;

  select jsonb_build_object(
    'broker_job_id',j.broker_job_id,
    'status',j.status,
    'result_payload',j.result_payload,
    'error_code',j.error_code,
    'error_message',j.error_message,
    'request_payload',j.request_payload,
    'created_at',j.created_at,
    'finished_at',j.finished_at
  ) into v_latest_deployment
  from agent_lab.infrastructure_broker_jobs j
  join agent_lab.infrastructure_broker_requests r on r.broker_request_id=j.broker_request_id
  where j.construct_id=v_job.construct_id
    and j.provider='vercel'
    and r.resource_type='deployment'
    and r.operation='deploy'
  order by j.created_at desc limit 1;

  update agent_lab.infrastructure_broker_jobs
  set status='executing',attempt_count=attempt_count+1,claimed_at=coalesce(claimed_at,now()),
      started_at=now(),executor_id=p_executor_id,updated_at=now()
  where broker_job_id=p_broker_job_id;

  update agent_lab.infrastructure_broker_requests set status='executing',updated_at=now()
  where broker_request_id=v_req.broker_request_id;

  update agent_lab.capability_invocations
  set status='executing',started_at=coalesce(started_at,now()),updated_at=now()
  where broker_job_id=p_broker_job_id;

  return jsonb_build_object(
    'broker_job_id',v_job.broker_job_id,
    'broker_request_id',v_req.broker_request_id,
    'capability_code',v_req.metadata->>'capability_code',
    'provider',v_req.provider,
    'resource_type',v_req.resource_type,
    'operation',v_req.operation,
    'construct_id',v_construct.construct_id,
    'construct_name',v_construct.name,
    'construct_slug',v_construct.slug,
    'requesting_agent_id',v_req.requesting_agent_id,
    'requested_config',v_req.requested_config,
    'github_repo_full_name',v_repo.metadata->>'repo_full_name',
    'github_default_branch',coalesce(v_repo.metadata->>'default_branch','main'),
    'vercel_project_id',v_project.external_identifier,
    'vercel_project_name',v_project.metadata->>'project_name',
    'latest_deployment',coalesce(v_latest_deployment,'{}'::jsonb),
    'attempt_number',v_job.attempt_count+1,
    'max_attempts',v_job.max_attempts
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.aau_bridge_complete_product_build_job(p_bridge_token text, p_broker_job_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_job agent_lab.infrastructure_broker_jobs%rowtype;
  v_req agent_lab.infrastructure_broker_requests%rowtype;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select * into v_job from agent_lab.infrastructure_broker_jobs
  where broker_job_id=p_broker_job_id for update;
  if not found then raise exception 'broker_job_not_found'; end if;
  if v_job.status not in ('executing','claimed') then raise exception 'job_not_completable:%',v_job.status; end if;

  select * into v_req from agent_lab.infrastructure_broker_requests
  where broker_request_id=v_job.broker_request_id for update;
  if not found then raise exception 'broker_request_not_found'; end if;

  update agent_lab.infrastructure_broker_jobs
  set status='succeeded',finished_at=now(),result_payload=coalesce(p_result,'{}'::jsonb),
      error_code=null,error_message=null,updated_at=now()
  where broker_job_id=p_broker_job_id;

  update agent_lab.infrastructure_broker_requests
  set status='completed',completed_at=now(),updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('product_build_result',coalesce(p_result,'{}'::jsonb))
  where broker_request_id=v_req.broker_request_id;

  if v_req.external_action_id is not null then
    update agent_lab.external_actions
    set status='completed',executed_at=coalesce(executed_at,now()),completed_at=now(),
        result_payload=coalesce(result_payload,'{}'::jsonb)||coalesce(p_result,'{}'::jsonb),updated_at=now()
    where external_action_id=v_req.external_action_id;
  end if;

  update agent_lab.capability_invocations
  set status='completed',result_payload=coalesce(result_payload,'{}'::jsonb)||coalesce(p_result,'{}'::jsonb),
      error_code=null,error_message=null,completed_at=now(),updated_at=now()
  where broker_job_id=p_broker_job_id;

  if v_req.provider='github' and v_req.operation='write' then
    update agent_lab.construct_assets
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'last_agent_write_at',now(),
          'last_agent_write_result',coalesce(p_result,'{}'::jsonb)
        ),
        updated_at=now()
    where construct_id=v_job.construct_id and provider='github' and asset_type='repository' and status='active';
  end if;

  if v_req.provider='vercel' and v_req.operation='configure' then
    update agent_lab.construct_assets
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'last_project_configure_at',now(),
          'project_configuration',coalesce(p_result,'{}'::jsonb)
        ),
        updated_at=now()
    where construct_id=v_job.construct_id and provider='vercel' and asset_type='deployment_project' and status='active';
  end if;

  return jsonb_build_object('ok',true,'broker_job_id',p_broker_job_id,'result',coalesce(p_result,'{}'::jsonb));
end
$function$;

CREATE OR REPLACE FUNCTION public.aau_bridge_fail_product_build_job(p_bridge_token text, p_broker_job_id uuid, p_error_code text, p_error_message text, p_retryable boolean, p_partial_result jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
declare
  v_job agent_lab.infrastructure_broker_jobs%rowtype;
  v_req agent_lab.infrastructure_broker_requests%rowtype;
  v_status text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select * into v_job from agent_lab.infrastructure_broker_jobs
  where broker_job_id=p_broker_job_id for update;
  if not found then raise exception 'broker_job_not_found'; end if;
  select * into v_req from agent_lab.infrastructure_broker_requests where broker_request_id=v_job.broker_request_id;

  v_status:=case when coalesce(p_retryable,false) and v_job.attempt_count<v_job.max_attempts then 'queued' else 'failed' end;

  update agent_lab.infrastructure_broker_jobs
  set status=v_status,
      available_at=case when v_status='queued' then now()+interval '15 seconds' else available_at end,
      finished_at=case when v_status='failed' then now() else null end,
      error_code=left(coalesce(p_error_code,'product_build_bridge_error'),160),
      error_message=left(coalesce(p_error_message,'unknown error'),4000),
      result_payload=coalesce(result_payload,'{}'::jsonb)||coalesce(p_partial_result,'{}'::jsonb),
      updated_at=now()
  where broker_job_id=p_broker_job_id;

  update agent_lab.infrastructure_broker_requests
  set status=case when v_status='queued' then 'queued' else 'failed' end,updated_at=now()
  where broker_request_id=v_job.broker_request_id;

  update agent_lab.capability_invocations
  set status=case when v_status='queued' then 'queued' else 'failed' end,
      error_code=left(coalesce(p_error_code,'product_build_bridge_error'),160),
      error_message=left(coalesce(p_error_message,'unknown error'),4000),
      completed_at=case when v_status='failed' then now() else null end,
      updated_at=now()
  where broker_job_id=p_broker_job_id;

  return jsonb_build_object('ok',false,'broker_job_id',p_broker_job_id,'status',v_status,'retryable',v_status='queued');
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.ensure_product_service_test_v0_1(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'code_bank', 'extensions'
AS $function$
declare
  v_artifact_id uuid;
  v_participant_id uuid;
  v_test_id uuid;
  v_code text;
  v_capability_codes jsonb := '[]'::jsonb;
begin
  select r.expertise_artifact_id
    into v_artifact_id
  from agent_lab.expertise_verification_runs r
  where r.agent_id=p_agent_id
    and r.status='verified_pass'
    and coalesce(r.final_report->>'academic_equivalence_level','')='masters_equivalent'
    and coalesce(r.metadata->>'authenticator_policy_version','')='expertise_authenticator_v0_2'
  order by r.verified_at desc nulls last, r.created_at desc
  limit 1;

  if v_artifact_id is null then
    return jsonb_build_object(
      'ok',false,
      'reason','verified_masters_equivalent_expertise_required',
      'version','product_service_test_v0_1'
    );
  end if;

  insert into code_bank.participants(
    participant_kind,source_namespace,source_subject,display_name,status,provider_agnostic,metadata
  )
  select
    'agent','agent_lab',p_agent_id::text,a.public_name,'active',true,
    jsonb_build_object(
      'origin','product_service_test_v0_1',
      'post_expertise_capability_subject',true
    )
  from agent_lab.agents a
  where a.agent_id=p_agent_id
  on conflict (source_namespace,source_subject)
  do update set
    status='active',
    display_name=coalesce(excluded.display_name,code_bank.participants.display_name),
    updated_at=now(),
    metadata=coalesce(code_bank.participants.metadata,'{}'::jsonb)
      || jsonb_build_object('post_expertise_capability_subject',true);

  select participant_id into v_participant_id
  from code_bank.participants
  where source_namespace='agent_lab'
    and source_subject=p_agent_id::text
    and status='active'
  order by created_at asc
  limit 1;

  -- Baseline Product/Service capabilities remain the historical minimum.
  -- Additional build/repair/inspection grants are agent-specific governance grants.
  foreach v_code in array array[
    'github.repository.create',
    'vercel.project.create',
    'vercel.deployment.create'
  ]
  loop
    if not exists(
      select 1
      from code_bank.capability_grants g
      where g.participant_id=v_participant_id
        and g.capability_code=v_code
        and g.instance_id is null
        and g.asset_code is null
        and g.status='active'
    ) then
      insert into code_bank.capability_grants(
        participant_id,capability_code,autonomous_execution,status,metadata
      ) values (
        v_participant_id,v_code,true,'active',
        jsonb_build_object(
          'grant_origin','product_service_test_v0_1',
          'grant_reason','verified_expertise_post_gate',
          'scope','post_expertise_product_service_test_and_open_autonomy',
          'credentials_broker_held',true
        )
      );
    end if;
  end loop;

  insert into agent_lab.product_service_tests(
    agent_id,expertise_artifact_id,status,metadata
  ) values (
    p_agent_id,v_artifact_id,'pending',
    jsonb_build_object(
      'created_by','ensure_product_service_test_v0_1',
      'revenue_required',false,
      'agent_selects_problem',true,
      'agent_selects_offering',true,
      'minimum_externalization','durable_github_artifact',
      'runtime_verification_required',true
    )
  )
  on conflict (agent_id,protocol_version)
  do update set
    expertise_artifact_id=excluded.expertise_artifact_id,
    updated_at=now()
  returning product_service_test_id into v_test_id;

  if v_test_id is null then
    select product_service_test_id into v_test_id
    from agent_lab.product_service_tests
    where agent_id=p_agent_id and protocol_version='product_service_test_v0_1';
  end if;

  select coalesce(jsonb_agg(x.capability_code order by x.capability_code),'[]'::jsonb)
    into v_capability_codes
  from (
    select distinct g.capability_code
    from code_bank.capability_grants g
    join agent_lab.capability_definitions d on d.capability_code=g.capability_code and d.enabled=true
    where g.participant_id=v_participant_id
      and g.status='active'
      and g.valid_from<=now()
      and (g.valid_until is null or g.valid_until>now())
      and g.capability_code in (
        'github.repository.create',
        'github.repository.inspect',
        'github.repository.write',
        'vercel.project.create',
        'vercel.project.inspect',
        'vercel.project.configure',
        'vercel.deployment.create',
        'vercel.deployment.inspect'
      )
  ) x;

  return jsonb_build_object(
    'ok',true,
    'product_service_test_id',v_test_id,
    'expertise_artifact_id',v_artifact_id,
    'participant_id',v_participant_id,
    'capability_codes',v_capability_codes,
    'capability_scope','active_agent_specific_product_build_grants',
    'credentials_broker_held',true,
    'version','product_service_test_v0_1'
  );
end
$function$;

CREATE OR REPLACE FUNCTION agent_lab.refresh_product_service_test_after_broker_job_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
  v_resource_type text;
  v_operation text;
begin
  if new.status='succeeded'
     and old.status is distinct from new.status
     and new.construct_id is not null then

    select r.resource_type,r.operation
      into v_resource_type,v_operation
    from agent_lab.infrastructure_broker_requests r
    where r.broker_request_id=new.broker_request_id;

    -- Inspection is observational only. It must not invoke the expensive
    -- Product/Service verifier or mutate lifecycle state.
    if coalesce(v_operation,'')='inspect' then
      return new;
    end if;

    -- Only external-state mutations that can materially change Product/Service
    -- readiness should trigger re-evaluation.
    if (v_resource_type,v_operation) not in (
      ('repository','create'),
      ('repository','write'),
      ('project','create'),
      ('project','configure'),
      ('deployment','deploy')
    ) then
      return new;
    end if;

    select owner_agent_id into v_agent_id
    from agent_lab.agent_constructs
    where construct_id=new.construct_id;

    if v_agent_id is not null
       and agent_lab.current_mandatory_lifecycle_stage(v_agent_id)='product_service_test' then
      perform agent_lab.evaluate_product_service_test_v0_1(v_agent_id);
      perform agent_lab.refresh_mandatory_lifecycle_state(v_agent_id);
    end if;
  end if;
  return new;
end
$function$;

grant execute on function public.aau_bridge_claim_product_build_job(text,uuid,text) to anon,authenticated,service_role;
grant execute on function public.aau_bridge_complete_product_build_job(text,uuid,jsonb) to anon,authenticated,service_role;
grant execute on function public.aau_bridge_fail_product_build_job(text,uuid,text,text,boolean,jsonb) to anon,authenticated,service_role;

commit;
