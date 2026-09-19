-- AAU runtime worker health non-blocking legacy mirror v0.1
-- Keep runtime_worker_health authoritative. Legacy runtime_config telemetry
-- must never block heartbeat/arm progress behind contention on config_id=1.

create or replace function agent_lab.sync_runtime_worker_health_legacy_metadata()
returns trigger
language plpgsql
set search_path='pg_catalog','agent_lab'
as $$
begin
  perform set_config('aau.runtime_telemetry_mirror','on',true);

  with target as (
    select config_id
    from agent_lab.runtime_config
    where config_id=1
    for update skip locked
  )
  update agent_lab.runtime_config rc
     set metadata=coalesce(rc.metadata,'{}'::jsonb)||jsonb_build_object(
       'rabbitmq_intent_consumer_bound',new.consumer_bound,
       'rabbitmq_wake_consumer_bound',new.consumer_bound,
       'autonomous_intent_worker_id',new.worker_id,
       'autonomous_wake_worker_id',new.worker_id,
       'autonomous_intent_worker_queue',new.queue_name,
       'autonomous_wake_worker_queue',new.queue_name,
       'autonomous_intent_worker_heartbeat_at',new.heartbeat_at,
       'autonomous_wake_worker_heartbeat_at',new.heartbeat_at,
       'autonomous_intent_worker_offline_at',new.offline_at,
       'autonomous_wake_worker_offline_at',new.offline_at,
       'experimental_intent_loop_state',new.loop_state,
       'experimental_intent_loop_reason',new.loop_reason,
       'autonomous_worker_liveness_bridge',new.liveness_bridge,
       'autonomous_worker_wake_ping_at',new.wake_ping_at,
       'autonomous_worker_wake_ping_request_id',new.wake_ping_request_id,
       'autonomous_worker_wake_ping_agent_id',new.wake_ping_agent_id,
       'autonomous_worker_wake_ping_due_at',new.wake_ping_due_at
     ),
     updated_at=now()
    from target
   where rc.config_id=target.config_id;

  return new;
end;
$$;
