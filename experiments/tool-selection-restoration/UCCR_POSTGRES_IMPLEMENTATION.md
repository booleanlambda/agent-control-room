# AAU Universal Computational Capability Registry v0.1

**Implementation:** live private Supabase PostgreSQL schema `aau_compute_registry` in project `mgtilfgygzymxiyixjit`; same schema definition, seed and regression SQL versioned on this experiment branch. No production wake, deployments or live grid commands changed.

## What exists

- Twelve relational tables for capabilities, tools, tool versions, concrete operations, execution evidence, test cases, producer/consumer interfaces, recipes, hard requirements, checked bindings, required inter-tool transfers, and known failures.
- `operation_evidence_summary` view **never** upgrades a synthetic API smoke to task-level verification.
- `search_operations(search_term)`: read-only semantic keyword search for registered operations with evidence level, inputs, outputs and exact invocation.
- `operation_details(operation_id)`: read-only versioned operation with receipts and positive/negative tests.
- `audit_recipe(recipe_id)`: fail-closed evaluation of missing hard computations, independently executed negative probes, required inter-tool interfaces and domain validation.
- `audit_model_response(jsonb)`: deterministic rejection of inconsistent requirement IDs, references to unselected tools or nonexistent tests, duplicate IDs, and absent independent testing. This function is not a substitute for domain-specific checking.
- `aau_registry_db_export_v01.json`: database-generated **read-only** snapshot of six narrow sample operations for future Kimi consultation, with real evidence sources.

## Source and recorded execution evidence

The initial six operations were imported from `capability_registry_sample_v01.json` produced from the independently executed GitHub Actions synthetic capability probes. Latest original artifact:

https://github.com/booleanlambda/agent-control-room/actions/runs/39455936347/artifacts/12280792701

All six receipt rows are explicitly marked `PASS_NARROW_CAPABILITY_ONLY`. The records do **not** claim protection coordination, generator transport, synchronism, 4,800-bus performance or domain safety.

The sample recipe `example.grid_restoration_unverified` deliberately includes 14 mandatory requirements but only five operation bindings. It has 3 required interface obligations. The SQL auditor returned exactly **17 blocking issues**:
- 9 missing mandatory computations.
- 4 missing executed negative tests.
- 3 missing proven typed interfaces.
- 1 independent domain-validation requirement.

## Production isolation and access

- `aau_compute_registry` is a **non-exposed custom schema**. `USAGE` is revoked from `anon` and `authenticated`; all 12 tables have RLS enabled with no public policies.
- No credential or service-role key is embedded in the repo or JSON export.
- Authenticated browser clients cannot currently read these tables. Agent access requires a separately authorized server-side broker, MCP/SQL connector, or an approved sanitized read-only export; **Kimi has not yet been wired to live SQL querying**.
- The existing GitHub sample-registry run remains unchanged. A database export is not a newly executed model experiment.
- Existing unrelated Supabase `public` schema RLS/security warnings pre-date this registry. They were **not** modified.

## Reproduce on existing connected Supabase project

Schema DDL: `aau_compute_registry_v01_schema.sql` (remote `apply_migration`: `aau_compute_registry_v01_private_schema`).

Seed DML: `aau_compute_registry_v01_seed.sql` (executed once, idempotent `ON CONFLICT DO NOTHING`).

Read-only lookup/audit functions DDL: `aau_compute_registry_v01_query_and_audit.sql` (remote `apply_migration`: `aau_compute_registry_v01_query_and_audit`).

Regression tests: `aau_compute_registry_v01_regression.sql`, executed successfully on live database:

```text
UCCR_V01_FAIL_CLOSED_REGRESSION_PASS
operation_count: 6
blocking_issues: 17
invalid_mutations_rejected: 5
```

### Read-only queries for the research control room

```sql
select * from aau_compute_registry.search_operations('graph');
select aau_compute_registry.operation_details('op.networkx.is_tree.v0');
select * from aau_compute_registry.audit_recipe('example.grid_restoration_unverified');
select * from aau_compute_registry.operation_evidence_summary;
```

### Run independent ID verification on any Kimi response JSON

```sql
select * from aau_compute_registry.audit_model_response(
  '{"required_computations":[{"id":"comp_a","hard_requirement":"must cover"}],
     "selected_tools":[{"id":"tool_a"}],
     "requirement_to_tool_mapping":[{"requirement_id":"req_wrong","tool_ids":["tool_a"],"verification_test_ids":[]}],
     "independent_verification_tests":[]}'::jsonb
);
```
This negative fixture must report `UNKNOWN_REQUIREMENT_REFERENCE`, `MISSING_HARD_MAPPING`, `MISSING_INDEPENDENT_TEST_REFERENCE`, plus `UNVERIFIED_TASK_COMPOSITION`.

## Future steps (not implemented)

- Add an independently authenticated, **read-only** registry tool interface for Kimi, with externally staged toolchain proposals and narrowly permitted test executors.
- Use a frozen, general set of benchmark problems and compare blind Kimi with DB-assisted Kimi under identical grading conditions.
- Expand catalog through documentation discovery; **no promotion** from unverified descriptions to actual operations until positive and negative probes execute.
- Register verified producer-to-consumer transforms, strict unit mapping, and task-level physical-safety checks.
- Improve controlled ingestion and evidence immutability with separate reviewer privileges and tamper-evident artifact storage.

**No Stage 2 authorization is issued by this registry.** A missing capability, incompatible API, or absence of evidence must be surfaced, not invented.
