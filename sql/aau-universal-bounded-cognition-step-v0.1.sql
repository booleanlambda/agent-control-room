
-- Universal bounded cognition step checkpoints v0.1
begin;

create table if not exists agent_lab.cognition_step_checkpoints (
  step_checkpoint_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  assignment_key text not null,
  step_key text not null,
  model_id text not null,
  artifact text not null,
  artifact_hash text not null,
  step_metadata jsonb not null default '{}'::jsonb,
  source_wake_request_id uuid not null,
  created_at timestamptz not null default now(),
  unique(agent_id,assignment_key,step_key,model_id)
);

create index if not exists cognition_step_checkpoints_recent_idx
  on agent_lab.cognition_step_checkpoints(agent_id,created_at desc);

alter table agent_lab.cognition_step_checkpoints enable row level security;
revoke all on agent_lab.cognition_step_checkpoints from public,anon,authenticated;

create or replace function public.aau_bridge_cognition_step_checkpoint(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_assignment_key text,
  p_step_key text,
  p_model text,
  p_action text,
  p_artifact text default null,
  p_meta jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','extensions'
as $$
declare
  v_bound text;
  v_hash text;
  v_row agent_lab.cognition_step_checkpoints%rowtype;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if p_action not in ('get','save') then raise exception 'invalid_cognition_step_action'; end if;
  if length(coalesce(p_assignment_key,'')) not between 1 and 240
     or length(coalesce(p_step_key,'')) not between 1 and 120 then
    raise exception 'invalid_cognition_step_identity';
  end if;
  if not exists (
    select 1 from agent_lab.wake_queue w
    where w.agent_id=p_agent_id and w.wake_request_id=p_wake_request_id
      and w.status in ('running','claimed')
  ) then raise exception 'cognition_step_wake_not_running'; end if;
  select primary_model_id into v_bound from agent_lab.agents where agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'cognition_step_bound_model_mismatch';
  end if;

  if p_action='save' then
    if p_artifact is null or octet_length(p_artifact) not between 20 and 50000 then
      raise exception 'invalid_cognition_step_artifact';
    end if;
    if p_meta is null or jsonb_typeof(p_meta)<>'object' or octet_length(p_meta::text)>15000 then
      raise exception 'invalid_cognition_step_metadata';
    end if;
    v_hash:=encode(extensions.digest(p_artifact,'sha256'),'hex');
    insert into agent_lab.cognition_step_checkpoints(
      agent_id,assignment_key,step_key,model_id,artifact,artifact_hash,step_metadata,source_wake_request_id
    ) values (
      p_agent_id,p_assignment_key,p_step_key,p_model,p_artifact,v_hash,p_meta,p_wake_request_id
    )
    on conflict (agent_id,assignment_key,step_key,model_id) do nothing;
  end if;

  select * into v_row from agent_lab.cognition_step_checkpoints
  where agent_id=p_agent_id and assignment_key=p_assignment_key
    and step_key=p_step_key and model_id=p_model;

  if not found then return jsonb_build_object('status','not_found'); end if;
  if encode(extensions.digest(v_row.artifact,'sha256'),'hex') is distinct from v_row.artifact_hash then
    raise exception 'cognition_step_hash_mismatch';
  end if;

  return jsonb_build_object(
    'status','ready',
    'contract','universal_bounded_cognition_step_v0_1',
    'step_checkpoint_id',v_row.step_checkpoint_id,
    'assignment_key',v_row.assignment_key,
    'step_key',v_row.step_key,
    'model',v_row.model_id,
    'artifact',v_row.artifact,
    'artifact_hash',v_row.artifact_hash,
    'meta',v_row.step_metadata,
    'source_wake_request_id',v_row.source_wake_request_id,
    'created_at',v_row.created_at
  );
end;
$$;

revoke all on function public.aau_bridge_cognition_step_checkpoint(
  text,uuid,uuid,text,text,text,text,text,jsonb
) from public;
grant execute on function public.aau_bridge_cognition_step_checkpoint(
  text,uuid,uuid,text,text,text,text,text,jsonb
) to anon,authenticated,service_role;

commit;
