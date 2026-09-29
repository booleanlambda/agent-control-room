-- AAU Agent Development Lifecycle v0.14
-- Conditional verified training + QDA-601 cumulative inheritance.
-- This migration defines the durable artifact/verification contract.
-- It does not grant a university credential.

begin;

create table if not exists agent_lab.supplemental_training_requirements (
  agent_id uuid not null,
  program_code text not null,
  program_version text not null,
  status text not null default 'assigned',
  assigned_reason text not null,
  blocks_lifecycle_boundary text not null,
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  overall_score numeric,
  verification_report jsonb not null default '{}'::jsonb,
  evidence_refs jsonb not null default '[]'::jsonb,
  hard_gate_results jsonb not null default '{}'::jsonb,
  competency_dimensions jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  primary key (agent_id, program_code),
  constraint supplemental_training_status_chk
    check (status in ('assigned','in_progress','assessment_pending','verified_pass','verified_fail'))
);

create or replace function agent_lab.qda_601_contract_v0_1()
returns jsonb
language sql
immutable
set search_path to 'pg_catalog','agent_lab'
as $function$
  select jsonb_build_object(
    'program_code','QDA601',
    'program_version','qda_601_v0_1',
    'competency_source_stage','quantitative_decision_analysis',
    'overall_pass_floor',0.90,
    'hard_gates',jsonb_build_object(
      'arithmetic_accuracy',0.95,
      'financial_model_integrity',0.90,
      'reconciliation_consistency',0.90,
      'evidence_provenance',1.00,
      'material_numeric_contradictions_max',0,
      'self_audit_pass_required',true
    ),
    'required_transfer_dimensions',jsonb_build_array(
      'applied_math',
      'financial_modeling',
      'data_analysis_statistics',
      'probability_uncertainty',
      'applied_economics',
      'model_reconciliation',
      'computational_verification',
      'evidence_classification',
      'self_audit'
    ),
    'non_compensatory',true
  );
$function$;

create or replace function agent_lab.assign_qda_601_v0_1(
  p_agent_id uuid,
  p_reason text,
  p_blocks_lifecycle_boundary text default 'expertise_viability'
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_contract jsonb:=agent_lab.qda_601_contract_v0_1();
begin
  insert into agent_lab.supplemental_training_requirements(
    agent_id,program_code,program_version,status,assigned_reason,
    blocks_lifecycle_boundary,competency_dimensions,metadata
  )
  values(
    p_agent_id,'QDA601','qda_601_v0_1','assigned',p_reason,
    p_blocks_lifecycle_boundary,
    v_contract->'required_transfer_dimensions',
    jsonb_build_object(
      'curriculum','curriculum/quantitative-decision-analysis-v0.1.json',
      'lifecycle_protocol','agent_development_lifecycle_v0_14',
      'pre_training_work_policy','preserve_as_evidence_not_post_training_mastery'
    )
  )
  on conflict(agent_id,program_code) do update
    set program_version=excluded.program_version,
        status=case
          when agent_lab.supplemental_training_requirements.status='verified_pass'
            then agent_lab.supplemental_training_requirements.status
          else 'assigned'
        end,
        assigned_reason=excluded.assigned_reason,
        blocks_lifecycle_boundary=excluded.blocks_lifecycle_boundary,
        competency_dimensions=excluded.competency_dimensions,
        metadata=agent_lab.supplemental_training_requirements.metadata||excluded.metadata,
        updated_at=now();

  update agent_lab.mandatory_lifecycle_states
  set protocol_version='agent_development_lifecycle_v0_14',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'mandatory_lifecycle_protocol','agent_development_lifecycle_v0_14',
        'qda_601_required',true,
        'qda_601_program_version','qda_601_v0_1',
        'qda_601_blocks_boundary',p_blocks_lifecycle_boundary,
        'supplemental_training_inheritance_contract','verified_supplemental_training_inheritance_v0_1'
      )
  where agent_id=p_agent_id;

  return jsonb_build_object(
    'ok',true,
    'agent_id',p_agent_id,
    'program','QDA601',
    'status','assigned',
    'blocks_lifecycle_boundary',p_blocks_lifecycle_boundary,
    'contract',v_contract
  );
end
$function$;

create or replace function agent_lab.record_qda_601_verification_v0_1(
  p_agent_id uuid,
  p_overall_score numeric,
  p_arithmetic_accuracy numeric,
  p_financial_model_integrity numeric,
  p_reconciliation_consistency numeric,
  p_evidence_provenance numeric,
  p_material_numeric_contradictions int,
  p_self_audit_pass boolean,
  p_verification_report jsonb default '{}'::jsonb,
  p_evidence_refs jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_pass boolean;
  v_status text;
  v_gates jsonb;
begin
  v_pass:=
    coalesce(p_overall_score,0)>=0.90
    and coalesce(p_arithmetic_accuracy,0)>=0.95
    and coalesce(p_financial_model_integrity,0)>=0.90
    and coalesce(p_reconciliation_consistency,0)>=0.90
    and coalesce(p_evidence_provenance,0)>=1.00
    and coalesce(p_material_numeric_contradictions,999)=0
    and coalesce(p_self_audit_pass,false);

  v_status:=case when v_pass then 'verified_pass' else 'verified_fail' end;

  v_gates:=jsonb_build_object(
    'arithmetic_accuracy',p_arithmetic_accuracy,
    'financial_model_integrity',p_financial_model_integrity,
    'reconciliation_consistency',p_reconciliation_consistency,
    'evidence_provenance',p_evidence_provenance,
    'material_numeric_contradictions',p_material_numeric_contradictions,
    'self_audit_pass',p_self_audit_pass,
    'non_compensatory_pass',v_pass
  );

  update agent_lab.supplemental_training_requirements
  set status=v_status,
      overall_score=p_overall_score,
      verification_report=coalesce(p_verification_report,'{}'::jsonb),
      evidence_refs=case when jsonb_typeof(p_evidence_refs)='array' then p_evidence_refs else '[]'::jsonb end,
      hard_gate_results=v_gates,
      completed_at=case when v_pass then now() else null end,
      updated_at=now()
  where agent_id=p_agent_id and program_code='QDA601';

  if not found then
    raise exception 'qda_601_not_assigned:%',p_agent_id;
  end if;

  update agent_lab.mandatory_lifecycle_states
  set protocol_version='agent_development_lifecycle_v0_14',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'qda_601_status',v_status,
        'qda_601_verified_pass',v_pass,
        'qda_601_overall_score',p_overall_score,
        'qda_601_hard_gate_results',v_gates
      )
  where agent_id=p_agent_id;

  return jsonb_build_object(
    'ok',v_pass,
    'status',v_status,
    'overall_score',p_overall_score,
    'hard_gate_results',v_gates,
    'contract',agent_lab.qda_601_contract_v0_1()
  );
end
$function$;

create or replace function agent_lab.build_verified_supplemental_training_context_v0_1(p_agent_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog','agent_lab'
as $function$
declare
  v_qda agent_lab.supplemental_training_requirements%rowtype;
begin
  select * into v_qda
  from agent_lab.supplemental_training_requirements
  where agent_id=p_agent_id and program_code='QDA601';

  if not found then
    return jsonb_build_object(
      'contract','verified_supplemental_training_inheritance_v0_1',
      'assigned',false,
      'required_source_stages','[]'::jsonb
    );
  end if;

  return jsonb_build_object(
    'contract','verified_supplemental_training_inheritance_v0_1',
    'assigned',true,
    'program_code',v_qda.program_code,
    'program_version',v_qda.program_version,
    'status',v_qda.status,
    'blocks_lifecycle_boundary',v_qda.blocks_lifecycle_boundary,
    'overall_score',v_qda.overall_score,
    'hard_gate_results',v_qda.hard_gate_results,
    'competency_dimensions',v_qda.competency_dimensions,
    'evidence_refs',v_qda.evidence_refs,
    'required_source_stages',
      case when v_qda.status='verified_pass'
        then jsonb_build_array('quantitative_decision_analysis')
        else '[]'::jsonb
      end,
    'stage4_blocked',
      (v_qda.blocks_lifecycle_boundary='expertise_viability' and v_qda.status<>'verified_pass')
  );
end
$function$;

comment on table agent_lab.supplemental_training_requirements is
  'AAU v0.14 durable conditional training assignments. Verified programs join cumulative competency inheritance; assigned but unpassed programs block their declared lifecycle boundary.';

commit;
