-- Extend the EXISTING system intervention event allowlist; preserve all
-- historically supported classes and their idempotent event identity.
begin;
alter table agent_lab.intervention_events
  drop constraint if exists intervention_events_failure_class_check;
alter table agent_lab.intervention_events
  add constraint intervention_events_failure_class_check check(
    failure_class in (
      'nvidia_model_timeout','orphaned_running_intent',
      'semantic_contract','postgres_statement_timeout',
      'cognition_runtime_fault'
    )
  );
commit;