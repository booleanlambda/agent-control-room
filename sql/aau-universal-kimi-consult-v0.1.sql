-- Universal Kimi Consultation Queue v0.1
-- Purpose: provide one reusable, auditable path for AAU/SAAU components to ask Kimi K3.
-- This migration creates no requests and therefore makes no model calls.

begin;

create table if not exists agent_lab.kimi_consult_requests (
  kimi_consult_request_id uuid primary key default gen_random_uuid(),
  protocol_version text not null default 'universal_kimi_consult_v0_1',
  source_kind text not null default 'operator',
  requester text,
  label text,
  system_prompt text not null,
  user_prompt text not null,
  status text not null default 'PENDING'
    check (status in ('PENDING','RUNNING','COMPLETE','ERROR','CANCELLED')),
  max_tokens integer not null default 2400
    check (max_tokens between 128 and 8192),
  reasoning_effort text not null default 'low'
    check (reasoning_effort in ('low','high','max')),
  json_mode boolean not null default false,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  claim_expires_at timestamptz,
  model_requested text not null default 'kimi-k3',
  model_used text,
  finish_reason text,
  usage jsonb,
  latency_ms integer,
  response_text text,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table agent_lab.kimi_consult_requests enable row level security;

revoke all on table agent_lab.kimi_consult_requests from anon, authenticated;

create index if not exists ix_kimi_consult_requests_status_created
  on agent_lab.kimi_consult_requests(status, created_at);

create unique index if not exists ux_kimi_consult_requests_idempotency
  on agent_lab.kimi_consult_requests(idempotency_key)
  where idempotency_key is not null;

create or replace function public.aau_bridge_submit_kimi_consult(
  p_bridge_token text,
  p_system_prompt text,
  p_user_prompt text,
  p_requester text default null,
  p_label text default null,
  p_source_kind text default 'operator',
  p_max_tokens integer default 2400,
  p_reasoning_effort text default 'low',
  p_json_mode boolean default false,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_id uuid;
  v_effort text := lower(trim(coalesce(p_reasoning_effort,'low')));
  v_system text := trim(coalesce(p_system_prompt,''));
  v_user text := trim(coalesce(p_user_prompt,''));
  v_idem text := nullif(trim(coalesce(p_idempotency_key,'')),'');
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if v_system = '' then raise exception 'kimi_consult_system_prompt_required'; end if;
  if v_user = '' then raise exception 'kimi_consult_user_prompt_required'; end if;
  if length(v_system) > 32000 then raise exception 'kimi_consult_system_prompt_too_large'; end if;
  if length(v_user) > 120000 then raise exception 'kimi_consult_user_prompt_too_large'; end if;
  if v_effort not in ('low','high','max') then raise exception 'kimi_consult_invalid_reasoning_effort'; end if;

  insert into agent_lab.kimi_consult_requests(
    source_kind,requester,label,system_prompt,user_prompt,status,
    max_tokens,reasoning_effort,json_mode,idempotency_key,metadata
  )
  values(
    left(coalesce(nullif(trim(p_source_kind),''),'operator'),120),
    nullif(left(trim(coalesce(p_requester,'')),300),''),
    nullif(left(trim(coalesce(p_label,'')),300),''),
    v_system,
    v_user,
    'PENDING',
    greatest(128,least(coalesce(p_max_tokens,2400),8192)),
    v_effort,
    coalesce(p_json_mode,false),
    v_idem,
    coalesce(p_metadata,'{}'::jsonb)
  )
  on conflict (idempotency_key) where idempotency_key is not null
  do update set idempotency_key=excluded.idempotency_key
  returning kimi_consult_request_id into v_id;

  return jsonb_build_object(
    'ok',true,
    'kimi_consult_request_id',v_id,
    'status',(select status from agent_lab.kimi_consult_requests where kimi_consult_request_id=v_id),
    'protocol_version','universal_kimi_consult_v0_1'
  );
end;
$function$;

create or replace function public.aau_bridge_claim_kimi_consult(
  p_bridge_token text,
  p_executor_id text,
  p_lease_seconds integer default 300
)
returns table(
  kimi_consult_request_id uuid,
  system_prompt text,
  user_prompt text,
  max_tokens integer,
  reasoning_effort text,
  json_mode boolean,
  attempt_count integer,
  label text,
  requester text,
  source_kind text,
  metadata jsonb
)
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  return query
  with candidate as (
    select r.kimi_consult_request_id
    from agent_lab.kimi_consult_requests r
    where (
      r.status='PENDING'
      or (r.status='RUNNING' and r.claim_expires_at is not null and r.claim_expires_at<now())
    )
    and r.attempt_count < 3
    order by r.created_at asc
    limit 1
    for update skip locked
  ),
  claimed as (
    update agent_lab.kimi_consult_requests r
    set status='RUNNING',
        claimed_by=left(coalesce(p_executor_id,'unknown'),300),
        claimed_at=now(),
        claim_expires_at=now()+make_interval(secs=>greatest(60,least(coalesce(p_lease_seconds,300),900))),
        attempt_count=r.attempt_count+1,
        started_at=coalesce(r.started_at,now()),
        error_code=null,
        error_message=null,
        updated_at=now()
    from candidate c
    where r.kimi_consult_request_id=c.kimi_consult_request_id
    returning r.*
  )
  select
    c.kimi_consult_request_id,
    c.system_prompt,
    c.user_prompt,
    c.max_tokens,
    c.reasoning_effort,
    c.json_mode,
    c.attempt_count,
    c.label,
    c.requester,
    c.source_kind,
    c.metadata
  from claimed c;
end;
$function$;

create or replace function public.aau_bridge_complete_kimi_consult(
  p_bridge_token text,
  p_kimi_consult_request_id uuid,
  p_executor_id text,
  p_response_text text,
  p_model_used text,
  p_finish_reason text,
  p_usage jsonb default null,
  p_latency_ms integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_text text := trim(coalesce(p_response_text,''));
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if v_text='' then raise exception 'kimi_consult_empty_final_response'; end if;

  update agent_lab.kimi_consult_requests
  set status='COMPLETE',
      response_text=v_text,
      model_used=nullif(trim(coalesce(p_model_used,'')),''),
      finish_reason=nullif(trim(coalesce(p_finish_reason,'')),''),
      usage=p_usage,
      latency_ms=case when p_latency_ms is null then null else greatest(0,p_latency_ms) end,
      claim_expires_at=null,
      error_code=null,
      error_message=null,
      completed_at=now(),
      updated_at=now()
  where kimi_consult_request_id=p_kimi_consult_request_id
    and status='RUNNING'
    and claimed_by=left(coalesce(p_executor_id,'unknown'),300);

  if not found then raise exception 'kimi_consult_claim_not_owned'; end if;

  return jsonb_build_object(
    'ok',true,
    'kimi_consult_request_id',p_kimi_consult_request_id,
    'status','COMPLETE'
  );
end;
$function$;

create or replace function public.aau_bridge_fail_kimi_consult(
  p_bridge_token text,
  p_kimi_consult_request_id uuid,
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
  from agent_lab.kimi_consult_requests
  where kimi_consult_request_id=p_kimi_consult_request_id
    and claimed_by=left(coalesce(p_executor_id,'unknown'),300)
  for update;

  if v_attempt is null then raise exception 'kimi_consult_claim_not_owned'; end if;

  v_status := case
    when coalesce(p_retryable,true) and v_attempt < 3 then 'PENDING'
    else 'ERROR'
  end;

  update agent_lab.kimi_consult_requests
  set status=v_status,
      claimed_by=case when v_status='PENDING' then null else claimed_by end,
      claimed_at=case when v_status='PENDING' then null else claimed_at end,
      claim_expires_at=null,
      error_code=left(coalesce(nullif(trim(p_error_code),''),'kimi_consult_error'),200),
      error_message=left(coalesce(p_error_message,'unknown error'),4000),
      completed_at=case when v_status='ERROR' then now() else completed_at end,
      updated_at=now()
  where kimi_consult_request_id=p_kimi_consult_request_id;

  return jsonb_build_object(
    'ok',true,
    'kimi_consult_request_id',p_kimi_consult_request_id,
    'status',v_status,
    'attempt_count',v_attempt
  );
end;
$function$;

create or replace function public.aau_bridge_get_kimi_consult(
  p_bridge_token text,
  p_kimi_consult_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab'
as $function$
declare
  v_row agent_lab.kimi_consult_requests%rowtype;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  select * into v_row
  from agent_lab.kimi_consult_requests
  where kimi_consult_request_id=p_kimi_consult_request_id;

  if not found then raise exception 'kimi_consult_request_not_found'; end if;

  return jsonb_build_object(
    'kimi_consult_request_id',v_row.kimi_consult_request_id,
    'protocol_version',v_row.protocol_version,
    'status',v_row.status,
    'source_kind',v_row.source_kind,
    'requester',v_row.requester,
    'label',v_row.label,
    'max_tokens',v_row.max_tokens,
    'reasoning_effort',v_row.reasoning_effort,
    'json_mode',v_row.json_mode,
    'attempt_count',v_row.attempt_count,
    'model_requested',v_row.model_requested,
    'model_used',v_row.model_used,
    'finish_reason',v_row.finish_reason,
    'usage',v_row.usage,
    'latency_ms',v_row.latency_ms,
    'response_text',v_row.response_text,
    'error_code',v_row.error_code,
    'error_message',v_row.error_message,
    'created_at',v_row.created_at,
    'started_at',v_row.started_at,
    'completed_at',v_row.completed_at,
    'metadata',v_row.metadata
  );
end;
$function$;

revoke all on function public.aau_bridge_submit_kimi_consult(text,text,text,text,text,text,integer,text,boolean,text,jsonb) from public;
revoke all on function public.aau_bridge_claim_kimi_consult(text,text,integer) from public;
revoke all on function public.aau_bridge_complete_kimi_consult(text,uuid,text,text,text,text,jsonb,integer) from public;
revoke all on function public.aau_bridge_fail_kimi_consult(text,uuid,text,text,text,boolean) from public;
revoke all on function public.aau_bridge_get_kimi_consult(text,uuid) from public;

grant execute on function public.aau_bridge_submit_kimi_consult(text,text,text,text,text,text,integer,text,boolean,text,jsonb)
  to anon,authenticated,service_role;
grant execute on function public.aau_bridge_claim_kimi_consult(text,text,integer)
  to anon,authenticated,service_role;
grant execute on function public.aau_bridge_complete_kimi_consult(text,uuid,text,text,text,text,jsonb,integer)
  to anon,authenticated,service_role;
grant execute on function public.aau_bridge_fail_kimi_consult(text,uuid,text,text,text,boolean)
  to anon,authenticated,service_role;
grant execute on function public.aau_bridge_get_kimi_consult(text,uuid)
  to anon,authenticated,service_role;

commit;
