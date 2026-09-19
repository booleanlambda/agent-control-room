-- AAU pause/existence invariant v0.1
-- Any lifecycle transition to PAUSED must freeze the existence levy,
-- regardless of which code path performed the pause.

create or replace function agent_lab.enforce_pause_freezes_existence_v0_1()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','agent_lab'
as $$
begin
  if new.status='paused' and old.status is distinct from new.status then
    update agent_lab.agent_existence_accounts
    set account_state='suspended',
        levy_enabled=false,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'suspended_at',now(),
          'suspended_reason',coalesce(nullif(new.metadata->>'pause_reason',''),'lifecycle_status_paused'),
          'pause_freezes_existence_levies',true,
          'pause_invariant_version','pause_existence_invariant_v0_1',
          'pause_invariant_enforced_at',now()
        ),
        updated_at=now()
    where agent_id=new.agent_id;
  end if;
  return new;
end
$$;

drop trigger if exists trg_pause_freezes_existence_v0_1
on agent_lab.autonomous_lifecycle_runs;

create trigger trg_pause_freezes_existence_v0_1
after update of status
on agent_lab.autonomous_lifecycle_runs
for each row
when (new.status='paused' and old.status is distinct from new.status)
execute function agent_lab.enforce_pause_freezes_existence_v0_1();
