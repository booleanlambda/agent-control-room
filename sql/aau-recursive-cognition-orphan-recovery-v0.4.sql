-- AAU recursive-cognition-aware orphan recovery v0.4
-- Fresh worker heartbeats are authoritative liveness regardless of cognition duration.
-- Durable recursive requirement nodes are first-class resumable checkpoints.

begin;

CREATE OR REPLACE FUNCTION agent_lab.recover_orphaned_autonomous_intents_v0_1(p_min_running_minutes integer DEFAULT 5, p_retry_minutes integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_count integer:=0;
  v_current_worker text;
  v_heartbeat timestamptz;
  r record;
begin
  select worker_id,heartbeat_at into v_current_worker,v_heartbeat
  from agent_lab.runtime_worker_health where queue_name='aau.intent';

  for r in
    select q.wake_request_id,q.agent_id,q.worker_id,q.started_at,q.attempts,q.metadata
    from agent_lab.wake_queue q
    where q.status='running'
      and coalesce((q.metadata->>'autonomous_lifecycle')::boolean,false)=true
      and q.started_at is not null
      and q.started_at < now()-make_interval(mins=>greatest(3,coalesce(p_min_running_minutes,5)))
      and (
        -- A different healthy worker has replaced the claimant.
        (v_current_worker is not null and q.worker_id is distinct from v_current_worker and v_heartbeat is not null and v_heartbeat>now()-interval '2 minutes')
        -- Or worker health itself is stale/missing. There is deliberately no
        -- wall-clock ceiling: recursive cognition may legitimately run for many
        -- model/research calls while the claimant continues to heartbeat.
        or v_heartbeat is null or v_heartbeat<now()-interval '2 minutes'
      )
    for update skip locked
  loop
    -- A worker replacement after durable deep cognition is different from an
    -- exhausted cognition retry. Reuse the same validated checkpoint instead
    -- of pausing the agent and charging a fourth substantive reasoning pass.
    if r.attempts>=3 and (
      exists (
        select 1
        from agent_lab.deep_cognition_checkpoints c
        join agent_lab.agents a on a.agent_id=c.agent_id
        where c.agent_id=r.agent_id
          and c.source_wake_request_id=r.wake_request_id
          and c.created_at>=r.started_at
          and c.model_id=a.primary_model_id
          and nullif(c.artifact,'') is not null
          and c.artifact_hash ~ '^[0-9a-f]{64}$'
      )
      or exists (
        select 1
        from agent_lab.cognition_requirement_nodes c
        join agent_lab.agents a on a.agent_id=c.agent_id
        where c.agent_id=r.agent_id
          and (
            c.source_wake_request_id=r.wake_request_id
            or c.last_wake_request_id=r.wake_request_id
          )
          and c.model_id=a.primary_model_id
          and c.status in ('pending','deciding','waiting_context','split','executing','completed')
      )
    ) then
      update agent_lab.wake_queue q
         set status='queued',worker_id=null,claimed_at=null,started_at=null,
             attempts=greatest(0,q.attempts-1),
             due_at=now()+make_interval(mins=>greatest(1,least(coalesce(p_retry_minutes,1),60))),
             last_error='orphaned_after_deep_checkpoint_recovered',
             metadata=(coalesce(q.metadata,'{}'::jsonb)
               -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by'
               -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue')
               ||jsonb_build_object(
                 'orphan_recovered_at',now(),
                 'orphan_recovered_from_worker',r.worker_id,
                 'orphan_recovery_version','recursive_cognition_orphan_recovery_v0_4',
                 'orphan_original_started_at',r.started_at,
                 'checkpoint_reuse_required',true,
                 'attempt_counter_rewound_from',r.attempts,
                 'attempt_counter_rewound_to',greatest(0,r.attempts-1),
                 'retry_scheduled',true,
                 'recovery_required',false
               )
       where q.wake_request_id=r.wake_request_id and q.status='running';
      if not found then continue; end if;

      update agent_lab.autonomous_lifecycle_runs
         set status='degraded',
             last_error='orphaned_after_deep_checkpoint_recovered_for_retry',
             next_wake_at=now()+make_interval(mins=>greatest(1,least(coalesce(p_retry_minutes,1),60))),
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'checkpoint_orphan_recovery_at',now(),
               'checkpoint_orphan_recovery_version','recursive_cognition_orphan_recovery_v0_4',
               'checkpoint_orphan_wake_request_id',r.wake_request_id),
             updated_at=now()
       where agent_id=r.agent_id and status in ('starting','running','degraded');

      insert into agent_lab.operator_alerts(agent_id,alert_type,severity,title,detail,source_ref,metadata)
      values(r.agent_id,'orphaned_autonomous_intent_recovered','warning',
             'Orphaned autonomous intent recovered from deep checkpoint',
             'A replaced or stale worker left a third-attempt intent after durable cognition state was saved. The interrupted claim was not counted as a substantive retry; the durable deep or recursive checkpoint will be reused.',
             r.wake_request_id::text,
             jsonb_build_object('worker_id',r.worker_id,'started_at',r.started_at,
               'attempts_before_rewind',r.attempts,
               'attempts_after_rewind',greatest(0,r.attempts-1),
               'recovery_version','recursive_cognition_orphan_recovery_v0_4'))
      on conflict(agent_id,alert_type,source_ref) do update
        set status='open',resolved_at=null,last_seen_at=now(),
            occurrences=agent_lab.operator_alerts.occurrences+1,
            detail=excluded.detail,metadata=excluded.metadata;

      v_count:=v_count+1;
      continue;
    end if;

    -- Any orphan with three or more execution attempts requires a terminal
    -- operator hold. Preserve the failed wake; do not keep replaying it.
    if r.attempts>=3 then
      update agent_lab.wake_queue q
         set status='failed',completed_at=now(),worker_id=null,
             last_error='orphaned_running_intent_retry_exhausted',
             metadata=(coalesce(q.metadata,'{}'::jsonb)
               -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by'
               -'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue')
               ||jsonb_build_object(
                 'failure_class','orphaned_running_intent',
                 'orphan_recovery_version','intervention_orphan_bounded_v0_1',
                 'last_claimed_worker',r.worker_id,
                 'last_started_at',r.started_at,
                 'orphan_max_attempts',3,
                 'recovery_required',true,
                 'retry_scheduled',false,
                 'model_switch_performed',false)
       where q.wake_request_id=r.wake_request_id and q.status='running';
      if not found then continue; end if;

      update agent_lab.autonomous_lifecycle_runs
         set status='paused',next_wake_at=null,
             last_error='orphaned_running_intent_retry_exhausted',
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'repair_required',true,'repair_reason','orphaned_running_intent_exhausted',
               'repair_required_at',now(),
               'failed_wake_request_id',r.wake_request_id,
               'orphan_max_attempts',3,
               'orphan_recovery_version','intervention_orphan_bounded_v0_1'),
             updated_at=now()
       where agent_id=r.agent_id;
      update agent_lab.agent_existence_accounts
         set account_state='suspended',levy_enabled=false,
             metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
               'suspended_reason','orphaned_running_intent_exhausted',
               'suspended_at',now(),'failed_wake_request_id',r.wake_request_id,
               'resume_rule','restart_next_due_from_resume_time'),
             updated_at=now()
       where agent_id=r.agent_id;
      update agent_lab.state
         set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
               'system_paused',true,'awake',false,'sleeping',false,
               'intent_pending',false,'wake_pending',false,
               'repair_pause_reason','orphaned_running_intent_exhausted',
               'failed_wake_request_id',r.wake_request_id),
             updated_at=now()
       where agent_id=r.agent_id;

      insert into agent_lab.operator_alerts(agent_id,alert_type,severity,title,detail,source_ref,metadata)
      values (r.agent_id,'orphaned_autonomous_intent_exhausted','warning',
              'Orphaned autonomous intent requires intervention',
              'An orphaned cognition exhausted its three-attempt limit. Agent paused and levy suspended until explicit recovery.',
              r.wake_request_id::text,
              jsonb_build_object('last_worker_id',r.worker_id,'last_started_at',r.started_at,
                'attempts',r.attempts,'recovery_version','intervention_orphan_bounded_v0_1'))
      on conflict(agent_id,alert_type,source_ref) do update
        set status='open',resolved_at=null,last_seen_at=now(),
            occurrences=agent_lab.operator_alerts.occurrences+1,
            detail=excluded.detail,metadata=excluded.metadata;
      begin
        perform agent_lab.queue_intervention_admin_message_v0_1(
          r.agent_id,r.wake_request_id,'orphaned_running_intent',
          'orphaned_running_intent_retry_exhausted',r.attempts
        );
      exception when others then
        update agent_lab.wake_queue q
           set metadata=coalesce(q.metadata,'{}'::jsonb)||jsonb_build_object(
             'intervention_enqueue_error',left(sqlerrm,300),
             'intervention_enqueue_failed_at',now())
         where q.wake_request_id=r.wake_request_id;
      end;
      v_count:=v_count+1;
      continue;
    end if;

    update agent_lab.wake_queue q
       set status='queued',worker_id=null,claimed_at=null,started_at=null,
           due_at=now()+make_interval(mins=>greatest(1,least(coalesce(p_retry_minutes,1),60))),
           last_error='orphaned_running_intent_recovered_by_health_monitor',
           metadata=(coalesce(q.metadata,'{}'::jsonb)
             -'rabbit_arm_claimed_at'-'rabbit_arm_claimed_by'-'rabbit_armed_at'-'rabbit_armed_by'-'rabbit_message_id'-'rabbit_delay_queue')
             ||jsonb_build_object(
               'orphan_recovered_at',now(),
               'orphan_recovered_from_worker',r.worker_id,
               'orphan_recovery_version','orphan_intent_recovery_v0_1',
               'orphan_original_started_at',r.started_at
             )
     where q.wake_request_id=r.wake_request_id;

    update agent_lab.autonomous_lifecycle_runs
       set status='degraded',last_error='orphaned_running_intent_recovered_for_retry',next_wake_at=now()+make_interval(mins=>greatest(1,least(coalesce(p_retry_minutes,1),60))),updated_at=now()
     where agent_id=r.agent_id and status in ('starting','running','degraded');

    insert into agent_lab.operator_alerts(agent_id,alert_type,severity,title,detail,source_ref,metadata)
    values(r.agent_id,'orphaned_autonomous_intent_recovered','warning','Orphaned autonomous intent recovered','A running autonomous intent outlived its claiming worker/runtime and was safely returned to the queue for retry.',r.wake_request_id::text,jsonb_build_object('worker_id',r.worker_id,'started_at',r.started_at,'recovery_version','orphan_intent_recovery_v0_1'))
    on conflict(agent_id,alert_type,source_ref) do update set status='open',resolved_at=null,last_seen_at=now(),occurrences=agent_lab.operator_alerts.occurrences+1,detail=excluded.detail,metadata=excluded.metadata;

    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION agent_lab.resume_orphaned_runtime_hold_v0_1(
  p_agent_id uuid,
  p_reason text DEFAULT 'runtime deployment interruption repaired'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog','agent_lab'
AS $function$
declare
  v_run_id uuid;
  v_failed_wake uuid;
  v_new_wake uuid;
  v_prior_error text;
begin
  select r.run_id,
         nullif(r.metadata->>'failed_wake_request_id','')::uuid,
         r.last_error
    into v_run_id,v_failed_wake,v_prior_error
  from agent_lab.autonomous_lifecycle_runs r
  where r.agent_id=p_agent_id
    and r.status='paused'
    and coalesce(r.metadata->>'repair_reason','')='orphaned_running_intent_exhausted'
  for update;

  if v_run_id is null then
    raise exception 'orphaned_runtime_hold_resume_not_applicable';
  end if;

  if v_failed_wake is null or not exists(
    select 1
    from agent_lab.cognition_requirement_nodes n
    where n.agent_id=p_agent_id
      and (
        n.source_wake_request_id=v_failed_wake
        or n.last_wake_request_id=v_failed_wake
      )
      and n.status in ('pending','deciding','waiting_context','split','executing','completed')
  ) then
    raise exception 'orphaned_runtime_hold_checkpoint_missing';
  end if;

  update agent_lab.autonomous_lifecycle_runs
     set status='running',
         next_wake_at=now(),
         last_error=null,
         metadata=(
           coalesce(metadata,'{}'::jsonb)
           -'repair_required'
           -'repair_reason'
           -'repair_required_at'
           -'failed_wake_request_id'
         ) || jsonb_build_object(
           'orphan_hold_resumed_at',now(),
           'orphan_hold_resume_reason',left(coalesce(p_reason,''),1000),
           'orphan_hold_prior_error',left(coalesce(v_prior_error,''),1000),
           'orphan_hold_resume_contract','orphaned_runtime_hold_resume_v0_1',
           'semantic_state_preserved',true
         ),
         updated_at=now()
   where run_id=v_run_id;

  update agent_lab.state
     set state_payload=(
           coalesce(state_payload,'{}'::jsonb)
           -'repair_pause_reason'
           -'failed_wake_request_id'
         ) || jsonb_build_object(
           'system_paused',false,
           'awake',true,
           'sleeping',false,
           'inactive_between_wakes',false,
           'between_cognition_ticks',false,
           'intent_pending',true,
           'wake_pending',true,
           'intent_pending_since',now(),
           'wake_pending_since',now(),
           'orphan_hold_resumed_at',now()
         ),
         updated_at=now()
   where agent_id=p_agent_id;

  update agent_lab.agent_existence_accounts
     set account_state='current',
         levy_enabled=true,
         next_due_at=now()+interval '1 minute',
         metadata=(
           coalesce(metadata,'{}'::jsonb)
           -'suspended_reason'
           -'suspended_at'
           -'failed_wake_request_id'
           -'resume_rule'
         ) || jsonb_build_object(
           'resumed_at',now(),
           'resume_reason','deployment_orphan_checkpoint_preserved',
           'orphan_hold_resume_contract','orphaned_runtime_hold_resume_v0_1'
         ),
         updated_at=now()
   where agent_id=p_agent_id;

  insert into agent_lab.wake_queue(
    agent_id,source_kind,trigger_type,priority,status,due_at,payload,metadata
  ) values (
    p_agent_id,
    'system',
    'runtime_repair_resume',
    1,
    'queued',
    now(),
    jsonb_build_object(
      'reason',left(coalesce(p_reason,'Resume preserved cognition after deployment interruption.'),1000)
    ),
    jsonb_build_object(
      'autonomous_lifecycle',true,
      'lifecycle_run_id',v_run_id,
      'rabbit_transport','aau.intent',
      'protocol_version','next_intent_protocol_v0_1',
      'runtime_repair_resume',true,
      'orphan_hold_resume_contract','orphaned_runtime_hold_resume_v0_1',
      'semantic_state_preserved',true,
      'superseded_failed_wake_request_id',v_failed_wake
    )
  )
  returning wake_request_id into v_new_wake;

  update agent_lab.operator_alerts
     set status='resolved',
         resolved_at=now(),
         last_seen_at=now(),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'resolved_by','orphaned_runtime_hold_resume_v0_1',
           'resolved_at',now(),
           'resume_wake_request_id',v_new_wake
         )
   where agent_id=p_agent_id
     and alert_type='orphaned_autonomous_intent_exhausted'
     and source_ref=v_failed_wake::text
     and status='open';

  return jsonb_build_object(
    'status','resumed',
    'agent_id',p_agent_id,
    'run_id',v_run_id,
    'failed_wake_request_id',v_failed_wake,
    'wake_request_id',v_new_wake,
    'semantic_state_preserved',true,
    'contract','orphaned_runtime_hold_resume_v0_1'
  );
end;
$function$;

revoke all on function agent_lab.resume_orphaned_runtime_hold_v0_1(uuid,text)
  from public,authenticated,anon;
grant execute on function agent_lab.resume_orphaned_runtime_hold_v0_1(uuid,text)
  to service_role;

commit;
