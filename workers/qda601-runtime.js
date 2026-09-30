import fs from 'node:fs';
import { verifyPythonMathChecks } from './python-math.js';
import { runPythonStatisticalAnalyses } from './python-quant.js';

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
      'For ordinary quantitative units, every problem_response must include python_checks covering every distinct material calculation result, not only a final aggregate. For designated statistics/simulation units, include python_analyses with explicit method specs and your own claims. Python verifies computation only; you remain responsible for choosing the method, assumptions, causal limits, interpretation, and reconciling disagreement.',
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

function hasOwn(obj,key){
  return Boolean(obj && typeof obj==='object' && !Array.isArray(obj)
    && Object.prototype.hasOwnProperty.call(obj,key));
}

function responseLabel(response,index){
  return String(
    response?.problem_id
    ?? response?.id
    ?? response?.problem
    ?? response?.label
    ?? `problem_${index+1}`
  ).trim() || `problem_${index+1}`;
}

function liftProblemField(responses,key){
  if(!Array.isArray(responses) || !responses.length) return undefined;
  if(!responses.every(response=>hasOwn(response,key))) return undefined;
  return {
    source:'problem_responses',
    by_problem:responses.map((response,index)=>({
      problem:responseLabel(response,index),
      value:response[key],
    })),
  };
}

function flattenProblemArrays(responses,key){
  if(!Array.isArray(responses) || !responses.length) return undefined;
  if(!responses.every(response=>Array.isArray(response?.[key]))) return undefined;
  return responses.flatMap((response,index)=>
    response[key].map(item=>(
      item && typeof item==='object' && !Array.isArray(item)
        ? {problem:responseLabel(response,index),...item}
        : {problem:responseLabel(response,index),value:item}
    ))
  );
}

function aggregateProblemSelfAudit(responses){
  if(!Array.isArray(responses) || !responses.length) return undefined;
  const audits=responses.map(response=>response?.self_audit);
  if(!audits.every(audit=>audit && typeof audit==='object' && !Array.isArray(audit)
      && audit.pass_a && audit.pass_b && String(audit.verdict || '').trim().length>=3)) {
    return undefined;
  }
  return {
    source:'problem_responses',
    pass_a:audits.map((audit,index)=>({
      problem:responseLabel(responses[index],index),
      value:audit.pass_a,
    })),
    pass_b:audits.map((audit,index)=>({
      problem:responseLabel(responses[index],index),
      value:audit.pass_b,
    })),
    verdict:audits.map((audit,index)=>
      `${responseLabel(responses[index],index)}: ${String(audit.verdict).trim()}`
    ).join(' | '),
  };
}

export function canonicalizeQda601UnitPayload(rawPayload){
  if(!rawPayload || typeof rawPayload!=='object' || Array.isArray(rawPayload)) return rawPayload;

  let payload={...rawPayload};

  // Some deep-cognition paths return {artifact:{...}, python_checks:[...]}.
  // Unwrap only when the outer object is clearly an envelope rather than a QDA unit.
  if(!payload.program_version
     && payload.artifact
     && typeof payload.artifact==='object'
     && !Array.isArray(payload.artifact)) {
    const artifact={...payload.artifact};
    if(!Array.isArray(artifact.python_checks) && Array.isArray(payload.python_checks)) {
      artifact.python_checks=payload.python_checks;
    }
    if(!Array.isArray(artifact.python_analyses) && Array.isArray(payload.python_analyses)) {
      artifact.python_analyses=payload.python_analyses;
    }
    payload=artifact;
  }

  const responses=Array.isArray(payload.problem_responses)?payload.problem_responses:[];

  for(const key of ['inputs','formula_or_model','calculation','units','interpretation','sanity_check']) {
    if(payload[key]===null || payload[key]===undefined) {
      const lifted=liftProblemField(responses,key);
      if(lifted!==undefined) payload[key]=lifted;
    }
  }

  if(!Array.isArray(payload.assumptions)) {
    const lifted=flattenProblemArrays(responses,'assumptions');
    if(lifted!==undefined) payload.assumptions=lifted;
  }

  if(!Array.isArray(payload.evidence)) {
    const lifted=flattenProblemArrays(responses,'evidence');
    if(lifted!==undefined) payload.evidence=lifted;
  }

  if(!payload.self_audit || typeof payload.self_audit!=='object' || Array.isArray(payload.self_audit)) {
    const lifted=aggregateProblemSelfAudit(responses);
    if(lifted!==undefined) payload.self_audit=lifted;
  }

  if(!Array.isArray(payload.python_checks)) {
    const lifted=flattenProblemArrays(responses,'python_checks');
    if(lifted!==undefined) payload.python_checks=lifted;
  }

  if(!Array.isArray(payload.python_analyses)) {
    const lifted=flattenProblemArrays(responses,'python_analyses');
    if(lifted!==undefined) payload.python_analyses=lifted;
  }

  return payload;
}

function writeAssociationPayload(association,payload){
  if(!association || typeof association!=='object') return;
  if(association.file && typeof association.file==='object') {
    association.file={...association.file,content:payload};
    return;
  }
  association.content=payload;
}

function parseAuthoritativeChildArtifact(child){
  let outer=child?.result_artifact;
  if(typeof outer==='string'){
    try{outer=JSON.parse(outer);}catch{return null;}
  }
  if(!outer || typeof outer!=='object' || Array.isArray(outer)) return null;
  let artifact=outer.artifact;
  if(typeof artifact==='string'){
    try{artifact=JSON.parse(artifact);}catch{return null;}
  }
  if(!artifact || typeof artifact!=='object' || Array.isArray(artifact)) return null;
  return artifact;
}

function arrayifyArtifactField(value){
  if(Array.isArray(value)) return value;
  if(value===null || value===undefined) return [];
  if(typeof value==='object') return [value];
  return [value];
}

export function materializeQda601UnitFromVerifiedChildren(packet,deepCognition){
  const ctx=packet?.qda_601_context;
  if(!ctx?.assigned || ctx?.status!=='in_progress' || !ctx?.next_unit) {
    return {applies:false,payload:null,failures:[]};
  }
  const children=Array.isArray(deepCognition?.authoritativeChildren)
    ?deepCognition.authoritativeChildren
    :Array.isArray(deepCognition?.authoritative_children)
      ?deepCognition.authoritative_children
      :[];
  const expectedProblems=Array.isArray(ctx.next_unit?.exercise_pack?.problems)
    ?ctx.next_unit.exercise_pack.problems : [];
  if(!children.length || !expectedProblems.length) {
    return {applies:false,payload:null,failures:[]};
  }

  const ordered=[...children]
    .filter(child=>String(child?.status||'').toLowerCase()==='completed')
    .sort((a,b)=>String(a?.node_path||'').localeCompare(String(b?.node_path||'')));

  const failures=[];
  if(ordered.length!==expectedProblems.length){
    failures.push(
      'qda_verified_child_count_mismatch:expected='+expectedProblems.length
      +';received='+ordered.length
    );
  }

  const problemResponses=[];
  const aggregateChecks=[];
  const aggregateAnalyses=[];
  const provenanceChildren=[];

  for(let index=0;index<Math.min(ordered.length,expectedProblems.length);index+=1){
    const child=ordered[index];
    const artifact=parseAuthoritativeChildArtifact(child);
    if(!artifact){
      failures.push('qda_verified_child_artifact_invalid:'+String(child?.node_path||index+1));
      continue;
    }

    const response={
      problem_id:index+1,
      problem:expectedProblems[index],
      inputs:artifact.inputs,
      assumptions:artifact.assumptions,
      formula_or_model:artifact.formula_or_model,
      calculation:artifact.calculation,
      units:artifact.units,
      interpretation:artifact.interpretation,
      sanity_check:artifact.sanity_check,
      evidence:artifact.evidence,
      self_audit:artifact.self_audit,
    };

    const childChecks=Array.isArray(artifact.python_checks)?artifact.python_checks:[];
    const childAnalyses=Array.isArray(artifact.python_analyses)?artifact.python_analyses:[];
    if(childChecks.length) response.python_checks=childChecks;
    if(childAnalyses.length) response.python_analyses=childAnalyses;

    const quantitative=String(ctx?.next_unit?.type||'').toLowerCase()==='quantitative'
      && !statisticalUnit(ctx);
    if(quantitative){
      const requiredChecks=materialCalculationCount(response);
      if(childChecks.length<requiredChecks){
        failures.push(
          'qda_verified_child_python_coverage_insufficient:'+String(child?.node_path||index+1)
          +':required='+requiredChecks+';received='+childChecks.length
        );
      }else{
        const verification=verifyPythonMathChecks(
          childChecks,{absoluteTolerance:0.005,relativeTolerance:1e-9}
        );
        if(!verification.ok){
          failures.push(
            (verification.failure_class==='input_contract'
              ?'qda_verified_child_python_contract_invalid:'
              :'qda_verified_child_python_runtime_invalid:')
            +String(child?.node_path||index+1)
          );
        }else if(!verification.all_match){
          const invalid=Array.isArray(verification.results)
            &&verification.results.some(row=>row?.valid===false);
          failures.push(
            (invalid
              ?'qda_verified_child_python_expression_or_type_invalid:'
              :'qda_verified_child_python_disagreement:')
            +String(child?.node_path||index+1)
          );
        }
      }
    }

    if(statisticalUnit(ctx) && !childAnalyses.length){
      failures.push('qda_verified_child_statistical_analysis_missing:'+String(child?.node_path||index+1));
    }

    childChecks.forEach(check=>aggregateChecks.push({
      ...check,
      label:String(child?.node_path||'child')+':'+String(check?.label||'check'),
    }));
    childAnalyses.forEach(analysis=>aggregateAnalyses.push({
      ...analysis,
      id:String(child?.node_path||'child')+':'+String(analysis?.id||'analysis'),
    }));

    problemResponses.push(response);
    provenanceChildren.push({
      node_path:child?.node_path||null,
      result_hash:child?.result_hash||null,
      deterministic_math_verified:child?.deterministic_math_verified===true,
      deterministic_math_check_count:Number(child?.deterministic_math_check_count||childChecks.length||0),
    });
  }

  if(failures.length) return {applies:true,payload:null,failures};

  const fieldByProblem=(field)=>({
    source:'verified_child_artifacts',
    by_problem:problemResponses.map((response,index)=>({
      problem:responseLabel(response,index),
      value:response[field],
    })),
  });
  const assumptions=problemResponses.flatMap((response,index)=>
    arrayifyArtifactField(response.assumptions).map(value=>({
      problem:responseLabel(response,index),value,
    }))
  );
  const evidence=problemResponses.flatMap((response,index)=>
    arrayifyArtifactField(response.evidence).map(value=>({
      problem:responseLabel(response,index),value,
    }))
  );

  const payload={
    program_version:'qda_601_v0_1',
    module_code:ctx.next_unit.module_code,
    unit_code:ctx.next_unit.unit_code,
    exercise_pack_ref:ctx.next_unit.exercise_pack_ref,
    title:ctx.next_unit.title,
    problem_responses:problemResponses,
    inputs:fieldByProblem('inputs'),
    assumptions,
    formula_or_model:fieldByProblem('formula_or_model'),
    calculation:fieldByProblem('calculation'),
    units:fieldByProblem('units'),
    interpretation:fieldByProblem('interpretation'),
    sanity_check:fieldByProblem('sanity_check'),
    evidence,
    python_checks:aggregateChecks,
    python_analyses:aggregateAnalyses,
    self_audit:{
      pass_a:problemResponses.map((response,index)=>({
        problem:responseLabel(response,index),
        value:response?.self_audit?.pass_a
          ??response?.self_audit?.pass_a_result
          ??response?.calculation?.pass_a
          ??'Preserved from verified child artifact.',
      })),
      pass_b:problemResponses.map((response,index)=>({
        problem:responseLabel(response,index),
        value:response?.self_audit?.pass_b
          ??response?.self_audit?.pass_b_result
          ??response?.calculation?.pass_b
          ??'Preserved from verified child artifact.',
      })),
      verdict:'PASS: all resolved child artifacts were preserved and deterministic verification requirements were satisfied before runtime materialization.',
    },
    runtime_materialization:{
      contract:'qda_verified_child_artifact_materialization_v0_1',
      arithmetic_recomputation_forbidden:true,
      source:'autonomous_recursive_decomposition_verified_children',
      children:provenanceChildren,
    },
  };

  const validationFailures=validateUnitPayload(ctx,payload);
  if(validationFailures.length){
    return {applies:true,payload:null,failures:validationFailures};
  }
  return {applies:true,payload,failures:[]};
}

export function applyAuthoritativeQda601DeepArtifact(packet,decision,deepCognition){
  const materialized=materializeQda601UnitFromVerifiedChildren(packet,deepCognition);
  if(!materialized.applies) return {decision,materialized:false,failures:[]};
  if(!materialized.payload) return {
    decision,
    materialized:false,
    failures:materialized.failures,
  };

  const ctx=packet.qda_601_context;
  const associations=Array.isArray(decision?.associations)?[...decision.associations]:[];
  const expected=String(ctx.next_unit.filename||'').trim().toUpperCase();
  let replaced=false;
  const nextAssociations=associations.map(association=>{
    if(!association || typeof association!=='object'
       ||String(association.origin||'')!=='agent_file_output_v0_1') return association;
    const wrapped=association.file&&typeof association.file==='object'
      ?association.file:association;
    if(String(wrapped.filename||'').trim().toUpperCase()!==expected) return association;
    replaced=true;
    return {
      origin:'agent_file_output_v0_1',
      file:{
        filename:ctx.next_unit.filename,
        mime_type:'application/json',
        caption:'QDA-601 '+ctx.next_unit.unit_code+' verified unit',
        content:materialized.payload,
      },
    };
  });
  if(!replaced){
    nextAssociations.push({
      origin:'agent_file_output_v0_1',
      file:{
        filename:ctx.next_unit.filename,
        mime_type:'application/json',
        caption:'QDA-601 '+ctx.next_unit.unit_code+' verified unit',
        content:materialized.payload,
      },
    });
  }
  return {
    decision:{...decision,associations:nextAssociations},
    materialized:true,
    failures:[],
    payload:materialized.payload,
  };
}

export function normalizeQda601FileAssociations(decision) {
  if (!decision || typeof decision !== 'object' || !Array.isArray(decision.associations)) return decision;
  decision.associations = decision.associations.map((association) => {
    if (!association || typeof association !== 'object' || association.origin !== 'agent_file_output_v0_1') return association;
    const wrapped = association.file && typeof association.file === 'object' ? association.file : association;
    if (!wrapped.content || typeof wrapped.content !== 'object' || Array.isArray(wrapped.content)) return association;
    const normalizedContent=canonicalizeQda601UnitPayload(wrapped.content);
    const serialized = JSON.stringify(normalizedContent);
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

const QDA_STATISTICAL_UNIT_CODES=new Set([
  'QDA601-M4-U1',
  'QDA601-M4-U2',
  'QDA601-M4-U3',
  'QDA601-M9-U3',
]);

function statisticalUnit(ctx){
  return QDA_STATISTICAL_UNIT_CODES.has(String(ctx?.next_unit?.unit_code || '').toUpperCase());
}

const NON_MATERIAL_CALCULATION_KEYS=/^(method|expression|formula|formula_or_model|unit|units|label|description|note|notes|explanation)$/i;
function materialCalculationLeafCount(value,key=''){
  if(value===null||value===undefined)return 0;
  if(NON_MATERIAL_CALCULATION_KEYS.test(String(key)))return 0;
  if(typeof value==='number')return Number.isFinite(value)?1:0;
  if(typeof value==='string')return value.trim()?1:0;
  if(typeof value==='boolean')return 0;
  if(Array.isArray(value)){
    return value.reduce((sum,item,index)=>sum+materialCalculationLeafCount(item,String(index)),0);
  }
  if(typeof value==='object'){
    return Object.entries(value).reduce(
      (sum,[childKey,child])=>sum+materialCalculationLeafCount(child,childKey),0
    );
  }
  return 0;
}
function materialCalculationCount(response){
  return Math.max(1,materialCalculationLeafCount(response?.calculation,'calculation'));
}
function plainObject(value){
  return Boolean(value && typeof value==='object' && !Array.isArray(value));
}
function validateProblemResponseTypes(response,index,quantitative,statistical){
  const failures=[];
  const prefix='qda_problem_'+String(index+1)+'_';
  if(!plainObject(response))return [prefix+'object_required'];
  if(!plainObject(response.inputs))failures.push(prefix+'inputs_object_required');
  if(!Array.isArray(response.assumptions))failures.push(prefix+'assumptions_array_required');
  if(response.formula_or_model===null||response.formula_or_model===undefined
     ||!['string','object'].includes(typeof response.formula_or_model)
     ||Array.isArray(response.formula_or_model))failures.push(prefix+'formula_or_model_string_or_object_required');
  if(response.calculation===null||response.calculation===undefined
     ||!['string','object'].includes(typeof response.calculation)
     ||Array.isArray(response.calculation))failures.push(prefix+'calculation_string_or_object_required');
  if(response.units===null||response.units===undefined
     ||!['string','object'].includes(typeof response.units)
     ||Array.isArray(response.units))failures.push(prefix+'units_string_or_object_required');
  if(typeof response.interpretation!=='string'||response.interpretation.trim().length<2)
    failures.push(prefix+'interpretation_string_required');
  if(typeof response.sanity_check!=='string'||response.sanity_check.trim().length<2)
    failures.push(prefix+'sanity_check_string_required');
  if(!Array.isArray(response.evidence))failures.push(prefix+'evidence_array_required');
  if(!plainObject(response.self_audit))failures.push(prefix+'self_audit_object_required');
  if(quantitative && !Array.isArray(response.python_checks))
    failures.push(prefix+'python_checks_array_required');
  if(statistical && !Array.isArray(response.python_analyses))
    failures.push(prefix+'python_analyses_array_required');
  return failures;
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
  const statistical = statisticalUnit(ctx);
  const quantitative = String(ctx?.next_unit?.type || '').toLowerCase() === 'quantitative' && !statistical;
  if(Array.isArray(payload.problem_responses)){
    payload.problem_responses.slice(0,expectedProblems.length).forEach((response,index)=>{
      failures.push(...validateProblemResponseTypes(response,index,quantitative,statistical));
    });
  }
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

  if (quantitative) {
    const responses=Array.isArray(payload.problem_responses)?payload.problem_responses:[];
    for(let index=0;index<Math.min(responses.length,expectedProblems.length);index+=1){
      const responseChecks=Array.isArray(responses[index]?.python_checks)
        ? responses[index].python_checks : [];
      const requiredChecks=materialCalculationCount(responses[index]);
      if(responseChecks.length<requiredChecks){
        failures.push(
          'qda_python_checks_problem_'+String(index+1)
          +'_insufficient_material_coverage:required='+requiredChecks
          +';received='+responseChecks.length
        );
      }
    }

    if(!Array.isArray(payload.python_checks)){
      failures.push('qda_python_checks_array_required');
    }
    const checks = Array.isArray(payload.python_checks) ? payload.python_checks : [];
    const minimumCoverage=responses
      .slice(0,expectedProblems.length)
      .reduce((sum,response)=>sum+materialCalculationCount(response),0);
    if (checks.length < minimumCoverage) {
      failures.push(
        'qda_python_checks_material_coverage_required:required='+minimumCoverage
        +';received='+checks.length
      );
    } else {
      const pythonVerification = verifyPythonMathChecks(checks,{absoluteTolerance:0.005,relativeTolerance:1e-9});
      if (!pythonVerification.ok) {
        if(pythonVerification.failure_class==='input_contract'){
          failures.push('qda_python_check_contract_invalid:'+String(pythonVerification.error||'invalid'));
        }else{
          failures.push('qda_python_runtime_unavailable_or_invalid');
        }
      } else if (!pythonVerification.all_match) {
        const invalid=Array.isArray(pythonVerification.results)
          &&pythonVerification.results.some(row=>row?.valid===false);
        failures.push(invalid?'qda_python_check_expression_or_type_invalid':'qda_python_arithmetic_disagreement');
      }
    }
  }

  if (statistical) {
    const analyses = Array.isArray(payload.python_analyses) ? payload.python_analyses : [];
    if (analyses.length < 1) {
      failures.push('qda_python_statistical_analyses_required');
    } else {
      const statisticalVerification = runPythonStatisticalAnalyses(analyses,{timeoutMs:12000});
      if (!statisticalVerification.ok) {
        failures.push(
          statisticalVerification.failure_class==='input_contract'
            ?'qda_python_statistics_contract_invalid:'+String(statisticalVerification.error||'invalid')
            :'qda_python_statistics_runtime_unavailable_or_invalid'
        );
      } else if (!statisticalVerification.all_claims_match) {
        failures.push('qda_python_statistics_claim_disagreement');
      }
    }
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
    const parsedPayload=parseAssociationJson(association);
    const payload=canonicalizeQda601UnitPayload(parsedPayload);
    if(payload && typeof payload==='object' && !Array.isArray(payload)) {
      writeAssociationPayload(association,payload);
    }
    const contentSize = payload && typeof payload==='object'
      ? JSON.stringify(payload).length
      : 0;
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
{"origin":"agent_file_output_v0_1","file":{"filename":"${next.filename || ''}","mime_type":"application/json","caption":"QDA-601 ${next.unit_code || ''} completed unit","content":{"program_version":"qda_601_v0_1","module_code":"${next.module_code || ''}","unit_code":"${next.unit_code || ''}","exercise_pack_ref":"${next.exercise_pack_ref || ''}","title":"...","problem_responses":[...],"inputs":...,"assumptions":[],"formula_or_model":...,"calculation":...,"units":...,"interpretation":...,"sanity_check":...,"evidence":[],"python_checks":[{"label":"problem_1_material_result","expression":"numeric expression using only constants and + - * / ** % plus safe functions such as sqrt/log/exp","claimed_result":0}],"python_analyses":[{"id":"analysis_1","analysis":"describe|pearson_correlation|simple_linear_regression|proportion_ci|difference_proportions_ci|mean_ci|one_sample_t|welch_t|coefficient_t|bootstrap_ci|monte_carlo_expression","spec":{},"claims":{"result_field":0}}],"self_audit":{"pass_a":...,"pass_b":...,"verdict":"..."}}}}

Author file.content as a normal JSON object. The runtime owns deterministic serialization into the database file channel; do not spend cognition escaping a JSON document into a string.

The content must be at least 500 characters and substantive. Answer every assigned problem in next_unit.exercise_pack and preserve the exact exercise_pack_ref. Do not substitute invented questions. If next_unit.exercise_pack.external_research is false, do not request web research: all required training-case inputs are already authoritative in the exercise pack. For ordinary quantitative units, work multiple nontrivial examples/cases rather than a single toy calculation. EACH problem_response must contain its own python_checks. Every distinct material result in a calculation object requires its own check; for example, four PV outputs require four checks, not one check of only their total. Each check must be a JSON object with a nonempty string label, a nonempty string expression, and a finite JSON-number claimed_result (never quoted, boolean, null, array, or object). Expressions may use only numeric constants, + - * / ** %, parentheses, pi/e, and sqrt/log/log10/exp/abs/round. Do not use variables, assignments, sum(), range(), list/dict/tuple literals, comprehensions, lambdas, indexing, attributes, imports, or other Python syntax; expand finite sums explicitly with + terms. The runtime recursively counts material calculation leaves, aggregates the checks at unit level, and executes them independently in sandboxed Python. For statistical units (QDA601-M4-U1/U2/U3 and QDA601-M9-U3), use python_analyses instead: choose the method yourself, provide its spec, and state your own numerical claims. Python recomputes descriptive statistics, confidence intervals, correlation/regression, t-tests, bootstrap intervals, or fixed-seed Monte Carlo as requested. Python does not choose the method, validate causality, or write the interpretation. Pass B must independently reconstruct, reverse-check, assumption-check, dimension-check, or otherwise attack Pass A; paraphrasing Pass A is not an audit. If genuinely missing current external evidence, request web_research_request_v0_1 instead and keep the same unit active. Do not submit or revise an expertise candidate. Do not omit the file association after explaining the work in prose. Validation failures: ${JSON.stringify(validation?.failures || [])}`;
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
