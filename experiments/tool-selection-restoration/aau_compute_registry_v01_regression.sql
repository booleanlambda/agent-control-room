-- Non-mutating fail-closed regression tests for UCCR v0.1.
-- Each deliberately rejected INSERT is rolled back by its exception savepoint.
do $t$
declare bad_writes int := 0;
begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='aau_compute_registry' and c.relkind='r') <> 12
  then raise exception 'Unexpected private registry table count'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='aau_compute_registry' and c.relkind='r' and c.relrowsecurity) <> 12
  then raise exception 'Registry RLS not enabled on all 12 tables'; end if;
  if has_schema_privilege('anon','aau_compute_registry','USAGE')
    or has_schema_privilege('authenticated','aau_compute_registry','USAGE')
  then raise exception 'Private registry accidentally exposed to public roles'; end if;
  if (select count(*) from aau_compute_registry.operations) <> 6
  then raise exception 'Sample operation count not six'; end if;
  if (select count(*) from aau_compute_registry.evidence
      where result='PASS_NARROW_CAPABILITY_ONLY') <> 6
  then raise exception 'Narrow evidence count invalid'; end if;
  if (select count(*) from aau_compute_registry.audit_recipe('example.grid_restoration_unverified')
      where issue_code='MISSING_MANDATORY_OPERATION') <> 9
  then raise exception 'Did not detect nine missing hard computations'; end if;
  if (select count(*) from aau_compute_registry.audit_recipe('example.grid_restoration_unverified')
      where issue_code='UNVERIFIED_REQUIRED_INTERFACE') <> 3
  then raise exception 'Did not detect three missing interfaces'; end if;
  if not exists (select 1 from aau_compute_registry.search_operations('graph')
                 where operation_id='op.networkx.is_tree.v0' and evidence_level='NARROW_API_PROVEN_ONLY')
  then raise exception 'Lookup omitted verified narrow graph capability'; end if;
  if not exists (select 1 from aau_compute_registry.audit_model_response(
    '{"required_computations":[{"id":"comp_a","hard_requirement":"mandatory"}],
      "selected_tools":[{"id":"tool_a"}],
      "requirement_to_tool_mapping":[{"requirement_id":"req_wrong","tool_ids":["tool_a"],"verification_test_ids":[]}],
      "independent_verification_tests":[]}'::jsonb)
    where issue_code='UNKNOWN_REQUIREMENT_REFERENCE')
  then raise exception 'LLM mismatched requirement IDs not rejected'; end if;
  if not exists(select 1 from aau_compute_registry.audit_recipe('recipe.unknown')
    where issue_code='UNKNOWN_RECIPE')
  then raise exception 'Unknown recipe not rejected'; end if;

  begin
    insert into aau_compute_registry.recipe_bindings(recipe_id,requirement_id,operation_id,rationale)
    values ('example.grid_restoration_unverified','req.fake','op.networkx.is_tree.v0','invalid');
    raise exception 'Ghost requirement accepted';
  exception when foreign_key_violation then bad_writes := bad_writes+1;
  end;
  begin
    insert into aau_compute_registry.test_cases(id,operation_id,test_kind,description,acceptance_or_rejection,status)
    values ('test.ghost','op.networkx.is_tree.v0','NEGATIVE','invalid','invalid','EXECUTED');
    raise exception 'No-receipt executed test accepted';
  exception when check_violation then bad_writes := bad_writes+1;
  end;
  begin
    insert into aau_compute_registry.interfaces(id,producer_operation_id,consumer_operation_id,producer_artifact,consumer_requirements,rejection_rule,status)
    values('edge.ghost','op.networkx.is_tree.v0','op.ortools.routing_tiny.v0','{}','{}','bad','TESTED');
    raise exception 'No-receipt tested interface accepted';
  exception when check_violation then bad_writes := bad_writes+1;
  end;
  begin
    insert into aau_compute_registry.evidence(id,operation_id,test_reference,result,scope)
    values('evidence.ghost','op.networkx.is_tree.v0','fake','PASS_NARROW_CAPABILITY_ONLY','fake');
    raise exception 'No-source passing receipt accepted';
  exception when check_violation then bad_writes := bad_writes+1;
  end;
  begin
    insert into aau_compute_registry.operations(id,capability_id,tool_id,tool_version,executable_invocation,inputs,outputs)
    values('op.ghost','cap.graph_tree','tool.networkx','version.ghost','nx.is_tree(G)','[]','[]');
    raise exception 'Unregistered tool version accepted';
  exception when foreign_key_violation then bad_writes := bad_writes+1;
  end;
  if bad_writes<>5 then raise exception 'Expected 5 negative writes rejected, got %',bad_writes; end if;
end $t$;
select 'UCCR_V01_FAIL_CLOSED_REGRESSION_PASS' as result,
       (select count(*) from aau_compute_registry.operations) as operation_count,
       (select count(*) from aau_compute_registry.audit_recipe('example.grid_restoration_unverified')) as blocking_issues,
       5 as invalid_mutations_rejected;
