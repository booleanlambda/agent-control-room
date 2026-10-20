-- AAU Universal Computational Capability Registry v0.1
-- Private, isolated schema. No grants to anon or authenticated; no production agent integration.
create schema if not exists aau_compute_registry;
revoke all on schema aau_compute_registry from public, anon, authenticated;

create table if not exists aau_compute_registry.capabilities (
 id text primary key check (length(id) between 4 and 160),
 description text not null check (length(description)>10),
 mathematical_class text not null,
 preconditions jsonb not null default '[]'::jsonb check (jsonb_typeof(preconditions)='array'),
 exclusions jsonb not null default '[]'::jsonb check (jsonb_typeof(exclusions)='array'),
 created_at timestamptz not null default now()
);
create table if not exists aau_compute_registry.tools (
 id text primary key,
 name text not null,
 homepage text,
 license_expression text,
 created_at timestamptz not null default now()
);
create table if not exists aau_compute_registry.tool_versions (
 tool_id text not null references aau_compute_registry.tools(id),
 version text not null,
 platform text not null default 'Linux x86_64, CPython 3.11',
 installation text,
 dependencies jsonb not null default '{}'::jsonb check (jsonb_typeof(dependencies)='object'),
 created_at timestamptz not null default now(),
 primary key(tool_id,version)
);
create table if not exists aau_compute_registry.operations (
 id text primary key,
 capability_id text not null references aau_compute_registry.capabilities(id),
 tool_id text not null,
 tool_version text not null,
 executable_invocation text not null check (length(executable_invocation)>4),
 inputs jsonb not null check (jsonb_typeof(inputs)='array'),
 outputs jsonb not null check (jsonb_typeof(outputs)='array'),
 assumptions jsonb not null default '[]'::jsonb check (jsonb_typeof(assumptions)='array'),
 limitations jsonb not null default '[]'::jsonb check (jsonb_typeof(limitations)='array'),
 status text not null default 'CANDIDATE'
   check (status in ('CANDIDATE','DOCUMENTED','PROBE_SUBMITTED')),
 created_at timestamptz not null default now(),
 unique(id,tool_id),
 foreign key (tool_id, tool_version) references aau_compute_registry.tool_versions(tool_id,version)
);
create table if not exists aau_compute_registry.evidence (
 id text primary key,
 operation_id text not null references aau_compute_registry.operations(id),
 test_reference text not null,
 result text not null check(result in ('NOT_RUN','PASS_NARROW_CAPABILITY_ONLY','PASS_INTEGRATION','PASS_TASK','FAIL')),
 scope text not null,
 artifact_url text,
 artifact_sha256 text check (artifact_sha256 is null or artifact_sha256 ~ '^[0-9a-f]{64}$'),
 observed jsonb not null default '{}'::jsonb check (jsonb_typeof(observed)='object'),
 executed_at timestamptz,
 created_at timestamptz not null default now(),
 unique(operation_id,id),
 check (result in ('NOT_RUN','FAIL') or (artifact_url is not null and artifact_sha256 is not null and executed_at is not null))
);
create table if not exists aau_compute_registry.test_cases (
 id text primary key,
 operation_id text not null references aau_compute_registry.operations(id),
 test_kind text not null check(test_kind in ('POSITIVE','NEGATIVE','INTEGRATION','DOMAIN')),
 description text not null,
 acceptance_or_rejection text not null,
 status text not null default 'PROPOSED' check(status in ('PROPOSED','EXECUTED')),
 evidence_id text,
 check((status='EXECUTED')=(evidence_id is not null)),
 foreign key(operation_id,evidence_id) references aau_compute_registry.evidence(operation_id,id)
);
create table if not exists aau_compute_registry.interfaces (
 id text primary key,
 producer_operation_id text not null references aau_compute_registry.operations(id),
 consumer_operation_id text not null references aau_compute_registry.operations(id),
 producer_artifact jsonb not null check (jsonb_typeof(producer_artifact)='object'),
 consumer_requirements jsonb not null check (jsonb_typeof(consumer_requirements)='object'),
 mapping_and_units jsonb not null default '{}'::jsonb check (jsonb_typeof(mapping_and_units)='object'),
 rejection_rule text not null,
 status text not null default 'PROPOSED' check(status in ('PROPOSED','TESTED')),
 integration_receipt_sha256 text check(integration_receipt_sha256 is null or integration_receipt_sha256 ~ '^[0-9a-f]{64}$'),
 check(status<>'TESTED' or integration_receipt_sha256 is not null)
);
create table if not exists aau_compute_registry.recipes (
 id text primary key,
 description text not null,
 claimed_status text not null default 'PROPOSED'
   check(claimed_status in ('PROPOSED','BLOCKED')),
 created_at timestamptz not null default now()
);
create table if not exists aau_compute_registry.recipe_requirements (
 recipe_id text not null references aau_compute_registry.recipes(id),
 requirement_id text not null,
 description text not null,
 mandatory boolean not null default true,
 acceptance_condition text not null,
 primary key(recipe_id,requirement_id)
);
create table if not exists aau_compute_registry.recipe_bindings (
 recipe_id text not null,
 requirement_id text not null,
 operation_id text not null references aau_compute_registry.operations(id),
 rationale text not null,
 primary key(recipe_id,requirement_id,operation_id),
 foreign key(recipe_id,requirement_id) references aau_compute_registry.recipe_requirements(recipe_id,requirement_id)
);
create table if not exists aau_compute_registry.recipe_required_interfaces (
 recipe_id text not null references aau_compute_registry.recipes(id),
 interface_requirement_id text not null,
 producer_requirement_id text not null,
 consumer_requirement_id text not null,
 expected_contract jsonb not null check (jsonb_typeof(expected_contract)='object'),
 verified_interface_id text references aau_compute_registry.interfaces(id),
 primary key(recipe_id,interface_requirement_id),
 foreign key(recipe_id,producer_requirement_id) references aau_compute_registry.recipe_requirements(recipe_id,requirement_id),
 foreign key(recipe_id,consumer_requirement_id) references aau_compute_registry.recipe_requirements(recipe_id,requirement_id)
);
create table if not exists aau_compute_registry.known_failures (
 id text primary key,
 operation_id text references aau_compute_registry.operations(id),
 recipe_id text references aau_compute_registry.recipes(id),
 failure_kind text not null,
 invalid_invocation text,
 explanation text not null,
 source_url text,
 recorded_at timestamptz not null default now()
);

create or replace view aau_compute_registry.operation_evidence_summary
with (security_invoker = true) as
select o.id as operation_id, o.capability_id, o.tool_id, o.tool_version,
       count(e.id) filter(where e.result='PASS_NARROW_CAPABILITY_ONLY') as narrow_pass_count,
       count(e.id) filter(where e.result='PASS_INTEGRATION') as integration_pass_count,
       count(e.id) filter(where e.result='PASS_TASK') as task_pass_count,
       case
         when count(e.id) filter(where e.result='PASS_TASK')>0 then 'HAS_TASK_EVIDENCE_CHECK_SCOPE'
         when count(e.id) filter(where e.result='PASS_INTEGRATION')>0 then 'HAS_INTEGRATION_EVIDENCE_CHECK_SCOPE'
         when count(e.id) filter(where e.result='PASS_NARROW_CAPABILITY_ONLY')>0 then 'NARROW_API_PROVEN_ONLY'
         else 'NO_EXECUTION_EVIDENCE'
       end as evidence_level
from aau_compute_registry.operations o
left join aau_compute_registry.evidence e on e.operation_id=o.id
group by o.id,o.capability_id,o.tool_id,o.tool_version;

-- Issues function cannot authorize Stage 2. It fails closed on absent mandatory
-- coverage, negative tests and inter-tool handoff, and ALWAYS requests external
-- domain-level verification even when no structural defect remains.
create or replace function aau_compute_registry.audit_recipe(p_recipe_id text)
returns table(issue_code text, subject_id text, detail text)
language sql stable security invoker set search_path = ''
as $fn$
  select 'MISSING_MANDATORY_OPERATION'::text,r.requirement_id,
         'No selected operation for hard requirement'::text
  from aau_compute_registry.recipe_requirements r
  where r.recipe_id=p_recipe_id and r.mandatory
    and not exists(
      select 1 from aau_compute_registry.recipe_bindings b
      where b.recipe_id=r.recipe_id and b.requirement_id=r.requirement_id)
  union all
  select 'NO_NARROW_EXECUTION_RECEIPT', b.operation_id,
         'Selected operation lacks PASS_NARROW_CAPABILITY_ONLY or higher receipt'::text
  from aau_compute_registry.recipe_bindings b
  where b.recipe_id=p_recipe_id and not exists(
    select 1 from aau_compute_registry.evidence e
    where e.operation_id=b.operation_id
      and e.result in ('PASS_NARROW_CAPABILITY_ONLY','PASS_INTEGRATION','PASS_TASK'))
  union all
  select 'MISSING_EXECUTED_NEGATIVE_TEST', r.requirement_id,
         'No independently evidenced negative test linked to a selected operation'::text
  from aau_compute_registry.recipe_requirements r
  where r.recipe_id=p_recipe_id and r.mandatory
    and exists(select 1 from aau_compute_registry.recipe_bindings b
               where b.recipe_id=r.recipe_id and b.requirement_id=r.requirement_id)
    and not exists (
      select 1 from aau_compute_registry.recipe_bindings b
      join aau_compute_registry.test_cases t
        on t.operation_id=b.operation_id and t.test_kind='NEGATIVE' and t.status='EXECUTED'
      join aau_compute_registry.evidence e
        on e.id=t.evidence_id and e.operation_id=t.operation_id
      where b.recipe_id=r.recipe_id and b.requirement_id=r.requirement_id
        and e.result in ('PASS_NARROW_CAPABILITY_ONLY','PASS_INTEGRATION','PASS_TASK'))
  union all
  select 'UNVERIFIED_REQUIRED_INTERFACE', i.interface_requirement_id,
         'No verified typed and tested interface for this required handoff'::text
  from aau_compute_registry.recipe_required_interfaces i
  left join aau_compute_registry.interfaces c on c.id=i.verified_interface_id
  where i.recipe_id=p_recipe_id and (c.id is null or c.status<>'TESTED')
  union all
  select 'INDEPENDENT_TASK_DOMAIN_VALIDATION_REQUIRED',p.id,
         'No complete-task authorization; narrow probes and schema do not prove correctness'::text
  from aau_compute_registry.recipes p
  where p.id=p_recipe_id
  union all
  select 'UNKNOWN_RECIPE',p_recipe_id,
         'No recipe exists; fail closed'::text
  where not exists(select 1 from aau_compute_registry.recipes p where p.id=p_recipe_id);
$fn$;

-- Defense in depth even though custom schema remains outside the Supabase Data API.
alter table aau_compute_registry.capabilities enable row level security;
alter table aau_compute_registry.tools enable row level security;
alter table aau_compute_registry.tool_versions enable row level security;
alter table aau_compute_registry.operations enable row level security;
alter table aau_compute_registry.evidence enable row level security;
alter table aau_compute_registry.test_cases enable row level security;
alter table aau_compute_registry.interfaces enable row level security;
alter table aau_compute_registry.recipes enable row level security;
alter table aau_compute_registry.recipe_requirements enable row level security;
alter table aau_compute_registry.recipe_bindings enable row level security;
alter table aau_compute_registry.recipe_required_interfaces enable row level security;
alter table aau_compute_registry.known_failures enable row level security;
revoke all on all tables in schema aau_compute_registry from public, anon, authenticated;
revoke all on all functions in schema aau_compute_registry from public, anon, authenticated;
revoke all on all sequences in schema aau_compute_registry from public, anon, authenticated;
