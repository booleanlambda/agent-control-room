-- Universal cognition integrity v0.1
-- Durable evidence for rejected model attempts. Rejected content is never stored,
-- never eligible for continuation, and never eligible for grading.
begin;

create table if not exists agent_lab.cognition_rejected_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agent_lab.agents(agent_id) on delete cascade,
  execution_context text not null,
  execution_id text not null,
  model_id text not null,
  phase text not null,
  rejection_reason text not null,
  finish_reason text,
  elapsed_ms integer,
  output_chars integer,
  output_sha256 text,
  usage jsonb not null default '{}'::jsonb,
  continuation_eligibility text not null default 'NOT_ELIGIBLE_FOR_CONTINUATION',
  contract text not null default 'universal_cognition_integrity_v0_1',
  created_at timestamptz not null default now(),
  constraint cognition_rejected_attempts_eligibility_ck
    check (continuation_eligibility='NOT_ELIGIBLE_FOR_CONTINUATION')
);

create index if not exists cognition_rejected_attempts_agent_recent_idx
  on agent_lab.cognition_rejected_attempts(agent_id,created_at desc);
create index if not exists cognition_rejected_attempts_execution_idx
  on agent_lab.cognition_rejected_attempts(execution_context,execution_id,created_at desc);

alter table agent_lab.cognition_rejected_attempts enable row level security;
revoke all on agent_lab.cognition_rejected_attempts from public,anon,authenticated;

create or replace function public.aau_bridge_record_cognition_rejection(
  p_bridge_token text,
  p_agent_id uuid,
  p_execution_context text,
  p_execution_id text,
  p_model_id text,
  p_phase text,
  p_rejection_reason text,
  p_finish_reason text default null,
  p_elapsed_ms integer default null,
  p_output_chars integer default null,
  p_output_sha256 text default null,
  p_usage jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab','extensions'
as $$
declare
  v_bound text;
  v_id uuid;
begin
  perform agent_lab.assert_broker_bridge_token(p_bridge_token);
  select primary_model_id into v_bound from agent_lab.agents where agent_id=p_agent_id;
  if v_bound is null or v_bound is distinct from p_model_id then
    raise exception 'cognition_rejection_bound_model_mismatch';
  end if;
  if length(coalesce(p_execution_context,'')) not between 1 and 80
     or length(coalesce(p_execution_id,'')) not between 1 and 200
     or length(coalesce(p_phase,'')) not between 1 and 120
     or length(coalesce(p_rejection_reason,'')) not between 1 and 120 then
    raise exception 'cognition_rejection_invalid_identity';
  end if;
  if p_finish_reason is not null and length(p_finish_reason)>80 then
    raise exception 'cognition_rejection_invalid_finish_reason';
  end if;
  if p_output_sha256 is not null and p_output_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'cognition_rejection_invalid_output_hash';
  end if;
  if p_usage is null or jsonb_typeof(p_usage)<>'object' or octet_length(p_usage::text)>12000 then
    raise exception 'cognition_rejection_invalid_usage';
  end if;

  insert into agent_lab.cognition_rejected_attempts(
    agent_id,execution_context,execution_id,model_id,phase,rejection_reason,
    finish_reason,elapsed_ms,output_chars,output_sha256,usage
  ) values (
    p_agent_id,p_execution_context,p_execution_id,p_model_id,p_phase,p_rejection_reason,
    p_finish_reason,p_elapsed_ms,p_output_chars,p_output_sha256,coalesce(p_usage,'{}'::jsonb)
  ) returning attempt_id into v_id;

  return jsonb_build_object(
    'status','recorded','attempt_id',v_id,
    'continuation_eligibility','NOT_ELIGIBLE_FOR_CONTINUATION',
    'contract','universal_cognition_integrity_v0_1'
  );
end;
$$;

revoke all on function public.aau_bridge_record_cognition_rejection(
  text,uuid,text,text,text,text,text,text,integer,integer,text,jsonb
) from public;
grant execute on function public.aau_bridge_record_cognition_rejection(
  text,uuid,text,text,text,text,text,text,integer,integer,text,jsonb
) to anon,authenticated,service_role;

commit;
