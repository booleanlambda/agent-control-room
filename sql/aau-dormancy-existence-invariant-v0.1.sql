-- AAU dormancy/existence invariant v0.1
-- Dormant agents do not accrue existence levy.
-- Entering dormancy freezes the levy account. Reactivation restarts the clock
-- from the reactivation moment so dormant time is never catch-up billed.

create or replace function agent_lab.enforce_dormancy_freezes_existence_v0_1()
returns trigger
language plpgsql
security definer
set search_path='pg_catalog','agent_lab'
as $$
begin
  if new.status='dormant' and old.status is distinct from new.status then
    update agent_lab.agent_existence_accounts
    set account_state='suspended',
        levy_enabled=false,
        dormancy_due=false,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'dormant_levy_frozen_at',now(),
          'dormant_freezes_existence_levies',true,
          'dormancy_existence_invariant_version','dormancy_existence_invariant_v0_1'
        ),
        updated_at=now()
    where agent_id=new.agent_id;

  elsif old.status='dormant'
        and new.status in ('seed','incubating','mature','public')
        and new.status is distinct from old.status then
    update agent_lab.agent_existence_accounts ea
    set account_state=case when ea.arrears_balance>0 then 'arrears' else 'current' end,
        levy_enabled=true,
        dormancy_due=false,
        next_due_at=now()+make_interval(mins=>greatest(1,coalesce(p.levy_interval_minutes,1))),
        metadata=(coalesce(ea.metadata,'{}'::jsonb)-'dormant_levy_frozen_at')
          ||jsonb_build_object(
            'dormant_levy_resumed_at',now(),
            'dormant_elapsed_time_billed',false,
            'dormancy_existence_invariant_version','dormancy_existence_invariant_v0_1'
          ),
        updated_at=now()
    from agent_lab.existence_policies p
    where ea.agent_id=new.agent_id
      and p.existence_policy_id=ea.existence_policy_id
      and not exists (
        select 1
        from agent_lab.autonomous_lifecycle_runs r
        where r.agent_id=new.agent_id and r.status='paused'
      );
  end if;
  return new;
end
$$;

drop trigger if exists trg_dormancy_freezes_existence_v0_1
on agent_lab.agents;

create trigger trg_dormancy_freezes_existence_v0_1
after update of status
on agent_lab.agents
for each row
when (old.status is distinct from new.status)
execute function agent_lab.enforce_dormancy_freezes_existence_v0_1();

-- Defense in depth: dormant is a zero-rate policy state even if a legacy path
-- reaches an assessor before the freeze invariant is observed.
update agent_lab.existence_policies
set status_multipliers=jsonb_set(
      coalesce(status_multipliers,'{}'::jsonb),
      '{dormant}',
      '0'::jsonb,
      true
    ),
    updated_at=now()
where coalesce(status_multipliers->>'dormant','') is distinct from '0';

-- Normalize any agents that are already dormant when this migration lands.
update agent_lab.agent_existence_accounts ea
set account_state='suspended',
    levy_enabled=false,
    dormancy_due=false,
    metadata=coalesce(ea.metadata,'{}'::jsonb)||jsonb_build_object(
      'dormant_levy_frozen_at',now(),
      'dormant_freezes_existence_levies',true,
      'dormancy_existence_invariant_version','dormancy_existence_invariant_v0_1',
      'normalized_by_migration',true
    ),
    updated_at=now()
from agent_lab.agents a
where a.agent_id=ea.agent_id
  and a.status='dormant';
