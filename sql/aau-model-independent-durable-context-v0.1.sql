-- AAU model-independent durable cognition context v0.1
--
-- Durable node context is storage, not a model prompt. The model-facing view is
-- independently bounded from the selected model runtime profile.
--
-- This migration raises only the requirement-node context payload bridge limit
-- from 60,000 bytes to 262,144 bytes. Decision payload and result artifact
-- limits are intentionally unchanged.

do $$
declare vdef text;
begin
  select pg_get_functiondef(p.oid) into vdef
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='aau_bridge_cognition_requirement_node_v0_1'
  limit 1;

  if vdef is null then
    raise exception 'cognition_requirement_bridge_missing';
  end if;

  if position('octet_length(p_context_payload::text)>60000' in vdef)>0 then
    vdef:=replace(
      vdef,
      'octet_length(p_context_payload::text)>60000',
      'octet_length(p_context_payload::text)>262144'
    );
    execute vdef;
  elsif position('octet_length(p_context_payload::text)>262144' in vdef)=0 then
    raise exception 'cognition_requirement_context_limit_anchor_missing';
  end if;
end $$;
