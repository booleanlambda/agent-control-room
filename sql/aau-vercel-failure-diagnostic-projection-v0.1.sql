-- AAU Vercel failure diagnostic projection v0.1
-- Preserve sanitized provider diagnostics on capability_invocations so the
-- autonomous agent can reason about the actual external failure on its next wake.

create or replace function public.aau_fail_vercel_deployment_job(
  p_broker_job_id uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default false,
  p_partial_result jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
set search_path to 'public','agent_lab'
as $function$
declare
  v_job agent_lab.infrastructure_broker_jobs%rowtype;
  v_next_status text;
begin
  select * into v_job from agent_lab.infrastructure_broker_jobs
  where broker_job_id=p_broker_job_id for update;
  if not found then raise exception 'broker_job_not_found'; end if;
  if v_job.provider <> 'vercel' then raise exception 'not_vercel_job'; end if;

  v_next_status:=case when p_retryable and v_job.attempt_count<v_job.max_attempts then 'queued' else 'failed' end;

  update agent_lab.infrastructure_broker_jobs
  set status=v_next_status,
      available_at=case when v_next_status='queued' then now()+make_interval(secs=>least(300,15*greatest(1,attempt_count))) else available_at end,
      finished_at=case when v_next_status='failed' then now() else null end,
      error_code=p_error_code,
      error_message=left(coalesce(p_error_message,''),2000),
      result_payload=coalesce(result_payload,'{}'::jsonb)||coalesce(p_partial_result,'{}'::jsonb),
      updated_at=now()
  where broker_job_id=p_broker_job_id;

  update agent_lab.infrastructure_broker_requests
  set status=case when v_next_status='queued' then 'queued' else 'failed' end,updated_at=now()
  where broker_request_id=v_job.broker_request_id;

  update agent_lab.capability_invocations
  set status=case when v_next_status='queued' then 'queued' else 'failed' end,
      error_code=p_error_code,
      error_message=left(coalesce(p_error_message,''),2000),
      result_payload=coalesce(result_payload,'{}'::jsonb)||coalesce(p_partial_result,'{}'::jsonb),
      completed_at=case when v_next_status='failed' then now() else null end,
      updated_at=now()
  where broker_job_id=p_broker_job_id;

  return jsonb_build_object('ok',false,'broker_job_id',p_broker_job_id,'status',v_next_status,'retryable',p_retryable);
end;
$function$;
