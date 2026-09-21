-- Control Room v2: 24-hour operator sessions + change-token long polling.
create table if not exists agent_lab.control_room_sessions(
  session_id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);
alter table agent_lab.control_room_sessions enable row level security;
revoke all on agent_lab.control_room_sessions from public,anon,authenticated;
create index if not exists idx_control_room_sessions_token_hash on agent_lab.control_room_sessions(token_hash);
create index if not exists idx_control_room_sessions_expires on agent_lab.control_room_sessions(expires_at) where revoked_at is null;

create or replace function public.aau_control_room_session_create(p_token_hash text,p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','agent_lab'
as $fn$
declare v_id uuid; v_exp timestamptz:=now()+interval '24 hours';
begin
  if length(coalesce(p_token_hash,''))<32 then raise exception 'invalid_session_hash'; end if;
  insert into agent_lab.control_room_sessions(token_hash,user_agent,expires_at)
  values(p_token_hash,left(p_user_agent,500),v_exp) returning session_id into v_id;
  delete from agent_lab.control_room_sessions where expires_at < now()-interval '7 days'
    or (revoked_at is not null and revoked_at < now()-interval '7 days');
  return jsonb_build_object('session_id',v_id,'expires_at',v_exp,'ttl_seconds',86400);
end $fn$;

create or replace function public.aau_control_room_session_validate(p_token_hash text)
returns jsonb language plpgsql security definer set search_path to 'pg_catalog','agent_lab'
as $fn$
declare v_row agent_lab.control_room_sessions%rowtype;
begin
  select * into v_row from agent_lab.control_room_sessions
  where token_hash=p_token_hash and revoked_at is null and expires_at>now() limit 1;
  if not found then return jsonb_build_object('valid',false); end if;
  update agent_lab.control_room_sessions set last_seen_at=now() where session_id=v_row.session_id;
  return jsonb_build_object('valid',true,'session_id',v_row.session_id,'expires_at',v_row.expires_at);
end $fn$;

create or replace function public.aau_control_room_session_revoke(p_token_hash text)
returns boolean language sql security definer set search_path to 'pg_catalog','agent_lab'
as $fn$
  update agent_lab.control_room_sessions set revoked_at=now()
  where token_hash=p_token_hash and revoked_at is null returning true
$fn$;

create or replace function public.aau_control_room_change_token()
returns jsonb language sql security definer set search_path to 'pg_catalog','agent_lab'
as $fn$
with revisions as (
  select
    coalesce((select max(updated_at) from agent_lab.agents),'epoch'::timestamptz) agents_rev,
    coalesce((select max(updated_at) from agent_lab.state),'epoch'::timestamptz) state_rev,
    coalesce((select max(updated_at) from agent_lab.autonomous_lifecycle_runs),'epoch'::timestamptz) lifecycle_rev,
    coalesce((select greatest(max(created_at),max(started_at),max(completed_at)) from agent_lab.wake_queue),'epoch'::timestamptz) wakes_rev,
    coalesce((select max(updated_at) from agent_lab.admin_chat_messages),'epoch'::timestamptz) chat_rev,
    coalesce((select max(updated_at) from agent_lab.agent_files),'epoch'::timestamptz) files_rev,
    coalesce((select max(updated_at) from agent_lab.expertise_economic_proposals),'epoch'::timestamptz) expertise_rev,
    coalesce((select max(updated_at) from agent_lab.attention_items),'epoch'::timestamptz) attention_rev
)
select jsonb_build_object(
 'token',md5(concat_ws('|',agents_rev,state_rev,lifecycle_rev,wakes_rev,chat_rev,files_rev,expertise_rev,attention_rev)),
 'agents_rev',agents_rev,'state_rev',state_rev,'lifecycle_rev',lifecycle_rev,'wakes_rev',wakes_rev,
 'chat_rev',chat_rev,'files_rev',files_rev,'expertise_rev',expertise_rev,'attention_rev',attention_rev
) from revisions
$fn$;

revoke all on function public.aau_control_room_session_create(text,text) from public,anon,authenticated;
revoke all on function public.aau_control_room_session_validate(text) from public,anon,authenticated;
revoke all on function public.aau_control_room_session_revoke(text) from public,anon,authenticated;
revoke all on function public.aau_control_room_change_token() from public,anon,authenticated;
grant execute on function public.aau_control_room_session_create(text,text) to service_role;
grant execute on function public.aau_control_room_session_validate(text) to service_role;
grant execute on function public.aau_control_room_session_revoke(text) to service_role;
grant execute on function public.aau_control_room_change_token() to service_role;
