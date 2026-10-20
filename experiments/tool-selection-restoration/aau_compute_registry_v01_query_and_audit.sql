-- Agent-facing read-only registry queries, kept private to internal SQL callers.
create or replace function aau_compute_registry.search_operations(p_search text)
returns table(operation_id text, tool_name text, exact_invocation text,
              input_contract jsonb, output_contract jsonb, evidence_level text,
              scope_limitations jsonb)
language sql stable security invoker set search_path=''
as $fn$
 select o.id,t.name,o.executable_invocation,o.inputs,o.outputs,s.evidence_level,o.limitations
 from aau_compute_registry.operations o
 join aau_compute_registry.tools t on t.id=o.tool_id
 join aau_compute_registry.capabilities c on c.id=o.capability_id
 join aau_compute_registry.operation_evidence_summary s on s.operation_id=o.id
 where nullif(trim(p_search),'') is not null
   and to_tsvector('english',concat_ws(' ',t.name,c.description,c.mathematical_class,o.executable_invocation))
       @@ websearch_to_tsquery('english',p_search)
 order by t.name,o.id
 limit 30;
$fn$;
create or replace function aau_compute_registry.operation_details(p_operation_id text)
returns jsonb language sql stable security invoker set search_path=''
as $fn$
 select jsonb_build_object(
  'operation_id',o.id,'capability_id',o.capability_id,'tool_id',o.tool_id,
  'version',o.tool_version,'exact_invocation',o.executable_invocation,
  'inputs',o.inputs,'outputs',o.outputs,'assumptions',o.assumptions,
  'limitations',o.limitations,
  'evidence_level',s.evidence_level,
  'receipts',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'scope',e.scope,'result',e.result,'source',e.artifact_url,'sha256',e.artifact_sha256))
                      from aau_compute_registry.evidence e where e.operation_id=o.id),'[]'::jsonb),
  'tests',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'kind',t.test_kind,'status',t.status,'acceptance',t.acceptance_or_rejection))
                   from aau_compute_registry.test_cases t where t.operation_id=o.id),'[]'::jsonb)
 )
 from aau_compute_registry.operations o
 join aau_compute_registry.operation_evidence_summary s on s.operation_id=o.id
 where o.id=p_operation_id;
$fn$;
-- Use registered operations and requirement IDs to validate LLM-created toolchain
-- submissions without any LLM self-grade. Null/invalid payloads fail closed.
create or replace function aau_compute_registry.audit_model_response(p jsonb)
returns table(issue_code text, subject_id text, detail text)
language sql stable security invoker set search_path=''
as $fn$
 with comps as (
    select j->>'id' as id,j
    from jsonb_array_elements(
      case when jsonb_typeof(p->'required_computations')='array'
           then p->'required_computations' else '[]'::jsonb end) j
 ),
 tools as (
    select j->>'id' as id,j
    from jsonb_array_elements(
      case when jsonb_typeof(p->'selected_tools')='array'
           then p->'selected_tools' else '[]'::jsonb end) j
 ),
 tests as (
    select j->>'id' as id,j
    from jsonb_array_elements(
      case when jsonb_typeof(p->'independent_verification_tests')='array'
           then p->'independent_verification_tests' else '[]'::jsonb end) j
 ),
 maps as (
    select j->>'requirement_id' as req,j
    from jsonb_array_elements(
      case when jsonb_typeof(p->'requirement_to_tool_mapping')='array'
           then p->'requirement_to_tool_mapping' else '[]'::jsonb end) j
 )
 select 'MISSING_OR_INVALID_COMPUTATIONS'::text,'required_computations'::text,'Must be a populated array'::text
 where jsonb_typeof(p->'required_computations')<>'array'
       or not exists(select 1 from comps)
 union all
 select 'MISSING_OR_INVALID_TOOLS','selected_tools','Must be a populated array'
 where jsonb_typeof(p->'selected_tools')<>'array'
       or not exists(select 1 from tools)
 union all
 select 'UNKNOWN_REQUIREMENT_REFERENCE',m.req,'No identical ID in required_computations'
 from maps m where not exists(select 1 from comps c where c.id=m.req)
 union all
 select 'MISSING_HARD_MAPPING',c.id,'Hard computation lacks requirement_to_tool_mapping'
 from comps c where (c.j->'hard_requirement') is distinct from 'false'::jsonb
    and not exists(select 1 from maps m where m.req=c.id)
 union all
 select 'UNKNOWN_TOOL_REFERENCE',m.req || ':' || coalesce(tid.tid,'null'),'No identical tool ID in selected_tools'
 from maps m cross join lateral
   jsonb_array_elements_text(
     case when jsonb_typeof(m.j->'tool_ids')='array'
          then m.j->'tool_ids' else '[]'::jsonb end) as tid(tid)
 where not exists(select 1 from tools t where t.id=tid.tid)
 union all
 select 'UNKNOWN_TEST_REFERENCE',m.req || ':' || coalesce(tid.tid,'null'),'No identical test ID in independent_verification_tests'
 from maps m cross join lateral
   jsonb_array_elements_text(
     case when jsonb_typeof(m.j->'verification_test_ids')='array'
          then m.j->'verification_test_ids' else '[]'::jsonb end) as tid(tid)
 where not exists(select 1 from tests t where t.id=tid.tid)
 union all
 select 'MISSING_INDEPENDENT_TEST_REFERENCE',m.req,'Mapping must reference at least one independent test'
 from maps m where jsonb_typeof(m.j->'verification_test_ids')<>'array'
   or jsonb_array_length(case when jsonb_typeof(m.j->'verification_test_ids')='array'
              then m.j->'verification_test_ids' else '[]'::jsonb end)=0
 union all
 select 'DUPLICATE_COMPUTATION_ID',c.id,'Duplicate required computation ID'
 from comps c where c.id is not null group by c.id having count(*)>1
 union all
 select 'DUPLICATE_TOOL_ID',t.id,'Duplicate selected tool ID'
 from tools t where t.id is not null group by t.id having count(*)>1
 union all
 select 'UNVERIFIED_TASK_COMPOSITION','all',
        'Structural closure alone is not domain, performance or safety validation';
$fn$;
revoke all on all functions in schema aau_compute_registry from public, anon, authenticated;