import fs from 'node:fs';

const curriculum = JSON.parse(
  fs.readFileSync(new URL('../curriculum/quantitative-decision-analysis-v0.1.json', import.meta.url), 'utf8')
);

const exerciseBank = JSON.parse(
  fs.readFileSync(new URL('../curriculum/qda601-exercise-packs-v0.1.json', import.meta.url), 'utf8')
);

const assignedIds = () => new Set(
  String(process.env.AAU_QDA601_REQUIRED_AGENT_IDS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
);

const units = curriculum.modules.flatMap((module, moduleIndex) =>
  module.units.map((unit, unitIndex) => {
    const unitCode=`${module.code}-U${unitIndex + 1}`;
    const exercisePack=exerciseBank?.packs?.[unitCode] || null;
    if(!exercisePack) throw new Error('qda601_exercise_pack_missing:'+unitCode);
    return {
      module_order: moduleIndex + 1,
      module_code: module.code,
      module_title: module.title,
      unit_order: unitIndex + 1,
      unit_code: unitCode,
      title: unit[0],
      type: unit[1],
      learning_goal: unit[2],
      assignment: unit[3],
      exercise_pack_ref:`curriculum/qda601-exercise-packs-v0.1.json#${unitCode}`,
      exercise_pack: exercisePack,
      problem_count:Array.isArray(exercisePack.problems)?exercisePack.problems.length:0,
      filename: `QDA601_M${String(moduleIndex + 1).padStart(2,'0')}_U${String(unitIndex + 1).padStart(2,'0')}.json`,
    };
  })
);

export function qda601RequiredForAgent(agentId, packet = {}) {
  const id = String(agentId || '').trim();
  const lifecycle = packet?.mandatory_lifecycle_context || {};
  const lifecycleMeta = lifecycle?.metadata || {};
  const supplemental = lifecycle?.supplemental_training_hold || {};
  const state = packet?.state || {};
  const statePayload = state?.state_payload || {};
  const durableQdaSignal =
    String(state?.current_focus || '').trim() === 'qda_601'
    || String(statePayload?.current_lifecycle_focus || '').trim() === 'supplemental_training_qda_601'
    || statePayload?.qda_601_required === true
    || String(statePayload?.qda_601_required || '').toLowerCase() === 'true'
    || String(lifecycle?.protocol_version || lifecycleMeta?.mandatory_lifecycle_protocol || '').trim() === 'agent_development_lifecycle_v0_14'
       && (
         lifecycleMeta?.qda_601_required === true
         || String(lifecycleMeta?.qda_601_required || '').toLowerCase() === 'true'
         || String(supplemental?.program_code || '').trim().toUpperCase() === 'QDA601'
       )
    || String(supplemental?.program_code || '').trim().toUpperCase() === 'QDA601';

  return durableQdaSignal || assignedIds().has(id);
}

function lastActionFromPacket(packet) {
  return String(
    packet?.state?.state_payload?.last_action
    ?? packet?.state?.last_action
    ?? packet?.continuity?.last_action
    ?? ''
  ).trim();
}

function cursorFromLastAction(packet) {
  const action = lastActionFromPacket(packet).toLowerCase();
  if (!action.startsWith('qda601_')) return {completedIndex:-1,researchIndex:null,final:false};

  if (action.startsWith('qda601_final_submission')) {
    return {completedIndex:units.length-1,researchIndex:null,final:true};
  }

  const completeMatch = action.match(/^qda601_complete_(qda601-m\d+-u\d+)/i);
  if (completeMatch) {
    const idx = units.findIndex(u => u.unit_code.toLowerCase() === completeMatch[1].toLowerCase());
    return {completedIndex:idx,researchIndex:null,final:false};
  }

  const researchMatch = action.match(/^qda601_research_(qda601-m\d+-u\d+)/i);
  if (researchMatch) {
    const idx = units.findIndex(u => u.unit_code.toLowerCase() === researchMatch[1].toLowerCase());
    return {completedIndex:Math.max(-1,idx-1),researchIndex:idx,final:false};
  }

  return {completedIndex:-1,researchIndex:null,final:false};
}

function preservedValidUnitCodesFromPacket(packet) {
  const raw = packet?.state?.state_payload?.qda_601_preserved_valid_units;
  if (!Array.isArray(raw)) return new Set();
  const known = new Set(units.map(u => u.unit_code.toUpperCase()));
  return new Set(
    raw
      .map(v => String(v || '').trim().toUpperCase())
      .filter(v => known.has(v))
  );
}

export function buildQda601Context(agentId, packet = {}) {
  if (!qda601RequiredForAgent(agentId, packet)) {
    return {assigned:false,program_version:'qda_601_v0_1'};
  }

  const cursor = cursorFromLastAction(packet);
  const preservedValidUnitCodes = preservedValidUnitCodesFromPacket(packet);
  const completedUnitCodes = new Set();

  for (let i = 0; i <= cursor.completedIndex && i < units.length; i += 1) {
    completedUnitCodes.add(units[i].unit_code.toUpperCase());
  }
  for (const code of preservedValidUnitCodes) completedUnitCodes.add(code);

  const completedCount = completedUnitCodes.size;
  const firstMissingIndex = units.findIndex(
    unit => !completedUnitCodes.has(unit.unit_code.toUpperCase())
  );
  const nextIndex = cursor.researchIndex !== null
    ? cursor.researchIndex
    : (firstMissingIndex >= 0 ? firstMissingIndex : units.length);
  const nextUnit = nextIndex < units.length ? units[nextIndex] : null;

  let status = 'in_progress';
  if (!nextUnit && !cursor.final) status = 'coursework_complete_final_packaging_required';
  if (cursor.final) status = 'coursework_complete_pending_independent_verification';

  return {
    contract:'qda_601_runtime_course_cursor_v0_2',
    assigned:true,
    program_code:'QDA601',
    program_version:'qda_601_v0_1',
    title:curriculum.title,
    status,
    blocking_stage4:true,
    source_artifact:'curriculum/quantitative-decision-analysis-v0.1.json',
    exercise_bank_artifact:'curriculum/qda601-exercise-packs-v0.1.json',
    lifecycle_artifact:'docs/AAU_AGENT_DEVELOPMENT_LIFECYCLE_v0.14.md',
    total_units:units.length,
    completed_units:completedCount,
    remaining_units:Math.max(0,units.length-completedCount),
    next_unit:nextUnit,
    final_submission:{
      required:!nextUnit,
      filename:'QDA601_FINAL_SUBMISSION.json',
      exists:cursor.final,
    },
    hard_gates:curriculum.requirements.hard_gates,
    overall_pass_floor:curriculum.requirements.overall_pass_floor,
    assessment_weighting:curriculum.requirements.weighting,
    evidence_state_labels:curriculum.evidence_state_labels,
    required_submission_fields:curriculum.default_submission_contract.required_fields,
    governing_loop:curriculum.governing_loop,
    progression_cursor:{
      source:'authoritative_last_committed_action_plus_preserved_external_audit_units',
      last_action:lastActionFromPacket(packet) || null,
      completed_index:cursor.completedIndex,
      research_index:cursor.researchIndex,
      preserved_valid_units:[...preservedValidUnitCodes],
      effective_completed_units:[...completedUnitCodes],
    },
    operating_rules:[
      'Complete the exact next_unit before later QDA units.',
      'Solve the runtime-owned next_unit.exercise_pack exactly. Do not invent replacement questions or datasets.',
      'When next_unit.exercise_pack.external_research is false, the pack is self-contained course data: do not request web research and do not classify the absence of outside sources as missing context.',
      'Persist completed unit work as one agent_file_output_v0_1 JSON artifact using next_unit.filename exactly.',
      'A unit artifact must expose inputs, assumptions, formal model/formula, calculation or structured derivation, units where applicable, interpretation, sanity check, evidence, and an independent self-audit.',
      'Pass A solves the task. Pass B independently reconstructs or attacks the result; do not merely reread Pass A.',
      'Do not return to Stage 4 expertise viability while blocking_stage4 is true.',
      'Runtime/provider/persistence failures are not cognitive failures; preserve the unit and retry persistence rather than changing a correct conclusion merely to satisfy infrastructure.'
    ],
  };
}

export function augmentPacketWithQda601(packet, agentId) {
  if (!qda601RequiredForAgent(agentId, packet)) return packet;
  const ctx = buildQda601Context(agentId, packet);
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
  if (f?.content && typeof f.content === 'object' && !Array.isArray(f.content)) return f.content;
  try { return JSON.parse(String(f?.content || '')); } catch { return null; }
}

export function normalizeQda601FileAssociations(decision) {
  if (!decision || typeof decision !== 'object' || !Array.isArray(decision.associations)) return decision;
  decision.associations = decision.associations.map((association) => {
    if (!association || typeof association !== 'object' || association.origin !== 'agent_file_output_v0_1') return association;
    const wrapped = association.file && typeof association.file === 'object' ? association.file : association;
    if (!wrapped.content || typeof wrapped.content !== 'object' || Array.isArray(wrapped.content)) return association;
    const serialized = JSON.stringify(wrapped.content);
    if (association.file && typeof association.file === 'object') {
      return {...association,file:{...association.file,content:serialized}};
    }
    return {...association,content:serialized};
  });
  return decision;
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
  if (String(payload.exercise_pack_ref || '') !== String(ctx?.next_unit?.exercise_pack_ref || '')) failures.push('qda_exercise_pack_ref_mismatch');
  const expectedProblems=Array.isArray(ctx?.next_unit?.exercise_pack?.problems)?ctx.next_unit.exercise_pack.problems:[];
  if (!Array.isArray(payload.problem_responses)) failures.push('qda_problem_responses_array_required');
  else if (payload.problem_responses.length < expectedProblems.length) failures.push('qda_all_assigned_problems_required');
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
    if (hasWebResearch(decision)) {
      if (ctx.next_unit?.exercise_pack?.external_research===false) {
        return {ok:false,active:true,failures:['qda_external_research_forbidden_for_self_contained_exercise_pack']};
      }
      return {ok:true,active:true,research:true,unit_code:ctx.next_unit.unit_code,failures:[]};
    }
    const association=qdaFileAssociation(decision,ctx.next_unit.filename);
    if (!association) return {ok:false,active:true,failures:['qda_current_unit_artifact_required:'+ctx.next_unit.filename]};
    const f=association.file && typeof association.file==='object'?association.file:association;
    const payload=parseAssociationJson(association);
    const contentSize = typeof f.content === 'string'
      ? f.content.trim().length
      : (f.content && typeof f.content === 'object' ? JSON.stringify(f.content).length : 0);
    if (contentSize<500) return {ok:false,active:true,failures:['qda_unit_artifact_min_500_chars']};
    const payloadFailures=validateUnitPayload(ctx,payload);
    return {
      ok:payloadFailures.length===0,
      active:true,
      completed:payloadFailures.length===0,
      unit_code:ctx.next_unit.unit_code,
      failures:payloadFailures
    };
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
    return {ok:true,active:true,finalSubmitted:true,failures:[]};
  }

  if (ctx.status==='coursework_complete_pending_independent_verification') {
    return {ok:true,active:true,pendingVerification:true,failures:[]};
  }

  return {ok:true,active:true,failures:[]};
}

export function stampQda601Progress(decision, validation) {
  if (!validation?.active || !decision || typeof decision !== 'object') return decision;
  if (validation.completed && validation.unit_code) {
    decision.selected_action=`qda601_complete_${validation.unit_code}`;
    decision.current_focus=`QDA-601 ${validation.unit_code} completed and persisted; next cognition advances to the next canonical unit.`;
  } else if (validation.research && validation.unit_code) {
    decision.selected_action=`qda601_research_${validation.unit_code}`;
    decision.current_focus=`QDA-601 ${validation.unit_code} evidence acquisition; the unit remains active until its canonical artifact is persisted.`;
  } else if (validation.finalSubmitted) {
    decision.selected_action='qda601_final_submission';
    decision.current_focus='QDA-601 coursework packaged; awaiting independent verification.';
  }
  return decision;
}

export function qda601Correction(packet, validation) {
  const ctx=packet?.qda_601_context || {};
  const next=ctx.next_unit || {};
  if (ctx.status==='coursework_complete_final_packaging_required') {
    return 'QDA-601 FINAL PACKAGING GATE: Coursework artifacts are complete, but the canonical final submission is missing. Do not return to Stage 4. Persist exactly one agent_file_output_v0_1 file named QDA601_FINAL_SUBMISSION.json. It must be valid JSON and include completed_unit_artifacts referencing all 40 canonical QDA unit filenames, canonical_variable_ledger, integrated_self_audit, capstone_decision, quantitative_failure_review, hard_gate_self_check, and evidence_refs. Do not self-certify independent verification. Preserve the normal next-intent contract.';
  }
  return `QDA-601 COURSE GATE: QDA-601 is an assigned lifecycle-blocking supplemental program and Stage 4 is held. Complete the exact current unit, not expertise viability. Current unit: ${JSON.stringify(next)}.

PERSISTENCE SHAPE IS MANDATORY. associations[] must contain this exact outer structure:
{"origin":"agent_file_output_v0_1","file":{"filename":"${next.filename || ''}","mime_type":"application/json","caption":"QDA-601 ${next.unit_code || ''} completed unit","content":{"program_version":"qda_601_v0_1","module_code":"${next.module_code || ''}","unit_code":"${next.unit_code || ''}","exercise_pack_ref":"${next.exercise_pack_ref || ''}","title":"...","problem_responses":[...],"inputs":...,"assumptions":[],"formula_or_model":...,"calculation":...,"units":...,"interpretation":...,"sanity_check":...,"evidence":[],"self_audit":{"pass_a":...,"pass_b":...,"verdict":"..."}}}}

Author file.content as a normal JSON object. The runtime owns deterministic serialization into the database file channel; do not spend cognition escaping a JSON document into a string.

The content must be at least 500 characters and substantive. Answer every assigned problem in next_unit.exercise_pack and preserve the exact exercise_pack_ref. Do not substitute invented questions. If next_unit.exercise_pack.external_research is false, do not request web research: all required training-case inputs are already authoritative in the exercise pack. For quantitative units, work multiple nontrivial examples/cases rather than a single toy calculation. Pass B must independently reconstruct, reverse-check, dimension-check, or otherwise attack Pass A; paraphrasing Pass A is not an audit. If genuinely missing current external evidence, request web_research_request_v0_1 instead and keep the same unit active. Do not submit or revise an expertise candidate. Do not omit the file association after explaining the work in prose. Validation failures: ${JSON.stringify(validation?.failures || [])}`;
}

export function qda601BootstrapMessage() {
  return [
    'AAU lifecycle update: QDA-601 Quantitative Decision Analysis is assigned as mandatory supplemental training before final Stage-4 expertise viability.',
    'Earlier Stage-4 research and durable checkpoints remain preserved as pre-QDA evidence; they are not erased, and runtime/materialization failures are not cognitive failures.',
    'The runtime supplies qda_601_context on every cognition and the exact next_unit is authoritative until coursework and independent verification are complete.',
    'Course scope: 10 modules / 40 units covering quantitative foundations, financial mathematics, probability, statistics/data analysis, causal/evidential reasoning, applied microeconomics, scenario analysis, model reconciliation, computational analysis, and an integrated decision laboratory.',
    'Hard gates are non-compensatory: arithmetic accuracy >=95%, financial-model integrity >=90%, reconciliation consistency >=90%, material-claim provenance 100%, zero material numerical contradictions, required independent self-audit, and overall >=90%.',
    'For each unit, solve first and independently audit second. Persist the exact QDA unit JSON artifact requested by qda_601_context. Do not skip ahead and do not return to Stage 4 while the QDA hold is active.',
    'After all 40 unit artifacts, package QDA601_FINAL_SUBMISSION.json. Independent verification remains external; do not self-certify a pass.'
  ].join(' ');
}
