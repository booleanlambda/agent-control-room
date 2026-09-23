-- AAU legacy-experiment cleanup (2026-09-23).
-- Preserve all agent identities, resource balances, historical world events, wake
-- records and unreconciled intervention cases (including Elian).
-- The one-time cleanup ran in live DB; these scoped statements are idempotent.
-- DO NOT use this script as an automatic recurring cleanup without review.
begin;
CREATE OR REPLACE FUNCTION agent_lab.scan_operator_alerts_v0_1(p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_count integer:=0;
  v_global_pause boolean := false;
begin
  select coalesce((metadata->>'global_pause')::boolean,false)
    into v_global_pause
  from agent_lab.runtime_config
  order by config_id desc
  limit 1;

  -- System/infrastructure class: always monitored, including during a global pause.
  insert into agent_lab.operator_alerts(
    agent_id,alert_type,severity,title,detail,source_ref,status,last_seen_at,resolved_at,metadata
  )
  select q.agent_id,
         'wake_executor_error',
         case when max(q.attempts)>=3 then 'high' else 'warning' end,
         'Wake executor error',
         max(q.last_error),
         coalesce(max(q.wake_request_id::text),''),
         'open',
         p_now,
         null,
         jsonb_build_object('scanner','operator_monitor_v0_1','max_attempts',max(q.attempts),'alert_class','system')
  from agent_lab.wake_queue q
  where q.last_error is not null
    and q.created_at>=p_now-interval '6 hours'
    and q.status in ('queued','claimed','running')
  group by q.agent_id
  on conflict(agent_id,alert_type,source_ref) do update
     set severity=excluded.severity,
         title=excluded.title,
         detail=excluded.detail,
         status='open',
         last_seen_at=p_now,
         resolved_at=null,
         occurrences=case
           when agent_lab.operator_alerts.status='open'
             then agent_lab.operator_alerts.occurrences
           else agent_lab.operator_alerts.occurrences+1
         end,
         metadata=excluded.metadata;
  get diagnostics v_count = row_count;

  insert into agent_lab.operator_alerts(
    agent_id,alert_type,severity,title,detail,source_ref,status,last_seen_at,resolved_at,metadata
  )
  select ra.agent_id,
         case when ra.balance<=greatest(1,coalesce(ra.target_reserve,0)*0.25)
              then 'resource_critical' else 'resource_low' end,
         case when ra.balance<=greatest(1,coalesce(ra.target_reserve,0)*0.25)
              then 'critical' else 'warning' end,
         initcap(ra.resource_type)||' resource pressure',
         'Balance '||ra.balance||' versus target reserve '||coalesce(ra.target_reserve,0),
         ra.resource_type,
         'open',
         p_now,
         null,
         jsonb_build_object(
           'scanner','operator_monitor_v0_1',
           'resource_type',ra.resource_type,
           'balance',ra.balance,
           'target_reserve',ra.target_reserve,
           'alert_class','system'
         )
  from agent_lab.resource_accounts ra
  where ra.resource_type in ('compute','research')
    and ra.balance<=coalesce(ra.target_reserve,0)
    -- Historical incubating experiments without a running lifecycle are
    -- retained in the resource ledger but excluded from *live* alerts.
    and exists (
      select 1 from agent_lab.agents a
      left join agent_lab.autonomous_lifecycle_runs r on r.agent_id=a.agent_id
      where a.agent_id=ra.agent_id
        and (
          a.status='active'
          or r.status in ('starting','running','degraded')
        )
    )
  on conflict(agent_id,alert_type,source_ref) do update
     set severity=excluded.severity,
         title=excluded.title,
         detail=excluded.detail,
         status='open',
         last_seen_at=p_now,
         resolved_at=null,
         occurrences=case
           when agent_lab.operator_alerts.status='open'
             then agent_lab.operator_alerts.occurrences
           else agent_lab.operator_alerts.occurrences+1
         end,
         metadata=excluded.metadata;

  -- Agent-development class: suppressed while the universe is globally paused.
  if not coalesce(v_global_pause,false) then
    insert into agent_lab.operator_alerts(
      agent_id,alert_type,severity,title,detail,source_ref,status,last_seen_at,resolved_at,metadata
    )
    select d.agent_id,
           'stimulus_backlog',
           'warning',
           'Stimulus inbox backlog',
           count(*)||' pending stimuli',
           'pending',
           'open',
           p_now,
           null,
           jsonb_build_object('scanner','operator_monitor_v0_1','pending',count(*),'alert_class','agent_development')
    from agent_lab.agent_stimulus_deliveries d
    where d.status='pending'
    group by d.agent_id
    having count(*)>25
    on conflict(agent_id,alert_type,source_ref) do update
       set severity=excluded.severity,
           title=excluded.title,
           detail=excluded.detail,
           status='open',
           last_seen_at=p_now,
           resolved_at=null,
           occurrences=case
             when agent_lab.operator_alerts.status='open'
               then agent_lab.operator_alerts.occurrences
             else agent_lab.operator_alerts.occurrences+1
           end,
           metadata=excluded.metadata;

    insert into agent_lab.operator_alerts(
      agent_id,alert_type,severity,title,detail,source_ref,status,last_seen_at,resolved_at,metadata
    )
    select a.agent_id,
           'no_future_wake',
           'warning',
           'No future wake path',
           'Agent has no active wake intent and no pending wake request',
           'wake_path',
           'open',
           p_now,
           null,
           jsonb_build_object('scanner','operator_monitor_v0_1','alert_class','agent_development')
    from agent_lab.agents a
    where a.status in ('active','incubating')
      and not exists(
        select 1 from agent_lab.wake_intents wi
        where wi.agent_id=a.agent_id and wi.status='active'
      )
      and not exists(
        select 1 from agent_lab.wake_queue q
        where q.agent_id=a.agent_id and q.status in ('queued','claimed','running')
      )
    on conflict(agent_id,alert_type,source_ref) do update
       set severity=excluded.severity,
           title=excluded.title,
           detail=excluded.detail,
           status='open',
           last_seen_at=p_now,
           resolved_at=null,
           occurrences=case
             when agent_lab.operator_alerts.status='open'
               then agent_lab.operator_alerts.occurrences
             else agent_lab.operator_alerts.occurrences+1
           end,
           metadata=excluded.metadata;

    insert into agent_lab.operator_alerts(
      agent_id,alert_type,severity,title,detail,source_ref,status,last_seen_at,resolved_at,metadata
    )
    select x.agent_id,
           'repeated_action_pattern',
           'info',
           'Repeated action pattern',
           'The same selected action occurred in the last three recorded activities',
           'last3',
           'open',
           p_now,
           null,
           jsonb_build_object('scanner','operator_monitor_v0_1','action',x.selected_action,'alert_class','agent_development')
    from (
      select agent_id,
             max(selected_action) as selected_action,
             count(distinct selected_action) as distinct_actions,
             count(*) as n
      from (
        select al.agent_id,
               al.selected_action,
               row_number() over(partition by al.agent_id order by al.created_at desc) rn
        from agent_lab.activity_log al
        where al.created_at>=p_now-interval '24 hours'
      ) z
      where rn<=3
      group by agent_id
    ) x
    where x.n=3 and x.distinct_actions=1
    on conflict(agent_id,alert_type,source_ref) do update
       set severity=excluded.severity,
           title=excluded.title,
           detail=excluded.detail,
           status='open',
           last_seen_at=p_now,
           resolved_at=null,
           occurrences=case
             when agent_lab.operator_alerts.status='open'
               then agent_lab.operator_alerts.occurrences
             else agent_lab.operator_alerts.occurrences+1
           end,
           metadata=excluded.metadata;
  end if;

  -- Resolve only conditions not observed in this scan. During global pause this
  -- naturally closes agent-development alerts while preserving live system alerts.
  update agent_lab.operator_alerts
     set status='resolved',
         resolved_at=p_now,
         metadata=case
           when coalesce(v_global_pause,false)
                and alert_type in ('stimulus_backlog','no_future_wake','repeated_action_pattern')
             then metadata || jsonb_build_object(
               'suppressed_by_global_pause',true,
               'suppressed_at',p_now
             )
           when alert_type in ('resource_critical','resource_low')
                and not exists (
                  select 1 from agent_lab.agents a
                  left join agent_lab.autonomous_lifecycle_runs r on r.agent_id=a.agent_id
                  where a.agent_id=agent_lab.operator_alerts.agent_id
                    and (a.status='active' or r.status in ('starting','running','degraded'))
                )
             then metadata || jsonb_build_object(
               'suppressed_inactive_experiment',true,
               'resource_balance_unchanged',true,
               'suppressed_at',p_now
             )
           else metadata
         end
   where status='open'
     and metadata->>'scanner'='operator_monitor_v0_1'
     and last_seen_at is distinct from p_now;

  return (
    select count(*)
    from agent_lab.operator_alerts
    where status='open'
  );
end;
$function$
;
commit;

-- One-time targeted reconciliation:
-- (1) cancel only overdue resource-balance stimulus wakes for inactive,
--     incubating legacy agents (never Silas or an active lifecycle).
-- (2) dismiss their linked deliveries, preserving the original event FK.
-- (3) dismiss superseded system-rule inbox entries, keeping the newest
--     per inactive agent; no agent's public discussion inbox is changed.
-- (4) the updated monitor resolves older resource alerts with an explicit
--     inactive-experiment suppression tag while leaving true account
--     balances untouched. Elian's intervention alerts are preserved.
-- Recorded live results: 17 wakes + 17 linked deliveries; 32,211 older
-- rule-change inbox entries; 48 latest notices retained; 9 stale resource
-- alerts suppressed. Keep this accounting as audit provenance.
