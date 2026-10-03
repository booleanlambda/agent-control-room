create or replace function agent_lab.recover_stale_qda601_authenticator_reviews_v0_1(
  p_stale_after interval default interval '15 minutes'
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_count integer;
begin
  if p_stale_after is null or p_stale_after < interval '5 minutes' then
    p_stale_after:=interval '15 minutes';
  end if;

  update agent_lab.qda601_authenticator_reviews
     set status=case when attempts>=4 then 'failed' else 'queued' end,
         claimed_by=null,
         claimed_at=null,
         last_error=case
           when attempts>=4 then 'stale_authenticator_claim_retry_limit_reached'
           else 'stale_authenticator_claim_recovered'
         end,
         updated_at=now()
   where status='claimed'
     and claimed_at is not null
     and claimed_at < now()-p_stale_after;

  get diagnostics v_count=row_count;
  return v_count;
end;
$function$;

revoke all on function agent_lab.recover_stale_qda601_authenticator_reviews_v0_1(interval)
from public,anon,authenticated;

create or replace function public.aau_bridge_claim_qda601_authenticator_review(
  p_bridge_token text,
  p_executor_id text
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v agent_lab.qda601_authenticator_reviews%rowtype;
  v_artifact text;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if length(btrim(coalesce(p_executor_id,'')))<3 then
    raise exception 'qda_authenticator_executor_required';
  end if;

  perform agent_lab.recover_stale_qda601_authenticator_reviews_v0_1(interval '15 minutes');

  select * into v
  from agent_lab.qda601_authenticator_reviews
  where status='queued' and attempts<4
  order by created_at
  for update skip locked
  limit 1;

  if not found then return null; end if;

  update agent_lab.qda601_authenticator_reviews
  set status='claimed',claimed_by=p_executor_id,claimed_at=now(),
      attempts=attempts+1,last_error=null,updated_at=now()
  where review_id=v.review_id
  returning * into v;

  select inline_text into v_artifact
  from agent_lab.agent_files
  where file_id=v.file_id;

  if coalesce(v_artifact,'')='' then
    update agent_lab.qda601_authenticator_reviews
    set status='failed',last_error='frozen_artifact_missing',updated_at=now()
    where review_id=v.review_id;
    raise exception 'qda_authenticator_frozen_artifact_missing:%',v.review_id;
  end if;

  return jsonb_build_object(
    'status','claimed',
    'review_id',v.review_id,
    'agent_id',v.agent_id,
    'file_id',v.file_id,
    'unit_code',v.unit_code,
    'artifact_sha256',v.artifact_sha256,
    'artifact',v_artifact,
    'authenticator_model_requested',v.authenticator_model_requested,
    'attempts',v.attempts
  );
end
$function$;
