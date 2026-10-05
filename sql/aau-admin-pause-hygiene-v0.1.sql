-- AAU admin pause hygiene v0.1
create or replace function public.aau_control_room_admin_pause(
  p_agent_id uuid,
  p_reason text default 'agent_control_room_admin_pause'::text
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','public','agent_lab','extensions'
as $function$
declare
  v_reason text := left(coalesce(nullif(btrim(p_reason),''),'agent_control_room_admin_pause'),500);
  v_label text;
  v_cancelled_wakes integer := 0;
  v_cancelled_intents integer := 0;
begin
  select a.internal_label into v_label
  from agent_lab.agents a
  where a.agent_id=p_agent_id and a.status<>'archived';
  if v_label is null then raise exception 'agent_missing_or_archived'; end if;

  with x as (
    update agent_lab.wake_queue q
       set status='cancelled',
           completed_at=coalesce(q.completed_at,now()),
           last_error='system_paused_by_admin',
           metadata=coalesce(q.metadata,'{}'::jsonb)||jsonb_build_object(
             'cancelled_by','agent_control_room_admin',
             'pause_reason',v_reason,
             'cancelled_at',now(),
             'pause_epoch_barrier',true
           )
     where q.agent_id=p_agent_id and q.status in ('queued','claimed','running')
     returning 1
  ) select count(*) into v_cancelled_wakes from x;

  with x as (
    update agent_lab.wake_intents i
       set status='cancelled',
           cancelled_at=now(),
           metadata=coalesce(i.metadata,'{}'::jsonb)||jsonb_build_object(
             'cancelled_by','agent_control_room_admin',
             'pause_reason',v_reason
           )
     where i.agent_id=p_agent_id and i.status='active'
     returning 1
  ) select count(*) into v_cancelled_intents from x;

  update agent_lab.admin_chat_messages
     set delivery_status='queued',
         source_wake_request_id=null,
         updated_at=now(),
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('requeued_by_pause',now())
   where agent_id=p_agent_id and sender_kind='admin' and delivery_status='scheduled';

  update agent_lab.state
     set state_payload=(coalesce(state_payload,'{}'::jsonb)-'wake_pending_since'-'intent_pending_since')
       ||jsonb_build_object(
         'system_paused',true,'awake',false,'sleeping',false,
         'wake_pending',false,'intent_pending',false,
         'between_cognition_ticks',false,'inactive_between_wakes',true,
         'paused_at',now(),'pause_reason',v_reason,
         'admin_control_version','admin_control_v0_3',
         'pause_epoch_barrier',true
       ),
         updated_at=now()
   where agent_id=p_agent_id;

  update agent_lab.autonomous_lifecycle_runs
     set status='paused',next_wake_at=null,last_error=null,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'paused_at',now(),'pause_reason',v_reason,
           'paused_by','agent_control_room_admin',
           'pause_epoch_barrier',true,
           'admin_control_version','admin_control_v0_3'
         ),
         updated_at=now()
   where agent_id=p_agent_id;

  update agent_lab.agent_existence_accounts
     set account_state='suspended',levy_enabled=false,
         metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'suspended_at',now(),'suspended_reason',v_reason,
           'pause_freezes_existence_levies',true,
           'pause_epoch_barrier',true
         ),
         updated_at=now()
   where agent_id=p_agent_id;

  update agent_lab.runtime_config
     set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
           'experimental_intent_loop_state','paused',
           'experimental_intent_loop_reason',v_reason,
           'admin_control_version','admin_control_v0_3'
         ),
         updated_at=now()
   where config_id=1 and metadata->>'current_experimental_agent_id'=p_agent_id::text;

  return jsonb_build_object(
    'status','paused','agent_id',p_agent_id,
    'cancelled_wakes',v_cancelled_wakes,
    'cancelled_intents',v_cancelled_intents,
    'reason',v_reason,
    'pause_contract','admin_pause_epoch_barrier_v0_2'
  );
end;
$function$;
