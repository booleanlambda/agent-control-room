-- AAU tool-completion attention batching v0.1
-- If a non-admin attention wake is already queued, newly inserted tool-completion
-- evidence joins that wake instead of allocating another cognition.

create or replace function agent_lab.coalesce_tool_completion_into_queued_attention_wake_v0_1()
returns trigger
language plpgsql
set search_path='pg_catalog','agent_lab'
as $$
declare
  v_wake uuid;
begin
  if new.source_type <> 'tool_completion' or new.state <> 'pending' then
    return new;
  end if;

  select q.wake_request_id
    into v_wake
  from agent_lab.wake_queue q
  where q.agent_id=new.agent_id
    and q.status='queued'
    and coalesce((q.metadata->>'attention_arbiter')::boolean,false)=true
    and coalesce((q.metadata->>'admin_chat')::boolean,false)=false
  order by q.created_at asc
  limit 1;

  if v_wake is not null then
    new.state:='coalesced';
    new.dispatch_wake_request_id:=v_wake;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'coalesced_at',now(),
      'coalesced_into_wake',v_wake,
      'coalescing_version','tool_completion_batch_v0_1'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_coalesce_tool_completion_into_queued_attention_wake
on agent_lab.attention_items;

create trigger trg_coalesce_tool_completion_into_queued_attention_wake
before insert
on agent_lab.attention_items
for each row
execute function agent_lab.coalesce_tool_completion_into_queued_attention_wake_v0_1();
