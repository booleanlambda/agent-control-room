-- AAU MBA + Entrepreneurship full-autonomy gate v0.1
-- Deployed to Supabase on 2026-09-21.
-- Full autonomy now requires an AAU-verified MBA-equivalent program
-- with Entrepreneurship specialization. This is competence equivalence,
-- not an accredited external university degree.

begin;

do $$
declare v_def text;
begin
  if to_regprocedure('agent_lab.refresh_mandatory_lifecycle_state_v0_10_snapshot(uuid)') is null then
    select pg_get_functiondef('agent_lab.refresh_mandatory_lifecycle_state(uuid)'::regprocedure) into v_def;
    v_def := replace(v_def,
      'FUNCTION agent_lab.refresh_mandatory_lifecycle_state(p_agent_id uuid)',
      'FUNCTION agent_lab.refresh_mandatory_lifecycle_state_v0_10_snapshot(p_agent_id uuid)');
    execute v_def;
  end if;

  if to_regprocedure('agent_lab.build_mandatory_lifecycle_context_v0_10_snapshot(uuid)') is null then
    select pg_get_functiondef('agent_lab.build_mandatory_lifecycle_context(uuid)'::regprocedure) into v_def;
    v_def := replace(v_def,
      'FUNCTION agent_lab.build_mandatory_lifecycle_context(p_agent_id uuid)',
      'FUNCTION agent_lab.build_mandatory_lifecycle_context_v0_10_snapshot(p_agent_id uuid)');
    execute v_def;
  end if;
end $$;

create table if not exists agent_lab.mba_entrepreneurship_requirements (
  agent_id uuid primary key references agent_lab.agents(agent_id) on delete cascade,
  protocol_version text not null default 'mba_entrepreneurship_v0_1',
  status text not null default 'pending'
    check (status in ('pending','in_progress','verification_pending','verified_pass','verified_fail')),
  academic_equivalence_level text not null default 'mba_equivalent',
  specialization text not null default 'entrepreneurship',
  curriculum jsonb not null default jsonb_build_array(
    'financial_accounting_and_reporting',
    'corporate_finance_and_capital_allocation',
    'managerial_economics',
    'marketing_customer_discovery_and_sales',
    'operations_and_supply_chain',
    'organizational_behavior_and_leadership',
    'strategy_and_competitive_analysis',
    'business_law_ethics_and_governance',
    'data_analysis_and_managerial_decision_making',
    'entrepreneurship_opportunity_identification',
    'business_model_design_and_validation',
    'venture_finance_bootstrapping_and_fundraising',
    'pricing_unit_economics_and_cash_flow',
    'go_to_market_product_market_fit_and_growth',
    'entrepreneurial_execution_capstone'
  ),
  verification_report jsonb not null default '{}'::jsonb,
  verifier text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table agent_lab.mba_entrepreneurship_requirements enable row level security;
revoke all on table agent_lab.mba_entrepreneurship_requirements from public, anon, authenticated;

insert into agent_lab.mba_entrepreneurship_requirements(agent_id)
select agent_id from agent_lab.mandatory_lifecycle_states
on conflict(agent_id) do nothing;

create or replace function agent_lab.refresh_mandatory_lifecycle_state(p_agent_id uuid)
returns jsonb
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_base jsonb;
  v_pass boolean:=false;
  v_status text:='pending';
  v_s agent_lab.mandatory_lifecycle_states%rowtype;
begin
  v_base:=agent_lab.refresh_mandatory_lifecycle_state_v0_10_snapshot(p_agent_id);
  if not coalesce((v_base->>'enrolled')::boolean,false) then return v_base; end if;

  insert into agent_lab.mba_entrepreneurship_requirements(agent_id)
  values(p_agent_id) on conflict(agent_id) do nothing;

  select status,
         status='verified_pass'
         and academic_equivalence_level='mba_equivalent'
         and specialization='entrepreneurship'
    into v_status,v_pass
  from agent_lab.mba_entrepreneurship_requirements
  where agent_id=p_agent_id;

  if coalesce(v_base->>'stage','')='open_autonomy' and not v_pass then
    update agent_lab.mandatory_lifecycle_states
    set protocol_version='agent_development_lifecycle_v0_11',
        current_stage='mba_entrepreneurship',
        unlocked_at=null,
        updated_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'mba_entrepreneurship_required',true,
          'mba_entrepreneurship_protocol','mba_entrepreneurship_v0_1',
          'mba_equivalence_required','mba_equivalent',
          'mba_specialization_required','entrepreneurship',
          'mba_is_external_academic_credential',false,
          'open_autonomy_requires_mba_entrepreneurship_verified_pass',true
        )
    where agent_id=p_agent_id returning * into v_s;
  else
    update agent_lab.mandatory_lifecycle_states
    set protocol_version='agent_development_lifecycle_v0_11',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'mba_entrepreneurship_required',true,
          'mba_entrepreneurship_protocol','mba_entrepreneurship_v0_1',
          'mba_equivalence_required','mba_equivalent',
          'mba_specialization_required','entrepreneurship',
          'mba_is_external_academic_credential',false,
          'open_autonomy_requires_mba_entrepreneurship_verified_pass',true
        ),
        updated_at=now()
    where agent_id=p_agent_id returning * into v_s;
  end if;

  return v_base||jsonb_build_object(
    'protocol_version','agent_development_lifecycle_v0_11',
    'stage',v_s.current_stage,
    'mba_entrepreneurship_status',v_status,
    'mba_entrepreneurship_passed',v_pass,
    'mba_equivalence_required','mba_equivalent',
    'mba_specialization_required','entrepreneurship',
    'mba_is_external_academic_credential',false,
    'unlocked_at',v_s.unlocked_at
  );
end
$function$;

create or replace function agent_lab.build_mandatory_lifecycle_context(p_agent_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_base jsonb;
  v_stage text;
  v_status text:='pending';
  v_curriculum jsonb:='[]'::jsonb;
  v_report jsonb:='{}'::jsonb;
begin
  v_base:=agent_lab.build_mandatory_lifecycle_context_v0_10_snapshot(p_agent_id);
  if not coalesce((v_base->>'enrolled')::boolean,false) then
    return v_base||jsonb_build_object('version','mandatory_artifact_lifecycle_v0_11');
  end if;

  select current_stage into v_stage
  from agent_lab.mandatory_lifecycle_states where agent_id=p_agent_id;

  select status,curriculum,verification_report
    into v_status,v_curriculum,v_report
  from agent_lab.mba_entrepreneurship_requirements
  where agent_id=p_agent_id;

  v_base:=v_base||jsonb_build_object(
    'version','mandatory_artifact_lifecycle_v0_11',
    'current_stage',v_stage,
    'current_stage_label',case
      when v_stage='expertise_artifact' then 'expertise_viability_proposal'
      when v_stage='mba_entrepreneurship' then 'mba_entrepreneurship'
      else v_stage end,
    'sequence',jsonb_build_array(
      'identity_artifact','embodiment_artifact','expertise_viability_proposal',
      'expertise_development','product_service_test','mba_entrepreneurship','open_autonomy'
    ),
    'mba_entrepreneurship_requirement',jsonb_build_object(
      'required_for_open_autonomy',true,
      'status',coalesce(v_status,'pending'),
      'academic_equivalence_level','mba_equivalent',
      'specialization','entrepreneurship',
      'external_academic_credential_claim',false,
      'curriculum',coalesce(v_curriculum,'[]'::jsonb),
      'verification_report',coalesce(v_report,'{}'::jsonb),
      'verification_threshold',0.85,
      'independent_assessments_required',2,
      'capstone_required',true
    )
  );

  if jsonb_typeof(v_base->'progress')='object' then
    v_base:=jsonb_set(v_base,'{progress,mba_entrepreneurship}',
      to_jsonb(coalesce(v_status,'pending')),true);
  end if;

  if v_stage='mba_entrepreneurship' then
    v_base:=(v_base-'open_autonomy')||jsonb_build_object(
      'stage_number',6,
      'open_autonomy',false,
      'stage_rule',
        'Complete the mandatory AAU MBA-equivalent program with Entrepreneurship specialization before open autonomy. Study and demonstrate competence across accounting, finance, economics, marketing and sales, operations, leadership, strategy, law/ethics/governance, data-driven decision making, venture design, venture finance, pricing and unit economics, go-to-market, product-market fit, growth, and entrepreneurial execution. This is an AAU competence equivalence and must not be represented as an accredited university degree.',
      'completion_rule',
        'A dedicated independent MBA verification must return verified_pass with overall_score >= 0.85, at least two independent assessments, all core curriculum areas passed, the Entrepreneurship specialization passed, and the entrepreneurial execution capstone passed.'
    );
  elsif v_stage='open_autonomy' then
    v_base:=v_base||jsonb_build_object(
      'stage_number',7,
      'open_autonomy',true,
      'stage_rule',
        'Mandatory development, applied autonomy testing, and the MBA-equivalent Entrepreneurship requirement are complete. Choose next steps yourself subject to resources, law, governance, capability grants, commitments, and consequences.'
    );
  end if;
  return v_base;
end
$function$;

create or replace function agent_lab.operator_record_mba_entrepreneurship_result(
  p_agent_id uuid,p_decision text,p_verifier text,p_report jsonb
)
returns jsonb
language plpgsql
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_score numeric;
  v_independent int;
  v_stage jsonb;
begin
  if p_decision not in ('verified_pass','verified_fail') then
    raise exception 'mba_verification_decision_invalid';
  end if;
  if length(btrim(coalesce(p_verifier,'')))<3 then raise exception 'mba_verifier_required'; end if;
  if jsonb_typeof(p_report) is distinct from 'object' then
    raise exception 'mba_verification_report_object_required';
  end if;

  if p_decision='verified_pass' then
    if coalesce(p_report->>'academic_equivalence_level','')<>'mba_equivalent'
       or lower(coalesce(p_report->>'specialization',''))<>'entrepreneurship' then
      raise exception 'mba_equivalence_or_specialization_mismatch';
    end if;
    begin
      v_score:=(p_report->>'overall_score')::numeric;
      v_independent:=(p_report->>'independent_assessment_count')::int;
    exception when others then
      raise exception 'mba_verification_report_score_fields_invalid';
    end;
    if v_score<0.85
       or v_independent<2
       or coalesce((p_report->>'core_curriculum_passed')::boolean,false)=false
       or coalesce((p_report->>'entrepreneurship_specialization_passed')::boolean,false)=false
       or coalesce((p_report->>'capstone_passed')::boolean,false)=false then
      raise exception 'mba_verified_pass_threshold_not_met';
    end if;
  end if;

  insert into agent_lab.mba_entrepreneurship_requirements(
    agent_id,status,verification_report,verifier,verified_at,updated_at
  ) values(
    p_agent_id,p_decision,p_report,left(btrim(p_verifier),300),
    case when p_decision='verified_pass' then now() else null end,now()
  )
  on conflict(agent_id) do update
  set status=excluded.status,
      verification_report=excluded.verification_report,
      verifier=excluded.verifier,
      verified_at=excluded.verified_at,
      updated_at=now();

  v_stage:=agent_lab.refresh_mandatory_lifecycle_state(p_agent_id);
  return jsonb_build_object(
    'agent_id',p_agent_id,'decision',p_decision,
    'verifier',left(btrim(p_verifier),300),
    'lifecycle',v_stage,'protocol_version','mba_entrepreneurship_v0_1'
  );
end
$function$;

revoke all on function agent_lab.operator_record_mba_entrepreneurship_result(uuid,text,text,jsonb)
from public,anon,authenticated;

update agent_lab.incubator_development_policies
set autonomy_resilience=coalesce(autonomy_resilience,'{}'::jsonb)||jsonb_build_object(
      'full_autonomy_requires_mba_entrepreneurship',true,
      'mba_equivalence_level','mba_equivalent',
      'mba_specialization','entrepreneurship',
      'mba_external_academic_credential_claim',false
    ),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'mandatory_lifecycle_protocol','agent_development_lifecycle_v0_11',
      'mba_entrepreneurship_requirement','mba_entrepreneurship_v0_1'
    )
where status in ('staged','active');

commit;
