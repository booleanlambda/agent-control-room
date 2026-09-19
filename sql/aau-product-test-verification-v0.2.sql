-- AAU Product / Service Test v0.2
-- Canonical source for the live Product Test Designer + independent execution gate.
-- Applied to Supabase on 2026-09-19.
--
-- Principle:
--   1. Agent chooses the product/service.
--   2. Runtime freezes the agent-authored claims.
--   3. Authenticator creates proportional behavioral tests before external build/deploy.
--   4. Runtime independently executes the frozen tests.
--   5. Deployment is a prerequisite, never the verdict.

begin;

create table if not exists agent_lab.product_test_designs (
  product_test_design_id uuid primary key default extensions.gen_random_uuid(),
  product_service_test_id uuid not null references agent_lab.product_service_tests(product_service_test_id) on delete cascade,
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  designer_version text not null default 'product_test_designer_v0_2',
  submission_fingerprint text not null,
  submission_snapshot jsonb not null default '{}'::jsonb,
  claim_manifest jsonb not null default '[]'::jsonb,
  status text not null default 'queued'
    check (status in ('queued','running','frozen','failed','superseded')),
  specification jsonb not null default '{}'::jsonb,
  model_requested text,
  model_used text,
  fallback_used boolean not null default false,
  attempt_count integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  frozen_at timestamptz,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_service_test_id, designer_version, submission_fingerprint)
);
alter table agent_lab.product_test_designs enable row level security;
create index if not exists product_test_designs_claim_idx
  on agent_lab.product_test_designs(status, created_at)
  where status in ('queued','running');

create table if not exists agent_lab.product_test_runs (
  product_test_run_id uuid primary key default extensions.gen_random_uuid(),
  product_test_design_id uuid not null references agent_lab.product_test_designs(product_test_design_id) on delete cascade,
  product_service_test_id uuid not null references agent_lab.product_service_tests(product_service_test_id) on delete cascade,
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued','running','verified_pass','verified_fail','failed','superseded')),
  evidence jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  final_report jsonb not null default '{}'::jsonb,
  executor_id text,
  attempt_count integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_test_design_id)
);
alter table agent_lab.product_test_runs enable row level security;
create index if not exists product_test_runs_status_idx
  on agent_lab.product_test_runs(status,created_at)
  where status in ('queued','running');

create or replace function agent_lab.product_test_submission_snapshot_v0_2(p_agent_id uuid)
returns jsonb
language sql
stable
set search_path='pg_catalog','agent_lab'
as $$
  select jsonb_build_object(
    'offering_type', t.offering_type,
    'title', t.title,
    'problem_statement', t.problem_statement,
    'target_user', t.target_user,
    'value_proposition', t.value_proposition,
    'success_criteria', t.success_criteria
  )
  from agent_lab.product_service_tests t
  where t.agent_id=p_agent_id
    and t.protocol_version='product_service_test_v0_1'
  order by t.updated_at desc
  limit 1
$$;

create or replace function agent_lab.product_test_claim_manifest_v0_2(p_agent_id uuid)
returns jsonb
language plpgsql
stable
set search_path='pg_catalog','agent_lab'
as $$
declare
  v_test agent_lab.product_service_tests%rowtype;
  v_claims jsonb := '[]'::jsonb;
  v_item jsonb;
  v_i integer := 0;
begin
  select * into v_test
  from agent_lab.product_service_tests
  where agent_id=p_agent_id and protocol_version='product_service_test_v0_1'
  order by updated_at desc
  limit 1;

  if not found then return '[]'::jsonb; end if;

  if nullif(btrim(coalesce(v_test.value_proposition,'')),'') is not null then
    v_claims := v_claims || jsonb_build_array(jsonb_build_object(
      'id','VP1','claim_kind','value_proposition','text',v_test.value_proposition,
      'critical',true,'source','agent_submission'
    ));
  end if;

  if jsonb_typeof(v_test.success_criteria)='array' then
    for v_item in select value from jsonb_array_elements(v_test.success_criteria)
    loop
      v_i := v_i + 1;
      v_claims := v_claims || jsonb_build_array(jsonb_build_object(
        'id','C'||v_i::text,'claim_kind','success_criterion',
        'text',trim(both '"' from v_item::text),
        'critical',true,'source','agent_submission'
      ));
    end loop;
  end if;
  return v_claims;
end
$$;

create or replace function agent_lab.ensure_product_test_design_v0_2(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','agent_lab'
as $$
declare
  v_test agent_lab.product_service_tests%rowtype;
  v_snapshot jsonb;
  v_claims jsonb;
  v_fp text;
  v_id uuid;
  v_complete boolean := false;
begin
  select * into v_test
  from agent_lab.product_service_tests
  where agent_id=p_agent_id and protocol_version='product_service_test_v0_1'
  order by updated_at desc
  limit 1;

  if not found then return jsonb_build_object('ok',false,'reason','product_service_test_not_found'); end if;

  v_complete :=
    v_test.offering_type in ('product','service')
    and nullif(btrim(coalesce(v_test.title,'')),'') is not null
    and nullif(btrim(coalesce(v_test.problem_statement,'')),'') is not null
    and nullif(btrim(coalesce(v_test.target_user,'')),'') is not null
    and nullif(btrim(coalesce(v_test.value_proposition,'')),'') is not null
    and jsonb_typeof(v_test.success_criteria)='array'
    and jsonb_array_length(v_test.success_criteria)>0;

  if not v_complete then return jsonb_build_object('ok',false,'reason','offering_plan_incomplete'); end if;

  v_snapshot := agent_lab.product_test_submission_snapshot_v0_2(p_agent_id);
  v_claims := agent_lab.product_test_claim_manifest_v0_2(p_agent_id);
  v_fp := md5(v_snapshot::text);

  select product_test_design_id into v_id
  from agent_lab.product_test_designs
  where product_service_test_id=v_test.product_service_test_id
    and designer_version='product_test_designer_v0_2'
    and submission_fingerprint=v_fp
  limit 1;

  if v_id is not null then
    return jsonb_build_object(
      'ok',true,'product_test_design_id',v_id,'submission_fingerprint',v_fp,
      'status',(select status from agent_lab.product_test_designs where product_test_design_id=v_id),
      'reused',true
    );
  end if;

  update agent_lab.product_test_designs
  set status='superseded', updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'superseded_at',now(),'superseded_by_new_submission',true
      )
  where product_service_test_id=v_test.product_service_test_id
    and designer_version='product_test_designer_v0_2'
    and status in ('queued','running','frozen');

  insert into agent_lab.product_test_designs(
    product_service_test_id,agent_id,designer_version,submission_fingerprint,
    submission_snapshot,claim_manifest,status,metadata
  ) values (
    v_test.product_service_test_id,p_agent_id,'product_test_designer_v0_2',v_fp,
    v_snapshot,v_claims,'queued',
    jsonb_build_object(
      'created_by','ensure_product_test_design_v0_2',
      'design_principle','agent_chooses_product_authenticator_chooses_proportional_tests_runtime_owns_evidence',
      'unrelated_requirements_forbidden',true
    )
  ) returning product_test_design_id into v_id;

  return jsonb_build_object(
    'ok',true,'product_test_design_id',v_id,'submission_fingerprint',v_fp,
    'status','queued','reused',false
  );
end
$$;

create or replace function agent_lab.enqueue_product_test_design_v0_2()
returns trigger
language plpgsql
set search_path='pg_catalog','agent_lab'
as $$
begin
  perform agent_lab.ensure_product_test_design_v0_2(new.agent_id);
  return new;
end
$$;

drop trigger if exists trg_enqueue_product_test_design_v0_2 on agent_lab.product_service_tests;
create trigger trg_enqueue_product_test_design_v0_2
after insert or update of offering_type,title,problem_statement,target_user,value_proposition,success_criteria
on agent_lab.product_service_tests
for each row
when (new.protocol_version='product_service_test_v0_1')
execute function agent_lab.enqueue_product_test_design_v0_2();

create or replace function agent_lab.get_product_test_design_context_v0_2(p_agent_id uuid)
returns jsonb
language plpgsql
stable
set search_path='pg_catalog','agent_lab'
as $$
declare
  v_test agent_lab.product_service_tests%rowtype;
  v_snapshot jsonb;
  v_fp text;
  v_design agent_lab.product_test_designs%rowtype;
begin
  select * into v_test
  from agent_lab.product_service_tests
  where agent_id=p_agent_id and protocol_version='product_service_test_v0_1'
  order by updated_at desc limit 1;

  if not found then return jsonb_build_object('version','product_test_designer_v0_2','exists',false); end if;

  v_snapshot := agent_lab.product_test_submission_snapshot_v0_2(p_agent_id);
  if v_snapshot is null then
    return jsonb_build_object('version','product_test_designer_v0_2','exists',false,'status','MISSING');
  end if;
  v_fp := md5(v_snapshot::text);

  select * into v_design
  from agent_lab.product_test_designs
  where product_service_test_id=v_test.product_service_test_id
    and designer_version='product_test_designer_v0_2'
    and submission_fingerprint=v_fp
  order by created_at desc limit 1;

  if not found then
    return jsonb_build_object(
      'version','product_test_designer_v0_2','exists',false,'status','MISSING',
      'rule','Submit a complete product/service idea first. AAU freezes the agent-authored claims and independently designs proportional tests before external build/deployment.'
    );
  end if;

  return jsonb_build_object(
    'version',v_design.designer_version,'exists',true,
    'product_test_design_id',v_design.product_test_design_id,
    'status',upper(v_design.status),
    'submission_fingerprint',v_design.submission_fingerprint,
    'claim_manifest',v_design.claim_manifest,
    'specification',v_design.specification,
    'model_requested',v_design.model_requested,'model_used',v_design.model_used,
    'fallback_used',v_design.fallback_used,'attempt_count',v_design.attempt_count,
    'frozen_at',v_design.frozen_at,'error_code',v_design.error_code,'error_message',v_design.error_message,
    'rule','The agent chooses what to build. The Authenticator may derive tests from the frozen claims and reasonable usage model, but may not invent unrelated product requirements. External build/deployment is blocked until this specification is FROZEN.'
  );
end
$$;

create or replace function public.aau_bridge_claim_product_test_design(
  p_bridge_token text,p_executor_id text,p_lease_seconds integer default 900
)
returns table(
  product_test_design_id uuid,agent_id uuid,product_service_test_id uuid,
  submission_snapshot jsonb,claim_manifest jsonb,designer_version text,metadata jsonb
)
language plpgsql
security definer
set search_path='pg_catalog','public','agent_lab'
as $$
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if nullif(trim(coalesce(p_executor_id,'')),'') is null then raise exception 'executor_id_required'; end if;
  return query
  with candidate as (
    select d.product_test_design_id
    from agent_lab.product_test_designs d
    where d.status='queued'
       or (d.status='running' and d.claim_expires_at is not null and d.claim_expires_at < now())
    order by d.created_at
    for update skip locked limit 1
  ), claimed as (
    update agent_lab.product_test_designs d
    set status='running',claimed_by=p_executor_id,claimed_at=now(),
        claim_expires_at=now()+make_interval(secs=>greatest(120,least(coalesce(p_lease_seconds,900),3600))),
        attempt_count=d.attempt_count+1,error_code=null,error_message=null,updated_at=now(),
        metadata=coalesce(d.metadata,'{}'::jsonb)||jsonb_build_object(
          'authenticator_primary','moonshotai/kimi-k3',
          'authenticator_fallbacks',jsonb_build_array('meta/muse-glimmer-30b','nvidia/nemotron-3.5-lightning-30b-a3b'),
          'claimed_at',now()
        )
    from candidate c
    where d.product_test_design_id=c.product_test_design_id
    returning d.*
  )
  select c.product_test_design_id,c.agent_id,c.product_service_test_id,
         c.submission_snapshot,c.claim_manifest,c.designer_version,c.metadata
  from claimed c;
end
$$;

create or replace function public.aau_bridge_complete_product_test_design(
  p_bridge_token text,p_product_test_design_id uuid,p_executor_id text,
  p_model_requested text,p_model_used text,p_fallback_used boolean,p_specification jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','agent_lab'
as $$
declare
  v_design agent_lab.product_test_designs%rowtype;
  v_gate jsonb; v_claim_id jsonb; v_known boolean; v_spec jsonb;
  v_claim_text text; v_pass_condition text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select * into v_design from agent_lab.product_test_designs
  where product_test_design_id=p_product_test_design_id for update;
  if not found then raise exception 'product_test_design_not_found'; end if;
  if v_design.status<>'running' then raise exception 'product_test_design_not_running'; end if;
  if coalesce(v_design.claimed_by,'')<>coalesce(p_executor_id,'') then raise exception 'product_test_design_claim_owner_mismatch'; end if;

  if jsonb_typeof(p_specification)<>'object' then raise exception 'product_test_spec_object_required'; end if;
  if jsonb_typeof(p_specification->'deterministic_gates')<>'array' then raise exception 'deterministic_gates_array_required'; end if;
  if jsonb_typeof(p_specification->'adversarial_tests')<>'array' then raise exception 'adversarial_tests_array_required'; end if;
  if jsonb_typeof(p_specification->'test_profile')<>'object' then raise exception 'test_profile_object_required'; end if;
  if nullif(trim(coalesce(p_specification->>'approval_rule','')),'') is null then raise exception 'approval_rule_required'; end if;

  for v_gate in select value from jsonb_array_elements(p_specification->'deterministic_gates')
  loop
    if coalesce(v_gate->>'basis','') not in ('explicit_claim','usage_model') then raise exception 'gate_basis_invalid'; end if;
    if nullif(trim(coalesce(v_gate->>'test','')),'') is null
       or nullif(trim(coalesce(v_gate->>'pass_condition','')),'') is null
       or nullif(trim(coalesce(v_gate->>'evidence','')),'') is null
       or nullif(trim(coalesce(v_gate->>'rationale','')),'') is null then
      raise exception 'gate_fields_incomplete';
    end if;

    if v_gate->>'basis'='explicit_claim' then
      if jsonb_typeof(v_gate->'claim_ids')<>'array' or jsonb_array_length(v_gate->'claim_ids')<1 then
        raise exception 'explicit_claim_gate_requires_claim_ids';
      end if;
      v_claim_text := '';
      for v_claim_id in select value from jsonb_array_elements(v_gate->'claim_ids')
      loop
        select exists(
          select 1 from jsonb_array_elements(v_design.claim_manifest) c
          where c->>'id'=trim(both '"' from v_claim_id::text)
        ) into v_known;
        if not v_known then raise exception 'unknown_claim_id_in_gate'; end if;
        select v_claim_text || ' ' || coalesce(c->>'text','') into v_claim_text
        from jsonb_array_elements(v_design.claim_manifest) c
        where c->>'id'=trim(both '"' from v_claim_id::text)
        limit 1;
      end loop;

      v_pass_condition := coalesce(v_gate->>'pass_condition','');
      if v_pass_condition ~* '\m([0-9]+([.][0-9]+)?)[[:space:]]*(ms|millisecond|milliseconds|second|seconds|sec|secs|minute|minutes)\M'
         and not (
           coalesce(v_claim_text,'') ~* '\m(latency|response[[:space:]]+time|sla)\M'
           or coalesce(v_claim_text,'') ~* '\m([0-9]+([.][0-9]+)?)[[:space:]]*(ms|millisecond|milliseconds|second|seconds|sec|secs|minute|minutes)\M'
         ) then
        raise exception 'unclaimed_performance_threshold';
      end if;
    end if;
  end loop;

  if lower(p_specification::text) ~ '(tagged release|5[+] commits|five commits|commit count|publicly accessible repository|repository must be public)' then
    raise exception 'unrelated_repository_maturity_requirement';
  end if;

  v_spec := (p_specification - 'frozen_claims') || jsonb_build_object(
    'frozen_claims',v_design.claim_manifest,
    'specification_version','product_test_designer_v0_2',
    'scope_rule','Tests must derive from explicit agent claims or the inferred usage model. Unrelated product requirements and implementation/interface prescriptions are forbidden.'
  );

  update agent_lab.product_test_designs
  set status='frozen',specification=v_spec,
      model_requested=nullif(trim(coalesce(p_model_requested,'')),''),
      model_used=nullif(trim(coalesce(p_model_used,'')),''),
      fallback_used=coalesce(p_fallback_used,false),frozen_at=now(),claim_expires_at=null,
      error_code=null,error_message=null,updated_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'completed_by',p_executor_id,'completed_at',now(),
        'runtime_claim_manifest_authoritative',true,
        'unrelated_requirements_forbidden',true,
        'implementation_choice_preserved',true
      )
  where product_test_design_id=p_product_test_design_id;

  return jsonb_build_object('ok',true,'product_test_design_id',p_product_test_design_id,'status','frozen','specification',v_spec);
end
$$;

create or replace function public.aau_bridge_fail_product_test_design(
  p_bridge_token text,p_product_test_design_id uuid,p_executor_id text,
  p_error_code text,p_error_message text,p_retryable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','agent_lab'
as $$
declare v_design agent_lab.product_test_designs%rowtype; v_status text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select * into v_design from agent_lab.product_test_designs
  where product_test_design_id=p_product_test_design_id for update;
  if not found then raise exception 'product_test_design_not_found'; end if;
  if coalesce(v_design.claimed_by,'')<>coalesce(p_executor_id,'') then raise exception 'product_test_design_claim_owner_mismatch'; end if;

  v_status := case when coalesce(p_retryable,true) and v_design.attempt_count<3 then 'queued' else 'failed' end;
  update agent_lab.product_test_designs
  set status=v_status,
      claimed_by=case when v_status='queued' then null else claimed_by end,
      claimed_at=case when v_status='queued' then null else claimed_at end,
      claim_expires_at=null,
      error_code=left(coalesce(p_error_code,'product_test_designer_error'),160),
      error_message=left(coalesce(p_error_message,'unknown error'),4000),
      updated_at=now()
  where product_test_design_id=p_product_test_design_id;
  return jsonb_build_object('ok',true,'status',v_status,'attempt_count',v_design.attempt_count);
end
$$;

grant execute on function public.aau_bridge_claim_product_test_design(text,text,integer) to anon,authenticated,service_role;
grant execute on function public.aau_bridge_complete_product_test_design(text,uuid,text,text,text,boolean,jsonb) to anon,authenticated,service_role;
grant execute on function public.aau_bridge_fail_product_test_design(text,uuid,text,text,text,boolean) to anon,authenticated,service_role;

-- Preserve the pre-v0.2 capability router, then make the frozen test spec a prerequisite
-- for Product/Service-stage GitHub/Vercel externalization.
do $$
begin
  if to_regprocedure('agent_lab.apply_capability_requests_v0_3_pre_test_design(uuid,uuid,uuid,jsonb)') is null
     and to_regprocedure('agent_lab.apply_capability_requests(uuid,uuid,uuid,jsonb)') is not null then
    execute 'alter function agent_lab.apply_capability_requests(uuid,uuid,uuid,jsonb) rename to apply_capability_requests_v0_3_pre_test_design';
  end if;
end
$$;

create or replace function agent_lab.apply_capability_requests(
  p_agent_id uuid,p_wake_request_id uuid,p_activity_id uuid,p_requests jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','agent_lab','public','extensions'
as $$
declare
  v_stage text; v_design jsonb; v_req jsonb; v_idx integer:=0; v_code text;
  v_allowed jsonb:='[]'::jsonb; v_blocked jsonb:='[]'::jsonb; v_base jsonb; v_feedback jsonb;
begin
  if jsonb_typeof(p_requests)<>'array' then
    return agent_lab.apply_capability_requests_v0_3_pre_test_design(p_agent_id,p_wake_request_id,p_activity_id,p_requests);
  end if;

  v_stage:=agent_lab.current_mandatory_lifecycle_stage(p_agent_id);
  if v_stage<>'product_service_test' then
    return agent_lab.apply_capability_requests_v0_3_pre_test_design(p_agent_id,p_wake_request_id,p_activity_id,p_requests);
  end if;

  v_design:=agent_lab.get_product_test_design_context_v0_2(p_agent_id);
  if coalesce(v_design->>'status','')='FROZEN' then
    return agent_lab.apply_capability_requests_v0_3_pre_test_design(p_agent_id,p_wake_request_id,p_activity_id,p_requests);
  end if;

  for v_req in select value from jsonb_array_elements(p_requests)
  loop
    v_idx:=v_idx+1; v_code:=left(trim(coalesce(v_req->>'capability_code','')),160);
    if v_code in ('github.repository.create','vercel.project.create','vercel.deployment.create') then
      v_blocked:=v_blocked||jsonb_build_array(jsonb_build_object(
        'index',v_idx,'capability_code',v_code,'status','rejected','durable_state','REJECTED',
        'success_confirmed',false,'reason','product_test_specification_not_frozen',
        'test_design_status',coalesce(v_design->>'status','MISSING'),
        'repair_hint','Wait for the independent Product Test Designer to freeze the acceptance specification. The agent remains free to decide how to build the product once the tests are known.'
      ));
    else
      v_allowed:=v_allowed||jsonb_build_array(v_req);
    end if;
  end loop;

  if jsonb_array_length(v_allowed)>0 then
    v_base:=agent_lab.apply_capability_requests_v0_3_pre_test_design(p_agent_id,p_wake_request_id,p_activity_id,v_allowed);
  else
    v_base:=jsonb_build_object('version','capability_apply_v0_3_persistent_construct_ref','requested',0,'results','[]'::jsonb,'constructs','{}'::jsonb);
  end if;

  v_feedback:=jsonb_build_object(
    'version','capability_apply_v0_4_product_test_design_gate',
    'requested',jsonb_array_length(p_requests),
    'results',coalesce(v_base->'results','[]'::jsonb)||v_blocked,
    'constructs',coalesce(v_base->'constructs','{}'::jsonb),
    'product_test_design',v_design,
    'rule','During product_service_test, external build/deployment is allowed only after the independent acceptance specification is FROZEN. REQUESTED still does not mean SUCCEEDED.'
  );

  update agent_lab.state
  set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
        'last_capability_request_feedback',v_feedback,'last_capability_request_feedback_at',now()
      ),updated_at=now()
  where agent_id=p_agent_id;
  return v_feedback;
end
$$;

create or replace function agent_lab.ensure_product_test_run_v0_2(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','agent_lab'
as $$
declare
  v_test agent_lab.product_service_tests%rowtype;
  v_design agent_lab.product_test_designs%rowtype;
  v_run_id uuid; v_deployment_ready boolean:=false;
begin
  select * into v_test from agent_lab.product_service_tests
  where agent_id=p_agent_id and protocol_version='product_service_test_v0_1'
  order by updated_at desc limit 1;
  if not found or v_test.construct_id is null then return jsonb_build_object('ok',false,'reason','product_service_test_or_construct_missing'); end if;

  select * into v_design from agent_lab.product_test_designs d
  where d.product_service_test_id=v_test.product_service_test_id and d.status='frozen'
  order by d.frozen_at desc nulls last,d.created_at desc limit 1;
  if not found then return jsonb_build_object('ok',false,'reason','frozen_product_test_design_required'); end if;

  select exists(
    select 1 from agent_lab.infrastructure_broker_jobs j
    join agent_lab.infrastructure_broker_requests r on r.broker_request_id=j.broker_request_id
    where j.construct_id=v_test.construct_id and j.provider='vercel'
      and r.resource_type='deployment' and r.operation='deploy'
      and j.status='succeeded'
      and coalesce((j.result_payload->>'site_http_status')::integer,0) between 200 and 399
  ) into v_deployment_ready;
  if not coalesce(v_deployment_ready,false) then return jsonb_build_object('ok',false,'reason','runtime_verified_deployment_required'); end if;

  select product_test_run_id into v_run_id from agent_lab.product_test_runs
  where product_test_design_id=v_design.product_test_design_id limit 1;
  if v_run_id is null then
    insert into agent_lab.product_test_runs(product_test_design_id,product_service_test_id,agent_id,status,metadata)
    values(v_design.product_test_design_id,v_test.product_service_test_id,p_agent_id,'queued',
      jsonb_build_object('created_by','ensure_product_test_run_v0_2','runtime_evidence_required',true,'agent_authored_tests_are_not_authoritative',true))
    returning product_test_run_id into v_run_id;
  end if;
  return jsonb_build_object('ok',true,'product_test_run_id',v_run_id,'status',(select status from agent_lab.product_test_runs where product_test_run_id=v_run_id));
end
$$;

create or replace function agent_lab.get_product_test_run_context_v0_2(p_agent_id uuid)
returns jsonb
language plpgsql
stable
set search_path='pg_catalog','agent_lab'
as $$
declare v_run agent_lab.product_test_runs%rowtype;
begin
  select r.* into v_run
  from agent_lab.product_test_runs r
  join agent_lab.product_test_designs d on d.product_test_design_id=r.product_test_design_id
  join agent_lab.product_service_tests t on t.product_service_test_id=r.product_service_test_id
  where r.agent_id=p_agent_id and d.status='frozen' and t.protocol_version='product_service_test_v0_1'
  order by r.created_at desc limit 1;
  if not found then
    return jsonb_build_object(
      'version','product_test_execution_v0_2','exists',false,'status','NOT_RUN',
      'rule','Final approval requires an independent runtime test run against the frozen specification after a runtime-verified live deployment.'
    );
  end if;
  return jsonb_build_object(
    'version','product_test_execution_v0_2','exists',true,
    'product_test_run_id',v_run.product_test_run_id,'product_test_design_id',v_run.product_test_design_id,
    'status',upper(v_run.status),'metrics',v_run.metrics,'final_report',v_run.final_report,
    'error_code',v_run.error_code,'error_message',v_run.error_message,
    'started_at',v_run.started_at,'completed_at',v_run.completed_at,
    'rule','Only runtime-generated independent evidence can set VERIFIED_PASS. Agent-authored tests may contribute evidence but cannot self-certify the product.'
  );
end
$$;

create or replace function agent_lab.enqueue_product_test_run_after_deployment_v0_2()
returns trigger
language plpgsql
set search_path='pg_catalog','agent_lab'
as $$
declare v_agent_id uuid; v_resource_type text; v_operation text;
begin
  if new.status='succeeded' and old.status is distinct from new.status
     and new.construct_id is not null and new.provider='vercel' then
    select r.resource_type,r.operation into v_resource_type,v_operation
    from agent_lab.infrastructure_broker_requests r where r.broker_request_id=new.broker_request_id;
    if v_resource_type='deployment' and v_operation='deploy' then
      select c.owner_agent_id into v_agent_id from agent_lab.agent_constructs c where c.construct_id=new.construct_id;
      if v_agent_id is not null and agent_lab.current_mandatory_lifecycle_stage(v_agent_id)='product_service_test' then
        perform agent_lab.ensure_product_test_run_v0_2(v_agent_id);
      end if;
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_product_test_run_after_deployment_v0_2 on agent_lab.infrastructure_broker_jobs;
create trigger trg_product_test_run_after_deployment_v0_2
after update of status on agent_lab.infrastructure_broker_jobs
for each row execute function agent_lab.enqueue_product_test_run_after_deployment_v0_2();

create or replace function public.aau_bridge_claim_product_test_run(p_bridge_token text,p_executor_id text)
returns table(
  product_test_run_id uuid,product_test_design_id uuid,product_service_test_id uuid,agent_id uuid,
  submission_snapshot jsonb,claim_manifest jsonb,specification jsonb,production_url text,repo_url text,metadata jsonb
)
language plpgsql
security definer
set search_path='pg_catalog','public','agent_lab'
as $$
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if nullif(trim(coalesce(p_executor_id,'')),'') is null then raise exception 'executor_id_required'; end if;
  return query
  with candidate as (
    select r.product_test_run_id from agent_lab.product_test_runs r
    where r.status='queued' order by r.created_at for update skip locked limit 1
  ), claimed as (
    update agent_lab.product_test_runs r
    set status='running',executor_id=p_executor_id,attempt_count=r.attempt_count+1,
        started_at=coalesce(r.started_at,now()),error_code=null,error_message=null,updated_at=now()
    from candidate c where r.product_test_run_id=c.product_test_run_id returning r.*
  )
  select r.product_test_run_id,r.product_test_design_id,r.product_service_test_id,r.agent_id,
         d.submission_snapshot,d.claim_manifest,d.specification,dep.production_url,repo.repo_url,r.metadata
  from claimed r
  join agent_lab.product_test_designs d on d.product_test_design_id=r.product_test_design_id
  join agent_lab.product_service_tests t on t.product_service_test_id=r.product_service_test_id
  left join lateral (
    select coalesce(nullif(j.result_payload->>'production_url',''),nullif(j.result_payload->>'deployment_url','')) as production_url
    from agent_lab.infrastructure_broker_jobs j
    join agent_lab.infrastructure_broker_requests br on br.broker_request_id=j.broker_request_id
    where j.construct_id=t.construct_id and j.provider='vercel'
      and br.resource_type='deployment' and br.operation='deploy' and j.status='succeeded'
      and coalesce((j.result_payload->>'site_http_status')::integer,0) between 200 and 399
    order by j.finished_at desc nulls last,j.created_at desc limit 1
  ) dep on true
  left join lateral (
    select a.external_url as repo_url from agent_lab.construct_assets a
    where a.construct_id=t.construct_id and a.provider='github'
      and a.asset_type='repository' and a.status='active'
    order by a.updated_at desc limit 1
  ) repo on true;
end
$$;

create or replace function public.aau_bridge_complete_product_test_run(
  p_bridge_token text,p_product_test_run_id uuid,p_executor_id text,p_verdict text,
  p_evidence jsonb,p_metrics jsonb,p_final_report jsonb
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','agent_lab'
as $$
declare
  v_run agent_lab.product_test_runs%rowtype; v_design agent_lab.product_test_designs%rowtype;
  v_required_load boolean:=false; v_required_users integer:=0; v_actual_users integer:=0;
  v_all_verified boolean:=false; v_authoritative text; v_eval jsonb;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if p_verdict not in ('verified_pass','verified_fail') then raise exception 'invalid_product_test_verdict'; end if;
  select * into v_run from agent_lab.product_test_runs where product_test_run_id=p_product_test_run_id for update;
  if not found then raise exception 'product_test_run_not_found'; end if;
  if v_run.status<>'running' then raise exception 'product_test_run_not_running'; end if;
  if coalesce(v_run.executor_id,'')<>coalesce(p_executor_id,'') then raise exception 'product_test_run_executor_mismatch'; end if;
  select * into v_design from agent_lab.product_test_designs where product_test_design_id=v_run.product_test_design_id;

  begin v_required_load:=coalesce((v_design.specification#>>'{load_test,required}')::boolean,false); exception when others then v_required_load:=false; end;
  begin v_required_users:=coalesce((v_design.specification#>>'{load_test,virtual_users}')::integer,0); exception when others then v_required_users:=0; end;
  begin v_actual_users:=coalesce((p_metrics#>>'{load,virtual_users}')::integer,0); exception when others then v_actual_users:=0; end;
  begin v_all_verified:=coalesce((p_final_report->>'all_required_gates_verified')::boolean,false); exception when others then v_all_verified:=false; end;

  v_authoritative:=case
    when p_verdict='verified_pass' and v_all_verified
      and (not v_required_load or (
        coalesce((p_metrics#>>'{load,completed}')::boolean,false) and v_actual_users>=v_required_users
      ))
    then 'verified_pass' else 'verified_fail' end;

  update agent_lab.product_test_runs
  set status=v_authoritative,evidence=coalesce(p_evidence,'{}'::jsonb),metrics=coalesce(p_metrics,'{}'::jsonb),
      final_report=coalesce(p_final_report,'{}'::jsonb)||jsonb_build_object(
        'worker_reported_verdict',p_verdict,'authoritative_verdict',v_authoritative,'runtime_gate_authority',true
      ),
      completed_at=now(),updated_at=now()
  where product_test_run_id=p_product_test_run_id;

  v_eval:=agent_lab.evaluate_product_service_test_v0_1(v_run.agent_id);
  return jsonb_build_object('ok',true,'product_test_run_id',p_product_test_run_id,'verdict',v_authoritative,'product_service_evaluation',v_eval);
end
$$;

create or replace function public.aau_bridge_fail_product_test_run(
  p_bridge_token text,p_product_test_run_id uuid,p_executor_id text,
  p_error_code text,p_error_message text,p_retryable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','public','agent_lab'
as $$
declare v_run agent_lab.product_test_runs%rowtype; v_status text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select * into v_run from agent_lab.product_test_runs where product_test_run_id=p_product_test_run_id for update;
  if not found then raise exception 'product_test_run_not_found'; end if;
  if coalesce(v_run.executor_id,'')<>coalesce(p_executor_id,'') then raise exception 'product_test_run_executor_mismatch'; end if;
  v_status:=case when coalesce(p_retryable,true) and v_run.attempt_count<2 then 'queued' else 'failed' end;
  update agent_lab.product_test_runs
  set status=v_status,executor_id=case when v_status='queued' then null else executor_id end,
      error_code=left(coalesce(p_error_code,'product_test_executor_error'),160),
      error_message=left(coalesce(p_error_message,'unknown error'),4000),updated_at=now()
  where product_test_run_id=p_product_test_run_id;
  return jsonb_build_object('ok',true,'status',v_status,'attempt_count',v_run.attempt_count);
end
$$;

grant execute on function public.aau_bridge_claim_product_test_run(text,text) to anon,authenticated,service_role;
grant execute on function public.aau_bridge_complete_product_test_run(text,uuid,text,text,jsonb,jsonb,jsonb) to anon,authenticated,service_role;
grant execute on function public.aau_bridge_fail_product_test_run(text,uuid,text,text,text,boolean) to anon,authenticated,service_role;

-- Preserve the prior v0.1 deterministic verifier but make its result only a prerequisite.
do $$
begin
  if to_regprocedure('agent_lab.evaluate_product_service_test_v0_1_pre_independent_test(uuid)') is null
     and to_regprocedure('agent_lab.evaluate_product_service_test_v0_1(uuid)') is not null then
    execute 'alter function agent_lab.evaluate_product_service_test_v0_1(uuid) rename to evaluate_product_service_test_v0_1_pre_independent_test';
  end if;
end
$$;

create or replace function agent_lab.evaluate_product_service_test_v0_1(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path='pg_catalog','agent_lab'
as $$
declare
  v_base jsonb; v_old_pass boolean:=false; v_test_run jsonb; v_test_pass boolean:=false;
  v_pass boolean:=false; v_test_id uuid; v_report jsonb; v_status text;
begin
  v_base:=agent_lab.evaluate_product_service_test_v0_1_pre_independent_test(p_agent_id);
  begin v_old_pass:=coalesce((v_base->>'passed')::boolean,false); exception when others then v_old_pass:=false; end;
  v_test_run:=agent_lab.get_product_test_run_context_v0_2(p_agent_id);
  v_test_pass:=coalesce(v_test_run->>'status','')='VERIFIED_PASS';
  v_pass:=v_old_pass and v_test_pass;
  begin v_test_id:=(v_base->>'product_service_test_id')::uuid; exception when others then v_test_id:=null; end;

  v_report:=coalesce(v_base->'report','{}'::jsonb)||jsonb_build_object(
    'version','product_service_test_verifier_v0_2_independent_execution',
    'passed',v_pass,'independent_product_test',v_test_run,
    'rule','Deployment is only a prerequisite. Final Product/Service Test approval requires a frozen independent test specification and a runtime-generated independent test run with VERIFIED_PASS.'
  );

  if v_test_id is not null then
    v_status:=case
      when v_pass then 'verified_pass'
      when coalesce(v_test_run->>'status','')='VERIFIED_FAIL' then 'verified_fail'
      else 'building'
    end;
    update agent_lab.product_service_tests
    set verification_report=v_report,status=v_status,
        verified_at=case when v_pass then coalesce(verified_at,now()) else null end,
        updated_at=now()
    where product_service_test_id=v_test_id;
  end if;

  return jsonb_build_object(
    'ok',coalesce((v_base->>'ok')::boolean,true),'passed',v_pass,
    'product_service_test_id',v_test_id,'construct_id',v_base->'construct_id','report',v_report
  );
end
$$;

-- Expose both frozen test design and independent execution state to cognition.
do $$
begin
  if to_regprocedure('agent_lab.build_product_service_test_context_v0_1_base(uuid)') is null
     and to_regprocedure('agent_lab.build_product_service_test_context_v0_1(uuid)') is not null then
    execute 'alter function agent_lab.build_product_service_test_context_v0_1(uuid) rename to build_product_service_test_context_v0_1_base';
  end if;
end
$$;

create or replace function agent_lab.build_product_service_test_context_v0_1(p_agent_id uuid)
returns jsonb
language sql
stable
set search_path='pg_catalog','agent_lab'
as $$
  select agent_lab.build_product_service_test_context_v0_1_base(p_agent_id)
    || jsonb_build_object(
      'product_test_design',agent_lab.get_product_test_design_context_v0_2(p_agent_id),
      'test_design_rule','Before external build/deployment, AAU freezes the agent-authored claims and the Authenticator creates a proportional behavioral acceptance specification. Deployment alone never proves the product.',
      'product_test_execution',agent_lab.get_product_test_run_context_v0_2(p_agent_id),
      'final_approval_rule','A live deployment is not sufficient. VERIFIED_PASS requires independent runtime execution of the frozen Product Test Specification.'
    )
$$;

commit;
