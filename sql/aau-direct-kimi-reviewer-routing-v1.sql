-- AAU direct Kimi reviewer routing v1
-- Aligns durable reviewer provenance with the direct Moonshot Kimi K3 runtime.

begin;

alter table agent_lab.qda601_authenticator_reviews
  alter column authenticator_model_requested set default 'kimi-k3';

update agent_lab.qda601_authenticator_reviews
set authenticator_model_requested='kimi-k3',
    updated_at=now()
where status='queued'
  and authenticator_model_requested='moonshotai/kimi-k3';

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
          'authenticator_primary','kimi-k3',
          'authenticator_provider','moonshot_direct',
          'authenticator_reasoning_effort','low',
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

commit;
