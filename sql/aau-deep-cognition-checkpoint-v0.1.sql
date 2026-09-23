-- Durable DEEP cognition checkpoint for the AAU broker.
-- Agent-scoped, bound-model checked, broker-token guarded, and keyed to the
-- authoritative current MBA unit and progression counters. Only an auditable
-- work artifact is persisted, never hidden chain-of-thought.
begin;
create table if not exists agent_lab.deep_cognition_checkpoints (
  checkpoint_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  assignment_key text not null,
  model_id text not null,
  unit_id uuid not null,
  units_submitted integer not null,
  courses_passed integer not null,
  artifact text not null,
  artifact_hash text not null,
  cognitive_metadata jsonb not null default '{}'::jsonb,
  source_wake_request_id uuid not null references agent_lab.wake_queue(wake_request_id),
  created_at timestamptz not null default now(),
  unique(agent_id,assignment_key,model_id),
  constraint deep_cognition_checkpoint_artifact_size check (octet_length(artifact) between 30 and 100000),
  constraint deep_cognition_checkpoint_hash_length check (artifact_hash ~ '^[0-9a-f]{64}$')
);
create index if not exists deep_cognition_checkpoints_recent_idx on agent_lab.deep_cognition_checkpoints(agent_id,created_at desc);
alter table agent_lab.deep_cognition_checkpoints enable row level security;
revoke all on agent_lab.deep_cognition_checkpoints from public, anon, authenticated;
CREATE OR REPLACE FUNCTION public.aau_bridge_deep_cognition_checkpoint(p_bridge_token text, p_agent_id uuid, p_wake_request_id uuid, p_unit_id uuid, p_model text, p_action text, p_artifact text DEFAULT NULL::text, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_bound text;
  v_stage text;
  v_progress jsonb;
  v_unit_id uuid;
  v_units integer;
  v_courses integer;
  v_key text;
  v_hash text;
  v_existing agent_lab.deep_cognition_checkpoints%rowtype;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  if p_action not in ('get','save') then
    raise exception 'invalid_deep_checkpoint_action';
  end if;
  if not exists (
    select 1 from agent_lab.wake_queue w
    where w.agent_id=p_agent_id and w.wake_request_id=p_wake_request_id
      and w.status in ('running','claimed')
  ) then
    raise exception 'deep_checkpoint_wake_not_running';
  end if;
  select a.primary_model_id into v_bound from agent_lab.agents a where a.agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'deep_checkpoint_bound_model_mismatch';
  end if;
  v_stage:=agent_lab.current_mandatory_lifecycle_stage(p_agent_id);
  if v_stage <> 'mba_entrepreneurship' then
    raise exception 'deep_checkpoint_not_supported_for_stage';
  end if;
  v_progress:=agent_lab.entrepreneurship_program_progress_v0_1(p_agent_id);
  v_unit_id:=nullif(v_progress#>>'{next_unit,unit_id}','')::uuid;
  if v_unit_id is null or v_unit_id is distinct from p_unit_id
     or (v_progress->>'next_kind') not in ('study_unit','course_remediation') then
    raise exception 'deep_checkpoint_assignment_mismatch';
  end if;
  v_units:=coalesce((v_progress->>'units_submitted')::integer,0);
  v_courses:=coalesce((v_progress->>'courses_passed')::integer,0);
  v_key:=concat_ws(':','mba',v_unit_id::text,v_units::text,v_courses::text);
  if p_action='save' then
    if p_artifact is null or octet_length(p_artifact) not between 30 and 100000 then
      raise exception 'deep_checkpoint_invalid_artifact';
    end if;
    if p_meta is null or jsonb_typeof(p_meta)<>'object' or octet_length(p_meta::text)>15000 then
      raise exception 'deep_checkpoint_invalid_metadata';
    end if;
    v_hash:=encode(extensions.digest(p_artifact,'sha256'),'hex');
    insert into agent_lab.deep_cognition_checkpoints (
      agent_id,assignment_key,model_id,unit_id,units_submitted,courses_passed,
      artifact,artifact_hash,cognitive_metadata,source_wake_request_id
    ) values (
      p_agent_id,v_key,p_model,v_unit_id,v_units,v_courses,
      p_artifact,v_hash,p_meta,p_wake_request_id
    )
    on conflict (agent_id,assignment_key,model_id)
    do update set
      artifact=excluded.artifact,artifact_hash=excluded.artifact_hash,
      cognitive_metadata=excluded.cognitive_metadata,source_wake_request_id=excluded.source_wake_request_id,
      created_at=now()
    where agent_lab.deep_cognition_checkpoints.created_at < now()-interval '24 hours';
  end if;
  select * into v_existing
    from agent_lab.deep_cognition_checkpoints c
    where c.agent_id=p_agent_id and c.assignment_key=v_key and c.model_id=p_model
      and c.created_at >= now()-interval '24 hours';
  if not found then
    return jsonb_build_object('status','not_found','assignment_key',v_key);
  end if;
  if encode(extensions.digest(v_existing.artifact,'sha256'),'hex') is distinct from v_existing.artifact_hash then
    raise exception 'deep_checkpoint_hash_mismatch';
  end if;
  return jsonb_build_object(
    'status','ready','version','deep_cognition_checkpoint_v0_1',
    'checkpoint_id',v_existing.checkpoint_id,
    'assignment_key',v_key,
    'source_wake_request_id',v_existing.source_wake_request_id,
    'model',v_existing.model_id,
    'artifact',v_existing.artifact,
    'artifact_hash',v_existing.artifact_hash,
    'meta',v_existing.cognitive_metadata,
    'created_at',v_existing.created_at
  );
end;
$function$
;
revoke all on function public.aau_bridge_deep_cognition_checkpoint(text,uuid,uuid,uuid,text,text,text,jsonb) from public;
grant execute on function public.aau_bridge_deep_cognition_checkpoint(text,uuid,uuid,uuid,text,text,text,jsonb) to anon,authenticated,service_role;
commit;
