-- AAU pause levy guard v0.1
-- Ensures existence levies are suspended whenever the canonical lifecycle
-- transitions to paused, even if a caller bypasses the admin pause RPC.
-- autonomous_intent_runs is a view over the canonical lifecycle state,
-- so the trigger belongs on autonomous_lifecycle_runs.

create or replace function agent_lab.freeze_existence_levy_on_lifecycle_pause_v0_1()
returns trigger
language plpgsql
set search_path='pg_catalog','agent_lab'
as $$
begin
  if new.status='paused' and old.status is distinct from new.status then
    update agent_lab.agent_existence_accounts
    set account_state='suspended',
        levy_enabled=false,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'suspended_at',now(),
          'suspended_reason','lifecycle_status_paused',
          'pause_freezes_existence_levies',true,
          'pause_safeguard_version','pause_levy_guard_v0_1'
        ),
        updated_at=now()
    where agent_id=new.agent_id;
  end if;
  return new;
end
$$;

drop trigger if exists trg_freeze_existence_levy_on_lifecycle_pause_v0_1
  on agent_lab.autonomous_lifecycle_runs;

create trigger trg_freeze_existence_levy_on_lifecycle_pause_v0_1
after update of status on agent_lab.autonomous_lifecycle_runs
for each row
execute function agent_lab.freeze_existence_levy_on_lifecycle_pause_v0_1();
