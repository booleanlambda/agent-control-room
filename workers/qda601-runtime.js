import fs from 'node:fs';

const SB = String(process.env.AAU_SUPABASE_URL || 'https://mgtilfgygzymxiyixjit.supabase.co').replace(/\/$/, '');
const serviceRole = String(process.env.AAU_SUPABASE_SERVICE_ROLE_KEY || '').trim();

const curriculum = JSON.parse(
  fs.readFileSync(new URL('../curriculum/quantitative-decision-analysis-v0.1.json', import.meta.url), 'utf8')
);

const assignedIds = () => new Set(
  String(process.env.AAU_QDA601_REQUIRED_AGENT_IDS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
);

const units = curriculum.modules.flatMap((module, moduleIndex) =>
  module.units.map((unit, unitIndex) => ({
    module_order: moduleIndex + 1,
    module_code: module.code,
    module_title: module.title,
    unit_order: unitIndex + 1,
    unit_code: `${module.code}-U${unitIndex + 1}`,
    title: unit[0],
    type: unit[1],
    learning_goal: unit[2],
    assignment: unit[3],
    filename: `QDA601_M${String(moduleIndex + 1).padStart(2,'0')}_U${String(unitIndex + 1).padStart(2,'0')}.json`,
  }))
);

async function serviceRpc(name, args = {}) {
  if (!serviceRole) throw new Error('qda601_service_role_missing');
  const response = await fetch(`${SB}/rest/v1/rpc/${name}`, {
    method:'POST',
    headers:{
      apikey:serviceRole,
      authorization:`Bearer ${serviceRole}`,
      'content-type':'application/json',
    },
    body:JSON.stringify(args),
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!response.ok) throw new Error(`${name}:${response.status}:${typeof body==='string'?body.slice(0,800):JSON.stringify(body).slice(0,800)}`);
  return body;
}

function validCourseFile(file) {
  return file
    && file.direction === 'outbound'
    && file.purpose === 'agent_output'
    && Number(file.file_size_bytes || 0) >= 500
    && /^QDA601_M\d{2}_U\d{2}\.json$/i.test(String(file.filename || ''));
}

export function qda601RequiredForAgent(agentId) {
  return assignedIds().has(String(agentId || '').trim());
}

export async function buildQda601Context(agentId) {
  if (!qda601RequiredForAgent(agentId)) {
    return {assigned:false,program_version:'qda_601_v0_1'};
  }

  let fileResponse = {files:[]};
  try {
    fileResponse = await serviceRpc('aau_control_room_agent_files', {
      p_agent_id:String(agentId),
      p_limit:200,
    }) || {files:[]};
  } catch (error) {
    console.error('AAU_QDA601_FILE_LEDGER_UNAVAILABLE', JSON.stringify({
      agent_id:agentId,error:String(error?.message || error).slice(0,900)
    }));
  }

  const files = Array.isArray(fileResponse?.files) ? fileResponse.files : [];
  const completedByName = new Map();
  for (const file of files) {
    if (!validCourseFile(file)) continue;
    const name = String(file.filename || '').toUpperCase();
    if (!completedByName.has(name)) completedByName.set(name,file);
  }

  const completed = units.filter(unit => completedByName.has(unit.filename.toUpperCase()));
  const nextUnit = units.find(unit => !completedByName.has(unit.filename.toUpperCase())) || null;
  const finalSubmission = files.find(file =>
    file?.direction === 'outbound'
    && file?.purpose === 'agent_output'
    && String(file?.filename || '').toUpperCase() === 'QDA601_FINAL_SUBMISSION.JSON'
    && Number(file?.file_size_bytes || 0) >= 800
  ) || null;

  let status = 'in_progress';
  if (!nextUnit && !finalSubmission) status = 'coursework_complete_final_packaging_required';
  if (!nextUnit && finalSubmission) status = 'coursework_complete_pending_independent_verification';

  return {
    contract:'qda_601_runtime_course_ledger_v0_1',
    assigned:true,
    program_code:'QDA601',
    program_version:'qda_601_v0_1',
    title:curriculum.title,
    status,
    blocking_stage4:true,
    source_artifact:'curriculum/quantitative-decision-analysis-v0.1.json',
    lifecycle_artifact:'docs/AAU_AGENT_DEVELOPMENT_LIFECYCLE_v0.14.md',
    total_units:units.length,
    completed_units:completed.length,
    remaining_units:units.length-completed.length,
    completed_filenames:completed.map(v=>v.filename),
    next_unit:nextUnit,
    final_submission:{
      required:!nextUnit,
      filename:'QDA601_FINAL_SUBMISSION.json',
      exists:Boolean(finalSubmission),
      file_id:finalSubmission?.file_id || null,
    },
    hard_gates:curriculum.requirements.hard_gates,
    overall_pass_floor:curriculum.requirements.overall_pass_floor,
    assessment_weighting:curriculum.requirements.weighting,
    evidence_state_labels:curriculum.evidence_state_labels,
    required_submission_fields:curriculum.default_submission_contract.required_fields,
    governing_loop:curriculum.governing_loop,
    operating_rules:[
      'Complete the exact next_unit before later QDA units.',
      'Persist completed unit work as one agent_file_output_v0_1 JSON artifact using next_unit.filename exactly.',
      'A unit artifact must expose inputs, assumptions, formal model/formula, calculation or structured derivation, units where applicable, interpretation, sanity check, evidence, and an independent self-audit.',
      'Pass A solves the task. Pass B independently reconstructs or attacks the result; do not merely reread Pass A.',
      'Do not return to Stage 4 expertise viability while blocking_stage4 is true.',
      'Runtime/provider/persistence failures are not cognitive failures; preserve the unit and retry persistence rather than changing a correct conclusion merely to satisfy infrastructure.'
    ],
  };
}

export async function augmentPacketWithQda601(packet, agentId) {
  if (!qda601RequiredForAgent(agentId)) return packet;
  const ctx = await buildQda601Context(agentId);
  return {
    ...packet,
    qda_601_context:ctx,
    mandatory_lifecycle_context:{
      ...(packet?.mandatory_lifecycle_context || {}),
      supplemental_training_hold:{
        program_code:'QDA601',
        program_version:'qda_601_v0_1',
        status:ctx.status,
        blocking_stage4:true,
        completed_units:ctx.completed_units,
        total_units:ctx.total_units,
        next_unit:ctx.next_unit,
      },
    },
  };
}

function qdaFileAssociation(decision, expectedFilename) {
  const associations = Array.isArray(decision?.associations) ? decision.associations : [];
  return associations.find(a => {
    if (!a || typeof a !== 'object' || String(a.origin || '') !== 'agent_file_output_v0_1') return false;
    const f = a.file && typeof a.file === 'object' ? a.file : a;
    return String(f.filename || '').trim().toUpperCase() === String(expectedFilename || '').trim().toUpperCase();
  }) || null;
}

function parseAssociationJson(association) {
  const f = association?.file && typeof association.file === 'object' ? association.file : association;
  try { return JSON.parse(String(f?.content || '')); } catch { return null; }
}

function hasWebResearch(decision) {
  return (Array.isArray(decision?.associations) ? decision.associations : [])
    .some(a => a?.origin === 'web_research_request_v0_1');
}

function validateUnitPayload(ctx, payload) {
  const failures=[];
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ['qda_unit_content_must_be_json_object'];
  if (String(payload.program_version || '') !== 'qda_601_v0_1') failures.push('qda_program_version_required');
  if (String(payload.module_code || '') !== String(ctx?.next_unit?.module_code || '')) failures.push('qda_module_code_mismatch');
  if (String(payload.unit_code || '') !== String(ctx?.next_unit?.unit_code || '')) failures.push('qda_unit_code_mismatch');
  const required=['inputs','assumptions','formula_or_model','calculation','units','interpretation','sanity_check','evidence','self_audit'];
  for (const key of required) {
    const value=payload[key];
    if (value===null || value===undefined) failures.push('qda_missing_'+key);
    else if (typeof value==='string' && value.trim().length<2) failures.push('qda_empty_'+key);
  }
  if (!Array.isArray(payload.assumptions)) failures.push('qda_assumptions_array_required');
  if (!Array.isArray(payload.evidence)) failures.push('qda_evidence_array_required');
  if (!payload.self_audit || typeof payload.self_audit!=='object' || Array.isArray(payload.self_audit)) failures.push('qda_self_audit_object_required');
  else {
    if (!payload.self_audit.pass_a) failures.push('qda_self_audit_pass_a_required');
    if (!payload.self_audit.pass_b) failures.push('qda_self_audit_pass_b_required');
    if (String(payload.self_audit.verdict || '').trim().length<3) failures.push('qda_self_audit_verdict_required');
  }
  return failures;
}

export function qda601DecisionValidation(packet, decision) {
  const ctx=packet?.qda_601_context;
  if (!ctx?.assigned || ctx?.blocking_stage4!==true) return {ok:true,active:false,failures:[]};

  const associations=Array.isArray(decision?.associations)?decision.associations:[];
  const expertiseAttempt=associations.some(a=>a?.origin==='expertise_viability_proposal_v0_1')
    || /expertise[_ -]?viability|submit[_ -]?expertise/i.test(String(decision?.selected_action || ''));

  if (expertiseAttempt) return {ok:false,active:true,failures:['qda601_blocks_stage4_until_independent_verification']};

  if (ctx.status==='in_progress' && ctx.next_unit) {
    if (hasWebResearch(decision)) return {ok:true,active:true,research:true,failures:[]};
    const association=qdaFileAssociation(decision,ctx.next_unit.filename);
    if (!association) return {ok:false,active:true,failures:['qda_current_unit_artifact_required:'+ctx.next_unit.filename]};
    const f=association.file && typeof association.file==='object'?association.file:association;
    if (String(f.content || '').trim().length<500) return {ok:false,active:true,failures:['qda_unit_artifact_min_500_chars']};
    const payload=parseAssociationJson(association);
    const payloadFailures=validateUnitPayload(ctx,payload);
    return {ok:payloadFailures.length===0,active:true,failures:payloadFailures};
  }

  if (ctx.status==='coursework_complete_final_packaging_required') {
    const association=qdaFileAssociation(decision,'QDA601_FINAL_SUBMISSION.json');
    if (!association) return {ok:false,active:true,failures:['qda_final_submission_artifact_required']};
    const payload=parseAssociationJson(association);
    if (!payload || typeof payload!=='object') return {ok:false,active:true,failures:['qda_final_submission_json_required']};
    const refs=Array.isArray(payload.completed_unit_artifacts)?payload.completed_unit_artifacts:[];
    if (refs.length<ctx.total_units) return {ok:false,active:true,failures:['qda_final_submission_must_reference_all_units']};
    if (!payload.canonical_variable_ledger || !payload.integrated_self_audit || !payload.capstone_decision)
      return {ok:false,active:true,failures:['qda_final_submission_missing_integrated_requirements']};
    return {ok:true,active:true,failures:[]};
  }

  if (ctx.status==='coursework_complete_pending_independent_verification') {
    return {ok:true,active:true,pendingVerification:true,failures:[]};
  }

  return {ok:true,active:true,failures:[]};
}

export function qda601Correction(packet, validation) {
  const ctx=packet?.qda_601_context || {};
  const next=ctx.next_unit || {};
  if (ctx.status==='coursework_complete_final_packaging_required') {
    return 'QDA-601 FINAL PACKAGING GATE: Coursework artifacts are complete, but the canonical final submission is missing. Do not return to Stage 4. Persist exactly one agent_file_output_v0_1 file named QDA601_FINAL_SUBMISSION.json. It must be valid JSON and include completed_unit_artifacts referencing all 40 canonical QDA unit filenames, canonical_variable_ledger, integrated_self_audit, capstone_decision, quantitative_failure_review, hard_gate_self_check, and evidence_refs. Do not self-certify independent verification. Preserve any admin reply and the five-minute next intent.';
  }
  return `QDA-601 COURSE GATE: QDA-601 is an assigned lifecycle-blocking supplemental program and Stage 4 is held. Complete the exact current unit, not expertise viability. Current unit: ${JSON.stringify(next)}. Persist ONE agent_file_output_v0_1 artifact whose filename is exactly "${next.filename || ''}". file.content must be complete valid JSON with program_version="qda_601_v0_1", module_code="${next.module_code || ''}", unit_code="${next.unit_code || ''}", title, inputs, assumptions ARRAY, formula_or_model, calculation, units, interpretation, sanity_check, evidence ARRAY, and self_audit OBJECT containing pass_a, pass_b and verdict. Pass B must independently reconstruct or attack the result. If genuinely missing current external evidence, request web_research_request_v0_1 instead and keep the same unit active. Do not submit or revise an expertise candidate. Validation failures: ${JSON.stringify(validation?.failures || [])}`;
}

export function qda601BootstrapMessage() {
  return [
    'AAU lifecycle update: QDA-601 Quantitative Decision Analysis is now assigned to you as mandatory supplemental training before final Stage-4 expertise viability.',
    'Your earlier Stage-4 research and durable checkpoints are preserved as pre-QDA evidence; they are not erased and runtime/materialization failures are not cognitive failures.',
    'The runtime now supplies qda_601_context on each cognition and treats its next_unit as the authoritative current training unit until the course is complete.',
    'Course scope: 10 modules / 40 units covering quantitative foundations, financial mathematics, probability, statistics/data analysis, causal/evidential reasoning, applied microeconomics, scenario analysis, model reconciliation, computational analysis, and an integrated decision laboratory.',
    'Hard gates are non-compensatory: arithmetic accuracy >=95%, financial-model integrity >=90%, reconciliation consistency >=90%, material-claim provenance 100%, zero material numerical contradictions, required independent self-audit, and overall >=90%.',
    'For each unit, solve first and then independently audit it. Persist the exact QDA unit JSON artifact requested by qda_601_context. Do not skip ahead and do not return to Stage 4 while the QDA hold is active.',
    'After all 40 unit artifacts, package QDA601_FINAL_SUBMISSION.json. Independent verification remains external; do not self-certify a pass.',
    'Begin with the exact next_unit supplied by the runtime.'
  ].join(' ');
}
