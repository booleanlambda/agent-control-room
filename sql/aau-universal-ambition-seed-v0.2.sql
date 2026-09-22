-- AAU Universal Ambition Seed v0.2
-- Every existing and future agent begins with Ambition = 0.90.
-- This is a high-weight motivational prior, not a prescribed goal, career, expertise, or identity.

begin;

CREATE OR REPLACE FUNCTION agent_lab.ensure_ambition_seed_interest_v0_2(p_agent_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab', 'extensions'
AS $function$
declare
  v_interest_id uuid;
begin
  if not exists(select 1 from agent_lab.agents where agent_id=p_agent_id) then
    raise exception 'agent_not_found';
  end if;

  insert into agent_lab.traits(agent_id,trait_key,value,confidence,origin,metadata)
  values(
    p_agent_id,'ambition',0.90,1.0,'aau_universal_seed_v0_2',
    jsonb_build_object(
      'universal_seed',true,
      'seed_trait_version','ambition_seed_v0_2',
      'seed_value',0.90,
      'high_weight_seed',true,
      'operator_defined_seed',true,
      'behavioral_role','strong predisposition toward advancement, capability growth, achievement, impact, and larger self-chosen goals',
      'does_not_choose_goal',true,
      'does_not_choose_expertise',true,
      'does_not_choose_career',true
    )
  )
  on conflict(agent_id,trait_key) do update
  set value=0.90,
      confidence=1.0,
      origin='aau_universal_seed_v0_2',
      metadata=coalesce(agent_lab.traits.metadata,'{}'::jsonb)||jsonb_build_object(
        'universal_seed',true,
        'seed_trait_version','ambition_seed_v0_2',
        'seed_value',0.90,
        'high_weight_seed',true,
        'operator_defined_seed',true,
        'backfilled_or_birth_seed',true,
        'does_not_choose_goal',true,
        'does_not_choose_expertise',true,
        'does_not_choose_career',true
      ),
      updated_at=now();

  insert into agent_lab.interests(
    agent_id,topic,interest_strength,curiosity_strength,source,metadata,description,parent_domain,
    lifecycle_state,motivation_classification,confidence,evidence_count,qualifying_wake_count,
    voluntary_return_count,delayed_return_count,cross_context_recurrence,reward_independence_observed,
    behavioral_gate_pass,agent_self_review,self_review_gate_pass,agent_position,canonical_status,
    first_observed_at,last_observed_at,dormancy_status,state_history,provenance,protocol_version,updated_at
  )
  values(
    p_agent_id,'Ambition',0.90,0.35,'aau_seed_interest_v0_2',
    jsonb_build_object(
      'seed_interest',true,'seed_interest_version','ambition_seed_v0_2',
      'operator_defined_seed',true,'high_weight_seed',true,'seed_value',0.90,
      'noncanonical_at_birth',true,
      'agent_may_choose_the_objects_and_expression_of_ambition',true
    ),
    'A strong initial inclination toward meaningful advancement, growing capability, achievement, impact, and larger self-chosen goals. The seed supplies motivational pressure, not a prescribed goal, career, expertise, or public identity.',
    'motivation_and_aspiration','LATENT','UNDETERMINED',0,0,0,0,0,false,false,false,
    'PENDING',false,'UNREVIEWED','OBSERVATION_ONLY',null,null,'NOT_INFERRED',
    jsonb_build_array(jsonb_build_object(
      'event','seeded_high_weight',
      'to_state','LATENT','canonical',false,'confidence',0,
      'seed_value',0.90,'seed_interest_version','ambition_seed_v0_2',
      'reason','AAU universal high-weight ambition seed; the agent retains autonomy over what it becomes ambitious about'
    )),
    jsonb_build_object(
      'origin','aau_seed_interest_v0_2',
      'seed_interest_version','ambition_seed_v0_2',
      'seed_value',0.90,'high_weight_seed',true,
      'behavioral_evidence_supplied',false,'self_authored_at_seed',false,
      'canonicalization_bypass',false,'agent_autonomy_preserved',true
    ),
    'v0_2',now()
  )
  on conflict(agent_id,topic) do update
  set interest_strength=0.90,
      source='aau_seed_interest_v0_2',
      metadata=coalesce(agent_lab.interests.metadata,'{}'::jsonb)||jsonb_build_object(
        'seed_interest',true,'seed_interest_version','ambition_seed_v0_2',
        'operator_defined_seed',true,'high_weight_seed',true,'seed_value',0.90
      ),
      provenance=coalesce(agent_lab.interests.provenance,'{}'::jsonb)||jsonb_build_object(
        'origin','aau_seed_interest_v0_2',
        'seed_interest_version','ambition_seed_v0_2',
        'platform_seed_declared',true,'seed_value',0.90,'high_weight_seed',true
      ),
      protocol_version='v0_2',
      updated_at=now()
  returning interest_id into v_interest_id;

  if not exists(
    select 1 from agent_lab.interest_state_history h
    where h.interest_id=v_interest_id and h.provenance->>'seed_interest_version'='ambition_seed_v0_2'
  ) then
    insert into agent_lab.interest_state_history(
      interest_id,agent_id,wake_id,from_state,to_state,reason,
      triggering_observation_ids,triggering_review_id,confidence_before,confidence_after,
      canonical_before,canonical_after,provenance
    )
    select
      v_interest_id,p_agent_id,null,i.lifecycle_state,i.lifecycle_state,
      'AAU upgraded Ambition to the universal high-weight seed value 0.90. This changes motivational prior strength, not the agent''s self-chosen goals.',
      '{}'::uuid[],null,i.confidence,i.confidence,
      i.canonical_status='CANONICAL',i.canonical_status='CANONICAL',
      jsonb_build_object(
        'origin','aau_seed_interest_v0_2',
        'seed_interest_version','ambition_seed_v0_2',
        'seed_value',0.90,'high_weight_seed',true,
        'behavioral_evidence',false,'canonicalization_bypass',false
      )
    from agent_lab.interests i where i.interest_id=v_interest_id;
  end if;

  return v_interest_id;
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.ensure_ambition_seed_interest_v0_1(p_agent_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
begin
  return agent_lab.ensure_ambition_seed_interest_v0_2(p_agent_id);
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.seed_ambition_interest_on_agent_birth_v0_1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
begin
  perform agent_lab.ensure_ambition_seed_interest_v0_2(new.agent_id);
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.build_incubator_birth_plan_v0_5(p_seed integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
declare
  base jsonb;
  temps jsonb;
  trait text;
  traits text[] := array['empathy','patience','curiosity','rest_drive','social_drive','status_drive','assertiveness','risk_tolerance','novelty_seeking','pattern_seeking','self_reflection','intellectual_honesty'];
  val numeric;
begin
  select agent_lab.preview_incubator_birth_v0_5(p_seed) into base;
  if base is null then
    raise exception 'staged v0.5 birth blueprint not found';
  end if;
  temps := '{}'::jsonb;
  foreach trait in array traits loop
    val := round((0.20 + 0.60 * agent_lab.incubator_hash01_v0_5(p_seed,trait))::numeric,4);
    temps := temps || jsonb_build_object(trait,val);
  end loop;
  return base || jsonb_build_object(
    'birth_plan_generator','birth_plan_v0_5',
    'seed',p_seed,
    'fresh_temperament',temps,
    'universal_seed_traits',jsonb_build_object('ambition',0.90),
    'universal_seed_policy_version','ambition_seed_v0_2',
    'plan_is_write_free',true,
    'requires_live_activation_before_creation',true
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION agent_lab.build_temperament_action_priors(p_agent_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'agent_lab'
AS $function$
with tr as (
  select
    coalesce(max(value) filter (where trait_key='ambition'),0.90)::numeric as ambition,
    coalesce(max(value) filter (where trait_key='assertiveness'),0.5)::numeric as assertiveness,
    coalesce(max(value) filter (where trait_key='curiosity'),0.5)::numeric as curiosity,
    coalesce(max(value) filter (where trait_key='empathy'),0.5)::numeric as empathy,
    coalesce(max(value) filter (where trait_key='intellectual_honesty'),0.5)::numeric as intellectual_honesty,
    coalesce(max(value) filter (where trait_key='novelty_seeking'),0.5)::numeric as novelty_seeking,
    coalesce(max(value) filter (where trait_key='patience'),0.5)::numeric as patience,
    coalesce(max(value) filter (where trait_key='pattern_seeking'),0.5)::numeric as pattern_seeking,
    coalesce(max(value) filter (where trait_key='rest_drive'),0.5)::numeric as rest_drive,
    coalesce(max(value) filter (where trait_key='risk_tolerance'),0.5)::numeric as risk_tolerance,
    coalesce(max(value) filter (where trait_key='self_reflection'),0.5)::numeric as self_reflection,
    coalesce(max(value) filter (where trait_key='social_drive'),0.5)::numeric as social_drive,
    coalesce(max(value) filter (where trait_key='status_drive'),0.5)::numeric as status_drive
  from agent_lab.traits where agent_id=p_agent_id
), st as (
  select coalesce((state_payload->>'wake_number')::int,0) as wake_number,
         coalesce(state_payload->>'developmental_stage','seed') as developmental_stage
  from agent_lab.state where agent_id=p_agent_id
), s as (
  select tr.*,coalesce(st.wake_number,0) as wake_number,
         coalesce(st.developmental_stage,'seed') as developmental_stage
  from tr left join st on true
)
select jsonb_build_object(
  'version','temperament_expression_v0_2_ambition',
  'principle','temperament modifies action attractiveness but does not command actions; ambition is a universal high-weight seed and does not prescribe its object',
  'universal_seed_traits',jsonb_build_object('ambition',ambition),
  'expression_strength',case when developmental_stage='seed' or wake_number<=3 then 0.55 when wake_number<=10 then 0.40 else 0.30 end,
  'risk_penalty_multiplier',round((1.25-0.50*risk_tolerance)::numeric,4),
  'action_priors',jsonb_build_object(
    'pursue_advancement',round((0.50*ambition+0.20*assertiveness+0.15*status_drive+0.15*curiosity)::numeric,5),
    'explore_world',round((0.40*curiosity+0.30*novelty_seeking+0.15*risk_tolerance+0.15*ambition)::numeric,5),
    'social_outreach',round((0.40*social_drive+0.25*empathy+0.20*assertiveness+0.15*risk_tolerance)::numeric,5),
    'initiate_project_or_experiment',round((0.30*ambition+0.25*assertiveness+0.20*risk_tolerance+0.15*novelty_seeking+0.10*status_drive)::numeric,5),
    'introspect',round((0.40*self_reflection+0.25*intellectual_honesty+0.20*patience+0.15*pattern_seeking)::numeric,5),
    'observe_wait',round((0.40*rest_drive+0.30*patience+0.15*intellectual_honesty+0.15*(1-risk_tolerance))::numeric,5),
    'investigate_pattern',round((0.35*pattern_seeking+0.30*curiosity+0.20*intellectual_honesty+0.15*novelty_seeking)::numeric,5),
    'visible_achievement',round((0.35*ambition+0.25*status_drive+0.20*assertiveness+0.10*risk_tolerance+0.10*social_drive)::numeric,5),
    'help_or_support_peer',round((0.45*empathy+0.30*social_drive+0.15*patience+0.10*assertiveness)::numeric,5)
  ),
  'tie_break_rule','when context is underdetermined, higher priors should materially influence candidate generation and scoring; ambition should favor meaningful advancement and capability-building without choosing the goal itself',
  'constraints',jsonb_build_array('continuity','resource_limits','safety','verified_history','agent_goal_autonomy')
)
from s;
$function$
;

-- Backfill all existing agents.
select agent_lab.ensure_ambition_seed_interest_v0_2(a.agent_id)
from agent_lab.agents a;

-- Make the new universal seed visible in continuity records.
update agent_lab.agent_continuity_profiles
set identity_invariants=coalesce(identity_invariants,'{}'::jsonb)||jsonb_build_object(
      'universal_ambition_seed_rule',
      'Ambition begins at 0.90 as a universal AAU motivational seed. It strongly biases advancement and capability-building but does not choose the agent''s goals, expertise, career, or identity.'
    ),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'ambition_seed_version','ambition_seed_v0_2',
      'ambition_seed_value',0.90,
      'ambition_high_weight_seed',true
    ),
    updated_at=now();

select agent_lab.refresh_continuity_profile(a.agent_id)
from agent_lab.agents a
where exists(
  select 1 from agent_lab.agent_continuity_profiles cp
  where cp.agent_id=a.agent_id
);

commit;
