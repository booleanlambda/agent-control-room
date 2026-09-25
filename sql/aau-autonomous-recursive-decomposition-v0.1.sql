-- AAU autonomous recursive decomposition v0.1
-- The agent authors decomposition. Runtime only persists/routes/checkpoints nodes.
begin;

create table if not exists agent_lab.cognition_requirement_nodes (
  node_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  assignment_key text not null,
  node_path text not null,
  parent_node_id uuid references agent_lab.cognition_requirement_nodes(node_id) on delete cascade,
  depth integer not null default 0 check (depth between 0 and 16),
  ordinal integer not null default 0 check (ordinal between 0 and 64),
  model_id text not null,
  requirement_text text not null,
  requirement_hash text not null,
  source_kind text not null default 'requirement',
  source_ref text,
  status text not null default 'pending'
    check (status in ('pending','deciding','waiting_context','split','executing','completed','blocked','cancelled')),
  decision_type text
    check (decision_type is null or decision_type in ('ATOMIC','SPLIT','NEED_CONTEXT')),
  decision_payload jsonb not null default '{}'::jsonb,
  context_payload jsonb not null default '{}'::jsonb,
  result_artifact text,
  result_hash text,
  source_wake_request_id uuid not null references agent_lab.wake_queue(wake_request_id),
  last_wake_request_id uuid not null references agent_lab.wake_queue(wake_request_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(agent_id,assignment_key,node_path,model_id)
);

create index if not exists cognition_requirement_nodes_assignment_idx
  on agent_lab.cognition_requirement_nodes(agent_id,assignment_key,node_path);
create index if not exists cognition_requirement_nodes_parent_idx
  on agent_lab.cognition_requirement_nodes(parent_node_id,ordinal);
create index if not exists cognition_requirement_nodes_open_idx
  on agent_lab.cognition_requirement_nodes(agent_id,status,updated_at desc);

alter table agent_lab.cognition_requirement_nodes enable row level security;
revoke all on agent_lab.cognition_requirement_nodes from public,anon,authenticated;

create or replace function public.aau_bridge_cognition_requirement_node_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_assignment_key text,
  p_node_path text,
  p_model text,
  p_action text,
  p_parent_path text default null,
  p_ordinal integer default 0,
  p_requirement_text text default null,
  p_source_kind text default 'requirement',
  p_source_ref text default null,
  p_status text default null,
  p_decision_type text default null,
  p_decision_payload jsonb default '{}'::jsonb,
  p_context_payload jsonb default '{}'::jsonb,
  p_result_artifact text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare
  v_bound text;
  v_parent agent_lab.cognition_requirement_nodes%rowtype;
  v_row agent_lab.cognition_requirement_nodes%rowtype;
  v_hash text;
  v_result_hash text;
  v_depth int:=0;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if p_action not in ('get','save','children') then
    raise exception 'cognition_requirement_invalid_action';
  end if;
  if length(coalesce(p_assignment_key,'')) not between 1 and 240
     or p_node_path !~ '^R([.][0-9]{3}){0,16}$' then
    raise exception 'cognition_requirement_invalid_identity';
  end if;
  if not exists (
    select 1 from agent_lab.wake_queue w
    where w.agent_id=p_agent_id and w.wake_request_id=p_wake_request_id
      and w.status in ('running','claimed')
  ) then
    raise exception 'cognition_requirement_wake_not_running';
  end if;

  select primary_model_id into v_bound
  from agent_lab.agents where agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model then
    raise exception 'cognition_requirement_bound_model_mismatch';
  end if;

  if p_action='children' then
    return jsonb_build_object(
      'status','ready',
      'children',coalesce((
        select jsonb_agg(jsonb_build_object(
          'node_id',c.node_id,'node_path',c.node_path,'ordinal',c.ordinal,
          'requirement_text',c.requirement_text,'requirement_hash',c.requirement_hash,
          'status',c.status,'decision_type',c.decision_type,
          'decision_payload',c.decision_payload,'context_payload',c.context_payload,
          'result_artifact',c.result_artifact,'result_hash',c.result_hash,
          'updated_at',c.updated_at
        ) order by c.ordinal)
        from agent_lab.cognition_requirement_nodes c
        join agent_lab.cognition_requirement_nodes p on p.node_id=c.parent_node_id
        where p.agent_id=p_agent_id and p.assignment_key=p_assignment_key
          and p.node_path=p_node_path and p.model_id=p_model
      ),'[]'::jsonb),
      'contract','autonomous_recursive_decomposition_v0_1'
    );
  end if;

  if p_action='get' then
    select * into v_row from agent_lab.cognition_requirement_nodes
    where agent_id=p_agent_id and assignment_key=p_assignment_key
      and node_path=p_node_path and model_id=p_model;
    if not found then return jsonb_build_object('status','not_found'); end if;
    if encode(extensions.digest(v_row.requirement_text,'sha256'),'hex') is distinct from v_row.requirement_hash then
      raise exception 'cognition_requirement_hash_mismatch';
    end if;
    if v_row.result_artifact is not null
       and encode(extensions.digest(v_row.result_artifact,'sha256'),'hex') is distinct from v_row.result_hash then
      raise exception 'cognition_requirement_result_hash_mismatch';
    end if;
    return jsonb_build_object(
      'status','ready','contract','autonomous_recursive_decomposition_v0_1',
      'node_id',v_row.node_id,'node_path',v_row.node_path,'depth',v_row.depth,
      'ordinal',v_row.ordinal,'parent_node_id',v_row.parent_node_id,
      'requirement_text',v_row.requirement_text,'requirement_hash',v_row.requirement_hash,
      'source_kind',v_row.source_kind,'source_ref',v_row.source_ref,
      'node_status',v_row.status,'decision_type',v_row.decision_type,
      'decision_payload',v_row.decision_payload,'context_payload',v_row.context_payload,
      'result_artifact',v_row.result_artifact,'result_hash',v_row.result_hash,
      'source_wake_request_id',v_row.source_wake_request_id,
      'last_wake_request_id',v_row.last_wake_request_id,
      'created_at',v_row.created_at,'updated_at',v_row.updated_at
    );
  end if;

  if p_requirement_text is null or length(btrim(p_requirement_text))<3
     or octet_length(p_requirement_text)>50000 then
    raise exception 'cognition_requirement_invalid_text';
  end if;
  if p_status not in ('pending','deciding','waiting_context','split','executing','completed','blocked','cancelled') then
    raise exception 'cognition_requirement_invalid_status';
  end if;
  if p_decision_type is not null and p_decision_type not in ('ATOMIC','SPLIT','NEED_CONTEXT') then
    raise exception 'cognition_requirement_invalid_decision';
  end if;
  if p_decision_payload is null or jsonb_typeof(p_decision_payload)<>'object'
     or octet_length(p_decision_payload::text)>20000 then
    raise exception 'cognition_requirement_invalid_decision_payload';
  end if;
  if p_context_payload is null or jsonb_typeof(p_context_payload)<>'object'
     or octet_length(p_context_payload::text)>60000 then
    raise exception 'cognition_requirement_invalid_context_payload';
  end if;
  if p_result_artifact is not null and octet_length(p_result_artifact)>20000 then
    raise exception 'cognition_requirement_result_too_large';
  end if;

  if p_node_path='R' then
    if p_parent_path is not null then raise exception 'cognition_requirement_root_parent_forbidden'; end if;
    v_depth:=0;
  else
    if p_parent_path is null then raise exception 'cognition_requirement_parent_required'; end if;
    select * into v_parent from agent_lab.cognition_requirement_nodes
    where agent_id=p_agent_id and assignment_key=p_assignment_key
      and node_path=p_parent_path and model_id=p_model;
    if not found then raise exception 'cognition_requirement_parent_not_found'; end if;
    v_depth:=v_parent.depth+1;
    if v_depth>16 then raise exception 'cognition_requirement_depth_limit'; end if;
  end if;

  v_hash:=encode(extensions.digest(p_requirement_text,'sha256'),'hex');
  v_result_hash:=case when p_result_artifact is null then null
    else encode(extensions.digest(p_result_artifact,'sha256'),'hex') end;

  insert into agent_lab.cognition_requirement_nodes(
    agent_id,assignment_key,node_path,parent_node_id,depth,ordinal,model_id,
    requirement_text,requirement_hash,source_kind,source_ref,status,decision_type,
    decision_payload,context_payload,result_artifact,result_hash,
    source_wake_request_id,last_wake_request_id
  ) values (
    p_agent_id,p_assignment_key,p_node_path,v_parent.node_id,v_depth,coalesce(p_ordinal,0),p_model,
    p_requirement_text,v_hash,left(coalesce(p_source_kind,'requirement'),80),left(p_source_ref,300),
    p_status,p_decision_type,p_decision_payload,p_context_payload,p_result_artifact,v_result_hash,
    p_wake_request_id,p_wake_request_id
  )
  on conflict(agent_id,assignment_key,node_path,model_id) do update set
    status=excluded.status,
    decision_type=excluded.decision_type,
    decision_payload=excluded.decision_payload,
    context_payload=excluded.context_payload,
    result_artifact=excluded.result_artifact,
    result_hash=excluded.result_hash,
    last_wake_request_id=excluded.last_wake_request_id,
    updated_at=now()
  where agent_lab.cognition_requirement_nodes.requirement_hash=excluded.requirement_hash
  returning * into v_row;

  if not found then raise exception 'cognition_requirement_conflict'; end if;

  return jsonb_build_object(
    'status','ready','contract','autonomous_recursive_decomposition_v0_1',
    'node_id',v_row.node_id,'node_path',v_row.node_path,'depth',v_row.depth,
    'ordinal',v_row.ordinal,'parent_node_id',v_row.parent_node_id,
    'requirement_text',v_row.requirement_text,'requirement_hash',v_row.requirement_hash,
    'node_status',v_row.status,'decision_type',v_row.decision_type,
    'decision_payload',v_row.decision_payload,'context_payload',v_row.context_payload,
    'result_artifact',v_row.result_artifact,'result_hash',v_row.result_hash,
    'updated_at',v_row.updated_at
  );
end;
$function$;

revoke all on function public.aau_bridge_cognition_requirement_node_v0_1(
  text,uuid,uuid,text,text,text,text,text,integer,text,text,text,text,text,jsonb,jsonb,text
) from public;
grant execute on function public.aau_bridge_cognition_requirement_node_v0_1(
  text,uuid,uuid,text,text,text,text,text,integer,text,text,text,text,text,jsonb,jsonb,text
) to anon;

commit;
