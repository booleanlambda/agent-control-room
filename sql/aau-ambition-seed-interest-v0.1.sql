-- AAU seed interest: Ambition v0.1
-- Applies to all existing agents and all future agents.
-- Seed is latent/noncanonical and does not bypass the Interest Artifact's behavioral/self-review gates.

begin;

create or replace function agent_lab.ensure_ambition_seed_interest_v0_1(p_agent_id uuid)
returns uuid
language plpgsql
set search_path to 'pg_catalog','agent_lab','extensions'
as $function$
declare
  v_interest_id uuid;
begin
  insert into agent_lab.interests(
    agent_id,topic,interest_strength,curiosity_strength,source,metadata,description,parent_domain,
    lifecycle_state,motivation_classification,confidence,evidence_count,qualifying_wake_count,
    voluntary_return_count,delayed_return_count,cross_context_recurrence,reward_independence_observed,
    behavioral_gate_pass,agent_self_review,self_review_gate_pass,agent_position,canonical_status,
    first_observed_at,last_observed_at,dormancy_status,state_history,provenance,protocol_version,updated_at
  )
  values(
    p_agent_id,'Ambition',0.25,0.35,'aau_seed_interest_v0_1',
    jsonb_build_object(
      'seed_interest',true,
      'seed_interest_version','ambition_seed_v0_1',
      'operator_defined_seed',true,
      'noncanonical_at_birth',true,
      'agent_may_strengthen_reframe_ignore_or_reject',true
    ),
    'A seed inclination toward meaningful advancement, growing capability, achievement, impact, or larger self-chosen goals. This is an initial predisposition only, not an established identity trait or obligation.',
    'motivation_and_aspiration','LATENT','UNDETERMINED',0,0,0,0,0,false,false,false,
    'PENDING',false,'UNREVIEWED','OBSERVATION_ONLY',null,null,'NOT_INFERRED',
    jsonb_build_array(jsonb_build_object(
      'event','seeded','to_state','LATENT','canonical',false,'confidence',0,
      'reason','AAU platform seed interest; requires agent-authored behavioral evidence and self-review before canonicalization'
    )),
    jsonb_build_object(
      'origin','aau_seed_interest_v0_1',
      'seed_interest_version','ambition_seed_v0_1',
      'behavioral_evidence_supplied',false,
      'self_authored_at_seed',false,
      'canonicalization_bypass',false,
      'agent_autonomy_preserved',true
    ),
    'v0_1',now()
  )
  on conflict(agent_id,topic) do update
  set metadata=coalesce(agent_lab.interests.metadata,'{}'::jsonb)||jsonb_build_object(
        'seed_interest',true,
        'seed_interest_version','ambition_seed_v0_1',
        'operator_defined_seed',true
      ),
      provenance=coalesce(agent_lab.interests.provenance,'{}'::jsonb)||jsonb_build_object(
        'seed_interest_version','ambition_seed_v0_1',
        'platform_seed_declared',true
      ),
      updated_at=now()
  returning interest_id into v_interest_id;

  if not exists(
    select 1 from agent_lab.interest_state_history h
    where h.interest_id=v_interest_id and h.provenance->>'origin'='aau_seed_interest_v0_1'
  ) then
    insert into agent_lab.interest_state_history(
      interest_id,agent_id,wake_id,from_state,to_state,reason,
      triggering_observation_ids,triggering_review_id,
      confidence_before,confidence_after,canonical_before,canonical_after,provenance
    )
    values(
      v_interest_id,p_agent_id,null,null,'LATENT',
      'AAU platform seed interest initialized; future status must be earned through normal interest evidence and self-review.',
      '{}'::uuid[],null,null,0,false,false,
      jsonb_build_object(
        'origin','aau_seed_interest_v0_1',
        'seed_interest_version','ambition_seed_v0_1',
        'behavioral_evidence',false,
        'canonicalization_bypass',false
      )
    );
  end if;

  return v_interest_id;
end
$function$;

create or replace function agent_lab.seed_ambition_interest_on_agent_birth_v0_1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
begin
  perform agent_lab.ensure_ambition_seed_interest_v0_1(new.agent_id);
  return new;
end
$function$;

drop trigger if exists trg_agents_seed_ambition_interest_v0_1 on agent_lab.agents;
create trigger trg_agents_seed_ambition_interest_v0_1
after insert on agent_lab.agents
for each row execute function agent_lab.seed_ambition_interest_on_agent_birth_v0_1();

select agent_lab.ensure_ambition_seed_interest_v0_1(a.agent_id)
from agent_lab.agents a;

commit;
