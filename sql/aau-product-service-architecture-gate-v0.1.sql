-- AAU Product/Service Architecture Gate v0.1
-- Applied live 2026-09-19.
--
-- Lifecycle:
--   Product submission
--   -> frozen independent Product Test specification
--   -> frozen Product/Service Architecture
--   -> agent implementation
--   -> independent architecture conformance
--   -> canonical deployment
--   -> independent product tests
--   -> VERIFIED_PASS
--
-- Design principles:
--   * The agent owns the product and implementation choices.
--   * The Architect derives behavioral/system requirements only from the
--     agent-authored product contract and the frozen Product Test.
--   * Frameworks, languages, endpoint paths, filenames, module layout and
--     literal request field names are non-prescriptive unless explicitly
--     claimed by the agent.
--   * Repository changes invalidate older conformance passes until reviewed.
--   * Deployments before the latest conformance VERIFIED_PASS are prototypes.
--   * Canonical deployment creation is blocked until latest conformance passes.

begin;

create table if not exists agent_lab.product_service_architectures (
  product_service_architecture_id uuid primary key default gen_random_uuid(),
  product_service_test_id uuid not null references agent_lab.product_service_tests(product_service_test_id) on delete cascade,
  agent_id uuid not null,
  construct_id uuid,
  protocol_version text not null default 'product_service_architecture_v0_1',
  status text not null default 'PENDING',
  specification jsonb not null default '{}'::jsonb,
  source_kind text not null default 'product_service_architect_v0_1',
  frozen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  model_requested text,
  model_used text,
  fallback_used boolean not null default false,
  error_code text,
  error_message text
);

alter table agent_lab.product_service_architectures
  add column if not exists attempt_count integer not null default 0,
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists model_requested text,
  add column if not exists model_used text,
  add column if not exists fallback_used boolean not null default false,
  add column if not exists error_code text,
  add column if not exists error_message text;

create unique index if not exists ux_product_service_architectures_active
  on agent_lab.product_service_architectures(product_service_test_id,protocol_version);
create index if not exists ix_product_service_architectures_agent
  on agent_lab.product_service_architectures(agent_id,created_at desc);

create table if not exists agent_lab.product_architecture_conformance_runs (
  product_architecture_conformance_run_id uuid primary key default gen_random_uuid(),
  product_service_architecture_id uuid not null references agent_lab.product_service_architectures(product_service_architecture_id) on delete cascade,
  product_service_test_id uuid not null references agent_lab.product_service_tests(product_service_test_id) on delete cascade,
  agent_id uuid not null,
  construct_id uuid,
  protocol_version text not null default 'product_architecture_conformance_v0_1',
  status text not null default 'NOT_RUN',
  implementation_manifest jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  executor_id text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  source_capability_invocation_id uuid,
  attempt_count integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  model_requested text,
  model_used text,
  fallback_used boolean not null default false,
  error_code text,
  error_message text
);

alter table agent_lab.product_architecture_conformance_runs
  add column if not exists source_capability_invocation_id uuid,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists claimed_by text,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_expires_at timestamptz,
  add column if not exists model_requested text,
  add column if not exists model_used text,
  add column if not exists fallback_used boolean not null default false,
  add column if not exists error_code text,
  add column if not exists error_message text;

create index if not exists ix_product_architecture_conformance_agent
  on agent_lab.product_architecture_conformance_runs(agent_id,created_at desc);
drop index if exists agent_lab.ux_product_architecture_conformance_source_invocation;
create unique index ux_product_architecture_conformance_source_invocation
  on agent_lab.product_architecture_conformance_runs(source_capability_invocation_id);

create or replace function agent_lab.get_product_service_architecture_context_v0_1(p_agent_id uuid)
returns jsonb
language sql stable
set search_path to 'pg_catalog','agent_lab'
as $function$
  select coalesce((
    select jsonb_build_object(
      'exists',true,
      'version',a.protocol_version,
      'product_service_architecture_id',a.product_service_architecture_id,
      'product_service_test_id',a.product_service_test_id,
      'construct_id',a.construct_id,
      'status',a.status,
      'source_kind',a.source_kind,
      'frozen_at',a.frozen_at,
      'specification',a.specification,
      'metadata',a.metadata
    )
    from agent_lab.product_service_architectures a
    where a.agent_id=p_agent_id
      and a.protocol_version='product_service_architecture_v0_1'
    order by a.created_at desc
    limit 1
  ),jsonb_build_object(
    'exists',false,
    'version','product_service_architecture_v0_1',
    'status','MISSING'
  ));
$function$;

create or replace function agent_lab.get_product_architecture_conformance_context_v0_1(p_agent_id uuid)
returns jsonb
language sql stable
set search_path to 'pg_catalog','agent_lab'
as $function$
  select coalesce((
    select jsonb_build_object(
      'exists',true,
      'version',r.protocol_version,
      'product_architecture_conformance_run_id',r.product_architecture_conformance_run_id,
      'product_service_architecture_id',r.product_service_architecture_id,
      'product_service_test_id',r.product_service_test_id,
      'construct_id',r.construct_id,
      'status',r.status,
      'implementation_manifest',r.implementation_manifest,
      'evidence',r.evidence,
      'report',r.report,
      'executor_id',r.executor_id,
      'started_at',r.started_at,
      'completed_at',r.completed_at,
      'metadata',r.metadata
    )
    from agent_lab.product_architecture_conformance_runs r
    where r.agent_id=p_agent_id
      and r.protocol_version='product_architecture_conformance_v0_1'
    order by r.created_at desc
    limit 1
  ),jsonb_build_object(
    'exists',false,
    'version','product_architecture_conformance_v0_1',
    'status','NOT_RUN'
  ));
$function$;

create or replace function agent_lab.enqueue_product_service_architecture_after_test_design_v0_1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_test agent_lab.product_service_tests%rowtype;
begin
  if lower(coalesce(new.status,''))<>'frozen'
     or (tg_op='UPDATE' and lower(coalesce(old.status,''))='frozen') then
    return new;
  end if;

  select * into v_test
  from agent_lab.product_service_tests
  where product_service_test_id=new.product_service_test_id;

  if not found then return new; end if;

  insert into agent_lab.product_service_architectures(
    product_service_test_id,agent_id,construct_id,protocol_version,status,
    source_kind,specification,metadata
  )
  values(
    v_test.product_service_test_id,v_test.agent_id,v_test.construct_id,
    'product_service_architecture_v0_1','PENDING',
    'product_service_architect_v0_1',
    '{}'::jsonb,
    jsonb_build_object(
      'trigger','frozen_product_test_design',
      'product_test_design_id',new.product_test_design_id,
      'designer_version',new.designer_version,
      'queued_at',now()
    )
  )
  on conflict (product_service_test_id,protocol_version) do nothing;

  return new;
end;
$function$;

drop trigger if exists trg_enqueue_product_service_architecture_after_test_design_v0_1
  on agent_lab.product_test_designs;
create trigger trg_enqueue_product_service_architecture_after_test_design_v0_1
after insert or update of status
on agent_lab.product_test_designs
for each row execute function agent_lab.enqueue_product_service_architecture_after_test_design_v0_1();

create or replace function public.aau_bridge_claim_product_service_architecture(
  p_bridge_token text,
  p_executor_id text,
  p_lease_seconds integer default 900
)
returns table(
  product_service_architecture_id uuid,
  product_service_test_id uuid,
  agent_id uuid,
  construct_id uuid,
  submission jsonb,
  product_test_specification jsonb,
  product_test_claim_manifest jsonb,
  protocol_version text
)
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  return query
  with candidate as (
    select a.product_service_architecture_id
    from agent_lab.product_service_architectures a
    where a.status='PENDING'
       or (a.status='RUNNING' and a.claim_expires_at is not null and a.claim_expires_at<now())
    order by a.created_at asc
    limit 1
    for update skip locked
  ),
  claimed as (
    update agent_lab.product_service_architectures a
    set status='RUNNING',
        claimed_by=left(coalesce(p_executor_id,'unknown'),300),
        claimed_at=now(),
        claim_expires_at=now()+make_interval(secs=>greatest(120,least(coalesce(p_lease_seconds,900),3600))),
        attempt_count=a.attempt_count+1,
        error_code=null,
        error_message=null,
        updated_at=now()
    from candidate c
    where a.product_service_architecture_id=c.product_service_architecture_id
    returning a.*
  )
  select
    c.product_service_architecture_id,
    c.product_service_test_id,
    c.agent_id,
    c.construct_id,
    t.submission,
    d.specification,
    d.claim_manifest,
    c.protocol_version
  from claimed c
  join agent_lab.product_service_tests t on t.product_service_test_id=c.product_service_test_id
  join lateral (
    select x.*
    from agent_lab.product_test_designs x
    where x.product_service_test_id=c.product_service_test_id
      and lower(x.status)='frozen'
    order by x.frozen_at desc nulls last,x.created_at desc
    limit 1
  ) d on true;
end;
$function$;

create or replace function public.aau_bridge_complete_product_service_architecture(
  p_bridge_token text,
  p_product_service_architecture_id uuid,
  p_executor_id text,
  p_specification jsonb,
  p_model_requested text,
  p_model_used text,
  p_fallback_used boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_arch agent_lab.product_service_architectures%rowtype;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select * into v_arch
  from agent_lab.product_service_architectures
  where product_service_architecture_id=p_product_service_architecture_id
  for update;

  if not found then raise exception 'product_service_architecture_not_found'; end if;
  if v_arch.status<>'RUNNING' then raise exception 'product_service_architecture_not_running'; end if;
  if coalesce(v_arch.claimed_by,'')<>coalesce(p_executor_id,'') then
    raise exception 'architecture_claim_owner_mismatch';
  end if;
  if jsonb_typeof(p_specification)<>'object' then raise exception 'architecture_spec_object_required'; end if;
  if jsonb_typeof(p_specification->'required_user_workflow')<>'array'
     or jsonb_array_length(p_specification->'required_user_workflow')<1 then
    raise exception 'architecture_required_user_workflow_required';
  end if;
  if jsonb_typeof(p_specification->'required_components')<>'array'
     or jsonb_array_length(p_specification->'required_components')<1 then
    raise exception 'architecture_required_components_required';
  end if;
  if jsonb_typeof(p_specification->'behavioral_invariants')<>'array'
     or jsonb_array_length(p_specification->'behavioral_invariants')<1 then
    raise exception 'architecture_behavioral_invariants_required';
  end if;
  if jsonb_typeof(p_specification->'interface_contract')<>'object' then
    raise exception 'architecture_interface_contract_required';
  end if;
  if jsonb_typeof(p_specification->'non_prescriptive_choices')<>'array' then
    raise exception 'architecture_non_prescriptive_choices_required';
  end if;

  update agent_lab.product_service_architectures
  set status='FROZEN',
      specification=coalesce(p_specification,'{}'::jsonb)
        || jsonb_build_object(
          'artifact_kind','product_service_architecture',
          'implementation_manifest_required',true,
          'architecture_conformance_required_before_canonical_deployment',true,
          'canonical_deployment_rule','A canonical deployment is eligible only after the latest independent architecture-conformance result is VERIFIED_PASS.',
          'architecture_version','product_service_architecture_v0_1'
        ),
      frozen_at=now(),
      model_requested=nullif(trim(coalesce(p_model_requested,'')),''),
      model_used=nullif(trim(coalesce(p_model_used,'')),''),
      fallback_used=coalesce(p_fallback_used,false),
      claim_expires_at=null,
      error_code=null,
      error_message=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'completed_by',p_executor_id,
        'completed_at',now(),
        'implementation_freedom_preserved',true,
        'literal_field_names_default_prescribed',false
      ),
      updated_at=now()
  where product_service_architecture_id=p_product_service_architecture_id;

  return jsonb_build_object(
    'ok',true,
    'product_service_architecture_id',p_product_service_architecture_id,
    'status','FROZEN'
  );
end;
$function$;

create or replace function public.aau_bridge_fail_product_service_architecture(
  p_bridge_token text,
  p_product_service_architecture_id uuid,
  p_executor_id text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_arch agent_lab.product_service_architectures%rowtype;
  v_status text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select * into v_arch
  from agent_lab.product_service_architectures
  where product_service_architecture_id=p_product_service_architecture_id
  for update;
  if not found then raise exception 'product_service_architecture_not_found'; end if;
  if coalesce(v_arch.claimed_by,'')<>coalesce(p_executor_id,'') then
    raise exception 'architecture_claim_owner_mismatch';
  end if;

  v_status:=case
    when coalesce(p_retryable,true) and v_arch.attempt_count<3 then 'PENDING'
    else 'ERROR'
  end;

  update agent_lab.product_service_architectures
  set status=v_status,
      claimed_by=case when v_status='PENDING' then null else claimed_by end,
      claimed_at=case when v_status='PENDING' then null else claimed_at end,
      claim_expires_at=null,
      error_code=left(coalesce(p_error_code,'product_service_architect_error'),160),
      error_message=left(coalesce(p_error_message,'unknown error'),4000),
      updated_at=now()
  where product_service_architecture_id=p_product_service_architecture_id;

  return jsonb_build_object('ok',true,'status',v_status,'attempt_count',v_arch.attempt_count);
end;
$function$;

create or replace function agent_lab.enqueue_architecture_conformance_after_github_change_v0_1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_arch agent_lab.product_service_architectures%rowtype;
begin
  if new.capability_code not in ('github.repository.create','github.repository.write')
     or new.status<>'completed'
     or (tg_op='UPDATE' and old.status is not distinct from new.status) then
    return new;
  end if;

  select * into v_arch
  from agent_lab.product_service_architectures a
  where a.agent_id=new.agent_id
    and a.construct_id=new.construct_id
    and a.protocol_version='product_service_architecture_v0_1'
    and a.status='FROZEN'
  order by a.created_at desc
  limit 1;

  if not found then return new; end if;

  insert into agent_lab.product_architecture_conformance_runs(
    product_service_architecture_id,product_service_test_id,agent_id,construct_id,
    protocol_version,status,source_capability_invocation_id,
    implementation_manifest,evidence,report,created_at,updated_at,metadata
  )
  values(
    v_arch.product_service_architecture_id,v_arch.product_service_test_id,new.agent_id,new.construct_id,
    'product_architecture_conformance_v0_1','PENDING',new.capability_invocation_id,
    '{}'::jsonb,'{}'::jsonb,'{}'::jsonb,now(),now(),
    jsonb_build_object(
      'trigger','github_repository_change',
      'capability_code',new.capability_code,
      'requested_at',new.requested_at,
      'completed_at',new.completed_at
    )
  )
  on conflict (source_capability_invocation_id) do nothing;

  update agent_lab.product_service_tests
  set status='building',verified_at=null,updated_at=now()
  where product_service_test_id=v_arch.product_service_test_id;

  return new;
end;
$function$;

drop trigger if exists trg_enqueue_architecture_conformance_after_github_change_v0_1
  on agent_lab.capability_invocations;
create trigger trg_enqueue_architecture_conformance_after_github_change_v0_1
after insert or update of status
on agent_lab.capability_invocations
for each row execute function agent_lab.enqueue_architecture_conformance_after_github_change_v0_1();

create or replace function public.aau_bridge_claim_product_architecture_conformance(
  p_bridge_token text,
  p_executor_id text,
  p_lease_seconds integer default 900
)
returns table(
  product_architecture_conformance_run_id uuid,
  agent_id uuid,
  construct_id uuid,
  product_service_architecture_id uuid,
  architecture_specification jsonb,
  repo_full_name text,
  default_branch text,
  source_capability_invocation_id uuid
)
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  return query
  with candidate as (
    select r.product_architecture_conformance_run_id
    from agent_lab.product_architecture_conformance_runs r
    where r.status='PENDING'
       or (r.status='RUNNING' and r.claim_expires_at is not null and r.claim_expires_at<now())
    order by r.created_at asc
    limit 1
    for update skip locked
  ),
  claimed as (
    update agent_lab.product_architecture_conformance_runs r
    set status='RUNNING',
        claimed_by=left(coalesce(p_executor_id,'unknown'),300),
        claimed_at=now(),
        claim_expires_at=now()+make_interval(secs=>greatest(60,least(coalesce(p_lease_seconds,900),3600))),
        attempt_count=r.attempt_count+1,
        started_at=coalesce(r.started_at,now()),
        error_code=null,
        error_message=null,
        updated_at=now()
    from candidate c
    where r.product_architecture_conformance_run_id=c.product_architecture_conformance_run_id
    returning r.*
  )
  select
    c.product_architecture_conformance_run_id,
    c.agent_id,
    c.construct_id,
    c.product_service_architecture_id,
    a.specification,
    ca.metadata->>'repo_full_name',
    coalesce(ca.metadata->>'default_branch','main'),
    c.source_capability_invocation_id
  from claimed c
  join agent_lab.product_service_architectures a
    on a.product_service_architecture_id=c.product_service_architecture_id
  left join lateral (
    select x.*
    from agent_lab.construct_assets x
    where x.construct_id=c.construct_id
      and x.provider='github'
      and x.asset_type='repository'
      and x.status='active'
    order by x.updated_at desc
    limit 1
  ) ca on true;
end;
$function$;

create or replace function public.aau_bridge_complete_product_architecture_conformance(
  p_bridge_token text,
  p_product_architecture_conformance_run_id uuid,
  p_executor_id text,
  p_status text,
  p_implementation_manifest jsonb,
  p_evidence jsonb,
  p_report jsonb,
  p_model_requested text,
  p_model_used text,
  p_fallback_used boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_status text:=upper(coalesce(p_status,''));
  v_agent_id uuid;
  v_test_id uuid;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if v_status not in ('VERIFIED_PASS','VERIFIED_FAIL') then
    raise exception 'invalid_conformance_status';
  end if;

  update agent_lab.product_architecture_conformance_runs r
  set status=v_status,
      implementation_manifest=coalesce(p_implementation_manifest,'{}'::jsonb),
      evidence=coalesce(p_evidence,'{}'::jsonb),
      report=coalesce(p_report,'{}'::jsonb),
      executor_id=left(coalesce(p_executor_id,'unknown'),300),
      model_requested=p_model_requested,
      model_used=p_model_used,
      fallback_used=coalesce(p_fallback_used,false),
      completed_at=now(),
      claim_expires_at=null,
      error_code=null,
      error_message=null,
      updated_at=now()
  where r.product_architecture_conformance_run_id=p_product_architecture_conformance_run_id
    and r.status='RUNNING'
    and r.claimed_by=left(coalesce(p_executor_id,'unknown'),300)
  returning r.agent_id,r.product_service_test_id into v_agent_id,v_test_id;

  if v_agent_id is null then raise exception 'conformance_claim_not_owned'; end if;

  update agent_lab.product_service_tests
  set status='building',verified_at=null,updated_at=now()
  where product_service_test_id=v_test_id;

  return jsonb_build_object(
    'ok',true,
    'product_architecture_conformance_run_id',p_product_architecture_conformance_run_id,
    'status',v_status,
    'agent_id',v_agent_id
  );
end;
$function$;

create or replace function public.aau_bridge_fail_product_architecture_conformance(
  p_bridge_token text,
  p_product_architecture_conformance_run_id uuid,
  p_executor_id text,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_attempt integer;
  v_status text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select attempt_count into v_attempt
  from agent_lab.product_architecture_conformance_runs
  where product_architecture_conformance_run_id=p_product_architecture_conformance_run_id
  for update;

  v_status:=case
    when coalesce(p_retryable,true) and coalesce(v_attempt,0)<3 then 'PENDING'
    else 'ERROR'
  end;

  update agent_lab.product_architecture_conformance_runs
  set status=v_status,
      error_code=left(coalesce(p_error_code,'conformance_error'),200),
      error_message=left(coalesce(p_error_message,''),2000),
      claimed_by=null,
      claimed_at=null,
      claim_expires_at=null,
      updated_at=now()
  where product_architecture_conformance_run_id=p_product_architecture_conformance_run_id
    and claimed_by=left(coalesce(p_executor_id,'unknown'),300);

  return jsonb_build_object('ok',true,'status',v_status,'attempt_count',v_attempt);
end;
$function$;

create or replace function agent_lab.enqueue_architecture_conformance_result_wake_v0_1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_run_id uuid;
  v_existing uuid;
begin
  if new.status not in ('VERIFIED_PASS','VERIFIED_FAIL','ERROR')
     or old.status is not distinct from new.status then
    return new;
  end if;

  select r.run_id into v_run_id
  from agent_lab.autonomous_lifecycle_runs r
  where r.agent_id=new.agent_id
    and r.status in ('starting','running','degraded')
  order by r.updated_at desc
  limit 1;

  if v_run_id is null then return new; end if;

  select q.wake_request_id into v_existing
  from agent_lab.wake_queue q
  where q.agent_id=new.agent_id
    and q.status in ('queued','claimed','running')
    and q.metadata->>'product_architecture_conformance_run_id'=new.product_architecture_conformance_run_id::text
  limit 1;

  if v_existing is null then
    insert into agent_lab.wake_queue(
      agent_id,source_kind,trigger_type,priority,status,due_at,payload,metadata
    )
    values(
      new.agent_id,'system','attention_architecture_conformance',0.82,'queued',now(),
      jsonb_build_object(
        'reason','product_architecture_conformance_result_available',
        'status',new.status,
        'product_architecture_conformance_run_id',new.product_architecture_conformance_run_id
      ),
      jsonb_build_object(
        'autonomous_lifecycle',true,
        'lifecycle_run_id',v_run_id,
        'rabbit_transport','aau.intent',
        'protocol_version','next_intent_protocol_v0_1',
        'product_architecture_conformance_run_id',new.product_architecture_conformance_run_id
      )
    );

    update agent_lab.autonomous_lifecycle_runs
    set next_wake_at=now(),rabbit_queue='aau.intent',updated_at=now()
    where run_id=v_run_id;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_enqueue_architecture_conformance_result_wake_v0_1
  on agent_lab.product_architecture_conformance_runs;
create trigger trg_enqueue_architecture_conformance_result_wake_v0_1
after update of status
on agent_lab.product_architecture_conformance_runs
for each row execute function agent_lab.enqueue_architecture_conformance_result_wake_v0_1();

create or replace function agent_lab.classify_product_deployment_role_v0_1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_agent_id uuid;
  v_resource_type text;
  v_operation text;
  v_conf_status text;
  v_conf_completed timestamptz;
  v_conf_pass boolean:=false;
begin
  if new.provider<>'vercel' or new.construct_id is null then return new; end if;

  select r.resource_type,r.operation into v_resource_type,v_operation
  from agent_lab.infrastructure_broker_requests r
  where r.broker_request_id=new.broker_request_id;

  if v_resource_type<>'deployment' or v_operation<>'deploy' then return new; end if;

  select c.owner_agent_id into v_agent_id
  from agent_lab.agent_constructs c
  where c.construct_id=new.construct_id;

  if v_agent_id is not null then
    select r.status,r.completed_at into v_conf_status,v_conf_completed
    from agent_lab.product_architecture_conformance_runs r
    where r.agent_id=v_agent_id
      and r.protocol_version='product_architecture_conformance_v0_1'
    order by r.created_at desc
    limit 1;
  end if;

  v_conf_pass:=coalesce(v_conf_status,'')='VERIFIED_PASS'
    and v_conf_completed is not null
    and coalesce(new.created_at,now())>=v_conf_completed;

  new.result_payload:=coalesce(new.result_payload,'{}'::jsonb)
    || jsonb_build_object(
      'deployment_role',case when v_conf_pass then 'CANONICAL_CANDIDATE' else 'PROTOTYPE' end,
      'canonical_product_deployment',false,
      'architecture_conformance_status',coalesce(v_conf_status,'REQUIRED')
    );
  return new;
end;
$function$;

drop trigger if exists trg_classify_product_deployment_role_v0_1
  on agent_lab.infrastructure_broker_jobs;
create trigger trg_classify_product_deployment_role_v0_1
before insert or update of status,result_payload
on agent_lab.infrastructure_broker_jobs
for each row execute function agent_lab.classify_product_deployment_role_v0_1();

-- Product-context / verification functions are intentionally overridden here
-- so stale prototype deployments cannot satisfy canonical readiness.

create or replace function agent_lab.build_product_service_test_context_v0_1(p_agent_id uuid)
returns jsonb
language sql stable
set search_path to 'pg_catalog','agent_lab'
as $function$
  with p as (
    select agent_lab.build_product_service_test_context_v0_1_pre_execution(p_agent_id) as ctx
  )
  select p.ctx || jsonb_build_object(
    'product_test_execution',agent_lab.get_product_test_run_context_v0_2(p_agent_id),
    'final_approval_rule','A live deployment is not sufficient. VERIFIED_PASS requires the latest architecture conformance to pass, a later canonical deployment, and independent runtime execution of the frozen Product Test Specification.',
    'current_product_gate',
      case
        when coalesce(p.ctx#>>'{architecture_conformance,status}','')<>'VERIFIED_PASS'
        then jsonb_build_object(
          'stage','architecture_conformance',
          'status',coalesce(p.ctx#>>'{architecture_conformance,status}','NOT_RUN'),
          'next_eligible_objective','Bring the repository into conformance with the frozen Product/Service Architecture. The agent chooses the implementation. A later repository change triggers independent re-review.'
        )
        else jsonb_build_object(
          'stage','canonical_deployment',
          'status','UNLOCKED',
          'next_eligible_objective','A deployment created after the latest VERIFIED_PASS may become the canonical product deployment.'
        )
      end,
    'capability_contract',
      coalesce(p.ctx->'capability_contract','{}'::jsonb)
      || jsonb_build_object(
        'vercel_deployment_create',
        case
          when coalesce(p.ctx#>>'{architecture_conformance,status}','')='VERIFIED_PASS'
          then 'Canonical deployment is eligible because the latest architecture-conformance result is VERIFIED_PASS. Use the same construct and verify the actual product workflow.'
          else 'Deployment creation remains blocked until the latest architecture-conformance result is VERIFIED_PASS.'
        end
      )
  )
  from p;
$function$;

-- Defense in depth at the direct router. The model-facing request wrapper
-- enforces the same rules, but no direct capability route may bypass them.
create or replace function public.aau_route_capability_request(
  p_agent_id uuid,
  p_capability_code text,
  p_payload jsonb default '{}'::jsonb,
  p_construct_id uuid default null::uuid,
  p_idempotency_key text default null::text
)
returns jsonb
language plpgsql
set search_path to 'public','agent_lab','code_bank','extensions'
as $function$
declare
  v_stage text;
  v_offering_construct uuid;
  v_design_status text;
  v_arch_status text;
  v_conf_status text;
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

    if p_capability_code in (
      'github.repository.create','github.repository.write',
      'vercel.project.create','vercel.project.configure',
      'vercel.deployment.create'
    ) then
      v_design_status:=upper(coalesce(agent_lab.get_product_test_design_context_v0_2(p_agent_id)->>'status',''));
      v_arch_status:=upper(coalesce(agent_lab.get_product_service_architecture_context_v0_1(p_agent_id)->>'status',''));
      v_conf_status:=upper(coalesce(agent_lab.get_product_architecture_conformance_context_v0_1(p_agent_id)->>'status',''));

      if v_design_status<>'FROZEN' then raise exception 'product_test_specification_not_frozen'; end if;
      if v_arch_status<>'FROZEN' then raise exception 'product_service_architecture_not_frozen'; end if;
      if p_capability_code='vercel.deployment.create'
         and v_conf_status<>'VERIFIED_PASS' then
        raise exception 'architecture_conformance_verified_pass_required';
      end if;
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
        'github.repository.create','github.repository.inspect','github.repository.write',
        'vercel.project.create','vercel.project.inspect','vercel.project.configure',
        'vercel.deployment.create','vercel.deployment.inspect'
      )
    )
    then
      raise exception 'mandatory_lifecycle_gate_blocks_capability:%:stage=%',p_capability_code,v_stage;
    end if;
  end if;

  return public.aau_route_capability_request_pre_lifecycle_v0_4(
    p_agent_id,p_capability_code,p_payload,p_construct_id,p_idempotency_key
  );
end;
$function$;

grant execute on function public.aau_bridge_claim_product_service_architecture(text,text,integer)
  to anon,authenticated,service_role;
grant execute on function public.aau_bridge_complete_product_service_architecture(text,uuid,text,jsonb,text,text,boolean)
  to anon,authenticated,service_role;
grant execute on function public.aau_bridge_fail_product_service_architecture(text,uuid,text,text,text,boolean)
  to anon,authenticated,service_role;
grant execute on function public.aau_bridge_claim_product_architecture_conformance(text,text,integer)
  to anon,authenticated,service_role;
grant execute on function public.aau_bridge_complete_product_architecture_conformance(text,uuid,text,text,jsonb,jsonb,jsonb,text,text,boolean)
  to anon,authenticated,service_role;
grant execute on function public.aau_bridge_fail_product_architecture_conformance(text,uuid,text,text,text,boolean)
  to anon,authenticated,service_role;

commit;
