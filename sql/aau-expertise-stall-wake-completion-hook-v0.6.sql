CREATE OR REPLACE FUNCTION agent_lab.complete_wake_request(p_wake_request_id uuid, p_success boolean, p_error text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  v_agent_id uuid;
begin
  update agent_lab.wake_queue
  set status=case when p_success then 'completed' else 'failed' end,
      completed_at=now(),
      last_error=p_error
  where wake_request_id=p_wake_request_id
    and status in ('claimed','running')
  returning agent_id into v_agent_id;

  if v_agent_id is null then return false; end if;

  -- Completion no longer manufactures sleep. Sleep exists only when the agent
  -- explicitly selects an eligible rest action, and fixed sleep owns its own T+5 wake.
  update agent_lab.state
     set state_payload=jsonb_set(
       coalesce(state_payload,'{}'::jsonb),
       '{wake_pending}','false'::jsonb,true
     ),
         updated_at=now()
   where agent_id=v_agent_id;

  -- Safe completion boundary: the current wake is marked completed,
  -- so operator safeguards cancel only FUTURE work and suspend the levy.
  if p_success then
    perform agent_lab.maybe_pause_expertise_verification_stall_v0_1(
      v_agent_id,p_wake_request_id
    );
  end if;

  return true;
end;
$function$
;
