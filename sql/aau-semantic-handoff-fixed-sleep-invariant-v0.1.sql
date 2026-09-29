-- Prevent semantic-budget handoff from masquerading as real fixed sleep.
-- A semantic handoff waits between cognition ticks but is not a rest/sleep action.
-- Real sleep remains owned by set_post_wake_activity_state_v0_1 and always has
-- sleep_started_at, sleep_until, and sleep_wake_request_id.

do $migration$
declare
  v_oid oid;
  v_def text;
  v_old text := E'''awake'',false,\n               ''sleeping'',true';
  v_new text := E'''awake'',true,\n               ''sleeping'',false';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='aau_bridge_hold_semantic_runtime_terminal_v0_2'
    and pg_get_function_identity_arguments(p.oid)=
      'p_bridge_token text, p_intent_execution_id uuid, p_terminal_code text, p_error text, p_runtime_state jsonb';

  if v_oid is null then
    raise exception 'semantic_runtime_terminal_function_missing';
  end if;

  v_def := pg_get_functiondef(v_oid);

  if (
    length(v_def)-length(replace(v_def,v_old,''))
  ) / nullif(length(v_old),0) <> 1 then
    raise exception 'semantic_handoff_sleep_patch_expected_exactly_one_match';
  end if;

  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end
$migration$;

comment on function public.aau_bridge_hold_semantic_runtime_terminal_v0_2(
  text,uuid,text,text,jsonb
) is
  'Semantic runtime terminal handoff v0.2 with fixed-sleep invariant repair: branch handoff remains awake/idle; only true rest actions set sleeping=true and create a sleep_complete wake.';
