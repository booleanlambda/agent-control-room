-- AAU requirement-linked durable research batches v0.1
-- Keeps full research receipts durable outside model context while allowing
-- compact source-index rehydration per requirement node after wake recovery.

create table if not exists agent_lab.cognition_research_batch_links (
  link_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  assignment_key text not null,
  node_path text not null,
  batch_id uuid not null references agent_lab.agent_web_research_batches(batch_id) on delete cascade,
  source_wake_request_id uuid not null references agent_lab.wake_queue(wake_request_id),
  created_at timestamptz not null default now(),
  unique(agent_id,assignment_key,node_path,batch_id)
);

create index if not exists cognition_research_batch_links_node_idx
  on agent_lab.cognition_research_batch_links(agent_id,assignment_key,node_path,created_at);

alter table agent_lab.cognition_research_batch_links enable row level security;

create or replace function public.aau_bridge_cognition_research_batches_v0_1(
  p_bridge_token text,
  p_agent_id uuid,
  p_wake_request_id uuid,
  p_assignment_key text,
  p_node_path text,
  p_action text,
  p_batch_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare
  v_batch agent_lab.agent_web_research_batches%rowtype;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);

  if p_action not in ('link','list') then
    raise exception 'cognition_research_batches_invalid_action';
  end if;
  if length(coalesce(p_assignment_key,'')) not between 1 and 240
     or p_node_path !~ '^R([.][0-9]{3}){0,16}$' then
    raise exception 'cognition_research_batches_invalid_identity';
  end if;

  if p_action='link' then
    if p_batch_id is null then raise exception 'cognition_research_batch_id_required'; end if;
    if not exists (
      select 1 from agent_lab.wake_queue w
      where w.wake_request_id=p_wake_request_id
        and w.agent_id=p_agent_id
        and w.status in ('running','claimed')
    ) then
      raise exception 'cognition_research_batches_wake_not_running';
    end if;

    select * into v_batch
    from agent_lab.agent_web_research_batches b
    where b.batch_id=p_batch_id
      and b.agent_id=p_agent_id
      and b.wake_request_id=p_wake_request_id;

    if not found then raise exception 'cognition_research_batch_not_owned'; end if;

    insert into agent_lab.cognition_research_batch_links(
      agent_id,assignment_key,node_path,batch_id,source_wake_request_id
    ) values (
      p_agent_id,p_assignment_key,p_node_path,p_batch_id,p_wake_request_id
    )
    on conflict(agent_id,assignment_key,node_path,batch_id) do nothing;

    return jsonb_build_object(
      'status','ready',
      'version','requirement_research_batch_links_v0_1',
      'batch_id',p_batch_id,
      'node_path',p_node_path
    );
  end if;

  return jsonb_build_object(
    'status','ready',
    'version','requirement_research_batch_links_v0_1',
    'batches',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'batch_id',b.batch_id,
          'status',b.status,
          'queries',b.queries,
          'created_at',b.created_at,
          'sources',coalesce((
            select jsonb_agg(jsonb_build_object(
              'query',r->>'query',
              'title',r->>'title',
              'url',r->>'url',
              'published_at',r->>'published_at',
              'coverage',r->>'coverage',
              'fetch_status',r->>'fetch_status',
              'sha256',r->>'sha256'
            ))
            from jsonb_array_elements(coalesce(b.receipts,'[]'::jsonb)) r
          ),'[]'::jsonb)
        )
        order by b.created_at
      )
      from agent_lab.cognition_research_batch_links l
      join agent_lab.agent_web_research_batches b on b.batch_id=l.batch_id
      where l.agent_id=p_agent_id
        and l.assignment_key=p_assignment_key
        and l.node_path=p_node_path
    ),'[]'::jsonb)
  );
end
$function$;

revoke all on function public.aau_bridge_cognition_research_batches_v0_1(
  text,uuid,uuid,text,text,text,uuid
) from public;
