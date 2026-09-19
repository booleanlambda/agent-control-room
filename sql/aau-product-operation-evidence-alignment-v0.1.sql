-- AAU v0.1 operation-evidence alignment; applied to live database September 19, 2026.
-- Canonical proof requires a matching deployment ID, immutable git SHA, production alias, method, path and 2xx result.
-- Successful operation probe only starts independent product testing, never approves the product.
begin;

-- agent_lab.build_recent_capability_results_v0_1
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
    i.requested_at,
    i.updated_at,
    i.error_code,
    i.error_message,
    i.result_payload,
    row_number() over(order by i.requested_at desc) as rn
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
    and i.requested_at >= now()-interval '2 hours'
),
trimmed as (
  select * from recent where rn<=12
),
projected as (
  select
    t.capability_invocation_id,t.capability_code,t.status,t.requested_at,t.updated_at,
    t.error_code,t.error_message,
    case
      when t.capability_code='vercel.deployment.inspect' then
        jsonb_build_object(
          'deployment',coalesce(t.result_payload->'deployment','{}'::jsonb),
          'build_events',coalesce((
            select jsonb_agg(value order by ord)
            from jsonb_array_elements(coalesce(t.result_payload->'build_events','[]'::jsonb)) with ordinality e(value,ord)
            where ord<=20
          ),'[]'::jsonb),
          'latest_broker_deployment',coalesce(t.result_payload->'latest_broker_deployment','{}'::jsonb),
          'http_diagnostics',jsonb_build_object(
            'root_path_only',true,
            'endpoint_probe_state',coalesce(t.result_payload#>>'{http_diagnostics,endpoint_probe_state}','NOT_REQUESTED'),
            'tested_endpoints',coalesce(t.result_payload#>'{http_diagnostics,tested_endpoints}','{}'::jsonb),
            'production_root_status',t.result_payload#>>'{http_diagnostics,production,status}',
            'deployment_root_status',t.result_payload#>>'{http_diagnostics,deployment,status}',
            'endpoint_evidence_rule','Only matching method/path in tested_endpoints supports an endpoint status claim. A root-only 404 proves nothing about other routes.'
          )
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
              ) order by f.ord
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
    end result
  from trimmed t
)
select jsonb_build_object(
  'version','recent_capability_results_v0_3_endpoint_aligned',
  'rule','These are authoritative runtime capability results. status=completed means the action finished. A completed inspection is not pending; use its result before requesting the same inspection again. REQUESTED/queued is not completion.',
  'results',coalesce(jsonb_agg(
    jsonb_build_object(
      'capability_invocation_id',p.capability_invocation_id,
      'capability_code',p.capability_code,
      'status',upper(p.status),
      'requested_at',p.requested_at,
      'updated_at',p.updated_at,
      'error_code',p.error_code,
      'error_message',p.error_message,
      'result',p.result
    ) order by p.requested_at desc
  ),'[]'::jsonb)
)
from projected p
$function$


-- agent_lab.get_verified_product_operation_evidence_v0_1
CREATE OR REPLACE FUNCTION agent_lab.get_verified_product_operation_evidence_v0_1(p_agent_id uuid, p_construct_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
with last_review as (
 select r.status,r.completed_at from agent_lab.product_architecture_conformance_runs r
 where r.agent_id=p_agent_id and r.protocol_version='product_architecture_conformance_v0_1'
 order by r.created_at desc limit 1
), deployments as (
 select j.broker_job_id,j.result_payload,j.finished_at,j.created_at,
 coalesce(nullif(j.result_payload->>'production_url',''),nullif(j.result_payload->>'public_url','')) as production_url
 from agent_lab.infrastructure_broker_jobs j
 join agent_lab.infrastructure_broker_requests br on br.broker_request_id=j.broker_request_id
 cross join last_review lr
 where j.construct_id=p_construct_id and j.provider='vercel'
 and br.resource_type='deployment' and br.operation='deploy'
 and j.status='succeeded' and lr.status='VERIFIED_PASS'
 and lr.completed_at is not null and j.created_at>=lr.completed_at
 and j.result_payload->>'deployment_role'='CANONICAL_CANDIDATE'
 and nullif(j.result_payload->>'deployment_id','') is not null
 and nullif(j.result_payload->>'git_sha','') is not null
), matching as (
 select d.broker_job_id,d.production_url,d.result_payload as deployment_payload,d.finished_at,
 i.capability_invocation_id,i.completed_at as inspection_completed_at,p.probe
 from deployments d
 join agent_lab.capability_invocations i
 on i.agent_id=p_agent_id and i.construct_id=p_construct_id
 and i.capability_code='vercel.deployment.inspect' and i.status='completed'
 and i.completed_at>=d.finished_at
 and i.result_payload#>>'{deployment,id}'=d.result_payload->>'deployment_id'
 and i.result_payload#>>'{deployment,meta,githubCommitSha}'=d.result_payload->>'git_sha'
 and rtrim(coalesce(i.result_payload#>>'{http_diagnostics,production,requested_url}',''),'/')
   =rtrim(d.production_url,'/')
 cross join lateral jsonb_array_elements(
 coalesce(i.result_payload#>'{http_diagnostics,tested_endpoints,production}','[]'::jsonb)
 ) p(probe)
 where (p.probe->>'path') not in ('/health','/ready','/status','/live')
 and (p.probe->>'method') in ('GET','POST')
 and coalesce((p.probe->>'status')::integer,0) between 200 and 299
 and coalesce((p.probe->>'ok')::boolean,false)=true
 and coalesce((p.probe->>'authenticated_redirect')::boolean,false)=false
 and (p.probe->>'requested_url')=rtrim(d.production_url,'/') || (p.probe->>'path')
 and coalesce(p.probe->>'content_type','') not ilike '%vercel-auth%'
 and coalesce(p.probe->>'body_preview','') not ilike '%Protected deployment%'
)
select coalesce(
 (select jsonb_build_object(
 'verified',true,'deployment_job_id',m.broker_job_id,
 'deployment_id',m.deployment_payload->>'deployment_id',
 'git_sha',m.deployment_payload->>'git_sha',
 'production_url',m.production_url,
 'probe_invocation_id',m.capability_invocation_id,
 'probe_completed_at',m.inspection_completed_at,
 'operation_path',m.probe->>'path','operation_method',m.probe->>'method',
 'operation_http_status',(m.probe->>'status')::integer,
 'operation_content_type',m.probe->>'content_type',
 'source','exact_method_path_production_probe_v0_1'
 ) from matching m
 order by m.finished_at desc nulls last,m.inspection_completed_at desc limit 1),
 jsonb_build_object('verified',false,
 'reason','no_verified_post_conformance_canonical_operation_probe',
 'latest_architecture_conformance_status',(select status from last_review))
);
$function$


-- agent_lab.ensure_product_test_run_v0_2
CREATE OR REPLACE FUNCTION agent_lab.ensure_product_test_run_v0_2(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
 v_test agent_lab.product_service_tests%rowtype;
 v_design agent_lab.product_test_designs%rowtype;
 v_run_id uuid;
 v_proof jsonb;
begin
 select * into v_test from agent_lab.product_service_tests
 where agent_id=p_agent_id and protocol_version='product_service_test_v0_1'
 order by updated_at desc limit 1;
 if not found or v_test.construct_id is null then
   return jsonb_build_object('ok',false,'reason','product_service_test_or_construct_missing');
 end if;
 select * into v_design from agent_lab.product_test_designs d
 where d.product_service_test_id=v_test.product_service_test_id and d.status='frozen'
 order by d.frozen_at desc nulls last,d.created_at desc limit 1;
 if not found then
   return jsonb_build_object('ok',false,'reason','frozen_product_test_design_required');
 end if;
 v_proof:=agent_lab.get_verified_product_operation_evidence_v0_1(p_agent_id,v_test.construct_id);
 if not coalesce((v_proof->>'verified')::boolean,false) then
   return jsonb_build_object('ok',false,'reason','canonical_operation_probe_required','evidence',v_proof);
 end if;
 select product_test_run_id into v_run_id from agent_lab.product_test_runs
 where product_test_design_id=v_design.product_test_design_id limit 1;
 if v_run_id is null then
   insert into agent_lab.product_test_runs(
     product_test_design_id,product_service_test_id,agent_id,status,metadata)
   values (v_design.product_test_design_id,v_test.product_service_test_id,p_agent_id,'queued',
     jsonb_build_object(
       'created_by','ensure_product_test_run_v0_2',
       'runtime_evidence_required',true,
       'agent_authored_tests_are_not_authoritative',true,
       'canonical_operation_evidence',v_proof
     ))
   returning product_test_run_id into v_run_id;
 end if;
 return jsonb_build_object('ok',true,'product_test_run_id',v_run_id,
   'status',(select status from agent_lab.product_test_runs where product_test_run_id=v_run_id),
   'canonical_operation_evidence',v_proof);
end
$function$


-- agent_lab.evaluate_product_service_test_v0_1_pre_independent_test
CREATE OR REPLACE FUNCTION agent_lab.evaluate_product_service_test_v0_1_pre_independent_test(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_test agent_lab.product_service_tests%rowtype;
  v_plan_complete boolean:=false;
  v_arch_frozen boolean:=false;
  v_arch_id uuid:=null;
  v_conf_status text:=null;
  v_conformance_pass boolean:=false;
  v_conformance_completed timestamptz:=null;
  v_repo_ready boolean:=false;
  v_authored_files integer:=0;
  v_deployment_ready boolean:=false;
  v_http_status integer:=null;
  v_production_url text:=null;
  v_deployment_job_id uuid:=null;
  v_operation_evidence jsonb := '{}'::jsonb;
  v_pass boolean:=false;
  v_report jsonb;
begin
  select * into v_test
  from agent_lab.product_service_tests
  where agent_id=p_agent_id and protocol_version='product_service_test_v0_1'
  for update;

  if not found then
    return jsonb_build_object('ok',false,'reason','product_service_test_not_found');
  end if;

  v_plan_complete:=
    v_test.offering_type in ('product','service')
    and nullif(btrim(v_test.title),'') is not null
    and nullif(btrim(v_test.problem_statement),'') is not null
    and nullif(btrim(v_test.target_user),'') is not null
    and nullif(btrim(v_test.value_proposition),'') is not null
    and jsonb_typeof(v_test.success_criteria)='array'
    and jsonb_array_length(v_test.success_criteria)>0;

  select true,a.product_service_architecture_id
  into v_arch_frozen,v_arch_id
  from agent_lab.product_service_architectures a
  where a.product_service_test_id=v_test.product_service_test_id
    and a.protocol_version='product_service_architecture_v0_1'
    and a.status='FROZEN'
  order by a.created_at desc
  limit 1;
  v_arch_frozen:=coalesce(v_arch_frozen,false);

  if v_arch_frozen then
    select r.status,r.completed_at
    into v_conf_status,v_conformance_completed
    from agent_lab.product_architecture_conformance_runs r
    where r.product_service_architecture_id=v_arch_id
      and r.protocol_version='product_architecture_conformance_v0_1'
    order by r.created_at desc
    limit 1;
  end if;
  v_conformance_pass:=coalesce(v_conf_status,'')='VERIFIED_PASS';

  if v_test.construct_id is not null then
    select
      count(*)>0,
      coalesce(max(case when j.status='succeeded' and j.provider='github'
                        then coalesce((j.result_payload->>'agent_authored_files_written')::integer,0)
                        else 0 end),0)
    into v_repo_ready,v_authored_files
    from agent_lab.construct_assets a
    left join agent_lab.infrastructure_broker_jobs j on j.broker_job_id=a.broker_job_id
    where a.construct_id=v_test.construct_id
      and a.provider='github'
      and a.asset_type='repository'
      and a.status='active';
    v_repo_ready:=coalesce(v_repo_ready,false) and v_authored_files>0;


    if v_conformance_pass then
      v_operation_evidence := agent_lab.get_verified_product_operation_evidence_v0_1(p_agent_id,v_test.construct_id);
      v_deployment_ready := coalesce((v_operation_evidence->>'verified')::boolean,false);
      if v_deployment_ready then
        v_http_status := (v_operation_evidence->>'operation_http_status')::integer;
        v_production_url := v_operation_evidence->>'production_url';
        v_deployment_job_id := (v_operation_evidence->>'deployment_job_id')::uuid;
      end if;
    end if;
  end if;

  v_deployment_ready:=coalesce(v_deployment_ready,false);
  v_pass:=v_plan_complete
    and v_test.construct_id is not null
    and v_arch_frozen
    and v_repo_ready
    and v_conformance_pass
    and v_deployment_ready;

  v_report:=jsonb_build_object(
    'version','product_service_test_verifier_v0_4_operation_evidence',
    'passed',v_pass,
    'criteria',jsonb_build_object(
      'agent_authored_plan_complete',v_plan_complete,
      'construct_exists',v_test.construct_id is not null,
      'product_service_architecture_frozen',v_arch_frozen,
      'durable_github_repository_with_agent_authored_files',v_repo_ready,
      'agent_authored_files_written',v_authored_files,
      'latest_architecture_conformance_status',v_conf_status,
      'architecture_conformance_verified_pass',v_conformance_pass,
      'canonical_live_deployment_after_conformance',v_deployment_ready,
      'canonical_deployment_broker_job_id',v_deployment_job_id,
      'site_http_status',v_http_status,
      'verified_operation_method',v_operation_evidence->>'operation_method',
      'verified_operation_path',v_operation_evidence->>'operation_path',
      'operation_probe_invocation_id',v_operation_evidence->>'probe_invocation_id',
      'root_http_status_is_not_operation_status',true,
      'production_url',v_production_url,
      'revenue_required',false
    ),
    'rule','A canonical deployment is eligible only after a frozen Product/Service Architecture and the latest independent architecture-conformance result is VERIFIED_PASS. Any later repository change invalidates the older pass until re-reviewed.'
  );

  update agent_lab.product_service_tests
  set verification_report=v_report,
      status='building',
      verified_at=null,
      updated_at=now()
  where product_service_test_id=v_test.product_service_test_id;

  return jsonb_build_object(
    'ok',true,'passed',v_pass,
    'product_service_test_id',v_test.product_service_test_id,
    'construct_id',v_test.construct_id,
    'report',v_report
  );
end;
$function$


-- public.aau_bridge_claim_product_test_run
CREATE OR REPLACE FUNCTION public.aau_bridge_claim_product_test_run(p_bridge_token text, p_executor_id text)
 RETURNS TABLE(product_test_run_id uuid, product_test_design_id uuid, product_service_test_id uuid, agent_id uuid, submission_snapshot jsonb, claim_manifest jsonb, specification jsonb, production_url text, repo_url text, metadata jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'agent_lab'
AS $function$
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if nullif(trim(coalesce(p_executor_id,'')),'') is null then
    raise exception 'executor_id_required';
  end if;

  return query
  with candidate as (
    select r.product_test_run_id
    from agent_lab.product_test_runs r
    where r.status='queued'
    order by r.created_at
    for update skip locked
    limit 1
  ), claimed as (
    update agent_lab.product_test_runs r
    set status='running',
        executor_id=p_executor_id,
        attempt_count=r.attempt_count+1,
        started_at=coalesce(r.started_at,now()),
        error_code=null,
        error_message=null,
        updated_at=now()
    from candidate c
    where r.product_test_run_id=c.product_test_run_id
    returning r.*
  )
  select
    r.product_test_run_id,
    r.product_test_design_id,
    r.product_service_test_id,
    r.agent_id,
    d.submission_snapshot,
    d.claim_manifest,
    d.specification,
    dep.production_url,
    repo.repo_url,
    r.metadata
  from claimed r
  join agent_lab.product_test_designs d on d.product_test_design_id=r.product_test_design_id
  join agent_lab.product_service_tests t on t.product_service_test_id=r.product_service_test_id
  left join lateral (
    select coalesce(nullif(j.result_payload->>'production_url',''),nullif(j.result_payload->>'deployment_url','')) as production_url
    from agent_lab.infrastructure_broker_jobs j
    join agent_lab.infrastructure_broker_requests br on br.broker_request_id=j.broker_request_id
    where j.construct_id=t.construct_id
      and j.provider='vercel'
      and br.resource_type='deployment'
      and br.operation='deploy'
      and j.status='succeeded'
      and coalesce((agent_lab.get_verified_product_operation_evidence_v0_1(r.agent_id,t.construct_id)->>'verified')::boolean,false)
      and j.broker_job_id=(agent_lab.get_verified_product_operation_evidence_v0_1(r.agent_id,t.construct_id)->>'deployment_job_id')::uuid
    order by j.finished_at desc nulls last,j.created_at desc
    limit 1
  ) dep on true
  left join lateral (
    select a.external_url as repo_url
    from agent_lab.construct_assets a
    where a.construct_id=t.construct_id
      and a.provider='github'
      and a.asset_type='repository'
      and a.status='active'
    order by a.updated_at desc
    limit 1
  ) repo on true;
end
$function$


-- agent_lab.enqueue_product_test_run_after_operation_inspection_v0_1
CREATE OR REPLACE FUNCTION agent_lab.enqueue_product_test_run_after_operation_inspection_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare v_proof jsonb;
begin
 if new.capability_code='vercel.deployment.inspect'
    and new.status='completed'
    and old.status is distinct from new.status
    and new.agent_id is not null and new.construct_id is not null then
   v_proof:=agent_lab.get_verified_product_operation_evidence_v0_1(new.agent_id,new.construct_id);
   if coalesce((v_proof->>'verified')::boolean,false)
      and v_proof->>'probe_invocation_id'=new.capability_invocation_id::text
      and agent_lab.current_mandatory_lifecycle_stage(new.agent_id)='product_service_test' then
     perform agent_lab.ensure_product_test_run_v0_2(new.agent_id);
   end if;
 end if;
 return new;
end
$function$


drop trigger if exists trg_enqueue_product_test_run_after_operation_inspection_v0_1 on agent_lab.capability_invocations;
create trigger trg_enqueue_product_test_run_after_operation_inspection_v0_1 after update of status on agent_lab.capability_invocations for each row execute function agent_lab.enqueue_product_test_run_after_operation_inspection_v0_1();
commit;