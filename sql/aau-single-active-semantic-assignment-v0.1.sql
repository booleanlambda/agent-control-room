-- AAU single-active semantic assignment invariant v0.1
-- A single agent/model may have only one active semantic assignment at a time.
-- New assignment initialization atomically supersedes older active assignments.

create or replace function agent_lab.enforce_single_active_semantic_assignment_v0_1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
begin
  if new.status='active' then
    update agent_lab.cognition_assignment_runtime
       set status='complete',
           metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
             'superseded_by_assignment_key',new.assignment_key,
             'superseded_by_runtime_id',new.runtime_id,
             'superseded_reason','new_authoritative_semantic_assignment_initialized',
             'superseded_cleanup_version','single_active_semantic_assignment_v0_1',
             'superseded_at',now()
           ),
           updated_at=now()
     where agent_id=new.agent_id
       and model_id=new.model_id
       and status='active'
       and assignment_key<>new.assignment_key;
  end if;
  return new;
end
$function$;

drop trigger if exists cognition_runtime_single_active_assignment_before_insert
  on agent_lab.cognition_assignment_runtime;

create trigger cognition_runtime_single_active_assignment_before_insert
before insert on agent_lab.cognition_assignment_runtime
for each row
execute function agent_lab.enforce_single_active_semantic_assignment_v0_1();

create or replace function agent_lab.publish_active_semantic_assignment_v0_1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
begin
  if new.status='active' then
    update agent_lab.state
       set state_payload=coalesce(state_payload,'{}'::jsonb) || jsonb_build_object(
             'semantic_runtime_active_runtime_id',new.runtime_id,
             'semantic_runtime_active_epoch',new.epoch_no,
             'semantic_runtime_active_assignment_key',new.assignment_key,
             'semantic_runtime_pointer_version','single_active_semantic_assignment_v0_1'
           ),
           updated_at=now()
     where agent_id=new.agent_id;
  end if;
  return new;
end
$function$;

drop trigger if exists cognition_runtime_publish_active_after_insert
  on agent_lab.cognition_assignment_runtime;

create trigger cognition_runtime_publish_active_after_insert
after insert on agent_lab.cognition_assignment_runtime
for each row
execute function agent_lab.publish_active_semantic_assignment_v0_1();

revoke all on function agent_lab.enforce_single_active_semantic_assignment_v0_1()
  from public,anon,authenticated;
revoke all on function agent_lab.publish_active_semantic_assignment_v0_1()
  from public,anon,authenticated;
grant execute on function agent_lab.enforce_single_active_semantic_assignment_v0_1()
  to service_role;
grant execute on function agent_lab.publish_active_semantic_assignment_v0_1()
  to service_role;
