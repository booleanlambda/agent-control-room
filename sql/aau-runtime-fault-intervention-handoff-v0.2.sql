-- AAU runtime fault -> existing intervention protocol, v0.2.
-- Idempotent by (wake_request_id,failure_class); no model change,
-- cognitive artifact mutation, automatic restart or levy during a hold.
begin;
do $patch$
declare v_def text;
  v_old text := '(''nvidia_model_timeout'',''orphaned_running_intent'',''semantic_contract'',''postgres_statement_timeout'')';
  v_new text := '(''nvidia_model_timeout'',''orphaned_running_intent'',''semantic_contract'',''postgres_statement_timeout'',''cognition_runtime_fault'')';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='agent_lab' and p.proname='queue_intervention_admin_message_v0_1';
  if v_def is null then raise exception 'intervention_queue_missing'; end if;
  if position(v_new in v_def)=0 then
    if position(v_old in v_def)=0 then
      raise exception 'intervention_queue_contract_changed';
    end if;
    execute replace(v_def,v_old,v_new);
  end if;
end
$patch$;
do $patch$
declare v_def text;
  v_declaration text := E'  v_new_wake_id uuid;\nbegin';
  v_insert text := E'  v_new_wake_id uuid;\n  v_intervention jsonb:=null;\nbegin';
  v_guard text := E'  v_node_path:=substring(';
  v_guarded text := E'  if v_status not in (''claimed'',''running'',''queued'') then\n    return jsonb_build_object(''status'',''stale_wake_unchanged'',''intent_execution_id'',p_intent_execution_id);\n  end if;\n\n  v_node_path:=substring(';
  v_return text := E'  return jsonb_build_object(\n    ''status'',''runtime_fault_held'',';
  v_new_return text := E'  begin\n    v_intervention:=agent_lab.queue_intervention_admin_message_v0_1(\n      v_agent_id,p_intent_execution_id,''cognition_runtime_fault'',\n      case when v_error like ''declared_verified_checks_unresolved:checks_source_cardinality_invalid:%''\n        then ''AAU-EVD-101: ''||v_error else v_error end,\n      coalesce((select attempts from agent_lab.wake_queue where wake_request_id=p_intent_execution_id),0)\n    );\n  exception when others then\n    raise warning ''cognition_runtime_intervention_enqueue_failed: %'',sqlerrm;\n  end;\n\n  return jsonb_build_object(\n    ''status'',''runtime_fault_held'',\n    ''intervention_status'',coalesce(v_intervention->>''status'',''queue_failed''),';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='aau_bridge_hold_cognition_runtime_fault_v0_1';
  if v_def is null then raise exception 'runtime_fault_hold_missing'; end if;
  if position('v_intervention jsonb' in v_def)=0 then
    if position(v_declaration in v_def)=0 or position(v_return in v_def)=0
       or position(v_guard in v_def)=0 then
      raise exception 'runtime_fault_hold_contract_changed';
    end if;
    v_def:=replace(v_def,v_declaration,v_insert);
    v_def:=replace(v_def,v_guard,v_guarded);
    v_def:=replace(v_def,v_return,v_new_return);
    execute v_def;
  end if;
end
$patch$;
commit;
