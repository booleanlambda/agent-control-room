
-- A failed/cancelled wake did not finish cognition. Record two explicit
-- deferred checks without pretending that knowledge was acquired.
create or replace function agent_lab.mark_knowledge_wake_interrupted_v0_1()
returns trigger language plpgsql security invoker
set search_path to 'pg_catalog','agent_lab'
as $function$
declare v_enabled boolean:=false;
begin
 if new.status not in ('failed','cancelled') or new.status is not distinct from old.status then
   return new;
 end if;
 select coalesce((metadata->>'knowledge_pool_enabled')::boolean,false) into v_enabled
 from agent_lab.runtime_config where config_id=1;
 if not v_enabled then return new; end if;
 insert into agent_lab.knowledge_wake_updates(
    agent_id,wake_request_id,component,status,agent_report,metadata)
 select new.agent_id,new.wake_request_id,component,'deferred','{}'::jsonb,
  jsonb_build_object('protocol','knowledge_pool_v0_1',
    'reason','wake_not_completed','wake_status',new.status,
    'error',left(coalesce(new.last_error,''),350),'not_expertise_verification',true)
 from unnest(ARRAY['general','peripheral']) component
 where exists(select 1 from agent_lab.agent_knowledge_pools p where p.agent_id=new.agent_id)
 on conflict(agent_id,wake_request_id,component) do nothing;
 return new;
end;
$function$;
drop trigger if exists trg_knowledge_wake_interrupted_v0_1 on agent_lab.wake_queue;
create trigger trg_knowledge_wake_interrupted_v0_1 after update of status on agent_lab.wake_queue
for each row when (new.status in ('failed','cancelled') and old.status is distinct from new.status)
execute function agent_lab.mark_knowledge_wake_interrupted_v0_1();
