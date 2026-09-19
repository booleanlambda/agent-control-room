create or replace function agent_lab.build_product_service_test_context_v0_1_pre_execution(p_agent_id uuid)
returns jsonb
language sql
stable
set search_path to 'pg_catalog','agent_lab'
as $function$
  with base as (
    select agent_lab.build_product_service_test_context_v0_1_base(p_agent_id)
      || jsonb_build_object(
        'product_test_design',agent_lab.get_product_test_design_context_v0_2(p_agent_id),
        'test_design_rule','Before external build/deployment, AAU freezes the agent-authored claims and the Authenticator creates a proportional acceptance specification. Deployment alone never proves the product.'
      ) as ctx
  ),
  diag as (
    select j.result_payload->'deployment_diagnostics' as deployment_diagnostics
    from agent_lab.product_service_tests t
    join agent_lab.infrastructure_broker_jobs j
      on j.construct_id=t.construct_id
    join agent_lab.infrastructure_broker_requests r
      on r.broker_request_id=j.broker_request_id
    where t.agent_id=p_agent_id
      and t.protocol_version='product_service_test_v0_1'
      and j.provider='vercel'
      and r.resource_type='deployment'
      and r.operation='deploy'
    order by coalesce(j.finished_at,j.started_at,j.created_at) desc,j.created_at desc
    limit 1
  ),
  http_diag as (
    select ci.result_payload->'http_diagnostics' as http_diagnostics
    from agent_lab.capability_invocations ci
    where ci.agent_id=p_agent_id
      and ci.capability_code='vercel.deployment.inspect'
      and ci.status='completed'
      and ci.result_payload ? 'http_diagnostics'
    order by coalesce(ci.completed_at,ci.started_at,ci.requested_at) desc
    limit 1
  ),
  enriched as (
    select
      case
        when diag.deployment_diagnostics is null then base.ctx
        else jsonb_set(
          base.ctx,
          '{external_workflow,states,production_deployment,deployment_diagnostics}',
          diag.deployment_diagnostics,
          true
        )
      end as ctx,
      http_diag.http_diagnostics
    from base
    left join diag on true
    left join http_diag on true
  )
  select case
    when enriched.http_diagnostics is null then enriched.ctx
    else jsonb_set(
      enriched.ctx,
      '{external_workflow,states,production_deployment,http_diagnostics}',
      enriched.http_diagnostics,
      true
    )
  end
  from enriched;
$function$;
