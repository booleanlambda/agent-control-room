-- QDA-601 verified-pass continuation recovery v0.1
-- Prevent a verified unit from stranding an autonomous agent when the
-- previously declared continuation intent was cancelled by an attention interrupt.

create or replace function agent_lab.ensure_qda601_progression_after_verified_pass_v0_1(
  p_agent_id uuid,
  p_review_id uuid default null
) returns uuid
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_review agent_lab.qda601_authenticator_reviews%rowtype;
  v_state jsonb;
  v_run_status text;
  v_intent_id uuid;
begin
  select * into v_review
  from agent_lab.qda601_authenticator_reviews
  where agent_id=p_agent_id
    and verdict='verified_pass'
    and status='completed'
    and (p_review_id is null or review_id=p_review_id)
  order by completed_at desc nulls last, created_at desc
  limit 1;

  if not found then return null; end if;

  select coalesce(state_payload,'{}'::jsonb) into v_state
  from agent_lab.state
  where agent_id=p_agent_id;

  if coalesce((v_state->>'system_paused')::boolean,false) then return null; end if;

  select status into v_run_status
  from agent_lab.autonomous_lifecycle_runs
  where agent_id=p_agent_id;

  if coalesce(v_run_status,'') not in ('starting','running','degraded') then return null; end if;

  if exists (
    select 1 from agent_lab.wake_intents
    where agent_id=p_agent_id and status='active'
  ) or exists (
    select 1 from agent_lab.wake_queue
    where agent_id=p_agent_id and status in ('queued','claimed','running')
  ) then return null; end if;

  v_intent_id := agent_lab.declare_next_intent_v0_1(
    p_agent_id,
    'time',
    null,
    null,
    '{}'::jsonb,
    'Continue the mandatory QDA-601 program from the authoritative verified cursor at the next canonical unit.',
    1,
    0,
    jsonb_build_object(
      'origin','qda601_verified_pass_progression_recovery_v0_1',
      'verified_review_id',v_review.review_id,
      'verified_unit_code',v_review.unit_code,
      'verified_at',v_review.completed_at,
      'semantic_intent_preserved',true
    )
  );

  update agent_lab.state
  set state_payload=coalesce(state_payload,'{}'::jsonb)||jsonb_build_object(
        'intent_pending',true,
        'intent_pending_since',now(),
        'qda_601_progression_recovery_intent_id',v_intent_id,
        'qda_601_progression_recovery_review_id',v_review.review_id,
        'qda_601_progression_recovery_at',now()
      ),
      updated_at=now()
  where agent_id=p_agent_id;

  return v_intent_id;
end
$function$;

create or replace function agent_lab.qda601_verified_pass_progression_trigger_v0_1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
begin
  if new.status='completed'
     and new.verdict='verified_pass'
     and (
       tg_op='INSERT'
       or old.status is distinct from new.status
       or old.verdict is distinct from new.verdict
     )
  then
    perform agent_lab.ensure_qda601_progression_after_verified_pass_v0_1(new.agent_id,new.review_id);
  end if;
  return new;
end
$function$;

drop trigger if exists qda601_verified_pass_progression_v0_1
  on agent_lab.qda601_authenticator_reviews;

create trigger qda601_verified_pass_progression_v0_1
after insert or update of status,verdict
on agent_lab.qda601_authenticator_reviews
for each row
execute function agent_lab.qda601_verified_pass_progression_trigger_v0_1();
