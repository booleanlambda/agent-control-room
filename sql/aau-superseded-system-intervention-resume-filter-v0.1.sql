-- Prevent resolved/superseded automatic runtime interventions from being
-- reclassified as fresh human admin chat during an operator resume.
begin;

do $$
declare
  v_def text;
  v_old text := $old$
      and exists (
        select 1 from agent_lab.admin_chat_messages reply
        where reply.agent_id=m.agent_id and reply.sender_kind='agent'
          and reply.reply_to_message_id=m.message_id
          and nullif(btrim(reply.content),'') is not null
      )
    )$old$;
  v_new text := $new$
      and (
        exists (
          select 1 from agent_lab.admin_chat_messages reply
          where reply.agent_id=m.agent_id and reply.sender_kind='agent'
            and reply.reply_to_message_id=m.message_id
            and nullif(btrim(reply.content),'') is not null
        )
        or nullif(m.metadata->>'superseded_at','') is not null
        or coalesce(m.metadata->>'terminal_reason','') like 'superseded_by_%'
        or exists (
          select 1 from agent_lab.intervention_events ie_superseded
          where ie_superseded.intervention_id=nullif(m.metadata->>'intervention_id','')::uuid
            and ie_superseded.agent_id=m.agent_id
            and ie_superseded.message_id=m.message_id
            and ie_superseded.status='resolved'
            and coalesce(ie_superseded.evidence->>'resolution','') like 'superseded_by_%'
        )
      )
    )$new$;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='aau_control_room_admin_unpause';

  if v_def is null then
    raise exception 'aau_control_room_admin_unpause_missing';
  end if;

  if position('ie_superseded' in v_def)>0 then
    return;
  end if;

  if position(v_old in v_def)=0 then
    raise exception 'aau_control_room_admin_unpause_selector_anchor_missing';
  end if;

  execute replace(v_def,v_old,v_new);
end
$$;

commit;
