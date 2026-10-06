import {
  resolveModelRuntimeContract,
  modelInputBudgetTokens,
} from './model-runtime-profiles.js';
import {
  SEMANTIC_RUNTIME_CONTRACT,
  semanticRuntimeConfig,
  modelCallCostUnits,
  semanticBranchBudget,
  semanticChildCapacity,
  repeatedStructuralFailureLocked,
  durableSiblingInspection,
  retryableModelTransportError,
  autonomousEvidenceWindowDecision,
  evidenceCeilingRequiresAgentResolution,
  mergeInheritedDependencyResults,
  THRESHOLD_EVIDENCE_POLICY,
  MAX_MODEL_TRANSPORT_ATTEMPTS,
  pathDepth,
} from './semantic-runtime-controls.js';
import {
  verifyPythonMathChecks,
  verifyPythonMathChecksChunked,
  calculatePythonMathExpressions,
} from './python-math.js';
import { runPythonStatisticalAnalysesChunked } from './python-quant.js';
import { materializeQda601UnitFromVerifiedChildren } from './qda601-runtime.js';

// AAU autonomous recursive decomposition v0.1
// The bound agent authors decomposition. Runtime only persists/routes/checkpoints.

const MAX_ATOMIC_EXECUTION_FAILURES=1;
// Protocol-shape failures are runtime/serialization failures, not failed cognition.
// Keep them on a separate bounded recovery path so malformed wrappers can never
// consume the atomic cognition allowance or force semantic decomposition.
const MAX_ATOMIC_PROTOCOL_FAILURES=2;
// Semantic work is bounded by the conserved assignment-epoch budget.
// The 16-level path ceiling is only a storage geometry emergency brake.
const MAX_CHILDREN_PER_NODE=16;
const MAX_CONTEXT_RESEARCH_ROUNDS=24;
const MAX_CONTEXT_STAGNANT_ROUNDS=2;
const MAX_CONTEXT_UNCHANGED_GAP_ROUNDS=3;
const MAX_CONTEXT_REPEAT_REQUEST_ROUNDS=1;
const MAX_CONTEXT_ACTIVE_ELAPSED_MS=90*60*1000;
const MAX_CONTEXT_UNIQUE_SOURCES=1000;
// Renewable evidence windows are intentionally much smaller than lifetime caps.
// The runtime may grant another window only when marginal evidence acquisition is
// productive and the conserved semantic budget still protects completion.
const EVIDENCE_WINDOW_MAX_CONTEXT_ROUNDS=2;
const EVIDENCE_WINDOW_MAX_NEW_SOURCES=40;
const EVIDENCE_WINDOW_MAX_ACTIVE_ELAPSED_MS=10*60*1000;
const MAX_AUTONOMOUS_EVIDENCE_WINDOW_RENEWALS=6;
const MAX_CONTEXT_REQUESTS_PER_ROUND=8;
const MAX_CONTEXT_VALUE_BYTES=12000;
const MAX_PERSISTED_CONTEXT_BYTES=262144;
const MAX_NODE_RPC_BODY_BYTES=220000;
const MIN_NODE_CONTEXT_BYTES=32000;
const MAX_PINNED_EVIDENCE_ITEMS_IN_COGNITION=16;
const MAX_PINNED_EVIDENCE_EXCERPT_CHARS=12000;
const MAX_SELF_REMEDIATION_ATTEMPTS=2;
const CHILD_FORMULATION_DEEP_TOKENS=7000;
const ATOMIC_EXECUTION_DEEP_TOKENS=7000;
const ATOMIC_RECONCILIATION_DEEP_TOKENS=9000;
const SYNTHESIS_MERGE_DEEP_TOKENS=6000;
const SYNTHESIS_FINAL_DEEP_TOKENS=7000;
const CHILD_PROVENANCE_REVIEW_DEEP_TOKENS=8000;
const SYNTHESIS_PROVENANCE_REVIEW_DEEP_TOKENS=12000;
const SELF_REMEDIATION_REPAIR_TYPES=[
  'INVALIDATE_DISCOVERY_CHECKPOINT',
  'REFRESH_SIBLING_EVIDENCE',
  'REBUILD_SYNTHESIS_FROM_RESOLVED_EVIDENCE',
];

const asObject=(v)=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const asArray=(v)=>Array.isArray(v)?v:[];

function text(v){return String(v??'').trim();}
function bytes(v){try{return Buffer.byteLength(typeof v==='string'?v:JSON.stringify(v));}catch{return 0;}}
function clip(s,n){const v=String(s??'');return v.length<=n?v:v.slice(0,n);}
export function safeJson(v){
  try{
    const serialized=JSON.stringify(v);
    return typeof serialized==='string'?serialized:'null';
  }catch{
    return '{}';
  }
}

const QDA_STATISTICAL_UNIT_CODES=new Set([
  'QDA601-M4-U1',
  'QDA601-M4-U2',
  'QDA601-M4-U3',
  'QDA601-M9-U3',
]);
function qdaVerifiedResultsSynthesisRequirement(node){
  const requirement=text(node?.requirement_text);
  if(!/QDA601/i.test(requirement))return false;
  const interpretiveScope=/(formal synthesis|interpretation|sanity[_ ]check|self[_ ]audit|audit fields?|decision relevance)/i.test(requirement);
  const upstreamVerifiedResults=/(using\s+(?:the\s+)?(?:quantitative|verified|numerical|statistical)\s+results?\s+from\s+R\.\d|using\s+.*?results?\s+from\s+R\.\d)/i.test(requirement);
  const explicitRecalculationContract=/(provide|include|derive|recompute|recalculate|calculate|compute)[^\n]{0,140}(?:`?calculation`?|python_checks?|python_analyses)/i.test(requirement);
  return interpretiveScope&&upstreamVerifiedResults&&!explicitRecalculationContract;
}
function qdaStatisticalAtomicRequirement(packet,node){
  if(qdaVerifiedResultsSynthesisRequirement(node))return false;
  const requirement=text(node?.requirement_text);
  const unitCode=text(packet?.qda_601_context?.next_unit?.unit_code).toUpperCase();

  // The QDA curriculum is authoritative about which units use the statistical
  // Python companion. Do not let incidental language inside an ordinary
  // quantitative unit (for example "financial calculator simulation") promote
  // that node into the statistics verifier.
  if(/^QDA601-M\d+-U\d+$/.test(unitCode)){
    if(!QDA_STATISTICAL_UNIT_CODES.has(unitCode))return false;
    const conceptualOnly=
      /\b(?:interpret|explain|discuss)\b/i.test(requirement)
      &&!/\b(?:compute|calculate|approximate|estimate|derive|fit|test|quantify)\b|confidence interval|t-statistic|p-value|bootstrap|monte carlo/i.test(requirement);
    return !conceptualOnly;
  }

  // Keyword inference is only a fallback for QDA work that lacks a canonical
  // curriculum unit code.
  if(!/QDA601/i.test(requirement))return false;
  return /(descriptive statistic|distribution|confidence interval|sampling|regression|correlation|association|bootstrap|monte carlo|simulation|p-value|t-statistic|variance|standard deviation)/i.test(requirement);
}
function qdaQuantitativeAtomicRequirement(packet,node){
  if(qdaVerifiedResultsSynthesisRequirement(node))return false;
  if(qdaStatisticalAtomicRequirement(packet,node))return false;
  const requirement=text(node?.requirement_text);
  const unitCode=text(packet?.qda_601_context?.next_unit?.unit_code).toUpperCase();
  if(QDA_STATISTICAL_UNIT_CODES.has(unitCode))return false;
  const inheritedQdaAssignment=/^QDA601-M\d+-U\d+$/.test(unitCode);

  // QDA identity is assignment-scoped, not wording-scoped. Agent-authored
  // descendants are allowed to paraphrase or omit the unit code; they must not
  // silently fall out of deterministic arithmetic verification because the
  // literal string "QDA601" disappeared from a child requirement.
  if(!inheritedQdaAssignment&&!/QDA601/i.test(requirement))return false;

  return /(calculat|compute|compound|discount|retention|churn|present value|future value|\bPV\b|\bFV\b|\bNPV\b|rate|ratio|revenue|cost|margin|probab|scenario|optimization|cash(?:\s+flow|\s+balance|\s+inflow|\s+outflow)?|runway|break[- ]?even|python_checks?)/i.test(requirement);
}

function qdaM7U4AuthoritativePythonCalculation(packet){
  const qda=asObject(packet?.qda_601_context);
  const next=asObject(qda.next_unit);
  if(text(next.unit_code).toUpperCase()!=='QDA601-M7-U4')return null;
  const caseData=asObject(asObject(next.exercise_pack).case_data);
  const payoffs=asObject(caseData.decision_payoffs);
  const priorHigh=Number(caseData.prior_high);
  const launchHigh=Number(payoffs.launch_high);
  const launchLow=Number(payoffs.launch_low);
  const kill=Number(payoffs.kill);
  const tests=asArray(caseData.tests);
  if(
    ![priorHigh,launchHigh,launchLow,kill].every(Number.isFinite)
    ||priorHigh<0||priorHigh>1
    ||tests.length<1
  )return null;

  const firstPass=[
    {label:'baseline_launch_ev',expression:`${priorHigh} * ${launchHigh} + ${1-priorHigh} * ${launchLow}`},
  ];
  for(const raw of tests){
    const name=text(raw?.name);
    const sensitivity=Number(raw?.sensitivity);
    const specificity=Number(raw?.specificity);
    const cost=Number(raw?.cost);
    if(!name||![sensitivity,specificity,cost].every(Number.isFinite))return null;
    const lowPrior=1-priorHigh;
    const falsePositive=1-specificity;
    const falseNegative=1-sensitivity;
    const pPos=`${priorHigh} * ${sensitivity} + ${lowPrior} * ${falsePositive}`;
    const pNeg=`${priorHigh} * ${falseNegative} + ${lowPrior} * ${specificity}`;
    const key=normalizedRequirement(name).replaceAll(' ','_');
    firstPass.push(
      {label:key+'_p_positive',expression:pPos},
      {label:key+'_p_negative',expression:pNeg},
      {label:key+'_posterior_high_positive',expression:`(${priorHigh} * ${sensitivity}) / (${pPos})`},
      {label:key+'_posterior_high_negative',expression:`(${priorHigh} * ${falseNegative}) / (${pNeg})`},
      {label:key+'_launch_ev_positive',expression:`((${priorHigh} * ${sensitivity}) / (${pPos})) * ${launchHigh} + (1 - ((${priorHigh} * ${sensitivity}) / (${pPos}))) * ${launchLow}`},
      {label:key+'_launch_ev_negative',expression:`((${priorHigh} * ${falseNegative}) / (${pNeg})) * ${launchHigh} + (1 - ((${priorHigh} * ${falseNegative}) / (${pNeg}))) * ${launchLow}`},
    );
  }

  const first=calculatePythonMathExpressions(firstPass);
  if(first.ok!==true)throw new Error('qda_m7_u4_python_first_pass_failed:'+String(first.error||'unknown'));
  const values=Object.fromEntries(first.results.map(row=>[row.label,row.actual]));
  const baselineLaunch=Number(values.baseline_launch_ev);
  const baselineDecision=Math.max(kill,baselineLaunch);
  const secondPass=[];

  for(const raw of tests){
    const name=text(raw?.name);
    const key=normalizedRequirement(name).replaceAll(' ','_');
    const cost=Number(raw?.cost);
    const pPositive=Number(values[key+'_p_positive']);
    const pNegative=Number(values[key+'_p_negative']);
    const launchPositive=Number(values[key+'_launch_ev_positive']);
    const launchNegative=Number(values[key+'_launch_ev_negative']);
    const decisionPositive=Math.max(kill,launchPositive);
    const decisionNegative=Math.max(kill,launchNegative);
    secondPass.push(
      {
        label:key+'_evwsi',
        expression:`${pPositive} * ${decisionPositive} + ${pNegative} * ${decisionNegative}`,
      },
      {
        label:key+'_evsi',
        expression:`(${pPositive} * ${decisionPositive} + ${pNegative} * ${decisionNegative}) - ${baselineDecision}`,
      },
      {
        label:key+'_net_decision_value',
        expression:`((${pPositive} * ${decisionPositive} + ${pNegative} * ${decisionNegative}) - ${baselineDecision}) - ${cost}`,
      },
    );
  }
  const second=calculatePythonMathExpressions(secondPass);
  if(second.ok!==true)throw new Error('qda_m7_u4_python_second_pass_failed:'+String(second.error||'unknown'));
  const derived=Object.fromEntries(second.results.map(row=>[row.label,row.actual]));

  const testResults=tests.map(raw=>{
    const name=text(raw?.name);
    const key=normalizedRequirement(name).replaceAll(' ','_');
    const launchPositive=Number(values[key+'_launch_ev_positive']);
    const launchNegative=Number(values[key+'_launch_ev_negative']);
    return {
      name,
      cost:Number(raw?.cost),
      sensitivity:Number(raw?.sensitivity),
      specificity:Number(raw?.specificity),
      p_positive:Number(values[key+'_p_positive']),
      p_negative:Number(values[key+'_p_negative']),
      posterior_high_positive:Number(values[key+'_posterior_high_positive']),
      posterior_high_negative:Number(values[key+'_posterior_high_negative']),
      launch_ev_positive:launchPositive,
      launch_ev_negative:launchNegative,
      optimal_positive:launchPositive>=kill?'LAUNCH':'KILL',
      optimal_negative:launchNegative>=kill?'LAUNCH':'KILL',
      decision_value_positive:Math.max(kill,launchPositive),
      decision_value_negative:Math.max(kill,launchNegative),
      evwsi:Number(derived[key+'_evwsi']),
      evsi:Number(derived[key+'_evsi']),
      net_decision_value:Number(derived[key+'_net_decision_value']),
    };
  });
  const ranked=[...testResults].sort((a,b)=>b.net_decision_value-a.net_decision_value);
  return {
    contract:'qda_m7_u4_authoritative_python_calculator_v0_1',
    calculator:'python3_safe_math_v0_1',
    source:'authoritative_curriculum_case_data',
    baseline:{
      launch_ev:baselineLaunch,
      kill_value:kill,
      optimal_decision:baselineLaunch>=kill?'LAUNCH':'KILL',
      expected_value:baselineDecision,
    },
    tests:testResults,
    recommended_experiment:ranked[0]?.name||null,
    recommended_net_decision_value:ranked[0]?.net_decision_value??null,
    numeric_authority:'runtime_python_calculation',
  };
}

const QDA_CURRICULUM_DEPENDENCY_OVERRIDES=Object.freeze({
  'QDA601-M2-U2':Object.freeze({2:[1],3:[1,2]}),
  'QDA601-M2-U3':Object.freeze({2:[1],3:[1,2]}),
  'QDA601-M2-U4':Object.freeze({2:[1]}),
  'QDA601-M3-U2':Object.freeze({2:[1],3:[1]}),
  'QDA601-M3-U3':Object.freeze({2:[1],3:[1]}),
  'QDA601-M3-U4':Object.freeze({2:[1],3:[1,2]}),
  'QDA601-M4-U2':Object.freeze({2:[1]}),
});
const QDA_STRICT_JSON_NUMBER=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
export function normalizeQdaStatisticalContractNumbers(value){
  if(typeof value==='string'){
    const trimmed=value.trim();
    if(QDA_STRICT_JSON_NUMBER.test(trimmed)){
      const number=Number(trimmed);
      if(Number.isFinite(number))return number;
    }
    return value;
  }
  if(Array.isArray(value))return value.map(normalizeQdaStatisticalContractNumbers);
  if(value&&typeof value==='object'){
    return Object.fromEntries(
      Object.entries(value).map(([key,item])=>[
        key,normalizeQdaStatisticalContractNumbers(item)
      ])
    );
  }
  return value;
}

function qdaCurriculumDependencies(unitCode,problem,ordinal){
  if(ordinal<=1)return [];
  const canonical=text(unitCode).toUpperCase();
  const override=QDA_CURRICULUM_DEPENDENCY_OVERRIDES[canonical]?.[ordinal];
  if(Array.isArray(override))return [...override];

  const value=text(problem);
  const explicit=[...value.matchAll(/\b(?:problem|question|item)\s+(\d+)\b/ig)]
    .map(match=>Number(match[1]))
    .filter(value=>Number.isInteger(value)&&value>0&&value<ordinal);
  if(explicit.length)return [...new Set(explicit)].sort((x,y)=>x-y);
  if(/\bfirst posterior\b/i.test(value))return [1];
  if(/\bupdate again\b/i.test(value))return [Math.max(1,ordinal-1)];
  if(/\bsame metrics\b.*\bcompare with A\b/i.test(value))return [1];
  if(/\b(?:previous|prior|earlier)\s+(?:result|answer|estimate|calculation|problem)\b/i.test(value)){
    return [Math.max(1,ordinal-1)];
  }
  return [];
}

export function qdaCurriculumFastPathPlan(packet){
  const qda=asObject(packet?.qda_601_context);
  const next=asObject(qda.next_unit);
  const exercisePack=asObject(next.exercise_pack);
  const unitCode=text(next.unit_code).toUpperCase();
  const exercisePackRef=text(next.exercise_pack_ref);
  const problems=asArray(exercisePack.problems).map(text).filter(Boolean);
  const applies=
    qda.assigned===true
    &&text(qda.status)==='in_progress'
    &&/^QDA601-M\d+-U\d+$/.test(unitCode)
    &&problems.length>=2;
  if(!applies){
    return {
      applies:false,
      unit_code:unitCode||null,
      problem_count:problems.length,
      children:[],
      contract:'qda_curriculum_fast_path_v0_1',
    };
  }

  const statistical=QDA_STATISTICAL_UNIT_CODES.has(unitCode);
  const externalResearch=exercisePack.external_research===true;
  const requiredFields=[
    'inputs','assumptions','formula_or_model','calculation','units',
    'interpretation','sanity_check','evidence','self_audit'
  ];
  const children=problems.map((problem,index)=>{
    const ordinal=index+1;
    const dependsOn=qdaCurriculumDependencies(unitCode,problem,ordinal);
    const syntheticNode={requirement_text:'Solve Problem '+ordinal+' of '+unitCode+': '+problem};
    const statisticalVerification=
      statistical&&qdaStatisticalAtomicRequirement(packet,syntheticNode);
    const quantitative=!statistical&&qdaQuantitativeAtomicRequirement(packet,syntheticNode);
    const verifierRequirement=statisticalVerification
      ?'Include python_analyses with explicit method specifications and claims for every material statistical result so the Python statistics companion can independently recompute them.'
      :quantitative
        ?'Include python_checks for every material numerical result using the deterministic safe-math contract.'
        :'';
    const dependencyRequirement=dependsOn.length
      ?'Use the verified result from prerequisite Problem '+dependsOn.join(' and Problem ')+' as authoritative sibling evidence; do not recompute that prerequisite unless explicitly required by this problem.'
      :'This problem has no prerequisite problem result and may execute independently.';
    return {
      ordinal,
      node_path:'R.'+String(ordinal).padStart(3,'0'),
      problem,
      depends_on:dependsOn,
      requirement:[
        'Solve Problem '+ordinal+' of '+unitCode+': "'+problem+'"',
        'This is the exact authoritative curriculum problem; do not replace, merge, or broaden it.',
        externalResearch
          ?'Use only research explicitly allowed by the exercise pack and preserve source evidence.'
          :'External research is forbidden; the exercise pack is self-contained.',
        exercisePackRef
          ?'Preserve exercise_pack_ref exactly as "'+exercisePackRef+'".'
          :'Preserve the current authoritative exercise-pack binding.',
        dependencyRequirement,
        'Return all required submission fields: '+requiredFields.join(', ')+'.',
        'self_audit must contain independent Pass A (solve) and Pass B (reconstruct or attack).',
        verifierRequirement,
      ].filter(Boolean).join(' '),
      statistical:statisticalVerification,
      quantitative,
      source_kind:'qda_curriculum_problem',
      source_ref:(exercisePackRef||unitCode)+'#problem-'+ordinal,
    };
  });

  const waves=[];
  const unresolved=new Map(children.map(child=>[child.ordinal,child]));
  const resolved=new Set();
  while(unresolved.size){
    const ready=[...unresolved.values()]
      .filter(child=>child.depends_on.every(dep=>resolved.has(dep)))
      .sort((x,y)=>x.ordinal-y.ordinal);
    if(!ready.length)break;
    waves.push(ready.map(child=>child.ordinal));
    ready.forEach(child=>{
      resolved.add(child.ordinal);
      unresolved.delete(child.ordinal);
    });
  }

  return {
    applies:true,
    unit_code:unitCode,
    module_code:text(next.module_code)||null,
    exercise_pack_ref:exercisePackRef||null,
    external_research:externalResearch,
    statistical,
    problem_count:problems.length,
    children,
    dependency_waves:waves,
    max_parallelism:3,
    contract:'qda_curriculum_fast_path_v0_1',
  };
}

function quantitativeArtifactBody(artifact){
  let parsed=artifact;
  if(typeof artifact==='string'){
    try{parsed=JSON.parse(artifact);}catch{return {};}
  }
  let obj=asObject(parsed);
  // Only unwrap documented QDA response envelopes. Keep all other object
  // shapes intact so type errors are surfaced rather than silently normalized.
  for(let depth=0;depth<3;depth++){
    let next=null;
    for(const key of ['problem_response','response']){
      const nested=obj[key];
      if(nested&&typeof nested==='object'&&!Array.isArray(nested)){
        next=nested;
        break;
      }
    }
    if(!next)break;
    obj=next;
  }
  return obj;
}
function typedArrayField(obj,key){
  if(!Object.prototype.hasOwnProperty.call(obj,key)){
    return {present:false,type_ok:true,value:[]};
  }
  if(!Array.isArray(obj[key])){
    return {
      present:true,type_ok:false,value:[],
      error:key+'_must_be_array',
      actual_type:obj[key]===null?'null':Array.isArray(obj[key])?'array':typeof obj[key],
    };
  }
  return {present:true,type_ok:true,value:obj[key]};
}
// Only locally calculated numeric results create deterministic Python coverage
// obligations. Presentation/provenance structures (for example a final ranking
// table whose values were already verified by sibling nodes) must not inflate
// the arithmetic coverage count.
const NON_MATERIAL_CALCULATION_KEYS=/^(method|expression|formula|formula_or_model|unit|units|label|description|note|notes|explanation|step|source|variable|rank|ranking|final_variable_ranking)$/i;
const CALCULATION_RESULT_NUMBER=/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
function materialCalculationStringDescriptor(value){
  const raw=text(value);
  if(!raw)return null;
  if(CALCULATION_RESULT_NUMBER.test(raw)){
    const claimedResult=Number(raw);
    return Number.isFinite(claimedResult)
      ?{claimed_result:claimedResult,expression:null}:null;
  }
  const equality=raw.lastIndexOf('=');
  if(equality<=0)return null;
  // Calculation prose often preserves a transparent derivation chain such as
  // "((78-32)*15000)-300000 = 690000-300000 = 390000".  The safe-math
  // verifier needs one executable arithmetic expression, not the entire chain
  // containing equality separators.  Use the final arithmetic segment that
  // directly produces the stated result.
  const expressionChain=raw.slice(0,equality).trim();
  const priorEquality=expressionChain.lastIndexOf('=');
  const expression=(priorEquality>=0
    ?expressionChain.slice(priorEquality+1)
    :expressionChain).trim();
  const resultRaw=raw.slice(equality+1).trim().replaceAll(',','').replace(/^\$/,'');
  if(!CALCULATION_RESULT_NUMBER.test(resultRaw))return null;
  // A material calculation string must actually encode arithmetic. This rejects
  // provenance-like strings such as "R.002.002" and ordinary presentation text.
  if(!/\d/.test(expression)||!/[+\-*\/%()]|\b(?:abs|sqrt|log|log10|exp|round)\s*\(/i.test(expression)){
    return null;
  }
  const claimedResult=Number(resultRaw);
  return Number.isFinite(claimedResult)
    ?{claimed_result:claimedResult,expression}:null;
}
function materialCalculationLeafCount(value,key=''){
  if(value===null||value===undefined)return 0;
  if(NON_MATERIAL_CALCULATION_KEYS.test(String(key)))return 0;
  if(typeof value==='number')return Number.isFinite(value)?1:0;
  if(typeof value==='string')return materialCalculationStringDescriptor(value)?1:0;
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
export function pythonChecksFromArtifact(artifact){
  const obj=quantitativeArtifactBody(artifact);
  const direct=typedArrayField(obj,'python_checks');
  if(!direct.type_ok)return direct;

  const responsesField=typedArrayField(obj,'problem_responses');
  if(!responsesField.type_ok)return {
    ...responsesField,
    error:'problem_responses_must_be_array',
  };

  const nested=[];
  for(let index=0;index<responsesField.value.length;index+=1){
    const response=responsesField.value[index];
    if(!response||typeof response!=='object'||Array.isArray(response))continue;
    const field=typedArrayField(response,'python_checks');
    if(!field.type_ok)return {
      present:true,type_ok:false,value:[],
      error:'problem_responses['+index+'].python_checks_must_be_array',
      actual_type:field.actual_type,
    };
    for(const check of field.value){
      nested.push({
        ...check,
        label:String(
          check?.label
          ||'problem_'+String(response?.problem_id??index+1)+'_check'
        ),
        problem:typeof check?.problem==='string'
          ?check.problem
          :String(response?.problem_statement||response?.problem||'problem_'+String(response?.problem_id??index+1)),
      });
    }
  }

  // Agent-authored structured artifacts sometimes wrap one bounded calculation
  // under a semantic key (for example interview_study_evwsi_calculation).
  // The Python checks remain authoritative even when they are one or more
  // object levels below the artifact root. Traverse only the artifact object,
  // bounded by depth, and fail closed if a discovered python_checks field is
  // not an array.
  const deep=[];
  let deepTypeError=null;
  const walk=(value,path,depth)=>{
    if(deepTypeError||depth>6||value===null||value===undefined)return;
    if(Array.isArray(value)){
      value.forEach((item,index)=>walk(item,path+'['+String(index)+']',depth+1));
      return;
    }
    if(typeof value!=='object')return;
    for(const [key,child] of Object.entries(value)){
      const childPath=path?path+'.'+key:key;
      if(key==='python_checks'){
        if(!Array.isArray(child)){
          deepTypeError={
            present:true,type_ok:false,value:[],
            error:childPath+'_must_be_array',
            actual_type:child===null?'null':typeof child,
          };
          return;
        }
        for(const check of child){
          deep.push({
            ...asObject(check),
            problem:typeof check?.problem==='string'
              ?check.problem
              :(path||'nested_artifact'),
          });
        }
        continue;
      }
      if(key==='problem_responses')continue;
      walk(child,childPath,depth+1);
    }
  };
  walk(obj,'',0);
  if(deepTypeError)return deepTypeError;

  // Some QDA artifacts are already canonicalized and therefore contain the
  // same checks at multiple levels. Preserve one exact instance of each check
  // so verification coverage is not inflated.
  const combined=[...direct.value,...nested,...deep];
  const seen=new Set();
  const value=[];
  for(const check of combined){
    const fingerprint=JSON.stringify({
      label:check?.label??null,
      expression:check?.expression??null,
      claimed_result:check?.claimed_result??null,
      problem:check?.problem??null,
    });
    if(seen.has(fingerprint))continue;
    seen.add(fingerprint);
    value.push(check);
  }
  const sources=[
    direct.value.length?'top_level':null,
    nested.length?'problem_responses':null,
    deep.length?'nested_artifact':null,
  ].filter(Boolean);
  return {
    present:sources.length>0,
    type_ok:true,
    value,
    source:sources.join('_and_')||'top_level',
  };
}
export function atomicMaterialCalculationCount(artifact){
  const obj=quantitativeArtifactBody(artifact);
  if(Array.isArray(obj.problem_responses)&&obj.problem_responses.length){
    return Math.max(
      1,
      obj.problem_responses.reduce(
        (sum,response)=>sum+Math.max(
          1,
          materialCalculationLeafCount(
            response&&typeof response==='object'?response.calculation:null,
            'calculation'
          )
        ),
        0
      )
    );
  }
  return Math.max(1,materialCalculationLeafCount(obj.calculation,'calculation'));
}
function deterministicMathVerification(packet,node,artifact){
  if(!qdaQuantitativeAtomicRequirement(packet,node))return {required:false,ok:true,all_match:true,check_count:0,results:[]};
  const checkField=pythonChecksFromArtifact(artifact);
  const artifactBody=quantitativeArtifactBody(artifact);
  const descendantMaterialization=
    asObject(artifactBody?.runtime_verified_descendant_materialization);
  const verifiedDescendantCoverage=[
    'qda_problem_verified_descendant_materialization_v0_1',
    'qda_verified_descendant_materialization_v0_2_recursive',
  ].includes(descendantMaterialization.contract);

  // For a split QDA parent, the durable atomic descendants are the arithmetic
  // execution boundary. Their structured checks are already fail-closed and are
  // re-executed here. Do not infer a second coverage requirement by counting
  // every numeric leaf in the synthesized presentation, where the same verified
  // value can legitimately appear multiple times (month index, beginning cash,
  // repeated inflow/outflow display fields, reconciliation copies, etc.).
  const requiredChecks=verifiedDescendantCoverage
    ?Math.max(1,Array.isArray(checkField.value)?checkField.value.length:0)
    :atomicMaterialCalculationCount(artifact);

  if(!checkField.type_ok)return {
    required:true,ok:false,failure_class:'input_contract',all_match:false,
    check_count:0,results:[],required_check_count:requiredChecks,
    coverage_authority:verifiedDescendantCoverage?'verified_descendants':'artifact_material_numeric_leaves',
    error:checkField.error,actual_type:checkField.actual_type
  };
  const checks=checkField.value;
  if(!checks.length)return {
    required:true,ok:false,failure_class:'input_contract',all_match:false,check_count:0,results:[],
    required_check_count:requiredChecks,
    coverage_authority:verifiedDescendantCoverage?'verified_descendants':'artifact_material_numeric_leaves',
    error:'python_checks_required'
  };
  if(checks.length<requiredChecks)return {
    required:true,ok:false,failure_class:'input_contract',all_match:false,check_count:checks.length,results:[],
    required_check_count:requiredChecks,
    coverage_authority:verifiedDescendantCoverage?'verified_descendants':'artifact_material_numeric_leaves',
    error:'python_checks_insufficient_material_coverage:required='+requiredChecks+';received='+checks.length
  };
  const verifier=verifiedDescendantCoverage
    ?verifyPythonMathChecksChunked
    :verifyPythonMathChecks;
  return {
    required:true,
    required_check_count:requiredChecks,
    coverage_authority:verifiedDescendantCoverage?'verified_descendants':'artifact_material_numeric_leaves',
    ...verifier(checks,{absoluteTolerance:0.005,relativeTolerance:1e-9})
  };
}

function compactMathVerificationForPersistence(verification){
  const v=asObject(verification);
  const results=asArray(v.results);
  const failures=results
    .filter(r=>r?.valid===false||r?.matched===false||r?.error_code)
    .slice(0,8)
    .map(r=>({
      index:Number.isFinite(Number(r?.index))?Number(r.index):null,
      label:clip(text(r?.label),160)||null,
      valid:r?.valid===true,
      matched:r?.matched===true,
      actual:r?.actual??null,
      claimed_result:r?.claimed_result??null,
      error_code:text(r?.error_code)||null,
    }));
  return {
    required:v.required===true,
    ok:v.ok===true,
    all_match:v.all_match===true,
    all_valid:v.all_valid!==false,
    check_count:Number(v.check_count||0),
    required_check_count:Number(v.required_check_count||0),
    coverage_authority:text(v.coverage_authority)||null,
    failure_class:text(v.failure_class)||null,
    error:text(v.error)||null,
    validation_error_count:Number(v.validation_error_count||0),
    result_count:results.length,
    failure_samples:failures,
    results_compacted:true,
    full_checks_location:'result_artifact.artifact.python_checks',
  };
}

function completedAtomicDeterministicRevalidation(packet,node){
  if(text(node?.decision_type).toUpperCase()!=='ATOMIC' || text(node?.node_status||node?.status).toLowerCase()!=='completed'){
    return {required:false,verification:null};
  }
  const parts=resultParts(node?.result_artifact);
  const verification=deterministicMathVerification(packet,node,parts.artifact);
  return {
    required:verification.required===true && (verification.ok!==true || verification.all_match!==true),
    verification,
  };
}

function pythonAnalysesFromArtifact(artifact){
  const obj=quantitativeArtifactBody(artifact);
  return typedArrayField(obj,'python_analyses');
}
function deterministicStatisticalVerification(packet,node,artifact){
  if(!qdaStatisticalAtomicRequirement(packet,node)){
    return {required:false,ok:true,all_claims_match:true,analysis_count:0,analyses:[]};
  }
  const field=pythonAnalysesFromArtifact(artifact);
  if(!field.type_ok){
    return {
      required:true,ok:false,failure_class:'input_contract',
      all_claims_match:false,analysis_count:0,analyses:[],
      error:field.error,actual_type:field.actual_type
    };
  }
  const analyses=field.value;
  if(!analyses.length){
    return {
      required:true,ok:false,failure_class:'input_contract',
      all_claims_match:false,analysis_count:0,analyses:[],
      error:'python_statistical_analyses_required'
    };
  }
  return {required:true,...runPythonStatisticalAnalysesChunked(analyses,{timeoutMs:12000})};
}
function artifactText(v){
  if(v===null||v===undefined)return '';
  if(typeof v==='string')return v.trim();
  if(typeof v==='object')return safeJson(v);
  return String(v).trim();
}

function parsedStructuredArtifact(v){
  if(v&&typeof v==='object'&&!Array.isArray(v))return v;
  const raw=artifactText(v);
  if(!raw)return null;
  try{
    const parsed=JSON.parse(raw);
    return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:null;
  }catch{
    return null;
  }
}

function deterministicEvidenceLedgerSynthesis(packet,node,childRows){
  const unitCode=text(packet?.qda_601_context?.next_unit?.unit_code).toUpperCase();
  const requirement=text(node?.requirement_text);
  const sourceRef=text(node?.source_ref);
  const eligible=
    unitCode==='QDA601-M5-U3'
    &&(/evidence[- ]state ledger/i.test(requirement)||/QDA601-M5-U3#problem-3/i.test(sourceRef));
  if(!eligible||!Array.isArray(childRows)||childRows.length<2)return null;

  const ordered=[...childRows].sort((a,b)=>text(a?.node_path).localeCompare(text(b?.node_path)));
  const evidenceStateLedger=[];
  const pythonChecks=[];
  const pythonAnalyses=[];
  const bindings=[];

  for(const child of ordered){
    if(text(child?.node_status||child?.status).toLowerCase()!=='completed')return null;
    const artifact=parsedStructuredArtifact(resultParts(child?.result_artifact).artifact);
    const ledger=asArray(artifact?.evidence_state_ledger);
    if(!artifact||!ledger.length)return null;
    for(const entry of ledger){
      if(!entry||typeof entry!=='object'||Array.isArray(entry))return null;
      evidenceStateLedger.push(entry);
      bindings.push({
        claim:text(entry.claim)||null,
        source_path_or_id:text(child?.node_path)||null,
        preserved:true,
      });
    }
    pythonChecks.push(...asArray(artifact.python_checks));
    pythonAnalyses.push(...asArray(artifact.python_analyses));
  }

  const expectedClaims=asArray(packet?.qda_601_context?.next_unit?.exercise_pack?.claims);
  if(expectedClaims.length&&evidenceStateLedger.length!==expectedClaims.length)return null;

  const childExercisePackRefs=ordered
    .map(child=>parsedStructuredArtifact(resultParts(child?.result_artifact).artifact)?.exercise_pack_ref)
    .map(text)
    .filter(Boolean);
  const exercisePackRef=
    text(packet?.qda_601_context?.next_unit?.exercise_pack_ref)
    ||childExercisePackRefs[0]
    ||null;

  const artifact={
    ...(exercisePackRef?{exercise_pack_ref:exercisePackRef}:{}),
    evidence_state_ledger:evidenceStateLedger,
    ...(pythonChecks.length?{python_checks:pythonChecks}:{}),
    ...(pythonAnalyses.length?{python_analyses:pythonAnalyses}:{}),
  };

  return {
    final_candidate:{
      outcome:'COMPLETE',
      reason:'Deterministically materialized the traceable evidence-state ledger from completed child artifacts without rewriting provenance-bearing fields.',
      artifact,
      handoff:{
        conclusions:['The traceable evidence-state ledger is materialized directly from completed child evidence.'],
        facts:evidenceStateLedger.map(entry=>text(entry.claim)).filter(Boolean),
        unresolved:[],
      },
      deterministic_provenance_materialization:'exact_completed_child_ledger_v0_1',
    },
    provenance_review:{
      status:'ACCEPT',
      reason:'Every evidence-state ledger entry was copied directly from a completed child artifact; no model-authored rewrite occurred at parent synthesis.',
      issues:[],
      evidence_bindings:bindings,
      revision_guidance:'',
      external_authenticator:false,
      deterministic_guard:{
        contract:'exact_completed_child_ledger_v0_1',
        child_count:ordered.length,
        ledger_entry_count:evidenceStateLedger.length,
        child_result_hashes:ordered.map(child=>({
          path:child?.node_path||null,
          result_hash:child?.result_hash||null,
        })),
      },
    },
  };
}
function reconciliationReplacementQuality(proposedArtifact,candidateArtifact){
  const proposed=artifactText(proposedArtifact);
  const candidate=artifactText(candidateArtifact);
  const proposedBytes=bytes(proposed);
  const candidateBytes=bytes(candidate);
  if(!candidate)return {
    acceptable:false,reason:'empty_reconciliation_artifact',proposed_bytes:proposedBytes,candidate_bytes:0
  };
  if(proposedBytes<1600)return {
    acceptable:true,reason:'small_proposed_artifact',proposed_bytes:proposedBytes,candidate_bytes:candidateBytes
  };
  const minimumBytes=Math.max(900,Math.floor(proposedBytes*0.55));
  return {
    acceptable:candidateBytes>=minimumBytes,
    reason:candidateBytes>=minimumBytes?'complete_replacement_size_ok':'materially_abbreviated_replacement',
    proposed_bytes:proposedBytes,candidate_bytes:candidateBytes,minimum_bytes:minimumBytes,
  };
}

function companionNormalizedArtifact(payload){
  const src=asObject(payload);
  const raw=src?.artifact;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return raw;
  const normalized={...raw};
  for(const key of ['python_checks','python_analyses']){
    if((!Array.isArray(normalized[key])||normalized[key].length===0)
       &&Array.isArray(src[key])&&src[key].length){
      normalized[key]=src[key];
    }
  }
  return normalized;
}

export function qdaDirectAtomicArtifactCandidate(payload){
  const src=asObject(payload);
  if(src?.artifact&&typeof src.artifact==='object'&&!Array.isArray(src.artifact)){
    return asObject(companionNormalizedArtifact(src));
  }
  return src;
}
function canonicalizeHashValue(v){
  if(Array.isArray(v))return v.map(canonicalizeHashValue);
  if(v&&typeof v==='object'){
    const out={};
    for(const key of Object.keys(v).sort())out[key]=canonicalizeHashValue(v[key]);
    return out;
  }
  return v;
}
function semanticContextIdentity(rawPayload){
  const src=asObject(rawPayload);
  const local={};
  for(const key of Object.keys(src).sort()){
    if(key==='research_source_catalog'
      ||key==='completed_sibling_results'
      ||key==='inherited_completed_sibling_results'
      ||/^external_research_round_\d+$/.test(key)
      ||key.startsWith('_model_context_')
      ||key.startsWith('_context_'))continue;
    local[key]=canonicalizeHashValue(src[key]);
  }
  const catalog=asArray(src.research_source_catalog)
    .map(raw=>{
      const v=asObject(raw);
      return {
        source_id:text(v.source_id)||null,
        url:text(v.url)||null,
        sha256:text(v.sha256)||null,
        fetch_status:text(v.fetch_status)||null,
      };
    })
    .sort((a,b)=>{
      const ka=[a.url,a.source_id,a.sha256].filter(Boolean).join('|');
      const kb=[b.url,b.source_id,b.sha256].filter(Boolean).join('|');
      return ka.localeCompare(kb);
    });
  return canonicalizeHashValue({local_context:local,research_source_catalog:catalog});
}
function estimatedTokens(v,contract){
  const chars=typeof v==='string'?v.length:safeJson(v).length;
  const charsPerToken=Math.max(1.5,Number(contract?.estimated_chars_per_token)||3.2);
  return Math.ceil(chars/charsPerToken)+32;
}
function compactResearchCatalogForModel(rows,mode='full'){
  return asArray(rows).map(raw=>{
    const v=asObject(raw);
    if(mode==='minimal'){
      return {
        source_id:v.source_id||null,
        url:v.url||null,
        sha256:v.sha256||null,
        fetch_status:v.fetch_status||null,
      };
    }
    return {
      source_id:v.source_id||null,
      ordinal:v.ordinal||null,
      query:clip(v.query,300)||null,
      title:clip(v.title,500)||null,
      publisher:clip(v.publisher,240)||null,
      url:v.url||null,
      published_at:v.published_at||null,
      coverage:v.coverage||null,
      fetch_status:v.fetch_status||null,
      sha256:v.sha256||null,
      excerpt_chars_shared:Number(v.excerpt_chars_shared||0),
      receipt_persisted:Boolean(v.receipt_persisted??v.full_receipt_persisted),
      full_text_persisted:Boolean(v.full_text_persisted),
      full_receipt_persisted:Boolean(v.full_receipt_persisted),
    };
  });
}
function compactResearchRoundForModel(raw,maxTokens,contract){
  const round=asObject(raw);
  const base={
    status:round.status||null,
    audit_batch_id:round.audit_batch_id||null,
    requested_queries:asArray(round.requested_queries).map(v=>clip(text(v),500)).slice(0,8),
    requested_urls:asArray(round.requested_urls).map(v=>clip(text(v),1000)).slice(0,8),
    handoff_policy:round.handoff_policy||null,
    evidence_rule:clip(round.evidence_rule,1200)||null,
  };
  const sources=asArray(round.sources);
  if(!sources.length)return base;
  const charsPerToken=Math.max(1.5,Number(contract?.estimated_chars_per_token)||3.2);
  const metadataOnly=sources.map((rawSource,index)=>{
    const s=asObject(rawSource);
    return {
      source_id:s.source_id||null,
      ordinal:s.ordinal||index+1,
      title:clip(s.title,450)||null,
      publisher:clip(s.publisher,220)||null,
      url:s.url||null,
      coverage:s.coverage||null,
      fetch_status:s.fetch_status||null,
      sha256:s.sha256||null,
      excerpt_chars_shared:Number(s.excerpt_chars_shared||0),
      receipt_persisted:Boolean(s.receipt_persisted??s.full_receipt_persisted),
      full_text_persisted:Boolean(s.full_text_persisted),
      full_receipt_persisted:Boolean(s.full_receipt_persisted),
    };
  });
  const metadataTokens=estimatedTokens({...base,sources:metadataOnly},contract);
  if(metadataTokens>=maxTokens)return {...base,sources:metadataOnly};
  const remainingChars=Math.max(0,Math.floor((maxTokens-metadataTokens)*charsPerToken));
  const fetched=Math.max(1,sources.filter(s=>typeof s?.excerpt==='string'&&s.excerpt.length).length);
  const excerptCharsEach=Math.max(0,Math.min(6000,Math.floor(remainingChars/fetched)));
  return {
    ...base,
    sources:sources.map((rawSource,index)=>{
      const s=asObject(rawSource);
      const meta=metadataOnly[index];
      return {
        ...meta,
        excerpt:excerptCharsEach>0&&typeof s.excerpt==='string'
          ? clip(s.excerpt,excerptCharsEach)
          : null,
      };
    }),
  };
}
function compactPinnedEvidenceForModel(rows,maxTokens,contract){
  const items=asArray(rows);
  if(!items.length)return [];
  if(estimatedTokens(items,contract)<=maxTokens)return items;
  const metadata=items.map(v=>({
    evidence_id:v.evidence_id||null,
    source_key:v.source_key||null,
    source_id:v.source_id||null,
    url:v.url||null,
    title:clip(v.title,450)||null,
    publisher:clip(v.publisher,220)||null,
    sha256:v.sha256||null,
    fetch_status:v.fetch_status||null,
    coverage:v.coverage||null,
    audit_batch_id:v.audit_batch_id||null,
    durable_pinned:true,
  }));
  const metadataTokens=estimatedTokens(metadata,contract);
  if(metadataTokens>=maxTokens)return metadata;
  const charsPerToken=Math.max(1.5,Number(contract?.estimated_chars_per_token)||3.2);
  const excerptCharsEach=Math.max(0,Math.min(
    MAX_PINNED_EVIDENCE_EXCERPT_CHARS,
    Math.floor((maxTokens-metadataTokens)*charsPerToken/Math.max(1,items.length))
  ));
  return items.map((v,i)=>({
    ...metadata[i],
    excerpt:excerptCharsEach>0?clip(v.excerpt,excerptCharsEach):null,
    excerpt_bytes:Number(v.excerpt_bytes||bytes(v.excerpt||'')),
  }));
}
function compactSiblingEvidenceForModel(rows,maxTokens,contract){
  const items=asArray(rows);
  if(!items.length)return [];
  if(estimatedTokens(items,contract)<=maxTokens)return items;
  const per=Math.max(300,Math.floor(maxTokens/Math.max(1,items.length)));
  const charsPerToken=Math.max(1.5,Number(contract?.estimated_chars_per_token)||3.2);
  const perChars=Math.max(500,Math.floor(per*charsPerToken));
  return items.map(v=>({
    path:v.path||null,
    status:v.status||null,
    decision_type:v.decision_type||null,
    requirement:clip(v.requirement,Math.min(700,Math.floor(perChars*0.15))),
    artifact:clip(v.artifact,Math.max(250,Math.floor(perChars*0.58))),
    handoff_json:clip(v.handoff_json,Math.max(180,Math.floor(perChars*0.20))),
    result_hash:v.result_hash||null,
    evidence_scope:v.evidence_scope||null,
  }));
}
function boundContextForModel(payload,maxTokens,contract){
  const src=asObject(payload);
  const budget=Math.max(1000,Math.floor(Number(maxTokens)||1000));
  if(estimatedTokens(src,contract)<=budget){
    return {
      ...src,
      _model_context_budget:{
        version:'model_profile_token_context_v0_1',
        model_id:contract?.model_id||null,
        max_tokens:budget,
        estimated_tokens:estimatedTokens(src,contract),
        compacted:false,
      },
    };
  }
  const out={};
  const evicted=[];
  const researchRound=(key)=>{
    const match=String(key).match(/^external_research(?:_round_)?(\d+)$/);
    return match?Number(match[1]):0;
  };
  const fits=(candidate)=>estimatedTokens(candidate,contract)<=budget;

  const catalog=asArray(src.research_source_catalog);
  if(catalog.length){
    let compact=compactResearchCatalogForModel(catalog,'full');
    if(!fits({...out,research_source_catalog:compact}))
      compact=compactResearchCatalogForModel(catalog,'minimal');
    if(fits({...out,research_source_catalog:compact}))out.research_source_catalog=compact;
    else evicted.push({path:'research_source_catalog',reason:'model_token_budget',items:catalog.length});
  }

  for(const key of ['completed_sibling_results','inherited_completed_sibling_results']){
    if(!src[key])continue;
    const candidate={...out,[key]:src[key]};
    if(fits(candidate))out[key]=src[key];
    else evicted.push({path:key,reason:'model_token_budget'});
  }

  const researchEntries=Object.entries(src)
    .filter(([key])=>key.startsWith('external_research'))
    .sort((a,b)=>researchRound(b[0])-researchRound(a[0]));
  for(const [key,value] of researchEntries){
    const remaining=Math.max(600,budget-estimatedTokens(out,contract)-128);
    const compact=compactResearchRoundForModel(value,remaining,contract);
    if(fits({...out,[key]:compact}))out[key]=compact;
    else evicted.push({path:key,reason:'model_token_budget'});
  }

  const priorityExcluded=new Set([
    'research_source_catalog','completed_sibling_results','inherited_completed_sibling_results',
    ...researchEntries.map(([key])=>key),
    '_context_evicted','_context_budget','_model_context_budget'
  ]);
  const other=Object.entries(src).filter(([key])=>!priorityExcluded.has(key)).reverse();
  for(const [key,value] of other){
    if(fits({...out,[key]:value}))out[key]=value;
    else evicted.push({path:key,reason:'model_token_budget'});
  }

  out._model_context_evicted=evicted.slice(0,60);
  out._model_context_budget={
    version:'model_profile_token_context_v0_1',
    model_id:contract?.model_id||null,
    operational_context_limit_tokens:contract?.operational_context_limit_tokens||null,
    max_tokens:budget,
    estimated_tokens:estimatedTokens(out,contract),
    compacted:true,
    evicted_count:evicted.length,
    source_catalog_items:asArray(out.research_source_catalog).length,
  };
  return out;
}
function withoutDuplicatedSiblingContext(payload){
  const out={...asObject(payload)};
  delete out.completed_sibling_results;
  delete out.inherited_completed_sibling_results;
  return out;
}
function mergeResearchSourceCatalog(existing,incoming){
  const out=[];
  const byKey=new Map();
  for(const source of [...asArray(existing),...asArray(incoming)]){
    const item=asObject(source);
    const key=text(item.url)||text(item.source_id)||text(item.sha256)||text(item.title);
    if(!key)continue;
    if(byKey.has(key)){
      const idx=byKey.get(key);
      out[idx]={...out[idx],...item};
      continue;
    }
    byKey.set(key,out.length);
    out.push(item);
  }
  return out;
}
function catalogSourceIdFromRequest(raw){
  const request=text(raw);
  if(!request)return '';
  if(/^src_[a-z0-9]+$/i.test(request))return request;
  const parts=pathParts(request);
  if(parts.length>=2&&parts[0]==='research_source_catalog'&&/^src_[a-z0-9]+$/i.test(parts[1]))
    return parts[1];
  return '';
}
function resolveCatalogSourceRequests(requests,catalog){
  const bySourceId=new Map(
    asArray(catalog)
      .map(raw=>asObject(raw))
      .filter(v=>text(v.source_id))
      .map(v=>[text(v.source_id),v])
  );
  const resolved=[];
  const unresolved=[];
  for(const raw of asArray(requests)){
    const request=text(raw);
    if(!request)continue;
    const sourceId=catalogSourceIdFromRequest(request);
    const source=sourceId?bySourceId.get(sourceId):null;
    if(source&&/^https:\/\//i.test(text(source.url))){
      resolved.push({
        request_path:request,
        source_id:sourceId,
        url:text(source.url),
        sha256:text(source.sha256)||null,
        audit_batch_id:text(source.audit_batch_id)||null,
      });
    }else{
      unresolved.push(request);
    }
  }
  return {resolved,unresolved};
}
function normalizedUrl(v){
  const raw=text(v);
  if(!raw)return '';
  try{
    const u=new URL(raw);
    u.hash='';
    u.search='';
    return u.toString().replace(/\/$/,'').toLowerCase();
  }catch{
    return raw.replace(/\/$/,'').toLowerCase();
  }
}
function compactPinnedEvidence(rows){
  return asArray(rows)
    .filter(v=>v&&typeof v==='object')
    .slice(0,MAX_PINNED_EVIDENCE_ITEMS_IN_COGNITION)
    .map(v=>({
      evidence_id:v.evidence_id||null,
      source_key:v.source_key||v.source_id||v.url||null,
      source_id:v.source_id||null,
      url:v.url||null,
      title:v.title||null,
      publisher:v.publisher||null,
      sha256:v.sha256||null,
      fetch_status:v.fetch_status||null,
      coverage:v.coverage||null,
      audit_batch_id:v.audit_batch_id||null,
      excerpt:clip(v.excerpt,MAX_PINNED_EVIDENCE_EXCERPT_CHARS),
      excerpt_bytes:Number(v.excerpt_bytes||bytes(v.excerpt||'')),
      durable_pinned:true,
    }));
}
function normalizedSignal(values){
  return asArray(values).map(v=>normalizedRequirement(v)).filter(Boolean).sort().join(' | ');
}
function contextResourceView(state,contextPayload){
  const s=asObject(state);
  const activeElapsedMs=Math.max(0,Number(s.active_context_elapsed_ms||0));
  const contextRounds=Math.max(0,Number(s.context_rounds_attempted||0));
  const uniqueSources=Math.max(
    asArray(contextPayload?.research_source_catalog).length,
    Number(s.total_new_sources||0)
  );
  const windowRoundBaseline=Math.max(0,Number(s.evidence_window_round_baseline||0));
  const windowSourceBaseline=Math.max(0,Number(s.evidence_window_source_baseline||0));
  const windowElapsedBaseline=Math.max(0,Number(s.evidence_window_elapsed_baseline_ms||0));
  const windowRounds=Math.max(0,contextRounds-windowRoundBaseline);
  const windowSources=Math.max(0,uniqueSources-windowSourceBaseline);
  const windowElapsedMs=Math.max(0,activeElapsedMs-windowElapsedBaseline);

  const reasons=[];
  if(contextRounds>=MAX_CONTEXT_RESEARCH_ROUNDS)
    reasons.push('absolute_context_round_safety_ceiling');
  if(uniqueSources>=MAX_CONTEXT_UNIQUE_SOURCES)
    reasons.push('absolute_unique_source_safety_ceiling');
  if(activeElapsedMs>=MAX_CONTEXT_ACTIVE_ELAPSED_MS)
    reasons.push('absolute_context_elapsed_time_ceiling');
  if(Number(s.stagnant_rounds||0)>=MAX_CONTEXT_STAGNANT_ROUNDS)
    reasons.push('no_new_observations');
  if(Number(s.unchanged_gap_rounds||0)>=MAX_CONTEXT_UNCHANGED_GAP_ROUNDS)
    reasons.push('unresolved_gap_not_changing');
  if(Number(s.repeated_request_rounds||0)>=MAX_CONTEXT_REPEAT_REQUEST_ROUNDS)
    reasons.push('research_request_repeating');
  if(windowRounds>=EVIDENCE_WINDOW_MAX_CONTEXT_ROUNDS)
    reasons.push('evidence_window_round_ceiling');
  if(windowSources>=EVIDENCE_WINDOW_MAX_NEW_SOURCES)
    reasons.push('evidence_window_source_ceiling');
  if(windowElapsedMs>=EVIDENCE_WINDOW_MAX_ACTIVE_ELAPSED_MS)
    reasons.push('evidence_window_elapsed_ceiling');

  const renewableSet=new Set([
    'evidence_window_round_ceiling',
    'evidence_window_source_ceiling',
    'evidence_window_elapsed_ceiling',
  ]);
  return {
    available:reasons.length===0,
    exhausted:reasons.length>0,
    reasons,
    renewable_reasons:reasons.filter(v=>renewableSet.has(v)),
    hard_reasons:reasons.filter(v=>!renewableSet.has(v)),
    elapsed_ms:activeElapsedMs,
    active_context_elapsed_ms:activeElapsedMs,
    elapsed_accounting:'active_context_acquisition_only_v0_3_evidence_windows',
    unique_sources:uniqueSources,
    context_rounds_attempted:contextRounds,
    research_rounds_attempted:Number(s.research_rounds_attempted||0),
    local_context_rounds_attempted:Number(s.local_context_rounds_attempted||0),
    stagnant_rounds:Number(s.stagnant_rounds||0),
    unchanged_gap_rounds:Number(s.unchanged_gap_rounds||0),
    repeated_request_rounds:Number(s.repeated_request_rounds||0),
    evidence_window_no:Math.max(0,Number(s.evidence_window_no||0)),
    evidence_window_renewals:Math.max(0,Number(s.evidence_window_renewals||0)),
    evidence_window_round_baseline:windowRoundBaseline,
    evidence_window_source_baseline:windowSourceBaseline,
    evidence_window_elapsed_baseline_ms:windowElapsedBaseline,
    evidence_window_rounds_used:windowRounds,
    evidence_window_new_sources:windowSources,
    evidence_window_elapsed_ms:windowElapsedMs,
    evidence_window_limits:{
      context_rounds:EVIDENCE_WINDOW_MAX_CONTEXT_ROUNDS,
      new_sources:EVIDENCE_WINDOW_MAX_NEW_SOURCES,
      active_elapsed_ms:EVIDENCE_WINDOW_MAX_ACTIVE_ELAPSED_MS,
    },
    lifetime_limits:{
      context_rounds:MAX_CONTEXT_RESEARCH_ROUNDS,
      unique_sources:MAX_CONTEXT_UNIQUE_SOURCES,
      active_elapsed_ms:MAX_CONTEXT_ACTIVE_ELAPSED_MS,
    },
  };
}
function normalizedRequirement(v){
  return text(v).toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
}
function requirementSimilarity(a,b){
  const aa=normalizedRequirement(a);
  const bb=normalizedRequirement(b);
  if(!aa||!bb)return 0;
  if(aa===bb)return 1;
  const aset=new Set(aa.split(' ').filter(Boolean));
  const bset=new Set(bb.split(' ').filter(Boolean));
  let overlap=0;
  for(const token of aset)if(bset.has(token))overlap++;
  return overlap/Math.max(1,new Set([...aset,...bset]).size);
}

function explicitRepeatedInstanceId(v){
  const source=normalizedRequirement([
    v?.requirement,
    v?.requirement_text,
    v?.completion_criterion,
    v?.scope_removed,
  ].filter(Boolean).join(' '));
  if(!source)return null;

  const numericPatterns=[
    /\bcandidate\s+(\d+)(?:\s+of\s+\d+)?\b/,
    /\bproposal\s+(\d+)(?:\s+of\s+\d+)?\b/,
    /\bordinal\s+(\d+)\b/,
    /\binstance\s+(\d+)(?:\s+of\s+\d+)?\b/,
    /\bitem\s+(\d+)(?:\s+of\s+\d+)?\b/,
  ];
  for(const pattern of numericPatterns){
    const match=source.match(pattern);
    if(match)return Number(match[1]);
  }

  const ordinalWords={
    first:1,second:2,third:3,fourth:4,fifth:5,sixth:6,seventh:7,eighth:8,ninth:9,tenth:10,
  };
  const wordMatch=source.match(
    /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(candidate|proposal|instance|item)\b/
  );
  return wordMatch?ordinalWords[wordMatch[1]]||null:null;
}

function explicitRepeatedInstancesDisjoint(a,b){
  const aa=explicitRepeatedInstanceId(a);
  const bb=explicitRepeatedInstanceId(b);
  return Number.isInteger(aa)&&Number.isInteger(bb)&&aa!==bb;
}

function explicitPartitionValues(v){
  const raw=[
    v?.requirement,
    v?.requirement_text,
    v?.completion_criterion,
  ].filter(Boolean).join(' ');
  const out={};

  // Scenario-specific numeric partitions must be recognized before generic
  // token-overlap rejection. QDA problems frequently repeat the full parent
  // sentence in every child while assigning one mutually exclusive parameter
  // value (for example elasticity ε=-0.6 vs ε=-1.0). Token-set similarity alone
  // therefore cannot distinguish the children.
  const scenarioSource=[
    v?.requirement,
    v?.completion_criterion,
  ].filter(Boolean).join(' ');
  const elasticityValues=new Set();
  const elasticityPatterns=[
    /specifically\s+for[^.;]{0,120}(?:ε|epsilon|elasticity)[^0-9+\-−–—]{0,20}([+\-−–—]?\s*\d+(?:\.\d+)?)/gi,
    /(?:elasticity\s+scenario|scenario\s+(?:with\s+)?(?:ε|epsilon|elasticity))[^0-9+\-−–—]{0,20}([+\-−–—]?\s*\d+(?:\.\d+)?)/gi,
  ];
  for(const pattern of elasticityPatterns){
    let match=null;
    while((match=pattern.exec(scenarioSource))!==null){
      const normalized=String(match[1]||'')
        .replace(/[−–—]/g,'-')
        .replace(/\s+/g,'');
      const value=Number(normalized);
      if(Number.isFinite(value))elasticityValues.add(value);
    }
  }
  if(elasticityValues.size){
    out.elasticity=[...elasticityValues].sort((a,b)=>a-b);
  }

  // Distinct named alternatives are also semantic partitions. Quantitative
  // branches often repeat the same formula vocabulary while operating on
  // different experiments/tests (for example "Interview study" vs "Paid pilot").
  // Treat an explicitly quoted named option as a partition identity so lexical
  // similarity cannot collapse genuinely disjoint work.
  const namedAlternatives=new Set();
  const quotedAlternativePattern=/['"]([^'"]{2,100})['"]/g;
  let quotedMatch=null;
  while((quotedMatch=quotedAlternativePattern.exec(raw))!==null){
    const label=normalizedRequirement(quotedMatch[1]);
    if(!label)continue;
    if(/\b(?:study|pilot|experiment|test|scenario|option|strategy|alternative|candidate)\b/.test(label)){
      namedAlternatives.add(label);
    }
  }
  if(namedAlternatives.size){
    out.named_alternative=[...namedAlternatives].sort();
  }

  const dimensions=['year','row','case','month','quarter','week','day','step','part','section'];
  for(const dimension of dimensions){
    const values=new Set();
    const rangePattern=new RegExp(
      '\\b'+dimension+'s?\\s+(\\d+)\\s*(?:-|–|—|to|through)\\s*(\\d+)\\b','gi'
    );
    let match=null;
    while((match=rangePattern.exec(raw))!==null){
      const start=Number(match[1]);
      const end=Number(match[2]);
      if(!Number.isInteger(start)||!Number.isInteger(end))continue;
      const low=Math.min(start,end);
      const high=Math.max(start,end);
      if(high-low>10000)continue;
      for(let value=low;value<=high;value++)values.add(value);
    }
    const itemPattern=new RegExp('\\b'+dimension+'s?\\s+(\\d+)\\b','gi');
    while((match=itemPattern.exec(raw))!==null){
      const value=Number(match[1]);
      if(Number.isInteger(value))values.add(value);
    }
    if(values.size)out[dimension]=[...values].sort((a,b)=>a-b);
  }
  return out;
}

function explicitPartitionsDisjoint(a,b){
  const aa=explicitPartitionValues(a);
  const bb=explicitPartitionValues(b);
  let compared=false;
  for(const dimension of Object.keys(aa)){
    if(!Array.isArray(bb[dimension])||!bb[dimension].length)continue;
    compared=true;
    const bset=new Set(bb[dimension]);
    if(aa[dimension].some(value=>bset.has(value)))return false;
  }
  return compared;
}

export function qdaScenarioPartitionsDisjointForProbe(a,b){
  return explicitPartitionsDisjoint(a,b);
}

function candidateLedgerRows(suppliedContext){
  const wrapped=asObject(asObject(suppliedContext)?.expertise_candidate_ledger);
  const ledger=asObject(wrapped.value||wrapped);
  return asArray(ledger.candidates);
}

function canonicalCandidateIdentity(v,suppliedContext){
  const raw=[
    v?.proposal_id,
    v?.requirement,
    v?.requirement_text,
    v?.scope_removed,
    v?.completion_criterion,
    v?.reason,
  ].filter(Boolean).join(' ');
  const rawLower=String(raw).toLowerCase();
  const normalized=normalizedRequirement(raw);

  for(const row of candidateLedgerRows(suppliedContext)){
    const proposalId=text(row?.proposal_id).trim();
    const domain=text(row?.domain).trim();
    const domainNorm=normalizedRequirement(domain);
    if(proposalId&&rawLower.includes(proposalId.toLowerCase())){
      return {
        kind:'canonical_candidate',
        key:'proposal:'+proposalId.toLowerCase(),
        proposal_id:proposalId,
        domain:domain||null,
        candidate_ordinal:Number(row?.candidate_ordinal||0)||null,
        match_basis:'proposal_id',
      };
    }
    if(domainNorm&&normalized.includes(domainNorm)){
      return {
        kind:'canonical_candidate',
        key:proposalId
          ?'proposal:'+proposalId.toLowerCase()
          :'domain:'+domainNorm,
        proposal_id:proposalId||null,
        domain:domain||null,
        candidate_ordinal:Number(row?.candidate_ordinal||0)||null,
        match_basis:'exact_normalized_domain',
      };
    }
  }

  const explicitId=explicitRepeatedInstanceId(v);
  if(Number.isInteger(explicitId)){
    return {
      kind:'explicit_ordinal',
      key:'ordinal:'+explicitId,
      proposal_id:null,
      domain:null,
      candidate_ordinal:explicitId,
      match_basis:'explicit_repeated_instance',
    };
  }
  return null;
}

function canonicalRepeatedInstancesDisjoint(a,b,suppliedContext){
  const aa=canonicalCandidateIdentity(a,suppliedContext);
  const bb=canonicalCandidateIdentity(b,suppliedContext);
  return Boolean(aa?.key&&bb?.key&&aa.key!==bb.key);
}
function childConvergenceValidation(parentRequirement,childRequirement,scopeRemoved,completionCriterion){
  const failures=[];
  const scope=text(scopeRemoved);
  const criterion=text(completionCriterion);
  if(scope.length<12)failures.push('scope_removed_required');
  if(criterion.length<12)failures.push('completion_criterion_required');
  const parentNorm=normalizedRequirement(parentRequirement);
  const childNorm=normalizedRequirement(childRequirement);
  const similarity=requirementSimilarity(parentRequirement,childRequirement);
  if(parentNorm===childNorm)failures.push('child_exactly_restates_parent');
  if(similarity>=0.88 && childNorm.length>=Math.max(1,Math.floor(parentNorm.length*0.80)))
    failures.push('child_does_not_materially_reduce_scope');
  return {valid:failures.length===0,failures,similarity};
}
function boundContextPayload(payload,maxBytes=MAX_PERSISTED_CONTEXT_BYTES){
  const src=asObject(payload);
  const effectiveMaxBytes=Math.max(
    MIN_NODE_CONTEXT_BYTES,
    Math.min(MAX_PERSISTED_CONTEXT_BYTES,Math.floor(Number(maxBytes)||MAX_PERSISTED_CONTEXT_BYTES))
  );
  if(bytes(src)<=effectiveMaxBytes)return src;
  const entries=Object.entries(src);
  const out={};
  const evicted=[];
  const reserve=6000;
  const researchRound=(key)=>{
    const match=String(key).match(/^external_research_round_(\d+)$/);
    return match?Number(match[1]):0;
  };
  const priorityScore=(key)=>{
    if(key==='research_source_catalog')return 10000;
    if(key==='inherited_completed_sibling_results')return 9800;
    if(key==='completed_sibling_results')return 9500;
    if(key.startsWith('external_research'))return 7000+researchRound(key);
    return 0;
  };
  const tryAdd=(key,value)=>{
    const candidate={...out,[key]:value};
    if(bytes(candidate)<=effectiveMaxBytes-reserve){
      out[key]=value;
      return true;
    }
    evicted.push({path:key,bytes:bytes(value)});
    return false;
  };

  // The durable source catalog must degrade structurally, not disappear wholesale.
  // Full receipts remain in agent_web_research_batches; this index preserves exact
  // URLs/source identity across worker restarts.
  if(Array.isArray(src.research_source_catalog)&&src.research_source_catalog.length){
    let catalog=compactResearchCatalogForModel(src.research_source_catalog,'full');
    if(!tryAdd('research_source_catalog',catalog)){
      evicted.pop();
      catalog=compactResearchCatalogForModel(src.research_source_catalog,'minimal');
      if(!tryAdd('research_source_catalog',catalog)){
        evicted.pop();
        catalog=src.research_source_catalog.map(v=>({
          source_id:v?.source_id||null,
          url:v?.url||null,
        }));
        if(!tryAdd('research_source_catalog',catalog)){
          // This should only be reachable at extreme source counts/URL lengths.
          // Preserve a durable pointer rather than pretending no catalog existed.
          evicted.push({
            path:'research_source_catalog',
            bytes:bytes(src.research_source_catalog),
            reason:'durable_context_ceiling_even_after_minimal_compaction',
            source_count:src.research_source_catalog.length,
          });
        }
      }
    }
  }

  const prioritized=entries
    .filter(([key])=>key!=='research_source_catalog'&&priorityScore(key)>0)
    .sort((a,b)=>priorityScore(b[0])-priorityScore(a[0]));
  for(const [key,value] of prioritized)tryAdd(key,value);
  for(let i=entries.length-1;i>=0;i--){
    const [key,value]=entries[i];
    if(key==='research_source_catalog'||priorityScore(key)>0||Object.prototype.hasOwnProperty.call(out,key))continue;
    tryAdd(key,value);
  }
  out._context_evicted=evicted.slice(0,60);
  out._context_budget={
    max_bytes:effectiveMaxBytes,
    policy:'durable_context_independent_of_model_v0_1_compact_catalog_never_wholesale_drop',
    evicted_count:evicted.length,
    research_source_catalog_items:asArray(out.research_source_catalog).length,
  };
  while(bytes(out)>effectiveMaxBytes && out._context_evicted.length){
    out._context_evicted.pop();
  }
  return out;
}

function inheritedChildContext(parentPayload){
  const src=asObject(parentPayload);
  const promoted=mergeInheritedDependencyResults({
    inheritedCompletedSiblingResults:src.inherited_completed_sibling_results,
    completedSiblingResults:src.completed_sibling_results,
  });
  return boundContextPayload(
    promoted.length
      ?{
        inherited_completed_sibling_results:promoted,
        dependency_context_contract:'ancestor_dependency_propagation_v0_3',
      }
      :{}
  );
}

function pathParts(path){
  return String(path||'')
    .replace(/\[([^\]]+)\]/g,'.$1')
    .split('.')
    .map(v=>v.trim())
    .filter(Boolean);
}
function selectorKey(v){
  return String(v??'').toLowerCase().replace(/[^a-z0-9]+/g,'');
}
function arraySelectorMatch(entry,selector){
  if(!entry||typeof entry!=='object')return false;
  const wanted=selectorKey(selector);
  if(!wanted)return false;
  const candidates=[
    entry.source_id,entry.publisher,entry.title,entry.search_title,entry.url,entry.sha256
  ].map(selectorKey).filter(Boolean);
  return candidates.some(value=>value===wanted||value.includes(wanted)||wanted.includes(value));
}
function getPath(root,path){
  const parts=pathParts(path);
  let cur=root;
  for(const part of parts){
    if(cur===null||cur===undefined||typeof cur!=='object')return {found:false,value:null};
    if(Array.isArray(cur)){
      if(/^[0-9]+$/.test(part)){
        const index=Number(part);
        if(index<0||index>=cur.length)return {found:false,value:null};
        cur=cur[index];
        continue;
      }
      const matched=cur.find(entry=>arraySelectorMatch(entry,part));
      if(matched===undefined)return {found:false,value:null};
      cur=matched;
      continue;
    }
    if(!(part in cur))return {found:false,value:null};
    cur=cur[part];
  }
  return {found:true,value:cur};
}

function indexObject(root,prefix='',depth=0,out=[]){
  if(!root||typeof root!=='object'||depth>2)return out;
  if(Array.isArray(root)){
    for(let i=0;i<Math.min(root.length,80)&&out.length<180;i++){
      const path=prefix?prefix+'.'+i:String(i);
      const value=root[i];
      out.push({path,kind:Array.isArray(value)?'array':typeof value,bytes:bytes(value)});
      if(value&&typeof value==='object'&&depth<2)indexObject(value,path,depth+1,out);
    }
    return out;
  }
  for(const key of Object.keys(root).sort()){
    if(out.length>=180)break;
    const path=prefix?prefix+'.'+key:key;
    const value=root[key];
    out.push({path,kind:Array.isArray(value)?'array':typeof value,bytes:bytes(value)});
    if(value&&typeof value==='object'&&depth<2)indexObject(value,path,depth+1,out);
  }
  return out;
}

function qda601AuthenticatorRemediation(packet){
  const qda=asObject(packet?.qda_601_context);
  const state=asObject(packet?.state?.state_payload);
  const required=
    state.qda_601_remediation_required===true
    ||text(state.qda_601_remediation_required).toLowerCase()==='true';
  const reason=text(state.qda_601_remediation_reason);
  const unit=text(state.qda_601_remediation_unit).toUpperCase();
  const nextUnit=text(qda?.next_unit?.unit_code).toUpperCase();
  const reviewId=text(state.qda_601_last_authenticator_review_id);
  const report=asObject(state.qda_601_authenticator_failure_report);
  if(
    !required
    ||reason!=='independent_authenticator_verified_fail'
    ||!unit
    ||unit!==nextUnit
    ||!reviewId
  ) return {active:false};
  return {
    active:true,
    unit_code:unit,
    review_id:reviewId,
    anchor_review_id:text(state.qda_601_remediation_anchor_review_id)||reviewId,
    rejected_file_id:text(state.qda_601_last_rejected_file_id)||null,
    artifact_sha256:text(state.qda_601_authenticator_failure_artifact_sha256)
      ||text(report.artifact_sha256)||null,
    score:Number(state.qda_601_authenticator_failure_score??report.overall_score??0)||null,
    report,
  };
}

function qda601HoldRequirement(packet){
  const qda=asObject(packet?.qda_601_context);
  if(qda.assigned!==true || qda.blocking_stage4!==true) return null;

  const status=text(qda.status);
  const next=asObject(qda.next_unit);
  if(status==='in_progress' && text(next.unit_code)){
    return {
      source_kind:'supplemental_training',
      source_ref:text(next.unit_code),
      requirement:[
        'QDA-601 is the authoritative lifecycle obligation while Stage 4 is suspended.',
        'Complete exactly the current QDA unit; do not perform, revise, select, or materialize Stage-4 expertise viability work.',
        'Current unit: '+text(next.unit_code)+' — '+text(next.title)+'.',
        text(next.learning_goal)?'Learning goal: '+text(next.learning_goal)+'.':'',
        text(next.assignment)?'Assignment: '+text(next.assignment)+'.':'',
        text(next.exercise_pack_ref)?'Exercise pack ref: '+text(next.exercise_pack_ref)+'.':'',
        next.exercise_pack?'AUTHORITATIVE EXERCISE PACK (solve these exact assigned problems; do not invent replacements): '+JSON.stringify(next.exercise_pack):'',
        next.exercise_pack?.external_research===false
          ? 'This exercise pack is self-contained AAU course data. External research is forbidden for this unit. NEED_CONTEXT is not justified by absence of outside sources or alternative problems; all required case inputs are supplied in the exercise pack.'
          : 'If genuinely current external evidence is required by this exercise pack, request bounded research for this same unit and return to it.',
        'Persist the completed work in this cognition as agent_file_output_v0_1 using filename '+text(next.filename)+'.',
        'The artifact must preserve exercise_pack_ref exactly, include problem_responses covering every assigned problem, satisfy qda_601_context.required_submission_fields, and include independent Pass A / Pass B self-audit.',
        'Never fall back to the suspended Stage-4 requirement.'
      ].filter(Boolean).join(' ')
    };
  }

  if(status==='coursework_complete_final_packaging_required'){
    return {
      source_kind:'supplemental_training',
      source_ref:'QDA601_FINAL_SUBMISSION',
      requirement:'QDA-601 coursework units are complete. Package the canonical QDA601_FINAL_SUBMISSION.json required by qda_601_context. Do not return to the suspended Stage-4 expertise requirement before independent QDA verification.'
    };
  }

  if(status==='coursework_complete_pending_independent_verification'){
    return {
      source_kind:'supplemental_training',
      source_ref:'QDA601_INDEPENDENT_VERIFICATION',
      requirement:'QDA-601 coursework is complete and awaiting independent verification. Preserve the completed artifacts and do not resume the suspended Stage-4 expertise requirement until the verifier records a pass.'
    };
  }

  return {
    source_kind:'supplemental_training',
    source_ref:'QDA601',
    requirement:'QDA-601 is the authoritative supplemental-training hold. Follow qda_601_context and do not resume the suspended Stage-4 expertise requirement.'
  };
}

function extractTriggerRequirement(packet){
  // A blocking supplemental-training contract is a lifecycle boundary, not an
  // ordinary stimulus. It must remain authoritative even when an older admin
  // or automatic-intervention message is still present in the packet.
  const qdaRequirement=qda601HoldRequirement(packet);
  if(qdaRequirement) return qdaRequirement;
  const admin=asObject(packet?.admin_chat_context?.current_admin_message);
  if(text(admin.content)){
    return {source_kind:'admin_message',source_ref:text(admin.message_id)||null,requirement:text(admin.content)};
  }
  const item=asObject(packet?.attention_arbiter_context?.current_attention_item);
  const payload=asObject(item.payload);
  const attn=text(payload.message)||text(payload.reason)||text(item.reason);
  if(attn){
    return {source_kind:'attention_item',source_ref:text(item.attention_item_id)||text(item.source_ref)||null,requirement:attn};
  }
  const trigger=asObject(packet?.intent_trigger);
  const intent=text(trigger.intent_reason)||text(trigger.reason);
  if(intent){
    return {source_kind:'agent_intent',source_ref:text(trigger.intent_id)||text(trigger.wake_intent_id)||null,requirement:intent};
  }
  const next=asObject(packet?.next_intent_context);
  if(text(next.intent_reason)){
    return {source_kind:'agent_intent',source_ref:text(next.intent_id)||null,requirement:text(next.intent_reason)};
  }
  const lifecycle=asObject(packet?.mandatory_lifecycle_context);
  if(text(lifecycle.stage_rule)){
    return {source_kind:'lifecycle_requirement',source_ref:text(lifecycle.current_stage)||text(lifecycle.stage)||null,requirement:text(lifecycle.stage_rule)};
  }
  const focus=text(packet?.state?.state_payload?.current_focus)||text(packet?.state?.current_focus);
  if(focus){
    return {source_kind:'agent_focus',source_ref:null,requirement:'Continue the agent-authored current focus: '+focus};
  }
  throw new Error('autonomous_decomposition_requirement_missing');
}

function contextIndex(packet){
  // Shallow index only. The agent recursively narrows oversized branches itself.
  if(!packet||typeof packet!=='object'||Array.isArray(packet))return [];
  return Object.keys(packet).sort().slice(0,80).map(key=>{
    const value=packet[key];
    return {
      path:key,
      kind:Array.isArray(value)?'array':typeof value,
      bytes:bytes(value),
      ...(Array.isArray(value)?{items:value.length}:{}),
      ...(value&&typeof value==='object'&&!Array.isArray(value)?{keys:Object.keys(value).length}:{})
    };
  });
}

function lifecycleStageContract(packet){
  const qda=asObject(packet?.qda_601_context);
  if(qda.assigned===true && qda.blocking_stage4===true){
    return {name:'',definition:null};
  }
  const lifecycle=asObject(packet?.mandatory_lifecycle_context);
  const name=text(lifecycle.stage_contract);
  const definition=asObject(lifecycle.stage_contract_definition);
  if(!name||!Object.keys(definition).length)return {name:'',definition:null};
  return {name,definition};
}

function lifecycleStageContractContext(packet){
  const lifecycle=asObject(packet?.mandatory_lifecycle_context);
  const resolved=lifecycleStageContract(packet);
  const out={};
  const qda=asObject(packet?.qda_601_context);
  if(qda.assigned===true && qda.blocking_stage4===true){
    out.qda_601_context={
      available:true,
      value:qda,
      source:'qda_601_context',
    };
    out.suspended_lifecycle_stage={
      available:true,
      value:{
        current_stage:text(lifecycle.current_stage)||null,
        current_stage_label:text(lifecycle.current_stage_label)||null,
        stage_contract:text(lifecycle.stage_contract)||null,
        suspension_reason:'qda_601_lifecycle_hold',
      },
      source:'mandatory_lifecycle_context',
    };
  }

  if(resolved.name&&resolved.definition){
    out[resolved.name]={
      available:true,
      value:resolved.definition,
      source:'mandatory_lifecycle_context.stage_contract_definition',
    };
  }

  const candidateMode=asObject(lifecycle.expertise_candidate_mode);
  if(Object.keys(candidateMode).length){
    out.expertise_candidate_mode={
      available:true,
      ...candidateMode,
      source:'mandatory_lifecycle_context.expertise_candidate_mode',
    };
  }

  const inheritance=asObject(lifecycle.cumulative_competency_inheritance);
  if(Object.keys(inheritance).length){
    out.cumulative_competency_inheritance={
      available:true,
      value:inheritance,
      source:'mandatory_lifecycle_context.cumulative_competency_inheritance',
    };

    const verifiedPrior=asObject(inheritance.verified_prior_learning);
    const masters=asObject(verifiedPrior.entrepreneurship_masters);
    if(Object.keys(masters).length){
      const courses=asArray(masters.courses).map(raw=>{
        const course=asObject(raw);
        return {
          course_code:text(course.course_code)||null,
          title:text(course.title)||null,
          category:text(course.category)||null,
          learning_objectives:asArray(course.learning_objectives).map(text).filter(Boolean),
        };
      });
      const verifiedCompetencies=courses.flatMap(course=>
        course.learning_objectives.map(objective=>({
          source_stage:'entrepreneurship_masters',
          course_code:course.course_code,
          course_title:course.title,
          category:course.category,
          competency:objective,
        }))
      );
      const capstone=asObject(masters.capstone);
      const verificationReport=asObject(masters.verification_report);
      const competencyLedger={
        contract:'verified_prior_learning_competency_ledger_v0_1',
        source_stage:'entrepreneurship_masters',
        status:text(masters.status)||null,
        course_count:courses.length,
        courses,
        verified_competencies:verifiedCompetencies,
        capstone:{
          status:text(capstone.status)||null,
          capstone_id:capstone.capstone_id||null,
          verified_transfer_principles:asArray(capstone.verified_transfer_principles).map(text).filter(Boolean),
        },
        verification:{
          certification_kind:verificationReport.certification_kind||null,
          operator_certification_override:Boolean(verificationReport.operator_certification_override),
          overall_score:Number(verificationReport.overall_score||0)||null,
          core_curriculum_passed:Boolean(verificationReport.core_curriculum_passed),
          capstone_passed:Boolean(verificationReport.capstone_passed),
          entrepreneurship_specialization_passed:Boolean(
            verificationReport.entrepreneurship_specialization_passed
          ),
          historical_integrity_status:verificationReport.historical_integrity_status||null,
          historical_integrity_hold_preserved:Boolean(
            verificationReport.historical_integrity_hold_preserved
          ),
        },
      };

      // Stable aliases make the verified prior-learning record directly
      // addressable by cognition/context requests. These are views of the
      // authoritative lifecycle packet, not synthetic competencies.
      out.entrepreneurship_masters={
        available:text(masters.status)==='verified_pass',
        status:text(masters.status)||null,
        verified_competencies_ledger:competencyLedger,
        courses,
        capstone:competencyLedger.capstone,
        verification:competencyLedger.verification,
        source:'mandatory_lifecycle_context.cumulative_competency_inheritance.verified_prior_learning.entrepreneurship_masters',
      };
      out.agent={
        competency_verification_records:{
          available:text(masters.status)==='verified_pass',
          source_stage:'entrepreneurship_masters',
          status:text(masters.status)||null,
          verified_competencies:verifiedCompetencies,
          capstone_transfer_principles:competencyLedger.capstone.verified_transfer_principles,
          verification:competencyLedger.verification,
          source:'mandatory_lifecycle_context.cumulative_competency_inheritance.verified_prior_learning.entrepreneurship_masters',
        },
      };
    }
  }

  return out;
}

const TERMINAL_SYNTHESIS_OWNERSHIP_VERSION='runtime_owned_terminal_synthesis_v0_2';
const STAGE_CONTRACT_MATERIALIZATION_VERSION='stage_contract_materialize_v0_1';

function stageContractForRequirement(packet,requirement,nodePath=null){
  const resolved=lifecycleStageContract(packet);
  if(!resolved.name||!resolved.definition)
    return {applies:false,name:'',definition:null,ownership_scope:null};
  const req=normalizedRequirement(requirement);
  const name=normalizedRequirement(resolved.name);
  const mentions=Boolean(req&&name&&req.includes(name));

  // Candidate-mode Stage 4 uses a coordinator root that references the proposal
  // contract as protocol. Only individual top-level candidate nodes own one
  // expertise_viability_proposal_v0_1 artifact.
  const candidateOwned=
    resolved.name==='expertise_viability_proposal_v0_1'
      ? /^R[.]\d{3}$/.test(text(nodePath))
      : true;

  const applies=
    resolved.name==='expertise_viability_proposal_v0_1'
      ? candidateOwned
      : Boolean(mentions&&candidateOwned);

  return {
    applies,
    name:resolved.name,
    definition:resolved.definition,
    ownership_scope:
      resolved.name==='expertise_viability_proposal_v0_1'
        ? 'top_level_candidate_node_by_lifecycle_position'
        : 'requirement_mentions_contract',
  };
}

export function runtimeOwnedTerminalSynthesisChild(candidate){
  const requirement=normalizedRequirement(candidate?.requirement);
  if(!requirement)return false;
  // Terminal synthesis is a runtime phase. A decomposition child may gather or
  // validate evidence, but it must not exist solely to format/merge/submit it.
  //
  // "Reconcile" is overloaded. Reconciliation of source values, definitions,
  // evidence, units, periods, or contradictions is substantive semantic work.
  // Only reconciliation of already-resolved child outputs into a final
  // deliverable is runtime-owned terminal synthesis.
  if(/^reconcile\b/.test(requirement)){
    const resolvedChildInputs=
      /\b(completed|resolved|verified)\b.*\b(child|children|sibling|result|results|artifact|artifacts)\b/.test(requirement)
      ||/\b(child|children|sibling|result|results|artifact|artifacts)\b.*\b(completed|resolved|verified)\b/.test(requirement);
    const finalDeliverable=
      /\b(final|terminal|submission|submit|format|synthesi[sz]e|merge|assemble)\b/.test(requirement);
    return resolvedChildInputs&&finalDeliverable;
  }
  return /^(synthesize|synthesise|format|submit|compile|merge|assemble|convert)\b/.test(requirement);
}

function validateStageContractArtifact(contractDefinition,artifactText){
  const definition=asObject(contractDefinition);
  let artifact=null;
  try{artifact=JSON.parse(text(artifactText));}catch{return {valid:false,issues:['artifact_not_valid_json_object']};}
  if(!artifact||typeof artifact!=='object'||Array.isArray(artifact))
    return {valid:false,issues:['artifact_not_json_object']};

  const issues=[];
  const required=asArray(definition.required_fields).map(text).filter(Boolean);
  const fieldContract=asObject(definition.field_contract);
  for(const field of required){
    const value=artifact[field];
    if(value===undefined||value===null||value==='')
      issues.push('missing_required_field:'+field);
    const spec=fieldContract[field];
    if(typeof spec==='string'){
      const lower=spec.toLowerCase();
      if(lower.includes('nonempty string')&&text(value).length<1)
        issues.push('nonempty_string_required:'+field);
      if(lower.includes('nonempty array')&&(!Array.isArray(value)||!value.length))
        issues.push('nonempty_array_required:'+field);
      const minMatch=lower.match(/at least\s+(\d+)\s+characters/);
      if(minMatch&&text(value).length<Number(minMatch[1]))
        issues.push('minimum_length_'+minMatch[1]+':'+field);
    }else if(spec&&typeof spec==='object'){
      if(!value||typeof value!=='object'||Array.isArray(value)){
        issues.push('object_required:'+field);
        continue;
      }
      const nestedRequired=[...new Set([
        ...asArray(spec.required),
        ...asArray(spec.required_fields),
      ].map(text).filter(Boolean))];
      for(const sub of nestedRequired){
        const subValue=value[sub];
        if(subValue===undefined||subValue===null||subValue==='')
          issues.push('missing_required_field:'+field+'.'+sub);
        if(sub==='risks'&&(!Array.isArray(subValue)||!subValue.length))
          issues.push('nonempty_array_required:'+field+'.'+sub);
      }

      if(text(spec.required_source_stage)){
        const stages=asArray(value.source_stages).map(text).filter(Boolean);
        if(!stages.includes(text(spec.required_source_stage)))
          issues.push(
            'required_source_stage:'+field+'.'+text(spec.required_source_stage)
          );
      }

      const masteryDimensions=
        asArray(spec.entrepreneurship_mastery_application_required_dimensions)
          .map(text).filter(Boolean);
      if(masteryDimensions.length){
        const mastery=asObject(value.entrepreneurship_mastery_application);
        for(const dimension of masteryDimensions){
          const dimensionValue=mastery[dimension];
          if(
            dimensionValue===undefined
            ||dimensionValue===null
            ||(
              typeof dimensionValue==='string'
              &&text(dimensionValue).length<20
            )
          ) issues.push(
            'missing_required_field:'
            +field+'.entrepreneurship_mastery_application.'+dimension
          );
        }
      }

      if(field==='prior_learning_application'){
        if(asArray(value.competencies_applied).length<6)
          issues.push('prior_learning_application.competencies_applied:min_6_for_stage4');
        if(asArray(value.application_map).length<6)
          issues.push('prior_learning_application.application_map:min_6_for_stage4');
      }
    }
  }
  return {valid:issues.length===0,issues,artifact};
}

function resolveContext(packet,requests,localContext={}){
  const out={};
  const lifecycleContract=lifecycleStageContract(packet);
  for(const raw of asArray(requests).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND)){
    const path=text(raw);
    if(!path||Object.prototype.hasOwnProperty.call(out,path))continue;
    const localHit=getPath(localContext,path);
    let packetHit=localHit.found?localHit:getPath(packet,path);
    if(!packetHit.found&&lifecycleContract.name===path&&lifecycleContract.definition){
      packetHit={found:true,value:lifecycleContract.definition};
    }
    const hit=packetHit;
    if(!hit.found){
      out[path]={available:false};
      continue;
    }
    if(bytes(hit.value)>MAX_CONTEXT_VALUE_BYTES){
      let childIndex=[];
      if(Array.isArray(hit.value)){
        childIndex=hit.value.slice(0,80).map((v,i)=>({
          path:path+'.'+i,bytes:bytes(v),kind:Array.isArray(v)?'array':typeof v,
          ...(v&&typeof v==='object'&&v.source_id?{source_id:v.source_id,title:v.title||null,url:v.url||null}:{}),
        }));
      }else if(hit.value&&typeof hit.value==='object'){
        childIndex=Object.keys(hit.value).slice(0,120).map(k=>({
          path:path+'.'+k,bytes:bytes(hit.value[k]),kind:Array.isArray(hit.value[k])?'array':typeof hit.value[k]
        }));
      }
      out[path]={available:true,too_large:true,bytes:bytes(hit.value),children:childIndex};
      continue;
    }
    out[path]={available:true,value:hit.value};
  }
  return out;
}

function parentPathOf(nodePath){
  const i=String(nodePath||'').lastIndexOf('.');
  return i<0?null:String(nodePath).slice(0,i);
}

function resultParts(raw){
  if(!raw)return {artifact:'',handoff:{}};
  try{
    const parsed=JSON.parse(raw);
    return {
      artifact:artifactText(parsed.artifact)||artifactText(parsed.summary)||String(raw),
      handoff:asObject(parsed.handoff),
    };
  }catch{
    return {artifact:String(raw),handoff:{}};
  }
}

function compactCompletedSiblingResults(rows){
  return asArray(rows).slice(-6).map(row=>{
    const parts=resultParts(row?.result_artifact);
    return {
      path:row?.node_path||null,
      status:row?.node_status||row?.status||null,
      decision_type:row?.decision_type||null,
      requirement:clip(row?.requirement_text,700),
      artifact:clip(parts.artifact,3500),
      handoff_json:clip(safeJson(parts.handoff),1800),
      result_hash:row?.result_hash||null,
    };
  });
}
function authoritativeSiblingEvidence(contextPayload){
  const src=asObject(contextPayload);
  const merged=[
    ...asArray(src.inherited_completed_sibling_results).map(row=>({row,scope:'ancestor_dependency'})),
    ...asArray(src.completed_sibling_results).map(row=>({row,scope:'direct_sibling'})),
  ];
  const out=[];
  const byKey=new Map();
  for(const entry of merged){
    const row=asObject(entry.row);
    const key=text(row.path)||text(row.result_hash)||safeJson(row).slice(0,240);
    if(!key)continue;
    const normalized={
      path:row.path||null,
      status:row.status||null,
      decision_type:row.decision_type||null,
      requirement:clip(row.requirement,900),
      artifact:clip(row.artifact,5000),
      handoff_json:clip(row.handoff_json,2400),
      result_hash:row.result_hash||null,
      evidence_scope:entry.scope,
    };
    if(byKey.has(key)){
      out[byKey.get(key)]={...out[byKey.get(key)],...normalized};
      continue;
    }
    byKey.set(key,out.length);
    out.push(normalized);
  }
  if(out.length<=24)return out;
  const selected=[...out.slice(0,10),...out.slice(-14)];
  const bounded=[];
  const seen=new Set();
  for(const row of selected){
    const key=text(row.path)||text(row.result_hash)||safeJson(row).slice(0,240);
    if(!key||seen.has(key))continue;
    seen.add(key);
    bounded.push(row);
  }
  return bounded.slice(0,24);
}
function siblingEvidencePaths(rows){
  return asArray(rows)
    .filter(v=>text(v?.evidence_scope)!=='ancestor_dependency')
    .map(v=>text(v?.path))
    .filter(Boolean);
}
function compactRemediationEpisodes(rows){
  return asArray(rows).slice(-MAX_SELF_REMEDIATION_ATTEMPTS).map(raw=>{
    const row=asObject(raw);
    return {
      remediation_id:row.remediation_id||null,
      attempt_no:Number(row.attempt_no||0),
      status:row.status||null,
      observed_anomaly:clip(row.observed_anomaly,900),
      diagnosis:clip(row.diagnosis,1100),
      repair_type:row.repair_type||null,
      verification_criterion:clip(row.verification_criterion,900),
      verification_result:asObject(row.verification_result),
    };
  });
}
function remediationStateSnapshot(node,contextPayload,pinnedEvidence,siblingEvidence){
  const payload=asObject(node?.decision_payload);
  const discovery=asObject(payload.routing_discovery_checkpoint);
  return {
    node_status:node?.node_status||null,
    decision_type:node?.decision_type||null,
    requirement_hash:node?.requirement_hash||null,
    discovery:{
      decision:text(discovery.decision)||null,
      reason:clip(discovery.reason,1200)||null,
      context_fingerprint:text(discovery.context_fingerprint)||null,
      unresolved_gaps:asArray(discovery.unresolved_gaps).map(v=>clip(text(v),500)).slice(0,12),
    },
    synthesis:{
      cursor:Number(payload.synthesis_cursor||0),
      accumulator_present:Object.keys(asObject(payload.synthesis_accumulator)).length>0,
      accumulator_bytes:bytes(payload.synthesis_accumulator),
      child_result_hashes:asArray(payload.synthesis_child_result_hashes).slice(0,24),
      provenance_pending:asObject(payload.synthesis_provenance_pending),
      provenance_review:asObject(payload.synthesis_provenance_review),
      failure:asObject(payload.synthesis_failure),
      remediation_nonce:text(payload.synthesis_remediation_nonce)||null,
    },
    context_resource_state:asObject(payload.context_resource_state),
    sibling_results:asArray(siblingEvidence).map(v=>({
      path:v.path||null,status:v.status||null,decision_type:v.decision_type||null,result_hash:v.result_hash||null
    })),
    pinned_evidence:asArray(pinnedEvidence).map(v=>({
      source_key:v.source_key||null,source_id:v.source_id||null,sha256:v.sha256||null,excerpt_bytes:v.excerpt_bytes||0
    })),
    context_evicted:asArray(contextPayload?._context_evicted).slice(0,16),
  };
}

function agentDiscoveryState(node){
  const payload=asObject(node?.decision_payload);
  return {
    authored_reason:text(payload.authored_reason)||null,
    scope_removed:text(payload.scope_removed)||null,
    completion_criterion:text(payload.completion_criterion)||null,
    prior_decision_reason:text(payload.reason)||null,
    source_kind:node?.source_kind||null,
    source_ref:node?.source_ref??null,
  };
}

export async function runAutonomousRequirementCognition({
  model,packet,modeInfo,agentId,intentExecutionId,
  rpc,sha256,completeJson,completeRouteJson=null,completeSerializeJson=null,researchContext=null,
}){
  const agentRuntimeContract=resolveModelRuntimeContract(model,'agent');
  const operationalOutputCeiling=Math.max(
    1,
    Math.min(
      Number(agentRuntimeContract.max_output_tokens)||8192,
      Number(agentRuntimeContract.operational_output_limit_tokens)
        ||Number(agentRuntimeContract.max_output_tokens)
        ||8192
    )
  );
  const stageOutputTokens=(requested)=>Math.max(
    1,
    Math.min(Math.floor(Number(requested)||1),operationalOutputCeiling)
  );
  const stageBudgets=Object.freeze({
    child_formulation:stageOutputTokens(CHILD_FORMULATION_DEEP_TOKENS),
    child_provenance_review:stageOutputTokens(CHILD_PROVENANCE_REVIEW_DEEP_TOKENS),
    atomic_execution:stageOutputTokens(ATOMIC_EXECUTION_DEEP_TOKENS),
    atomic_reconciliation:stageOutputTokens(ATOMIC_RECONCILIATION_DEEP_TOKENS),
    synthesis_merge:stageOutputTokens(SYNTHESIS_MERGE_DEEP_TOKENS),
    synthesis_final:stageOutputTokens(SYNTHESIS_FINAL_DEEP_TOKENS),
    synthesis_provenance_review:stageOutputTokens(SYNTHESIS_PROVENANCE_REVIEW_DEEP_TOKENS),
  });
  const rootReq=extractTriggerRequirement(packet);
  const qda=asObject(packet?.qda_601_context);
  const statePayload=asObject(packet?.state?.state_payload);
  const assignmentKey='req:'+sha256({
    agent_id:agentId,
    source_kind:rootReq.source_kind,
    source_ref:rootReq.source_ref,
    requirement:rootReq.requirement,
    // Remediation is a material change of assignment identity. This prevents
    // a previously completed later-unit tree from being reused after an
    // independent verifier rolls the authoritative cursor back.
    qda_context:qda.assigned===true?{
      status:text(qda.status)||null,
      next_unit:text(qda?.next_unit?.unit_code)||null,
      exercise_pack_ref:text(qda?.next_unit?.exercise_pack_ref)||null,
      remediation_required:statePayload.qda_601_remediation_required===true
        ||text(statePayload.qda_601_remediation_required).toLowerCase()==='true',
      remediation_unit:text(statePayload.qda_601_remediation_unit)||null,
      // Keep one semantic tree for the entire remediation cycle. The latest
      // review remains evidence inside the tree, but does not create a new tree.
      remediation_review_id:(
        statePayload.qda_601_remediation_required===true
        ||text(statePayload.qda_601_remediation_required).toLowerCase()==='true'
      )
        ?(
          text(statePayload.qda_601_remediation_anchor_review_id)
          ||text(statePayload.qda_601_last_authenticator_review_id)
          ||null
        )
        :(text(statePayload.qda_601_last_verified_review_id)||null),
    }:null,
  }).slice(0,48);
  const idx=contextIndex(packet);
  const counters={nodes:0,model_calls:0,context_requests:0};
  const semanticRuntime={...semanticRuntimeConfig(agentRuntimeContract)};

  async function semanticRuntimeRpc(action,args={}){
    return rpc('aau_bridge_cognition_assignment_runtime_v0_2',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_model:model,
      p_action:action,
      p_epoch_no:semanticRuntime.epoch_no,
      p_initial_budget_units:args.initialBudgetUnits??null,
      p_quantum_tokens:semanticRuntime.quantum_tokens,
      p_event_key:args.eventKey??null,
      p_event_kind:args.eventKind??null,
      p_event_fingerprint:args.eventFingerprint??null,
      p_cost_units:args.costUnits??0,
      p_node_path:args.nodePath??null,
      p_metadata:args.metadata??{},
    });
  }

  let semanticRuntimeSnapshot=await semanticRuntimeRpc('resolve');
  if(semanticRuntimeSnapshot?.status!=='ready')
    throw new Error('semantic_runtime_resolution_failed');
  if(semanticRuntimeSnapshot?.runtime_found===true){
    const resolvedEpoch=Number(semanticRuntimeSnapshot?.epoch_no);
    if(!Number.isInteger(resolvedEpoch)||resolvedEpoch<1)
      throw new Error('semantic_runtime_resolved_epoch_invalid');
    semanticRuntime.epoch_no=resolvedEpoch;
  }else{
    semanticRuntimeSnapshot=await semanticRuntimeRpc('init',{
      initialBudgetUnits:semanticRuntime.initial_budget_units,
      metadata:{
        contract:SEMANTIC_RUNTIME_CONTRACT,
        initial_budget_tokens:semanticRuntime.initial_budget_tokens,
        budget_quantum_tokens:semanticRuntime.quantum_tokens,
        budget_derivation:'model_operational_context_x8_or_explicit_override',
        model_operational_context_limit_tokens:
          agentRuntimeContract.operational_context_limit_tokens||null,
        source_wake_request_id:intentExecutionId,
      },
    });
    if(semanticRuntimeSnapshot?.status!=='ready')
      throw new Error('semantic_runtime_initialization_failed');
  }
  const externalAuthenticatorRemediation=qda601AuthenticatorRemediation(packet);
  if(
    String(semanticRuntimeSnapshot?.runtime_status||'')==='complete'
    &&externalAuthenticatorRemediation.active
  ){
    const reopened=await rpc(
      'aau_bridge_reopen_qda_assignment_for_auth_review_v0_1',
      {
        p_agent_id:agentId,
        p_wake_request_id:intentExecutionId,
        p_assignment_key:assignmentKey,
        p_model:model,
        p_review_id:externalAuthenticatorRemediation.review_id,
        p_unit_code:externalAuthenticatorRemediation.unit_code,
      }
    );
    if(reopened?.status!=='ready'||String(reopened?.runtime_status||'')!=='active')
      throw new Error('qda_authenticator_remediation_runtime_reopen_failed');
    semanticRuntime.epoch_no=Number(reopened.epoch_no);
    semanticRuntimeSnapshot={
      ...semanticRuntimeSnapshot,
      ...reopened,
      runtime_found:true,
      runtime_status:'active',
    };
    console.log('AAU_QDA_AUTHENTICATOR_REMEDIATION_RUNTIME_REOPENED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      assignment_key:assignmentKey,
      epoch_no:semanticRuntime.epoch_no,
      review_id:externalAuthenticatorRemediation.review_id,
      unit_code:externalAuthenticatorRemediation.unit_code,
    }));
  }
  if(String(semanticRuntimeSnapshot?.runtime_status||'')==='budget_exhausted'){
    const error=new Error('semantic_runtime_terminal:budget_exhausted:'+assignmentKey);
    error.code='SEMANTIC_BUDGET_EXHAUSTED';
    error.semanticRuntime=semanticRuntimeSnapshot;
    throw error;
  }

  async function reopenCompletedRuntimeForDeterministicRevalidation(nodePath){
    if(String(semanticRuntimeSnapshot?.runtime_status||'')==='active')return semanticRuntimeSnapshot;
    if(String(semanticRuntimeSnapshot?.runtime_status||'')!=='complete'){
      throw new Error(
        'deterministic_revalidation_runtime_not_reopenable:'
        +String(semanticRuntimeSnapshot?.runtime_status||'unknown')
      );
    }
    const reopened=await rpc(
      'aau_bridge_reopen_completed_cognition_for_deterministic_revalidation_v0_1',
      {
        p_agent_id:agentId,
        p_wake_request_id:intentExecutionId,
        p_assignment_key:assignmentKey,
        p_model:model,
        p_node_path:nodePath,
      }
    );
    if(reopened?.status!=='ready'||String(reopened?.runtime_status||'')!=='active'){
      throw new Error('deterministic_revalidation_runtime_reopen_failed');
    }
    semanticRuntime.epoch_no=Number(reopened.epoch_no);
    semanticRuntimeSnapshot={
      ...semanticRuntimeSnapshot,
      ...reopened,
      runtime_found:true,
      runtime_status:'active',
    };
    console.log('AAU_DETERMINISTIC_REVALIDATION_RUNTIME_REOPENED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      assignment_key:assignmentKey,
      node_path:nodePath,
      epoch_no:semanticRuntime.epoch_no,
      carried_forward_remaining_budget_units:Number(reopened.remaining_budget_units||0),
      compute_grant_units:Number(reopened.compute_grant_units||0),
    }));
    return semanticRuntimeSnapshot;
  }

  async function semanticRuntimeView(){
    const row=await semanticRuntimeRpc('get');
    if(row?.status!=='ready')throw new Error('semantic_runtime_state_unavailable');
    semanticRuntimeSnapshot=row;
    return row;
  }

  async function closeSemanticRuntime(status,metadata={}){
    const row=await semanticRuntimeRpc('close',{
      metadata:{status,...metadata},
    });
    if(row?.status!=='ready')throw new Error('semantic_runtime_close_failed');
    semanticRuntimeSnapshot=row;
    return row;
  }

  async function chargeSemanticRuntime({
    eventKind,materialKey,nodePath=null,costUnits,eventFingerprint=null,metadata={}
  }){
    const eventKey=eventKind+':'+sha256({
      assignment_key:assignmentKey,
      epoch_no:semanticRuntime.epoch_no,
      event_kind:eventKind,
      material_key:String(materialKey||''),
    }).slice(0,64);
    const fingerprint=eventFingerprint||sha256({
      assignment_key:assignmentKey,
      epoch_no:semanticRuntime.epoch_no,
      event_kind:eventKind,
      node_path:nodePath,
      material_key:String(materialKey||''),
      metadata,
    });
    const row=await semanticRuntimeRpc('charge',{
      eventKey,eventKind,eventFingerprint:fingerprint,
      costUnits:Math.max(1,Math.floor(Number(costUnits)||1)),
      nodePath,metadata,
    });
    if(row?.status!=='ready')throw new Error('semantic_runtime_charge_failed');
    semanticRuntimeSnapshot=row;
    if(row.available!==true){
      const error=new Error(
        'semantic_runtime_budget_exhausted:'
        +(nodePath||'assignment')
        +':remaining='+String(row.remaining_budget_units??0)
      );
      error.code='SEMANTIC_BUDGET_EXHAUSTED';
      error.semanticRuntime=row;
      error.semanticEvent={eventKind,materialKey,nodePath};
      throw error;
    }
    return row;
  }

  function agentModelContextView(rawPayload,pinnedEvidence,outputTokens){
    const safeInputTokens=modelInputBudgetTokens(agentRuntimeContract,outputTokens);
    const fixedReserveTokens=Math.max(2500,Math.min(16000,Math.floor(safeInputTokens*0.18)));
    const rawSibling=authoritativeSiblingEvidence(rawPayload);
    const siblingBudget=Math.max(700,Math.floor(safeInputTokens*0.12));
    const pinnedBudget=Math.max(700,Math.floor(safeInputTokens*0.22));
    const siblingEvidence=compactSiblingEvidenceForModel(
      rawSibling,siblingBudget,agentRuntimeContract
    );
    const pinned=compactPinnedEvidenceForModel(
      pinnedEvidence,pinnedBudget,agentRuntimeContract
    );
    const usedByEvidence=
      estimatedTokens(siblingEvidence,agentRuntimeContract)
      +estimatedTokens(pinned,agentRuntimeContract);
    const contextBudget=Math.max(
      1000,
      safeInputTokens-fixedReserveTokens-usedByEvidence
    );
    const bounded=boundContextForModel(
      withoutDuplicatedSiblingContext(rawPayload),
      contextBudget,
      agentRuntimeContract
    );
    const suppliedContext={
      ...bounded,
      ...(pinned.length?{pinned_research_evidence:pinned}:{}),
    };
    return {
      suppliedContext,
      siblingEvidence,
      safeInputTokens,
      fixedReserveTokens,
      contextBudget,
      estimatedSuppliedTokens:estimatedTokens(suppliedContext,agentRuntimeContract),
      estimatedSiblingTokens:estimatedTokens(siblingEvidence,agentRuntimeContract),
      estimatedPinnedTokens:estimatedTokens(pinned,agentRuntimeContract),
    };
  }

  function boundInMemoryContext(rawPayload,pinnedEvidence,outputTokens){
    const view=agentModelContextView(rawPayload,pinnedEvidence,outputTokens);
    return boundContextForModel(
      rawPayload,
      Math.max(1000,view.contextBudget+view.estimatedSiblingTokens),
      agentRuntimeContract
    );
  }

  function projectedModelCallEconomics(rawPayload,pinnedEvidence,outputTokens){
    const view=agentModelContextView(rawPayload,pinnedEvidence,outputTokens);
    const estimatedInputTokens=Math.max(
      1,
      Math.min(
        view.safeInputTokens,
        view.fixedReserveTokens
          +view.estimatedSuppliedTokens
          +view.estimatedSiblingTokens
      )
    );
    return Object.freeze({
      estimated_input_tokens:estimatedInputTokens,
      requested_output_tokens:outputTokens,
      cost_units:modelCallCostUnits({
        estimatedInputTokens,
        requestedOutputTokens:outputTokens,
        quantumTokens:semanticRuntime.quantum_tokens,
      }),
    });
  }

  function projectedBranchEconomics(rawPayload,pinnedEvidence){
    const childFormulation=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,stageBudgets.child_formulation
    );
    const childProvenance=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,stageBudgets.child_provenance_review
    );
    const childDiscovery=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,10000
    );
    const childResolution=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,stageBudgets.atomic_execution
    );
    const terminalReconciliation=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,stageBudgets.atomic_reconciliation
    );
    const terminalSynthesis=projectedModelCallEconomics(
      rawPayload,pinnedEvidence,stageBudgets.synthesis_final
    );
    const childSerializationUnits=modelCallCostUnits({
      estimatedInputTokens:2500,
      requestedOutputTokens:700,
      quantumTokens:semanticRuntime.quantum_tokens,
    });
    const budget=semanticBranchBudget({
      nodeCreateUnits:semanticRuntime.node_create_units,
      childFormulationUnits:childFormulation.cost_units,
      childProvenanceUnits:childProvenance.cost_units,
      childSerializationUnits,
      childDiscoveryUnits:childDiscovery.cost_units,
      childResolutionUnits:childResolution.cost_units,
      childTransitionUnits:3,
      terminalReconciliationUnits:terminalReconciliation.cost_units,
      terminalSynthesisUnits:terminalSynthesis.cost_units,
      safetyReserveUnits:semanticRuntime.safety_reserve_units,
    });
    return Object.freeze({
      ...budget,
      projected_calls:Object.freeze({
        child_formulation:childFormulation,
        child_provenance:childProvenance,
        child_discovery:childDiscovery,
        child_resolution:childResolution,
        terminal_reconciliation:terminalReconciliation,
        terminal_synthesis:terminalSynthesis,
        child_serialization:Object.freeze({
          estimated_input_tokens:2500,
          requested_output_tokens:700,
          cost_units:childSerializationUnits,
        }),
      }),
    });
  }

  function projectedEvidenceRoundEconomics(rawPayload,pinnedEvidence,branchEconomics){
    const discovery=projectedModelCallEconomics(rawPayload,pinnedEvidence,10000);
    const contextPlan=projectedModelCallEconomics(rawPayload,pinnedEvidence,2500);
    const routingSerializationUnits=modelCallCostUnits({
      estimatedInputTokens:2500,
      requestedOutputTokens:700,
      quantumTokens:semanticRuntime.quantum_tokens,
    });
    const projectedRoundUnits=
      semanticRuntime.context_acquire_units
      +discovery.cost_units
      +contextPlan.cost_units
      +routingSerializationUnits
      +3; // context transition + routing transition + checkpoint transition
    const completionReserveUnits=Math.max(
      semanticRuntime.safety_reserve_units,
      Number(branchEconomics?.completion_reserve_units||0)
    );
    return Object.freeze({
      contract:'autonomous_evidence_round_economics_v0_1',
      projected_round_units:projectedRoundUnits,
      completion_reserve_units:completionReserveUnits,
      discovery_units:discovery.cost_units,
      context_plan_units:contextPlan.cost_units,
      routing_serialization_units:routingSerializationUnits,
      context_acquisition_units:semanticRuntime.context_acquire_units,
      transition_units:3,
    });
  }

  async function loadExpertiseCandidateLedger(){
    const row=await rpc('aau_bridge_expertise_candidate_ledger_v0_1',{
      p_agent_id:agentId,
    });
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_candidate_ledger_lookup_failed');
    return row;
  }

  function expertiseCandidateLedgerContext(row){
    const ledger=asObject(row);
    if(text(ledger.candidate_mode)!=='four_viability_proposals_v0_1')return {};
    return {
      expertise_candidate_ledger:{
        available:true,
        source:'canonical_expertise_economic_proposals_current_cohort',
        value:{
          contract:text(ledger.contract)||'expertise_candidate_ledger_v0_1',
          candidate_mode:text(ledger.candidate_mode),
          candidate_cohort:Number(ledger.candidate_cohort||1),
          target_count:Number(ledger.target_count||4),
          submitted_count:Number(ledger.submitted_count||0),
          candidates:asArray(ledger.candidates).map(v=>({
            proposal_id:v?.proposal_id||null,
            domain:text(v?.domain)||null,
            status:text(v?.status)||null,
            candidate_ordinal:Number(v?.candidate_ordinal||0)||null,
            candidate_cohort:Number(v?.candidate_cohort||ledger.candidate_cohort||1),
            source_wake_request_id:v?.source_wake_request_id||null,
            created_at:v?.created_at||null,
          })),
        },
      },
    };
  }

  async function nodeRpc(action,args={}){
    const base={
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_node_path:args.nodePath||'R',
      p_model:model,
      p_action:action,
      p_parent_path:args.parentPath??null,
      p_ordinal:args.ordinal??0,
      p_requirement_text:args.requirement??null,
      p_source_kind:args.sourceKind??'requirement',
      p_source_ref:args.sourceRef??null,
      p_status:args.status??null,
      p_decision_type:args.decisionType??null,
      p_decision_payload:args.decisionPayload??{},
      p_result_artifact:args.resultArtifact??null,
    };
    const bridgeAndJsonReserve=8192;
    const nonContextBytes=bytes({p_bridge_token:'x'.repeat(256),...base,p_context_payload:{}});
    let contextAllowance=Math.max(
      MIN_NODE_CONTEXT_BYTES,
      Math.min(MAX_PERSISTED_CONTEXT_BYTES,MAX_NODE_RPC_BODY_BYTES-nonContextBytes-bridgeAndJsonReserve)
    );
    let boundedContext=boundContextPayload(args.contextPayload??{},contextAllowance);
    let envelope={...base,p_context_payload:boundedContext};
    let envelopeBytes=bytes({p_bridge_token:'x'.repeat(256),...envelope});
    if(envelopeBytes>MAX_NODE_RPC_BODY_BYTES){
      const excess=envelopeBytes-MAX_NODE_RPC_BODY_BYTES;
      contextAllowance=Math.max(
        MIN_NODE_CONTEXT_BYTES,
        contextAllowance-excess-bridgeAndJsonReserve
      );
      boundedContext=boundContextPayload(args.contextPayload??{},contextAllowance);
      envelope={...base,p_context_payload:boundedContext};
      envelopeBytes=bytes({p_bridge_token:'x'.repeat(256),...envelope});
    }
    if(envelopeBytes>MAX_NODE_RPC_BODY_BYTES){
      const error=new Error(
        'autonomous_decomposition_node_rpc_envelope_exceeded:'
        +(args.nodePath||'R')
        +':bytes='+envelopeBytes
        +':limit='+MAX_NODE_RPC_BODY_BYTES
      );
      error.code='COGNITION_NODE_RPC_ENVELOPE_EXCEEDED';
      error.envelopeBytes=envelopeBytes;
      error.maxEnvelopeBytes=MAX_NODE_RPC_BODY_BYTES;
      throw error;
    }
    if(bytes(asObject(args.contextPayload))>bytes(boundedContext)){
      console.log('AAU_AUTONOMOUS_NODE_CONTEXT_ENVELOPE_COMPACTED',JSON.stringify({
        node_path:args.nodePath||'R',
        action,
        original_context_bytes:bytes(asObject(args.contextPayload)),
        persisted_context_bytes:bytes(boundedContext),
        non_context_bytes:nonContextBytes,
        envelope_bytes:envelopeBytes,
        envelope_limit_bytes:MAX_NODE_RPC_BODY_BYTES,
      }));
    }
    return rpc('aau_bridge_cognition_requirement_node_v0_1',envelope);
  }

  async function saveNode(args){
    const transitionFingerprint=sha256({
      node_path:args.nodePath||'R',
      parent_path:args.parentPath??null,
      ordinal:args.ordinal??0,
      requirement:args.requirement??null,
      source_kind:args.sourceKind??'requirement',
      source_ref:args.sourceRef??null,
      status:args.status??null,
      decision_type:args.decisionType??null,
      decision_payload:args.decisionPayload??{},
      context_payload_hash:sha256(args.contextPayload??{}),
      result_artifact_hash:args.resultArtifact==null?null:sha256(String(args.resultArtifact)),
    });
    await chargeSemanticRuntime({
      eventKind:'semantic_transition',
      materialKey:(args.nodePath||'R')+':'+transitionFingerprint,
      nodePath:args.nodePath||'R',
      costUnits:1,
      eventFingerprint:transitionFingerprint,
      metadata:{
        status:args.status??null,
        decision_type:args.decisionType??null,
      },
    });
    const row=await nodeRpc('save',args);
    if(row?.status!=='ready')throw new Error('autonomous_decomposition_checkpoint_save_failed:'+args.nodePath);
    return {
      ...row,
      parent_path:args.parentPath??null,
      source_kind:row.source_kind||args.sourceKind||'requirement',
      source_ref:row.source_ref??args.sourceRef??null,
    };
  }

  async function researchBatchRpc(action,nodePath,batchId=null){
    return rpc('aau_bridge_cognition_research_batches_v0_1',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_node_path:nodePath,
      p_action:action,
      p_batch_id:batchId,
    });
  }

  async function loadDurableResearchCatalog(nodePath){
    const row=await researchBatchRpc('list',nodePath,null);
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_research_batch_catalog_lookup_failed:'+nodePath);
    const merged=[];
    for(const batch of asArray(row.batches)){
      for(const source of asArray(batch?.sources)){
        const s=asObject(source);
        const identity=text(s.url)||text(s.sha256)||text(s.title);
        if(!identity)continue;
        merged.push({
          source_id:'src_'+sha256(identity).slice(0,12),
          query:s.query||null,
          title:s.title||null,
          url:s.url||null,
          published_at:s.published_at||null,
          coverage:s.coverage||null,
          fetch_status:s.fetch_status||null,
          sha256:s.sha256||null,
          audit_batch_id:batch.batch_id||null,
          receipt_persisted:true,
          full_text_persisted:false,
          full_receipt_persisted:true,
        });
      }
    }
    return mergeResearchSourceCatalog([],merged);
  }

  async function linkResearchBatch(nodePath,batchId){
    if(!batchId)return null;
    const row=await researchBatchRpc('link',nodePath,batchId);
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_research_batch_link_failed:'+nodePath);
    return row;
  }

  async function pinnedEvidenceRpc(action,nodePath,evidence=[]){
    return rpc('aau_bridge_cognition_pinned_research_v0_1',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_node_path:nodePath,
      p_model:model,
      p_action:action,
      p_evidence:Array.isArray(evidence)?evidence:[],
    });
  }

  async function loadPinnedEvidence(nodePath){
    const row=await pinnedEvidenceRpc('list',nodePath,[]);
    if(row?.status!=='ready')throw new Error('autonomous_decomposition_pinned_evidence_lookup_failed:'+nodePath);
    return compactPinnedEvidence(row.evidence);
  }

  async function persistExplicitResearchEvidence(nodePath,researchUrls,researchObserved){
    if(!researchObserved)
      return {save:{status:'ready',inserted:0,extended:0,unchanged:0,restored_or_extended:0},evidence:await loadPinnedEvidence(nodePath)};

    const requestedUrlKeys=new Set(asArray(researchUrls).map(normalizedUrl).filter(Boolean));
    const fetchedSources=asArray(researchObserved.sources)
      .filter(source=>
        source?.fetch_status==='fetched_text'
        && typeof source?.excerpt==='string'
        && source.excerpt.length
        && /^https:\/\//i.test(text(source?.url))
      );

    // Explicit catalog/URL retrievals get first priority. Broad query research also
    // retains a bounded, query-diverse evidence set so durable source catalogs never
    // outlive the excerpts needed to interpret them after a restart.
    const selected=[];
    const selectedUrls=new Set();
    const addSource=(source)=>{
      const key=normalizedUrl(source?.url);
      if(!key||selectedUrls.has(key)||selected.length>=16)return false;
      selectedUrls.add(key);
      selected.push(source);
      return true;
    };

    for(const source of fetchedSources){
      if(requestedUrlKeys.has(normalizedUrl(source?.url)))addSource(source);
    }

    const perQuery=new Map();
    for(const source of fetchedSources){
      if(selected.length>=16)break;
      const query=text(source?.query)||'__unscoped__';
      const used=Number(perQuery.get(query)||0);
      if(used>=2)continue;
      if(addSource(source))perQuery.set(query,used+1);
    }
    for(const source of fetchedSources){
      if(selected.length>=16)break;
      addSource(source);
    }

    const pinCandidates=selected.map(source=>({
      source_key:source.source_id||source.url||source.sha256,
      source_id:source.source_id||null,
      url:source.url||null,
      title:source.title||null,
      publisher:source.publisher||null,
      sha256:source.sha256||null,
      fetch_status:source.fetch_status||null,
      coverage:source.coverage||null,
      excerpt:clip(source.excerpt,MAX_PINNED_EVIDENCE_EXCERPT_CHARS),
      audit_batch_id:researchObserved.audit_batch_id||null,
    }));
    if(!pinCandidates.length)
      return {save:{status:'ready',inserted:0,extended:0,unchanged:0,restored_or_extended:0},evidence:await loadPinnedEvidence(nodePath)};

    const save=await pinnedEvidenceRpc('save',nodePath,pinCandidates);
    if(save?.status!=='ready')
      throw new Error('autonomous_decomposition_pinned_evidence_save_failed:'+nodePath);
    const evidence=await loadPinnedEvidence(nodePath);
    console.log('AAU_AUTONOMOUS_PINNED_EVIDENCE',JSON.stringify({
      node_path:nodePath,
      requested_url_count:asArray(researchUrls).length,
      fetched_source_count:fetchedSources.length,
      durable_candidate_count:pinCandidates.length,
      inserted:Number(save.inserted||0),
      extended:Number(save.extended||0),
      unchanged:Number(save.unchanged||0),
      restored_or_extended:Number(save.restored_or_extended||0),
      pinned_items:evidence.length,
      persistence_policy:'explicit_urls_plus_query_diverse_v0_2',
    }));
    return {save,evidence};
  }

  async function getNode(nodePath){
    return nodeRpc('get',{nodePath});
  }

  async function children(nodePath){
    const row=await nodeRpc('children',{nodePath});
    return asArray(row?.children);
  }

  async function remediationRpc(action,nodePath,episode={}){
    return rpc('aau_bridge_cognition_remediation_v0_1',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_node_path:nodePath,
      p_model:model,
      p_action:action,
      p_episode:asObject(episode),
    });
  }

  async function loadRemediationEpisodes(nodePath){
    const row=await remediationRpc('list',nodePath,{});
    if(row?.status!=='ready')throw new Error('autonomous_decomposition_remediation_lookup_failed:'+nodePath);
    return asArray(row.episodes);
  }

  async function cognitionStepRpc(action,stepKey,artifact=null,meta={}){
    return rpc('aau_bridge_cognition_step_checkpoint',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,
      p_step_key:stepKey,
      p_model:model,
      p_action:action,
      p_artifact:artifact,
      p_meta:asObject(meta),
    });
  }

  const DURABLE_CONTINUATION_CONTRACT='universal_durable_cognition_continuation_v0_1';

  function phaseCheckpointStepKey(nodePath,phase,semanticIdentity){
    return 'phase:'+sha256({
      contract:DURABLE_CONTINUATION_CONTRACT,
      node_path:nodePath,
      phase,
      semantic_identity:semanticIdentity,
      model,
    }).slice(0,56);
  }

  async function loadJsonPhaseCheckpoint(nodePath,phase,semanticIdentity){
    const stepKey=phaseCheckpointStepKey(nodePath,phase,semanticIdentity);
    const row=await cognitionStepRpc('get',stepKey,null,{});
    if(row?.status==='not_found')return {stepKey,row:null,parsed:null};
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_phase_checkpoint_lookup_failed:'+nodePath+':'+phase);
    let parsed=null;
    try{parsed=JSON.parse(String(row.artifact||''));}
    catch{
      throw new Error('autonomous_decomposition_phase_checkpoint_malformed:'+nodePath+':'+phase);
    }
    console.log('AAU_COGNITION_PHASE_CHECKPOINT_REUSED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:nodePath,
      phase,
      step_key:stepKey,
      checkpoint_id:row.step_checkpoint_id||null,
      contract:DURABLE_CONTINUATION_CONTRACT,
    }));
    return {stepKey,row,parsed:asObject(parsed)};
  }

  async function saveJsonPhaseCheckpoint(nodePath,phase,semanticIdentity,parsed,meta={}){
    const stepKey=phaseCheckpointStepKey(nodePath,phase,semanticIdentity);
    const artifact=JSON.stringify(asObject(parsed));
    const row=await cognitionStepRpc('save',stepKey,artifact,{
      contract:DURABLE_CONTINUATION_CONTRACT,
      node_path:nodePath,
      phase,
      semantic_identity:semanticIdentity,
      immutable_completed_phase:true,
      ...asObject(meta),
    });
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_phase_checkpoint_save_failed:'+nodePath+':'+phase);
    console.log('AAU_COGNITION_PHASE_CHECKPOINT_SAVED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:nodePath,
      phase,
      step_key:stepKey,
      checkpoint_id:row.step_checkpoint_id||null,
      contract:DURABLE_CONTINUATION_CONTRACT,
    }));
    return row;
  }

  function childProposalSiblingSignature(previous=[]){
    return sha256(asArray(previous).map(v=>({
      node_path:text(v?.node_path)||null,
      ordinal:Number(v?.ordinal||0),
      status:text(v?.status)||null,
      requirement:text(v?.requirement),
      scope_removed:text(v?.scope_removed)||null,
      completion_criterion:text(v?.completion_criterion)||null,
    })));
  }

  function childProposalStepKey(node,ordinal,previous=[]){
    const discovery=asObject(node?.decision_payload?.routing_discovery_checkpoint);
    return 'childprop:'+sha256({
      contract:'agent_authored_child_proposal_v0_3_remaining_scope',
      node_path:node.node_path,
      ordinal,
      requirement_hash:node.requirement_hash||sha256(node.requirement_text||''),
      discovery_fingerprint:text(discovery.context_fingerprint)||null,
      discovery_decision:text(discovery.decision)||null,
      prior_children_signature:childProposalSiblingSignature(previous),
    }).slice(0,56);
  }

  async function loadChildProposalCheckpoint(node,ordinal,previous=[]){
    const row=await cognitionStepRpc('get',childProposalStepKey(node,ordinal,previous),null,{});
    if(row?.status==='not_found')return null;
    if(row?.status!=='ready')throw new Error('autonomous_decomposition_child_proposal_checkpoint_lookup_failed:'+node.node_path);
    let proposal=null;
    try{proposal=JSON.parse(String(row.artifact||''));}
    catch{throw new Error('autonomous_decomposition_child_proposal_checkpoint_malformed:'+node.node_path);}
    return {row,proposal:asObject(proposal)};
  }

  async function saveChildProposalCheckpoint(node,ordinal,proposal,previous=[]){
    const artifact=JSON.stringify(proposal);
    const row=await cognitionStepRpc('save',childProposalStepKey(node,ordinal,previous),artifact,{
      contract:'agent_authored_child_proposal_v0_3_remaining_scope',
      node_path:node.node_path,
      ordinal,
      discovery_fingerprint:text(node?.decision_payload?.routing_discovery_checkpoint?.context_fingerprint)||null,
      prior_children_signature:childProposalSiblingSignature(previous),
      authored_by_bound_agent:true,
      deep_formulation:true,
      serialization_pending:true,
    });
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_child_proposal_checkpoint_save_failed:'+node.node_path);
    return row;
  }

  function childProposalRejectionStepKey(node,ordinal,candidate,siblingOverlap,previous=[]){
    return 'childreject:'+sha256({
      contract:'agent_authored_child_proposal_rejection_v0_1',
      node_path:node.node_path,
      ordinal,
      requirement_hash:node.requirement_hash||sha256(node.requirement_text||''),
      candidate_requirement_hash:sha256(text(candidate?.requirement)),
      sibling_ordinal:Number(siblingOverlap?.ordinal||0),
      sibling_requirement_hash:sha256(text(siblingOverlap?.requirement)),
      prior_children_signature:childProposalSiblingSignature(previous),
      rejection_reason:'COGNITION_CHILD_OVERLAP',
    }).slice(0,54);
  }

  async function persistChildProposalRejection(node,ordinal,candidate,siblingOverlap,previous=[]){
    const artifact={
      contract:'agent_authored_child_proposal_rejection_v0_1',
      node_path:node.node_path,
      ordinal,
      rejection_reason:'COGNITION_CHILD_OVERLAP',
      candidate:{
        requirement:text(candidate?.requirement)||null,
        scope_removed:text(candidate?.scope_removed)||null,
        completion_criterion:text(candidate?.completion_criterion)||null,
        reason:text(candidate?.reason)||null,
      },
      accepted_sibling:{
        node_path:text(siblingOverlap?.node_path)||null,
        ordinal:Number(siblingOverlap?.ordinal||0),
        status:text(siblingOverlap?.status)||null,
        requirement:text(siblingOverlap?.requirement)||null,
        scope_removed:text(siblingOverlap?.scope_removed)||null,
        completion_criterion:text(siblingOverlap?.completion_criterion)||null,
      },
      overlap:{
        similarity:Number(siblingOverlap?.similarity||0),
        rejection_threshold:0.78,
        explicit_instance_id:siblingOverlap?.explicit_instance_id??null,
        explicit_instance_disjoint:Boolean(siblingOverlap?.explicit_instance_disjoint),
        explicit_partition_disjoint:Boolean(siblingOverlap?.explicit_partition_disjoint),
        explicit_partition_candidate:siblingOverlap?.explicit_partition_candidate??{},
        explicit_partition_sibling:siblingOverlap?.explicit_partition_sibling??{},
        canonical_identity:siblingOverlap?.canonical_identity??null,
        canonical_instance_disjoint:Boolean(siblingOverlap?.canonical_instance_disjoint),
      },
      prior_children_signature:childProposalSiblingSignature(previous),
      recorded_at:new Date().toISOString(),
    };
    const stepKey=childProposalRejectionStepKey(node,ordinal,candidate,siblingOverlap,previous);
    const row=await cognitionStepRpc('save',stepKey,JSON.stringify(artifact),{
      contract:'agent_authored_child_proposal_rejection_v0_1',
      node_path:node.node_path,
      ordinal,
      rejection_reason:'COGNITION_CHILD_OVERLAP',
      similarity:Number(siblingOverlap?.similarity||0),
      rejection_threshold:0.78,
      prior_children_signature:childProposalSiblingSignature(previous),
      candidate_requirement_sha256:sha256(text(candidate?.requirement)),
      sibling_requirement_sha256:sha256(text(siblingOverlap?.requirement)),
      durable_rejection_evidence:true,
    });
    if(row?.status!=='ready')
      throw new Error('autonomous_decomposition_child_rejection_evidence_persist_failed:'+node.node_path);
    console.warn('AAU_AUTONOMOUS_CHILD_REJECTION_EVIDENCE_PERSISTED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:node.node_path,
      ordinal,
      step_key:stepKey,
      checkpoint_id:row.step_checkpoint_id||null,
      rejection_reason:'COGNITION_CHILD_OVERLAP',
      similarity:Number(siblingOverlap?.similarity||0),
      rejection_threshold:0.78,
      sibling_ordinal:Number(siblingOverlap?.ordinal||0),
    }));
    return row;
  }

  async function refreshedSiblingContext(node){
    const parentPath=node.parent_path??parentPathOf(node.node_path);
    if(!parentPath){
      return {
        contextPayload:asObject(node.context_payload),
        siblingEvidence:authoritativeSiblingEvidence(node.context_payload),
        refreshed:false,
      };
    }
    const siblings=(await children(parentPath))
      .filter(row=>row?.node_path!==node.node_path)
      .filter(row=>['completed','blocked'].includes(String(row?.status||row?.node_status||'')));
    const compact=compactCompletedSiblingResults(siblings);
    const contextPayload=boundContextPayload({
      ...(node.context_payload||{}),
      ...(compact.length?{completed_sibling_results:compact}:{}),
    });
    return {
      contextPayload,
      siblingEvidence:authoritativeSiblingEvidence(contextPayload),
      refreshed:true,
    };
  }

  function compactSynthesisReviewState(review){
    const value=asObject(review);
    if(!Object.keys(value).length)return {};
    return {
      status:text(value.status)||null,
      reason:clip(value.reason,1600)||null,
      issues:asArray(value.issues).map(v=>clip(text(v),700)).filter(Boolean).slice(0,10),
      evidence_bindings:asArray(value.evidence_bindings).map(v=>({
        claim:clip(text(v?.claim),500)||null,
        source_path_or_id:clip(text(v?.source_path_or_id),300)||null,
        preserved:v?.preserved===true,
      })).slice(0,16),
      revision_guidance:clip(value.revision_guidance,2200)||null,
      external_authenticator:value.external_authenticator===true,
      deterministic_guard:text(value.deterministic_guard)||null,
    };
  }

  function selfRemediationVerificationBoundary(repairType,subject=null){
    if(text(repairType).toUpperCase()!=='REBUILD_SYNTHESIS_FROM_RESOLVED_EVIDENCE')
      return 'POST_FRESH_DISCOVERY';
    const nodeFailure=asObject(asObject(subject?.decision_payload).synthesis_failure);
    const episodeFailure=asObject(asObject(asObject(subject?.pre_state).synthesis).failure);
    const failureType=text(nodeFailure.failure_type)||text(episodeFailure.failure_type);
    return failureType==='independent_authenticator_verified_fail'
      ?'POST_INDEPENDENT_AUTHENTICATOR'
      :'POST_SYNTHESIS_PROVENANCE';
  }

  function selfRemediationResumeMode(boundary){
    return boundary==='POST_FRESH_DISCOVERY'?'DISCOVERY':'SYNTHESIS';
  }

  function cleanedRemediationDecisionPayload(payload){
    const next={...asObject(payload)};
    for(const key of [
      'reason','requirement_interpretation','evidence_assessment','unresolved_gaps',
      'context_requests','research_queries','research_urls','routing_discovery_checkpoint',
      'routing_discovery_checkpointed','routing_discovery_checkpointed_at',
      'routing_discovery_reused','routing_commit_serialized',
      'blocked_by_bound_agent','block_reason','context_resource_at_block',
      // A fresh discovery may repartition the node. Child-authoring state from
      // the superseded partition must not short-circuit or bias the repaired one.
      'children_authored','child_count','child_authoring_failure_count',
      'child_authoring_failure','conserved_branch_economics_constraint_applied',
      'semantic_child_capacity_at_stop','budget_constrained_child_authoring_reopened',
      'budget_constrained_child_authoring_reopened_at',
      'synthesis_cursor','synthesis_accumulator','synthesis_child_result_hashes',
      'synthesis_complete','synthesis_outcome','synthesis_reason',
      'synthesis_provenance_review','synthesis_provenance_pending'
    ]) delete next[key];
    next.reconsider_decomposition=true;
    return next;
  }

  async function retireUnresolvedDescendantsForRouteSupersession(node,nextDecision){
    const retired=[];
    const preservedCompleted=[];
    const visited=new Set();

    async function walk(parentNodePath){
      if(visited.has(parentNodePath))return;
      visited.add(parentNodePath);
      const refs=(await children(parentNodePath))
        .sort((a,b)=>Number(a?.ordinal||0)-Number(b?.ordinal||0));
      for(const ref of refs){
        const child=await getNode(ref.node_path);
        if(child?.status!=='ready')continue;
        const childStatus=text(child.node_status||child.status).toLowerCase();

        // Recurse before retiring the parent so the durable audit tree remains
        // inspectable and completed work is never destroyed.
        await walk(child.node_path);

        if(childStatus==='completed'){
          preservedCompleted.push({
            node_path:child.node_path,
            result_hash:child.result_hash||null,
            requirement_hash:child.requirement_hash||null,
          });
          continue;
        }
        if(childStatus==='cancelled')continue;

        await saveNode({
          nodePath:child.node_path,
          parentPath:parentNodePath,
          ordinal:child.ordinal||0,
          requirement:child.requirement_text,
          sourceKind:child.source_kind,
          sourceRef:child.source_ref,
          status:'cancelled',
          decisionType:child.decision_type??null,
          decisionPayload:{
            cancellation_contract:'parent_route_supersession_v0_1',
            cancelled_by_parent_path:node.node_path,
            superseding_decision:text(nextDecision).toUpperCase()||null,
            prior_status:childStatus||null,
            prior_decision_type:text(child.decision_type)||null,
            prior_requirement_hash:child.requirement_hash||null,
            prior_result_hash:child.result_hash||null,
            prior_decision_payload_sha256:sha256(asObject(child.decision_payload)),
            cancelled_at:new Date().toISOString(),
            reusable_only_if_explicitly_rebound:false,
          },
          contextPayload:child.context_payload||{},
          resultArtifact:child.result_artifact||null,
        });
        retired.push({
          node_path:child.node_path,
          prior_status:childStatus||null,
          prior_decision_type:text(child.decision_type)||null,
          requirement_hash:child.requirement_hash||null,
        });
      }
    }

    await walk(node.node_path);
    if(retired.length){
      console.log('AAU_AUTONOMOUS_ROUTE_SUPERSESSION_DESCENDANTS_RETIRED',JSON.stringify({
        agent_id:agentId,
        intent_execution_id:intentExecutionId,
        node_path:node.node_path,
        superseding_decision:text(nextDecision).toUpperCase()||null,
        retired_count:retired.length,
        retired_paths:retired.map(v=>v.node_path),
        preserved_completed_count:preservedCompleted.length,
        policy:'parent_route_supersession_v0_1',
      }));
    }
    return {retired,preserved_completed:preservedCompleted};
  }

  async function retireUnresolvedDescendantsForDiscoveryRepair(node,episode){
    const repairType=text(episode?.repair_type).toUpperCase();
    if(!['INVALIDATE_DISCOVERY_CHECKPOINT','REFRESH_SIBLING_EVIDENCE'].includes(repairType)){
      return {retired:[],preserved_completed:[]};
    }

    const retired=[];
    const preservedCompleted=[];
    const visited=new Set();

    async function walk(parentNodePath){
      if(visited.has(parentNodePath))return;
      visited.add(parentNodePath);
      const refs=(await children(parentNodePath))
        .sort((a,b)=>Number(a?.ordinal||0)-Number(b?.ordinal||0));
      for(const ref of refs){
        const child=await getNode(ref.node_path);
        if(child?.status!=='ready')continue;
        const childStatus=text(child.node_status||child.status).toLowerCase();

        // Snapshot descendants before cancelling their parent so the durable
        // audit tree remains traversable even though the active branch is retired.
        await walk(child.node_path);

        if(childStatus==='completed'){
          preservedCompleted.push({
            node_path:child.node_path,
            result_hash:child.result_hash||null,
            requirement_hash:child.requirement_hash||null,
          });
          continue;
        }
        if(childStatus==='cancelled')continue;

        const cancellationPayload={
          cancellation_contract:'parent_discovery_remediation_partition_supersession_v0_1',
          cancelled_by_parent_path:node.node_path,
          remediation_id:episode.remediation_id,
          repair_type:repairType,
          prior_status:childStatus||null,
          prior_decision_type:text(child.decision_type)||null,
          prior_requirement_hash:child.requirement_hash||null,
          prior_result_hash:child.result_hash||null,
          prior_decision_payload_sha256:sha256(asObject(child.decision_payload)),
          cancelled_at:new Date().toISOString(),
          reusable_only_if_explicitly_rebound:false,
        };
        await saveNode({
          nodePath:child.node_path,
          parentPath:parentNodePath,
          ordinal:child.ordinal||0,
          requirement:child.requirement_text,
          sourceKind:child.source_kind,
          sourceRef:child.source_ref,
          status:'cancelled',
          decisionType:child.decision_type??null,
          decisionPayload:cancellationPayload,
          contextPayload:child.context_payload||{},
          resultArtifact:child.result_artifact||null,
        });
        retired.push({
          node_path:child.node_path,
          prior_status:childStatus||null,
          prior_decision_type:text(child.decision_type)||null,
          requirement_hash:child.requirement_hash||null,
        });
      }
    }

    await walk(node.node_path);
    if(retired.length){
      console.log('AAU_AUTONOMOUS_REMEDIATION_DESCENDANTS_RETIRED',JSON.stringify({
        agent_id:agentId,
        intent_execution_id:intentExecutionId,
        node_path:node.node_path,
        remediation_id:episode.remediation_id,
        repair_type:repairType,
        retired_count:retired.length,
        retired_paths:retired.map(v=>v.node_path),
        preserved_completed_count:preservedCompleted.length,
        policy:'parent_discovery_remediation_partition_supersession_v0_1',
      }));
    }
    return {retired,preserved_completed:preservedCompleted};
  }

  function compactSynthesisFailureState(raw){
    const failure=asObject(raw);
    if(!Object.keys(failure).length)return {};
    const reportRef=asObject(failure.authenticator_report_ref);
    const report=asObject(failure.authenticator_report);
    return {
      contract:text(failure.contract)||'agent_visible_synthesis_failure_v0_2',
      failure_type:text(failure.failure_type)||null,
      reason:clip(failure.reason,1800)||null,
      review:compactSynthesisReviewState(failure.review),
      authenticator_review_id:text(failure.authenticator_review_id)||null,
      authenticator_report_ref:Object.keys(reportRef).length
        ?reportRef
        :(
          text(failure.authenticator_review_id)
          ?{
              review_id:text(failure.authenticator_review_id),
              rejected_file_id:text(failure.rejected_file_id)||null,
              artifact_sha256:text(failure.rejected_artifact_sha256)||null,
              report_sha256:Object.keys(report).length?sha256(report):null,
            }
          :{}
        ),
      rejected_file_id:text(failure.rejected_file_id)||null,
      rejected_artifact_sha256:text(failure.rejected_artifact_sha256)||null,
      authenticator_score:Number(failure.authenticator_score||0)||null,
      prior_root_result_hash:text(failure.prior_root_result_hash)||null,
      child_result_hashes:asArray(failure.child_result_hashes).slice(0,24),
      child_state_hash:text(failure.child_state_hash)||null,
      accumulator_hash:text(failure.accumulator_hash)||null,
      prior_synthesis_remediation_id:text(failure.prior_synthesis_remediation_id)||null,
      preserved_children:failure.preserved_children===true,
      preserved_accumulator:failure.preserved_accumulator===true,
      recovery_policy:text(failure.recovery_policy)||null,
      failed_at:text(failure.failed_at)||null,
    };
  }

  function synthesisRemediationDecisionPayload(payload,episode){
    const next={...asObject(payload)};
    for(const key of [
      'synthesis_complete','synthesis_outcome','synthesis_reason',
      'synthesis_provenance_review','synthesis_provenance_pending',
      'routing_discovery_checkpoint','routing_discovery_checkpointed',
      'routing_discovery_checkpointed_at','routing_discovery_reused',
      'routing_commit_serialized'
    ]) delete next[key];
    if(Object.keys(asObject(next.synthesis_failure)).length){
      next.synthesis_failure=compactSynthesisFailureState(next.synthesis_failure);
    }
    next.synthesis_remediation_nonce=episode.remediation_id;
    next.synthesis_rebuild_reason='self_remediation_rebuild_from_resolved_evidence';
    next.synthesis_rebuild_at=new Date().toISOString();
    next.reconsider_decomposition=false;
    return next;
  }

  function latestActiveRemediation(episodes,repairType=null){
    const wanted=text(repairType).toUpperCase();
    return [...asArray(episodes)].reverse().find(v=>{
      const active=['proposed','applied','verifying'].includes(String(v?.status||''));
      return active&&(!wanted||text(v?.repair_type).toUpperCase()===wanted);
    })||null;
  }

  async function applyRemediationEpisode(node,episode,{contextPayload,pinnedEvidence,siblingEvidence}){
    const repairType=text(episode.repair_type).toUpperCase();
    if(!SELF_REMEDIATION_REPAIR_TYPES.includes(repairType))
      throw new Error('autonomous_decomposition_remediation_repair_not_allowed:'+node.node_path);

    const verificationBoundary=selfRemediationVerificationBoundary(repairType,node);
    let nextContext=asObject(contextPayload);
    let nextSiblingEvidence=asArray(siblingEvidence);
    if(repairType==='REFRESH_SIBLING_EVIDENCE'){
      const refreshed=await refreshedSiblingContext(node);
      nextContext=refreshed.contextPayload;
      nextSiblingEvidence=refreshed.siblingEvidence;
    }

    const descendantReconciliation=
      verificationBoundary==='POST_FRESH_DISCOVERY'
        ?await retireUnresolvedDescendantsForDiscoveryRepair(node,episode)
        :{retired:[],preserved_completed:[]};

    let nextPayload;
    let nextStatus='pending';
    let nextDecisionType=null;
    if(repairType==='REBUILD_SYNTHESIS_FROM_RESOLVED_EVIDENCE'){
      const currentPayload=asObject(node.decision_payload);
      const failure=asObject(currentPayload.synthesis_failure);
      const pending=asObject(currentPayload.synthesis_provenance_pending);
      if(!Object.keys(failure).length&&!Object.keys(pending).length)
        throw new Error('autonomous_decomposition_synthesis_remediation_without_failure:'+node.node_path);
      if(!Object.keys(asObject(currentPayload.synthesis_accumulator)).length)
        throw new Error('autonomous_decomposition_synthesis_remediation_accumulator_missing:'+node.node_path);
      nextPayload=synthesisRemediationDecisionPayload(currentPayload,episode);
      nextStatus='split';
      nextDecisionType='SPLIT';
    }else{
      nextPayload=cleanedRemediationDecisionPayload(node.decision_payload);
    }

    nextPayload.self_remediation_in_progress={
      remediation_id:episode.remediation_id,
      attempt_no:Number(episode.attempt_no||0),
      repair_type:repairType,
      verification_boundary:verificationBoundary,
      requested_by_bound_agent:true,
      mechanical_repair_applied:true,
      fresh_cognition_required:true,
      descendant_reconciliation:{
        contract:'parent_discovery_remediation_partition_supersession_v0_1',
        retired_count:descendantReconciliation.retired.length,
        retired_paths:descendantReconciliation.retired.map(v=>v.node_path),
        preserved_completed_count:descendantReconciliation.preserved_completed.length,
        preserved_completed:descendantReconciliation.preserved_completed.slice(0,16),
      },
      applied_at:new Date().toISOString(),
    };

    node=await saveNode({
      nodePath:node.node_path,
      parentPath:node.parent_path??parentPathOf(node.node_path),
      ordinal:node.ordinal||0,
      requirement:node.requirement_text,
      sourceKind:node.source_kind,
      sourceRef:node.source_ref,
      status:nextStatus,
      decisionType:nextDecisionType,
      decisionPayload:nextPayload,
      contextPayload:nextContext,
      resultArtifact:null,
    });
    node.parent_path=node.parent_path??parentPathOf(node.node_path);

    const postState=remediationStateSnapshot(node,nextContext,pinnedEvidence,nextSiblingEvidence);
    await remediationRpc('update',node.node_path,{
      remediation_id:episode.remediation_id,
      status:'applied',
      post_state:postState,
    });

    console.log('AAU_AUTONOMOUS_SELF_REMEDIATION_APPLIED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:node.node_path,
      remediation_id:episode.remediation_id,
      attempt_no:Number(episode.attempt_no||0),
      repair_type:repairType,
      verification_boundary:verificationBoundary,
      verification_deferred:true,
      retired_unresolved_descendant_count:descendantReconciliation.retired.length,
      preserved_completed_descendant_count:descendantReconciliation.preserved_completed.length,
    }));

    return {
      node,
      contextPayload:nextContext,
      siblingEvidence:nextSiblingEvidence,
      postState,
      verification_boundary:verificationBoundary,
      resume_mode:selfRemediationResumeMode(verificationBoundary),
    };
  }

  async function verifyRemediationEpisode(node,episode,{
    contextPayload,pinnedEvidence,siblingEvidence,postState=null,
    externalVerification=null,preserveCurrentCognition=true
  }){
    const effectivePostState=postState||remediationStateSnapshot(node,contextPayload,pinnedEvidence,siblingEvidence);
    const repairType=text(episode.repair_type).toUpperCase();
    const verificationBoundary=selfRemediationVerificationBoundary(repairType,episode);
    await remediationRpc('update',node.node_path,{
      remediation_id:episode.remediation_id,
      status:'verifying',
      post_state:effectivePostState,
      verification_result:{
        status:'PENDING',
        verification_boundary:verificationBoundary,
        external_verification:externalVerification,
        verification_started_at:new Date().toISOString(),
      },
    });

    let verification=null;
    const deterministicOperationalVerification=
      verificationBoundary==='POST_SYNTHESIS_PROVENANCE'
      &&externalVerification?.ok===true
      &&text(externalVerification?.status).toUpperCase()==='ACCEPT'
      &&text(externalVerification?.deterministic_provenance_guard?.contract)
        ==='exact_completed_child_ledger_v0_1';

    if(deterministicOperationalVerification){
      verification={
        status:'VERIFIED',
        reason:'The runtime deterministically reconstructed the parent evidence ledger from completed child artifacts and verified zero provenance drift.',
        observed_after:'The parent ledger is an exact structural composition of completed child evidence under exact_completed_child_ledger_v0_1.',
        remaining_problem:'',
        agent_authored:false,
        operational_verification:true,
        verification_boundary:verificationBoundary,
        external_verification:externalVerification,
      };
    }else{
      for(let attempt=1;attempt<=2;attempt++){
      try{
        const verificationResponse=await callJson([
          {role:'system',content:[
            'You are the bound autonomous agent verifying YOUR OWN cognitive self-remediation.',
            'Mechanical repair is not success. Verification occurs only after the repair-specific fresh cognition boundary has been reached.',
            'You previously detected an anomaly, diagnosed it, chose a bounded repair, and stated a verification criterion.',
            'Compare the before state, after-fresh-cognition state, current durable evidence, YOUR verification criterion, and any independent runtime verification supplied.',
            'Independent runtime verification is authoritative about its own checks. Do not claim VERIFIED when external_verification.ok=false.',
            'Return VERIFIED only if the original cognitive problem has actually been resolved, not merely because a checkpoint was cleared or a retry became possible.',
            'Otherwise return FAILED and identify what remains wrong.',
            'Return JSON only: {"status":"VERIFIED|FAILED","reason":"auditable verification","observed_after":"what changed or did not change","remaining_problem":"empty when verified"}.',
          ].join('\n')},
          {role:'user',content:safeJson({
            requirement:node.requirement_text,
            verification_boundary:verificationBoundary,
            remediation_plan:{
              observed_anomaly:episode.observed_anomaly,
              prior_belief:episode.prior_belief,
              contradicting_evidence:asArray(episode.contradicting_evidence),
              diagnosis:episode.diagnosis,
              repair_type:episode.repair_type,
              repair_payload:asObject(episode.repair_payload),
              verification_criterion:episode.verification_criterion,
            },
            pre_state:asObject(episode.pre_state),
            post_state:effectivePostState,
            external_verification:externalVerification,
            authoritative_completed_sibling_evidence:agentModelContextView(
              contextPayload,pinnedEvidence,2200
            ).siblingEvidence,
            pinned_research_evidence:compactPinnedEvidenceForModel(
              pinnedEvidence,
              Math.max(700,Math.floor(modelInputBudgetTokens(agentRuntimeContract,2200)*0.22)),
              agentRuntimeContract
            ),
            supplied_context:agentModelContextView(
              contextPayload,pinnedEvidence,2200
            ).suppliedContext,
          })},
        ],2200,'req_'+node.node_path.replaceAll('.','_')+'_self_remediation_verify_'+episode.attempt_no+'_'+attempt);

        const candidate=asObject(verificationResponse?.parsed);
        let status=text(candidate.status).toUpperCase();
        if(!['VERIFIED','FAILED'].includes(status)){
          if(attempt===2){
            verification={
              status:'FAILED',
              reason:'Self-remediation verification did not produce a valid VERIFIED or FAILED judgment.',
              observed_after:'',
              remaining_problem:'verification_output_invalid',
              agent_authored:false,
            };
            break;
          }
          continue;
        }
        if(externalVerification&&externalVerification.ok===false)status='FAILED';
        verification={
          status,
          reason:clip(candidate.reason,2400),
          observed_after:clip(candidate.observed_after,2400),
          remaining_problem:clip(
            status==='FAILED'&&externalVerification&&externalVerification.ok===false
              ? text(candidate.remaining_problem)||text(externalVerification.reason)||'external_verification_failed'
              : candidate.remaining_problem,
            2400
          ),
          agent_authored:true,
          verification_boundary:verificationBoundary,
          external_verification:externalVerification,
        };
        break;
      }catch(error){
        const recoverable=error?.code==='COGNITION_RESPONSE_REJECTED'||error?.code==='NVIDIA_TIMEOUT';
        if(!recoverable)throw error;
        if(attempt===2){
          verification={
            status:'FAILED',
            reason:'Self-remediation verification could not complete after bounded retry.',
            observed_after:'',
            remaining_problem:String(error?.rejectionReason||error?.code||'verification_incomplete'),
            agent_authored:false,
            verification_boundary:verificationBoundary,
            external_verification:externalVerification,
          };
          break;
        }
      }
      }
    }

    if(!verification)throw new Error('autonomous_decomposition_remediation_verification_missing:'+node.node_path);

    await remediationRpc('update',node.node_path,{
      remediation_id:episode.remediation_id,
      status:verification.status==='VERIFIED'?'succeeded':'failed',
      post_state:effectivePostState,
      verification_result:verification,
    });

    const finalPayload=preserveCurrentCognition
      ?{...asObject(node.decision_payload)}
      :cleanedRemediationDecisionPayload(node.decision_payload);
    delete finalPayload.self_remediation_in_progress;
    finalPayload.last_self_remediation={
      remediation_id:episode.remediation_id,
      attempt_no:Number(episode.attempt_no||0),
      repair_type:episode.repair_type,
      status:verification.status,
      reason:clip(verification.reason,1600),
      verification_boundary:verificationBoundary,
      verification_agent_authored:Boolean(verification.agent_authored),
      external_verification:externalVerification,
      verified_by_bound_agent:verification.status==='VERIFIED'&&Boolean(verification.agent_authored),
    };
    finalPayload.self_remediation_attempts_used=Number(episode.attempt_no||0);
    if(
      verification.status==='VERIFIED'
      &&repairType==='REBUILD_SYNTHESIS_FROM_RESOLVED_EVIDENCE'
      &&Object.keys(asObject(finalPayload.synthesis_failure)).length
    ){
      finalPayload.last_resolved_synthesis_failure={
        ...asObject(finalPayload.synthesis_failure),
        resolved_by_remediation_id:episode.remediation_id,
        resolved_at:new Date().toISOString(),
      };
      delete finalPayload.synthesis_failure;
    }
    if(verification.status==='FAILED')finalPayload.reconsider_decomposition=true;

    node=await saveNode({
      nodePath:node.node_path,
      parentPath:node.parent_path??parentPathOf(node.node_path),
      ordinal:node.ordinal||0,
      requirement:node.requirement_text,
      sourceKind:node.source_kind,
      sourceRef:node.source_ref,
      status:preserveCurrentCognition?(node.node_status||'pending'):'pending',
      decisionType:preserveCurrentCognition?(node.decision_type??null):null,
      decisionPayload:finalPayload,
      contextPayload,
      resultArtifact:node.result_artifact||null,
    });
    node.parent_path=node.parent_path??parentPathOf(node.node_path);

    console.log('AAU_AUTONOMOUS_SELF_REMEDIATION_VERIFIED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:node.node_path,
      remediation_id:episode.remediation_id,
      attempt_no:Number(episode.attempt_no||0),
      repair_type:episode.repair_type,
      verification_boundary:verificationBoundary,
      verification_status:verification.status,
      external_verification_ok:externalVerification?.ok??null,
    }));

    return {
      node,
      verified:verification.status==='VERIFIED',
      verification_status:verification.status,
      verification,
      contextPayload,
      siblingEvidence,
    };
  }

  async function failRemediationEpisode(node,episode,{reason,remainingProblem,externalVerification=null}){
    const verification={
      status:'FAILED',
      reason:clip(reason,2400),
      observed_after:'',
      remaining_problem:clip(remainingProblem||reason,2400),
      agent_authored:false,
      verification_boundary:selfRemediationVerificationBoundary(episode.repair_type,episode),
      external_verification:externalVerification,
    };
    await remediationRpc('update',node.node_path,{
      remediation_id:episode.remediation_id,
      status:'failed',
      post_state:asObject(episode.post_state),
      verification_result:verification,
    });
    return verification;
  }

  async function resumeSelfRemediationEpisode(node,episode,{contextPayload,pinnedEvidence,siblingEvidence}){
    if(episode.status==='proposed'){
      return applyRemediationEpisode(node,episode,{contextPayload,pinnedEvidence,siblingEvidence});
    }
    if(episode.status==='applied'){
      return {
        node,contextPayload,siblingEvidence,postState:asObject(episode.post_state),
        verification_boundary:selfRemediationVerificationBoundary(episode.repair_type,episode),
        resume_mode:selfRemediationResumeMode(selfRemediationVerificationBoundary(episode.repair_type,episode)),
      };
    }
    if(episode.status==='verifying'){
      const boundary=selfRemediationVerificationBoundary(episode.repair_type,episode);
      if(boundary==='POST_INDEPENDENT_AUTHENTICATOR'){
        return {
          node,contextPayload,siblingEvidence,postState:asObject(episode.post_state),
          verification_boundary:boundary,
          resume_mode:'SYNTHESIS',
          awaiting_independent_authenticator:true,
        };
      }
      return verifyRemediationEpisode(node,episode,{
        contextPayload,pinnedEvidence,siblingEvidence,
        postState:Object.keys(asObject(episode.post_state)).length?episode.post_state:null,
        externalVerification:asObject(episode.verification_result)?.external_verification||null,
        preserveCurrentCognition:true,
      });
    }
    throw new Error('autonomous_decomposition_remediation_resume_status_invalid:'+node.node_path);
  }

  async function executeSelfRemediation(node,discovery,{contextPayload,pinnedEvidence,siblingEvidence}){
    const history=await loadRemediationEpisodes(node.node_path);
    const attemptNo=history.length+1;
    if(attemptNo>MAX_SELF_REMEDIATION_ATTEMPTS)
      throw new Error('autonomous_decomposition_remediation_attempt_limit:'+node.node_path);

    const plan=asObject(discovery.remediation);
    const repairType=text(plan.repair_type).toUpperCase();
    if(!SELF_REMEDIATION_REPAIR_TYPES.includes(repairType))
      throw new Error('autonomous_decomposition_remediation_repair_not_allowed:'+node.node_path);
    if(text(plan.observed_anomaly).length<8
       || text(plan.prior_belief).length<3
       || text(plan.diagnosis).length<8
       || text(plan.verification_criterion).length<8)
      throw new Error('autonomous_decomposition_remediation_reasoning_incomplete:'+node.node_path);

    const runtimePreState=remediationStateSnapshot(node,contextPayload,pinnedEvidence,siblingEvidence);
    const preState={
      ...runtimePreState,
      agent_prior_cognitive_state:asObject(discovery.remediation_prior_state),
    };
    const created=await remediationRpc('create',node.node_path,{
      attempt_no:attemptNo,
      observed_anomaly:clip(plan.observed_anomaly,2400),
      prior_belief:clip(plan.prior_belief,2400),
      contradicting_evidence:asArray(plan.contradicting_evidence).slice(0,16),
      diagnosis:clip(plan.diagnosis,3000),
      repair_type:repairType,
      repair_payload:asObject(plan.repair_payload),
      verification_criterion:clip(plan.verification_criterion,2400),
      pre_state:preState,
    });
    if(created?.status!=='ready'||!created.remediation_id)
      throw new Error('autonomous_decomposition_remediation_create_failed:'+node.node_path);

    const episodes=await loadRemediationEpisodes(node.node_path);
    const episode=episodes.find(v=>v.remediation_id===created.remediation_id)
      || {
        remediation_id:created.remediation_id,
        attempt_no:attemptNo,
        status:'proposed',
        observed_anomaly:plan.observed_anomaly,
        prior_belief:plan.prior_belief,
        contradicting_evidence:asArray(plan.contradicting_evidence),
        diagnosis:plan.diagnosis,
        repair_type:repairType,
        repair_payload:asObject(plan.repair_payload),
        verification_criterion:plan.verification_criterion,
        pre_state:preState,
      };

    return resumeSelfRemediationEpisode(node,episode,{contextPayload,pinnedEvidence,siblingEvidence});
  }

  async function reserveModelCall(messages,maxTokens,phase,kind,attempt=1){
    const estimatedInput=estimatedTokens(messages,agentRuntimeContract);
    const fingerprint=sha256({kind,messages,max_tokens:maxTokens,model});
    const reservedUnits=modelCallCostUnits({
      estimatedInputTokens:estimatedInput,
      requestedOutputTokens:maxTokens,
      quantumTokens:semanticRuntime.quantum_tokens,
    });
    const eventKey='modelreserve:'+sha256({
      assignment_key:assignmentKey,epoch_no:semanticRuntime.epoch_no,
      phase,attempt,fingerprint,
    }).slice(0,64);
    const row=await rpc('aau_bridge_reserve_semantic_model_call_v0_1',{
      p_agent_id:agentId,p_wake_request_id:intentExecutionId,
      p_assignment_key:assignmentKey,p_model:model,p_epoch_no:semanticRuntime.epoch_no,
      p_event_key:eventKey,p_event_fingerprint:fingerprint,p_reserved_units:reservedUnits,
      p_metadata:{phase,kind,transport_attempt:attempt,estimated_input_tokens:estimatedInput,requested_output_tokens:maxTokens},
    });
    if(row?.status!=='ready')throw new Error('autonomous_decomposition_model_call_reservation_failed:'+phase);
    semanticRuntimeSnapshot=row;
    if(row.available!==true){
      const error=new Error('semantic_runtime_budget_exhausted:model_call:'+phase+':remaining='+String(row.remaining_budget_units??0));
      error.code='SEMANTIC_BUDGET_EXHAUSTED'; error.semanticRuntime=row;
      error.semanticEvent={eventKind:'model_call_reservation',materialKey:eventKey,nodePath:null};
      throw error;
    }
    return {reservationEventId:row.reservation_event_id,reservedUnits:Number(row.reserved_units||reservedUnits),estimatedInput,phase,kind,attempt};
  }

  function providerUsageSettlement(response,error,reservation){
    const usage=response?.result?.usage||response?.usage||error?.providerUsage||error?.usage||null;
    const explicitTotal=Number(usage?.total_tokens ?? error?.providerTotalTokens);
    const hasReportedTotal=Number.isFinite(explicitTotal)&&explicitTotal>=0;
    const rawProviderStatus=response
      ?200
      :(Number.isFinite(Number(error?.providerStatusCode))
        ?Math.floor(Number(error.providerStatusCode))
        :(Number.isFinite(Number(error?.status))?Math.floor(Number(error.status)):null));
    const providerStatus=
      rawProviderStatus!==null&&rawProviderStatus>=100&&rawProviderStatus<=599
        ?rawProviderStatus
        :null;
    if(hasReportedTotal){
      const actualUnits=explicitTotal>0?Math.max(1,Math.ceil(explicitTotal/semanticRuntime.quantum_tokens)):(providerStatus===200?1:0);
      return {settledUnits:Math.min(reservation.reservedUnits,actualUnits),providerStatus,providerTotalTokens:Math.floor(explicitTotal),reason:providerStatus===200?'provider_completed_actual_usage':'provider_error_reported_usage',settlementCapped:actualUnits>reservation.reservedUnits};
    }
    if(providerStatus!==null&&providerStatus>=400)
      return {settledUnits:0,providerStatus,providerTotalTokens:null,reason:'provider_http_error_no_reported_usage',settlementCapped:false};
    return {settledUnits:reservation.reservedUnits,providerStatus,providerTotalTokens:null,reason:'provider_usage_unknown_conservative_settlement',settlementCapped:false};
  }

  async function settleModelCall(reservation,{response=null,error=null}={}){
    const settlement=providerUsageSettlement(response,error,reservation);
    const row=await rpc('aau_bridge_settle_semantic_model_call_v0_1',{
      p_agent_id:agentId,p_assignment_key:assignmentKey,p_model:model,p_epoch_no:semanticRuntime.epoch_no,
      p_reservation_event_id:reservation.reservationEventId,p_settled_units:settlement.settledUnits,
      p_settlement_reason:settlement.reason,p_provider_status_code:settlement.providerStatus,
      p_provider_total_tokens:settlement.providerTotalTokens,
      p_metadata:{phase:reservation.phase,kind:reservation.kind,transport_attempt:reservation.attempt,estimated_input_tokens:reservation.estimatedInput,reserved_units:reservation.reservedUnits,settlement_capped_to_reservation:settlement.settlementCapped,error_code:error?String(error?.code||error?.cause?.code||'').slice(0,120):null,error_message:error?String(error?.message||error).slice(0,500):null},
    });
    if(row?.status!=='ready'){
      const e=new Error('autonomous_decomposition_model_call_settlement_failed:'+reservation.phase);
      e.code='COGNITION_RUNTIME_ACCOUNTING_FAULT'; throw e;
    }
    semanticRuntimeSnapshot=row;
    console.log('AAU_MODEL_CALL_SEMANTIC_SETTLEMENT',JSON.stringify({agent_id:agentId,intent_execution_id:intentExecutionId,phase:reservation.phase,reserved_units:reservation.reservedUnits,settled_units:Number(row.settled_units??settlement.settledUnits),refund_units:Number(row.refund_units||0),settlement_reason:settlement.reason,provider_status_code:settlement.providerStatus,provider_total_tokens:settlement.providerTotalTokens,idempotent:Boolean(row.idempotent)}));
    return row;
  }

  async function callWithChargedTransportRetry(fn,messages,maxTokens,phase,kind){
    let lastError=null;
    for(let attempt=1;attempt<=MAX_MODEL_TRANSPORT_ATTEMPTS;attempt++){
      const attemptPhase=attempt===1?phase:phase+'_transport_retry_'+attempt;
      const reservation=await reserveModelCall(messages,maxTokens,attemptPhase,kind,attempt);
      counters.model_calls++;
      try{
        const response=await fn(messages,maxTokens,attemptPhase);
        await settleModelCall(reservation,{response});
        return response;
      }catch(error){
        lastError=error;
        await settleModelCall(reservation,{error});
        if(!retryableModelTransportError(error)||attempt>=MAX_MODEL_TRANSPORT_ATTEMPTS)throw error;
        console.warn('AAU_MODEL_TRANSPORT_LOCAL_RETRY',JSON.stringify({agent_id:agentId,intent_execution_id:intentExecutionId,assignment_key:assignmentKey,phase,failed_attempt:attempt,next_attempt:attempt+1,error_name:String(error?.name||'Error'),error_code:String(error?.code||error?.cause?.code||''),error_message:String(error?.message||error).slice(0,300)}));
      }
    }
    throw lastError||new Error('model_transport_retry_exhausted');
  }

  async function callJson(messages,maxTokens,phase){
    return callWithChargedTransportRetry(completeJson,messages,maxTokens,phase,'deep_json');
  }

  async function callRoute(messages,maxTokens,phase){
    const fn=typeof completeRouteJson==='function'?completeRouteJson:completeJson;
    return callWithChargedTransportRetry(fn,messages,maxTokens,phase,'route_json');
  }

  async function callSerialize(messages,maxTokens,phase){
    const fn=typeof completeSerializeJson==='function'?completeSerializeJson
      :(typeof completeRouteJson==='function'?completeRouteJson:completeJson);
    return callWithChargedTransportRetry(fn,messages,maxTokens,phase,'serialize_json');
  }

  async function decide(node,{forceReconsider=false,branchDepth=0,singleChildRefinements=0}={}){
    const canonicalCandidateLedger=await loadExpertiseCandidateLedger();
    const routingPythonCalculation=qdaM7U4AuthoritativePythonCalculation(packet);
    let contextPayload={
      ...asObject(node.context_payload),
      ...lifecycleStageContractContext(packet),
      ...expertiseCandidateLedgerContext(canonicalCandidateLedger),
      ...(routingPythonCalculation?{
        runtime_python_calculation:routingPythonCalculation,
      }:{}),
    };
    let pinnedEvidence=await loadPinnedEvidence(node.node_path);
    const durableResearchCatalog=await loadDurableResearchCatalog(node.node_path);
    if(durableResearchCatalog.length){
      contextPayload={
        ...contextPayload,
        research_source_catalog:mergeResearchSourceCatalog(
          contextPayload.research_source_catalog,
          durableResearchCatalog
        ),
      };
    }
    contextPayload=boundInMemoryContext(contextPayload,pinnedEvidence,10000);
    const atomicExecutionFailures=Math.max(0,Number(node?.decision_payload?.atomic_execution_failures||0));
    const atomicProtocolFailures=Math.max(0,Number(node?.decision_payload?.atomic_protocol_failures||0));
    const atomicUnavailable=atomicExecutionFailures>=MAX_ATOMIC_EXECUTION_FAILURES;
    const atomicProtocolRecoveryExhausted=atomicProtocolFailures>=MAX_ATOMIC_PROTOCOL_FAILURES;
    const priorAtomicRejection=text(node?.decision_payload?.prior_atomic_rejection).toUpperCase();
    const priorAtomicProtocolRejection=text(node?.decision_payload?.prior_atomic_protocol_rejection).toUpperCase();
    const atomicOverflowRecovery=
      atomicUnavailable && priorAtomicRejection==='TRUNCATED_RESPONSE';
    const normalizedBranchDepth=pathDepth(node.node_path);
    const storageDepthAvailable=Number.isFinite(normalizedBranchDepth)
      &&normalizedBranchDepth<semanticRuntime.hard_storage_path_depth;

    let contextState=asObject(node?.decision_payload?.context_resource_state);
    if(!['agent_visible_context_resource_v0_2','agent_visible_context_resource_v0_3_autonomous_evidence_windows'].includes(contextState.version)){
      const legacyRounds=Math.max(
        0,
        Number(contextState.context_rounds_attempted||0),
        Number(node?.decision_payload?.context_round??-1)+1,
        Object.keys(contextPayload).filter(key=>/^external_research_round_\d+$/.test(key)).length
      );
      const priorState=contextState;
      contextState={
        ...priorState,
        version:'agent_visible_context_resource_v0_2',
        started_at:text(priorState.started_at)||new Date().toISOString(),
        active_context_elapsed_ms:Math.max(0,Number(priorState.active_context_elapsed_ms||0)),
        elapsed_accounting:'active_context_acquisition_only_v0_2',
        elapsed_accounting_migrated_at:new Date().toISOString(),
        context_rounds_attempted:legacyRounds,
        research_rounds_attempted:Math.max(0,Number(priorState.research_rounds_attempted??legacyRounds)),
        local_context_rounds_attempted:Math.max(0,Number(priorState.local_context_rounds_attempted||0)),
        stagnant_rounds:Math.max(0,Number(priorState.stagnant_rounds||0)),
        unchanged_gap_rounds:Math.max(0,Number(priorState.unchanged_gap_rounds||0)),
        repeated_request_rounds:Math.max(0,Number(priorState.repeated_request_rounds||0)),
        total_new_sources:Math.max(0,Number(priorState.total_new_sources||0)),
        total_new_local_context_paths:Math.max(0,Number(priorState.total_new_local_context_paths||0)),
        total_restored_pinned_evidence:Math.max(0,Number(priorState.total_restored_pinned_evidence||0)),
        last_gap_signal:priorState.last_gap_signal||null,
        last_request_signal:priorState.last_request_signal||null,
      };
    }

    while(true){
      contextPayload=boundInMemoryContext(contextPayload,pinnedEvidence,10000);
      const discoveryContextView=agentModelContextView(contextPayload,pinnedEvidence,10000);
      const siblingEvidence=discoveryContextView.siblingEvidence;
      const cognitionContext=discoveryContextView.suppliedContext;
      const runtimeView=await semanticRuntimeView();
      const branchEconomics=projectedBranchEconomics(contextPayload,pinnedEvidence);
      const availableChildCapacity=semanticChildCapacity({
        remainingBudgetUnits:Number(runtimeView?.remaining_budget_units||0),
        nodeCreateUnits:semanticRuntime.node_create_units,
        safetyReserveUnits:semanticRuntime.safety_reserve_units,
        expectedChildLifecycleUnits:branchEconomics.expected_child_lifecycle_units,
        completionReserveUnits:branchEconomics.completion_reserve_units,
        maxChildren:MAX_CHILDREN_PER_NODE,
      });
      const splitAvailable=storageDepthAvailable&&availableChildCapacity>=1;
      const structuralBranchingAvailable=splitAvailable&&availableChildCapacity>=2;
      const singleRefinementAvailable=splitAvailable;
      const resourceView=contextResourceView(contextState,contextPayload);
      const remediationEpisodes=await loadRemediationEpisodes(node.node_path);
      const remediationAttemptsUsed=remediationEpisodes.length;
      const activeRemediation=latestActiveRemediation(remediationEpisodes);
      if(activeRemediation&&String(activeRemediation.status)==='proposed'){
        const resumed=await resumeSelfRemediationEpisode(node,activeRemediation,{
          contextPayload,
          pinnedEvidence,
          siblingEvidence,
        });
        node=resumed.node;
        contextPayload=resumed.contextPayload;
        if(resumed.resume_mode==='SYNTHESIS')
          return {node,decision:'SPLIT',self_remediation_applied:true};
        continue;
      }
      if(activeRemediation&&String(activeRemediation.status)==='verifying'){
        const resumed=await resumeSelfRemediationEpisode(node,activeRemediation,{
          contextPayload,
          pinnedEvidence,
          siblingEvidence,
        });
        node=resumed.node;
        contextPayload=resumed.contextPayload;
        if(resumed.resume_mode==='SYNTHESIS')
          return {node,decision:'SPLIT',self_remediation_verifying:true};
        continue;
      }
      if(
        activeRemediation
        &&String(activeRemediation.status)==='applied'
        &&selfRemediationVerificationBoundary(activeRemediation.repair_type,activeRemediation)!=='POST_FRESH_DISCOVERY'
      ){
        return {node,decision:'SPLIT',self_remediation_applied:true};
      }
      const priorCognitiveState=asObject(node?.decision_payload?.routing_discovery_checkpoint);
      const lastRemediation=asObject(node?.decision_payload?.last_self_remediation);
      const synthesisFailure=asObject(node?.decision_payload?.synthesis_failure);
      const allowedRemediationRepairs=Object.keys(synthesisFailure).length
        ?SELF_REMEDIATION_REPAIR_TYPES
        :SELF_REMEDIATION_REPAIR_TYPES.filter(
          v=>v!=='REBUILD_SYNTHESIS_FROM_RESOLVED_EVIDENCE'
        );
      const remediationAvailable=
        !activeRemediation
        &&remediationAttemptsUsed<MAX_SELF_REMEDIATION_ATTEMPTS
        && (
          priorCognitiveState.version==='agent_deep_discovery_v0_1'
          || text(lastRemediation.status).toUpperCase()==='FAILED'
          || Object.keys(synthesisFailure).length>0
        );
      // Semantic routing and runtime admission are separate authorities.
      // Ordinarily the agent can still state NEED_CONTEXT even when the current
      // evidence window is temporarily exhausted. A HARD evidence ceiling is
      // different: the bounded acquisition strategy has converged (repeating /
      // no new observations / renewal limit), so control returns to the agent
      // to resolve the requirement from durable evidence rather than pausing
      // the whole lifecycle or repeating retrieval forever.
      const evidenceCeilingResolution=asObject(
        node?.decision_payload?.evidence_ceiling_resolution
      );
      const evidenceAcquisitionClosed=evidenceCeilingResolution.status==='ACTIVE';
      const synthesisRecoveryRouting=Object.keys(synthesisFailure).length>0;
      // A synthesis failure is downstream of successful decomposition. An old
      // atomic-overflow marker must not force the already-resolved parent back
      // into SPLIT or hide REMEDIATE. At this boundary the agent owns recovery:
      // repair the synthesis, request genuinely missing context, or conclude BLOCKED.
      const availableDecisions=synthesisRecoveryRouting
        ? [
            ...(remediationAvailable?['REMEDIATE']:[]),
            ...(!evidenceAcquisitionClosed?['NEED_CONTEXT']:[]),
            'BLOCKED',
          ]
        : atomicOverflowRecovery
          ? ['SPLIT']
          : [
              'ATOMIC',
              'SPLIT',
              ...(!evidenceAcquisitionClosed?['NEED_CONTEXT']:[]),
              'BLOCKED',
              ...(remediationAvailable?['REMEDIATE']:[]),
            ];
      if(atomicOverflowRecovery&&!synthesisRecoveryRouting){
        console.warn('AAU_ATOMIC_TRUNCATION_DECOMPOSITION_REQUIRED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          atomic_execution_failures:atomicExecutionFailures,
          prior_atomic_rejection:priorAtomicRejection,
          policy:'bounded_overflow_requires_agent_authored_split_v0_1',
        }));
      }

      // Semantic checkpoint identity deliberately excludes remaining budget,
      // child capacity, wake attempt, and resource-exhaustion counters. A
      // failed attempt spending compute cannot invalidate the cognition it is
      // supposed to resume. Evidence/state changes still create a new identity.
      const contextFingerprint=sha256(safeJson(canonicalizeHashValue({
        contract:'semantic_discovery_fingerprint_v0_3_stable_evidence_identity',
        node_path:node.node_path,
        requirement:node.requirement_text,
        context_evidence:semanticContextIdentity(contextPayload),
        pinned_evidence_index:pinnedEvidence.map(v=>({
          source_key:v.source_key,source_id:v.source_id,url:v.url,sha256:v.sha256,excerpt_bytes:v.excerpt_bytes
        })).sort((a,b)=>String(a.url||a.source_id||a.source_key||'').localeCompare(String(b.url||b.source_id||b.source_key||''))),
        authoritative_sibling_results:siblingEvidence.map(v=>({
          path:v.path,status:v.status,decision_type:v.decision_type,result_hash:v.result_hash,
          evidence_scope:v.evidence_scope||null
        })).sort((a,b)=>String(a.path||'').localeCompare(String(b.path||''))),
        remediation_history:compactRemediationEpisodes(remediationEpisodes),
        synthesis_failure:Object.keys(synthesisFailure).length?{
          contract:text(synthesisFailure.contract)||null,
          failure_type:text(synthesisFailure.failure_type)||null,
          reason:clip(synthesisFailure.reason,1800)||null,
          failed_at:text(synthesisFailure.failed_at)||null,
          accumulator_hash:text(synthesisFailure.accumulator_hash)||null,
          child_state_hash:text(synthesisFailure.child_state_hash)||null,
          child_result_hashes:asArray(synthesisFailure.child_result_hashes).map(v=>({
            path:text(v?.path),status:text(v?.status),
            decision_type:text(v?.decision_type),result_hash:text(v?.result_hash)
          })),
          review_status:text(synthesisFailure?.review?.status)||null,
          review_issues:asArray(synthesisFailure?.review?.issues).map(v=>clip(text(v),700)),
        }:null,
        child_authoring_failure_count:Number(node?.decision_payload?.child_authoring_failure_count||0),
        child_authoring_failure:asObject(node?.decision_payload?.child_authoring_failure),
        force_reconsider:Boolean(forceReconsider),
        evidence_acquisition_closed:evidenceAcquisitionClosed,
        evidence_ceiling_reason:evidenceCeilingResolution.reason||null,
        evidence_ceiling_resource_reasons:asArray(evidenceCeilingResolution.resource_reasons),
        atomic_execution_failures:atomicExecutionFailures,
        atomic_overflow_recovery:atomicOverflowRecovery,
        prior_atomic_rejection:priorAtomicRejection||null,
      })));

      const priorPayload=asObject(node.decision_payload);
      const priorDiscovery=asObject(priorPayload.routing_discovery_checkpoint);
      const priorDecision=text(priorDiscovery.decision).toUpperCase();
      const priorAdmission=asObject(priorPayload.routing_admission);
      const priorResource=asObject(priorDiscovery.context_resource_state);
      const priorDirectHashes=asArray(priorDiscovery.authoritative_sibling_result_hashes)
        .map(v=>({path:text(v?.path),result_hash:text(v?.result_hash)}))
        .sort((a,b)=>a.path.localeCompare(b.path));
      const priorDependencyHashes=asArray(priorDiscovery.authoritative_dependency_result_hashes)
        .map(v=>({path:text(v?.path),result_hash:text(v?.result_hash)}))
        .sort((a,b)=>a.path.localeCompare(b.path));
      const currentDirectHashes=siblingEvidence
        .filter(v=>text(v?.evidence_scope)!=='ancestor_dependency')
        .map(v=>({path:text(v?.path),result_hash:text(v?.result_hash)}))
        .sort((a,b)=>a.path.localeCompare(b.path));
      const currentDependencyHashes=siblingEvidence
        .filter(v=>text(v?.evidence_scope)==='ancestor_dependency')
        .map(v=>({path:text(v?.path),result_hash:text(v?.result_hash)}))
        .sort((a,b)=>a.path.localeCompare(b.path));
      const deferredAdmissionReplaySafe=
        priorAdmission.status==='DEFERRED'
        && priorAdmission.semantic_decision===priorDecision
        && priorDiscovery.version==='agent_deep_discovery_v0_1'
        && priorDiscovery.context_fingerprint===contextFingerprint
        && availableDecisions.includes(priorDecision)
        && !forceReconsider
        && Number(priorResource.unique_sources??-1)===Number(resourceView.unique_sources??-2)
        && Number(priorResource.context_rounds_attempted??-1)===Number(resourceView.context_rounds_attempted??-2)
        && Number(priorResource.active_context_elapsed_ms??-1)===Number(resourceView.active_context_elapsed_ms??-2)
        && safeJson(priorDirectHashes)===safeJson(currentDirectHashes)
        && safeJson(priorDependencyHashes)===safeJson(currentDependencyHashes);
      const reusableDiscovery=
        deferredAdmissionReplaySafe
        ||(
          priorDiscovery.version==='agent_deep_discovery_v0_1'
          && priorDiscovery.context_fingerprint===contextFingerprint
          && availableDecisions.includes(priorDecision)
        );

      let discovery=reusableDiscovery?priorDiscovery:null;

      if(!discovery){
        let siblingInspectionRetry=null;
        let siblingInspectionUnconfirmed=null;
        const durableDiscovery=await loadJsonPhaseCheckpoint(
          node.node_path,'DISCOVERY',contextFingerprint
        );
        for(let attempt=1;attempt<=2;attempt++){
          try{
            const response=durableDiscovery.parsed
              ? {parsed:durableDiscovery.parsed,checkpoint_reused:true}
              : await callJson([
              {role:'system',content:[
                'You are the bound autonomous agent performing a DEEP DISCOVERY pass for ONE requirement.',
                'Thinking is enabled. This pass is where YOU determine what the requirement means and what action YOU intend to take.',
                'The runtime does not choose, reinterpret, decompose, repair, or declare the requirement blocked for you.',
                'Available decisions for this exact node: '+availableDecisions.join(', ')+'.',
                'CANONICAL STAGE-4 LEDGER: when supplied_context.expertise_candidate_ledger is available, it is the authoritative current-cohort record of already submitted candidate domains, ordinals, and progress. Use it for distinctness/progress checks. Do not reconstruct those facts from recent_activity, historical trees, or prior invalidated cohorts.',
                'CANONICAL PRIOR-LEARNING LEDGER: when supplied_context.entrepreneurship_masters or supplied_context.agent.competency_verification_records is available, it is the authoritative verified competency record for cumulative transfer. Use those records directly for prior_learning_application; do not ask for a separate competency ledger that already exists in supplied context.',
                remediationAvailable
                  ? 'REMEDIATE is available because you have a prior durable cognitive state and remaining remediation budget. Choose it only if YOU detect a contradiction, stale belief, or recoverable cognitive-state failure in your own prior reasoning. The runtime will not diagnose the anomaly for you.'
                  : 'REMEDIATE is mechanically unavailable because there is no eligible prior cognitive state or the remediation budget is exhausted.',
                'If you choose REMEDIATE, YOU must supply observed_anomaly, prior_belief, contradicting_evidence, diagnosis, repair_type, repair_payload, and verification_criterion. Allowed repair types for THIS node are '+allowedRemediationRepairs.join(', ')+'. INVALIDATE_DISCOVERY_CHECKPOINT supersedes your current discovery checkpoint and requires fresh discovery before verification. REFRESH_SIBLING_EVIDENCE mechanically reloads resolved siblings, supersedes discovery, and requires fresh discovery before verification. REBUILD_SYNTHESIS_FROM_RESOLVED_EVIDENCE is available only after a durable synthesis/provenance failure; it preserves resolved children, hashes, and the synthesis accumulator, clears only the failed final-synthesis/provenance surface, and verifies only after a fresh synthesis passes deterministic/provenance checks. No repair changes facts, conclusions, atomic-failure counts, completed child artifacts, or hard resource ceilings.',
                atomicOverflowRecovery
                  ? 'BOUNDED ATOMIC OVERFLOW RECOVERY: your prior bounded atomic execution exhausted the output limit twice and both partial responses were rejected. ATOMIC is mechanically unavailable for this node. Choose SPLIT and author one or more genuinely narrower child requirements that can each finish independently within the existing output bound. Preserve the original requirement; do not solve it by deleting scope, inflating token limits, or continuing truncated text.'
                  : atomicUnavailable
                    ? 'ATOMIC execution admission is mechanically unavailable for this node after a prior rejected bounded execution. Choose another available semantic action; do not repeat the rejected execution unchanged.'
                    : 'ATOMIC is semantically available if you judge the requirement genuinely bounded.',
                routingPythonCalculation
                  ? 'AUTHORITATIVE PYTHON ROUTING EVIDENCE: supplied_context.runtime_python_calculation already contains the deterministic numeric solution for this QDA value-of-information case. Do not SPLIT merely to protect arithmetic precision, recompute intermediate values, or avoid rounding. Prefer ATOMIC when the remaining work is only to select, explain, structure, sanity-check, or bind these already-computed values. SPLIT remains valid only for genuinely independent semantic scope.'
                  : null,
                'RESOURCE ADVISORY ONLY: '+Number(runtimeView?.remaining_budget_units||0)+' units remain. Current execution admission can support '+availableChildCapacity+' child branch(es), priced at approximately '+branchEconomics.expected_child_lifecycle_units+' units each while protecting '+branchEconomics.completion_reserve_units+' units for completion. Do not change your semantic routing judgment merely to fit this resource snapshot; the runtime handles admission separately.',
                storageDepthAvailable
                  ? 'Tree depth is not the ordinary stopping rule. If SPLIT is semantically correct, choose SPLIT; runtime admission will separately determine how many children can be started now.'
                  : 'EMERGENCY STORAGE GUARD: this durable path reached '+semanticRuntime.hard_storage_path_depth+' levels. If SPLIT is still semantically correct, choose SPLIT anyway. The runtime will preserve the decision and defer execution rather than forcing a different substantive answer.',
                evidenceAcquisitionClosed
                  ? 'HARD EVIDENCE CEILING: bounded context acquisition for THIS node is now closed because prior retrieval converged without material new observations ('+asArray(evidenceCeilingResolution.resource_reasons).join(', ')+'). NEED_CONTEXT is mechanically unavailable in this reconsideration. You own the semantic resolution: choose ATOMIC if the requirement can be completed honestly from durable evidence while preserving unresolved criteria as UNKNOWN/hypotheses and using validation/kill criteria; choose SPLIT only when genuinely independent remaining work exists (never merely to reopen research); choose BLOCKED if you judge the requirement cannot honestly be completed under the established evidence boundary. Do not repeat retrieval requests.'
                  : resourceView.available
                    ? 'Context/research admission is currently available. Choose NEED_CONTEXT only when another retrieval or exact context lookup can materially reduce a stated gap.'
                    : 'CONTEXT RESOURCE CONSTRAINT: the current evidence window reports: '+resourceView.reasons.join(', ')+'. This does NOT make NEED_CONTEXT semantically false. If more evidence is genuinely required, choose NEED_CONTEXT. The runtime will autonomously test whether another bounded evidence window is economically admissible; only a true hard/economic stop is deferred.',
                evidenceAcquisitionClosed
                  ? 'BLOCKED BASIS CONTRACT UNDER HARD EVIDENCE CEILING: BLOCKED remains YOUR semantic conclusion. EVIDENCE_PROVES_BLOCKED means current evidence disproves/defeats the requirement. MORE_EVIDENCE_REQUIRED is also permitted here only when YOU conclude the requirement cannot be completed honestly after the bounded evidence strategy has converged; it will remain a branch-local BLOCKED result rather than reopening context or pausing the lifecycle.'
                  : 'BLOCKED BASIS CONTRACT: BLOCKED is a semantic conclusion, never a resource status. If the current evidence itself proves the requirement cannot honestly be completed, choose BLOCKED with block_basis=EVIDENCE_PROVES_BLOCKED. If completion merely requires evidence/context that is not currently available, choose NEED_CONTEXT. If you nevertheless serialize BLOCKED with block_basis=MORE_EVIDENCE_REQUIRED, the runtime will normalize it to NEED_CONTEXT without changing the stated evidence gap.',
                'Before deciding, interrogate semantic equivalence, definitions, time horizons, populations/scopes, proxy metrics, evidence sufficiency, assumptions, and unresolved gaps.',
                'REPEATED ACQUISITION RULE: if an exact context/research request has already been repeated and the required evidence remains unresolved, do not issue the same request again. Use materially different retrieval if one exists; otherwise preserve the criterion as UNKNOWN when the task can proceed, or choose BLOCKED when the unresolved evidence prevents honest completion.',
                'AUTHORITATIVE DEPENDENCY HANDOFF: authoritative_completed_sibling_evidence contains both direct resolved siblings and inherited prerequisite results routed from ancestor branches. evidence_scope=ancestor_dependency means the result was already made available to an ancestor and must remain available down this branch. Inspect this durable evidence before deciding NEED_CONTEXT; do not research again for information already present here.',
                'Only evidence_scope=direct_sibling paths are subject to inspected_sibling_paths attention accounting. Inherited ancestor dependencies do not require path echoing; they are durable prerequisite context, not a serialization invariant.',
                siblingInspectionRetry
                  ? 'SIBLING INSPECTION RETRY: Your immediately prior discovery output was rejected only because it omitted required sibling path(s) from inspected_sibling_paths. Re-inspect the exact evidence rows named in sibling_inspection_retry.missing_paths before deciding again. Do not merely echo those paths: reconsider your evidence assessment and routing decision in light of the re-inspected sibling evidence. You may preserve or change your prior decision, but the new output must be fully agent-authored and must explicitly account for every supplied sibling path.'
                  : '',
                'Do not treat a nearby metric or label as equivalent unless YOU can justify the equivalence from supplied evidence.',
                'EPISTEMIC THRESHOLD POLICY: '+THRESHOLD_EVIDENCE_POLICY.RULE+' '+THRESHOLD_EVIDENCE_POLICY.PASS+' '+THRESHOLD_EVIDENCE_POLICY.FAIL+' '+THRESHOLD_EVIDENCE_POLICY.UNKNOWN,
                'When supplied_context contains research_source_catalog, treat it as the complete discoverable source index for prior research rounds. If context acquisition is available and a source is indexed but its excerpt is insufficient, put its exact listed HTTPS URL in research_urls (not context_requests) so the runtime can fetch it directly.',
                'Do not solve the requirement or author child requirements in this pass.',
                'Return complete JSON only: {"decision":"ATOMIC|SPLIT|NEED_CONTEXT|BLOCKED|REMEDIATE","block_basis":"EVIDENCE_PROVES_BLOCKED|MORE_EVIDENCE_REQUIRED|null","reason":"auditable reason","requirement_interpretation":"what this requirement actually demands","evidence_assessment":"what the current evidence does and does not establish","inspected_sibling_paths":["R.001..."],"unresolved_gaps":["..."],"context_requests":["exact.path"],"research_queries":["query"],"research_urls":["https://..."],"remediation":{"observed_anomaly":"required when REMEDIATE","prior_belief":"required when REMEDIATE","contradicting_evidence":[],"diagnosis":"required when REMEDIATE","repair_type":"one value from runtime_resource_constraints.allowed_self_remediation_repairs","repair_payload":{},"verification_criterion":"required when REMEDIATE"}}. When decision=BLOCKED, block_basis is required. Use MORE_EVIDENCE_REQUIRED when the gap could be resolved by additional evidence, even if runtime resources are currently exhausted.',
                forceReconsider
                  ? 'A prior atomic execution was rejected or exhausted. Reconsider the requirement under the persisted constraints rather than repeating the failed action.'
                  : '',
              ].filter(Boolean).join('\n')},
              {role:'user',content:safeJson({
                requirement:node.requirement_text,
                agent_authored_discovery_state:agentDiscoveryState(node),
                source:{kind:node.source_kind,ref:node.source_ref},
                authoritative_completed_sibling_evidence:siblingEvidence,
                sibling_inspection_retry:siblingInspectionRetry,
                prior_cognitive_state:priorCognitiveState,
                synthesis_failure:synthesisFailure,
                active_self_remediation:activeRemediation?compactRemediationEpisodes([activeRemediation])[0]:null,
                durable_self_remediation_history:compactRemediationEpisodes(remediationEpisodes),
                decomposition_execution_failure:asObject(node?.decision_payload?.child_authoring_failure),
                supplied_context:cognitionContext,
                available_context_index:idx,
                available_supplied_context_index:indexObject(cognitionContext),
                available_decisions:availableDecisions,
                runtime_resource_constraints:{
                  semantic_runtime_contract:SEMANTIC_RUNTIME_CONTRACT,
                  epoch_no:semanticRuntime.epoch_no,
                  remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
                  initial_budget_units:Number(runtimeView?.initial_budget_units||semanticRuntime.initial_budget_units),
                  budget_quantum_tokens:semanticRuntime.quantum_tokens,
                  semantic_child_capacity:availableChildCapacity,
                  semantic_branch_economics_contract:branchEconomics.contract,
                  expected_child_lifecycle_units:branchEconomics.expected_child_lifecycle_units,
                  completion_reserve_units:branchEconomics.completion_reserve_units,
                  branch_economics_components:branchEconomics.components,
                  storage_path_depth:normalizedBranchDepth,
                  emergency_storage_path_depth:semanticRuntime.hard_storage_path_depth,
                  multi_child_split_available:structuralBranchingAvailable,
                  single_child_refinement_available:singleRefinementAvailable,
                  context_acquisition_available:resourceView.available,
                  context_acquisition_exhausted:resourceView.exhausted,
                  context_exhaustion_reasons:resourceView.reasons,
                  context_rounds_attempted:resourceView.context_rounds_attempted,
                  research_rounds_attempted:resourceView.research_rounds_attempted,
                  local_context_rounds_attempted:resourceView.local_context_rounds_attempted,
                  stagnant_rounds:resourceView.stagnant_rounds,
                  unchanged_gap_rounds:resourceView.unchanged_gap_rounds,
                  repeated_request_rounds:resourceView.repeated_request_rounds,
                  elapsed_context_acquisition_ms:resourceView.elapsed_ms,
                  unique_research_sources:resourceView.unique_sources,
                  self_remediation_available:remediationAvailable,
                  self_remediation_attempts_used:remediationAttemptsUsed,
                  max_self_remediation_attempts:MAX_SELF_REMEDIATION_ATTEMPTS,
                  allowed_self_remediation_repairs:allowedRemediationRepairs,
                  model_runtime_contract:{
                    model_id:agentRuntimeContract.model_id,
                    operational_context_limit_tokens:agentRuntimeContract.operational_context_limit_tokens,
                    max_output_tokens:agentRuntimeContract.max_output_tokens,
                    input_safety_margin_tokens:agentRuntimeContract.input_safety_margin_tokens,
                    safe_input_tokens:discoveryContextView.safeInputTokens,
                    supplied_context_budget_tokens:discoveryContextView.contextBudget,
                    estimated_supplied_context_tokens:discoveryContextView.estimatedSuppliedTokens,
                  },
                },
              })},
            ],10000,'req_'+node.node_path.replaceAll('.','_')+'_discovery_'+(resourceView.context_rounds_attempted+1)+'_'+attempt);

            const candidate=asObject(response?.parsed);
            const rawCandidateDecision=text(candidate.decision).toUpperCase();
            let candidateDecision=rawCandidateDecision;
            if(
              rawCandidateDecision==='REMEDIATE'
              &&!allowedRemediationRepairs.includes(
                text(candidate?.remediation?.repair_type).toUpperCase()
              )
            ){
              if(attempt===2)
                throw new Error('autonomous_decomposition_remediation_repair_not_available:'+node.node_path);
              continue;
            }
            const blockBasis=text(candidate.block_basis).toUpperCase();
            let blockNormalization=null;

            if(rawCandidateDecision==='BLOCKED'){
              const validBlockBasis=['EVIDENCE_PROVES_BLOCKED','MORE_EVIDENCE_REQUIRED'].includes(blockBasis);
              if(!validBlockBasis&&!durableDiscovery.parsed){
                if(attempt===2)
                  throw new Error('autonomous_decomposition_block_basis_invalid:'+node.node_path);
                continue;
              }
              if(blockBasis==='MORE_EVIDENCE_REQUIRED'&&!evidenceAcquisitionClosed){
                candidateDecision='NEED_CONTEXT';
                blockNormalization={
                  contract:'resource_independent_block_normalization_v0_1',
                  raw_decision:'BLOCKED',
                  normalized_decision:'NEED_CONTEXT',
                  block_basis:blockBasis,
                  reason:'more_evidence_required_is_not_semantic_blocked',
                  context_resource_available:resourceView.available,
                  context_resource_reasons:resourceView.reasons,
                  normalized_at:new Date().toISOString(),
                };
                console.warn('AAU_RESOURCE_BLOCK_NORMALIZED',JSON.stringify({
                  agent_id:agentId,
                  intent_execution_id:intentExecutionId,
                  node_path:node.node_path,
                  raw_decision:'BLOCKED',
                  normalized_decision:'NEED_CONTEXT',
                  block_basis:blockBasis,
                  context_resource_available:resourceView.available,
                  context_resource_reasons:resourceView.reasons,
                }));
              }else if(blockBasis==='MORE_EVIDENCE_REQUIRED'&&evidenceAcquisitionClosed){
                blockNormalization={
                  contract:'bounded_evidence_ceiling_branch_resolution_v0_1',
                  raw_decision:'BLOCKED',
                  normalized_decision:'BLOCKED',
                  block_basis:blockBasis,
                  reason:'bound_agent_declared_requirement_not_honestly_completable_after_bounded_evidence_convergence',
                  context_resource_available:false,
                  context_resource_reasons:resourceView.reasons,
                  normalized_at:new Date().toISOString(),
                };
              }
            }

            if(!availableDecisions.includes(candidateDecision)){
              if(attempt===2)throw new Error('autonomous_decomposition_discovery_invalid_available_action:'+node.node_path);
              continue;
            }
            if(candidateDecision==='REMEDIATE'){
              const remediation=asObject(candidate.remediation);
              const repairType=text(remediation.repair_type).toUpperCase();
              const validRemediation=
                remediationAvailable
                && SELF_REMEDIATION_REPAIR_TYPES.includes(repairType)
                && text(remediation.observed_anomaly).length>=8
                && text(remediation.prior_belief).length>=3
                && text(remediation.diagnosis).length>=8
                && text(remediation.verification_criterion).length>=8
                && asArray(remediation.contradicting_evidence).length>0;
              if(!validRemediation){
                if(attempt===2)throw new Error('autonomous_decomposition_discovery_invalid_remediation:'+node.node_path);
                continue;
              }
            }
            const directSiblingEvidence=siblingEvidence.filter(
              row=>text(row?.evidence_scope)!=='ancestor_dependency'
            );
            const siblingInspection=durableSiblingInspection({
              siblingEvidence:directSiblingEvidence,
              candidateInspectedPaths:asArray(candidate.inspected_sibling_paths).map(text).filter(Boolean),
              priorDiscovery,
            });
            const missingSiblingInspection=siblingInspection.missing_paths;
            if(missingSiblingInspection.length){
              if(attempt===2){
                siblingInspectionUnconfirmed={
                  reason:'agent_did_not_serialize_sibling_attention_after_explicit_retry',
                  paths:missingSiblingInspection,
                  evidence_hashes:siblingEvidence
                    .filter(v=>missingSiblingInspection.includes(text(v?.path)))
                    .map(v=>({path:text(v?.path),result_hash:text(v?.result_hash)||null})),
                  candidate_decision:candidateDecision,
                  candidate_reason:clip(candidate.reason,1400),
                };
                console.warn('AAU_AUTONOMOUS_SIBLING_INSPECTION_UNCONFIRMED',JSON.stringify({
                  agent_id:agentId,
                  intent_execution_id:intentExecutionId,
                  node_path:node.node_path,
                  missing_paths:missingSiblingInspection,
                  candidate_decision:candidateDecision,
                  policy:'durable_warning_not_wake_failure',
                }));
              }else{
                siblingInspectionRetry={
                  reason:'prior_discovery_omitted_required_or_changed_sibling_attention_accounting',
                  missing_paths:missingSiblingInspection,
                  prior_inspected_paths:siblingInspection.inspected_paths,
                  invalidated_paths:siblingInspection.invalidated_paths,
                  prior_decision:candidateDecision,
                  prior_reason:clip(candidate.reason,1400),
                  evidence_to_reinspect:siblingEvidence.filter(v=>missingSiblingInspection.includes(text(v?.path))),
                };
                console.log('AAU_AUTONOMOUS_SIBLING_INSPECTION_RETRY',JSON.stringify({
                  agent_id:agentId,
                  intent_execution_id:intentExecutionId,
                  node_path:node.node_path,
                  missing_paths:missingSiblingInspection,
                  prior_decision:candidateDecision,
                }));
                continue;
              }
            }

            const durableUnconfirmedSiblingPaths=[...new Set([
              ...siblingInspection.inherited_unconfirmed_paths,
              ...asArray(siblingInspectionUnconfirmed?.paths).map(text).filter(Boolean),
            ])];

            const normalizedCandidate={
              ...candidate,
              decision:candidateDecision,
              raw_decision:rawCandidateDecision,
              block_basis:blockBasis||null,
              block_normalization:blockNormalization,
            };

            if(!durableDiscovery.parsed){
              await saveJsonPhaseCheckpoint(
                node.node_path,'DISCOVERY',contextFingerprint,normalizedCandidate,{
                  semantic_fingerprint:contextFingerprint,
                  semantic_decision:candidateDecision,
                  raw_semantic_decision:rawCandidateDecision,
                  block_basis:blockBasis||null,
                  resource_block_normalized:Boolean(blockNormalization),
                  resource_independent_identity:true,
                }
              );
            }

            discovery={
              version:'agent_deep_discovery_v0_1',
              context_fingerprint:contextFingerprint,
              decision:candidateDecision,
              raw_decision:rawCandidateDecision,
              block_basis:blockBasis||null,
              block_normalization:blockNormalization,
              reason:clip(candidate.reason,2200),
              requirement_interpretation:clip(candidate.requirement_interpretation,2800),
              evidence_assessment:clip(candidate.evidence_assessment,3200),
              inspected_sibling_paths:siblingInspection.inspected_paths.slice(0,16),
              inherited_sibling_inspection_paths:siblingInspection.inherited_paths.slice(0,16),
              inherited_unconfirmed_sibling_inspection_paths:siblingInspection.inherited_unconfirmed_paths.slice(0,16),
              invalidated_sibling_inspection_paths:siblingInspection.invalidated_paths.slice(0,16),
              sibling_inspection_unconfirmed_paths:durableUnconfirmedSiblingPaths.slice(0,16),
              sibling_inspection_accounting_status:durableUnconfirmedSiblingPaths.length
                ?'evidence_delivered_acknowledgment_unconfirmed'
                :'agent_acknowledged',
              sibling_inspection_unconfirmed_reason:siblingInspectionUnconfirmed?.reason
                ||(durableUnconfirmedSiblingPaths.length
                  ?text(priorDiscovery.sibling_inspection_unconfirmed_reason)
                    ||'prior_unconfirmed_acknowledgment_inherited_for_unchanged_hash'
                  :null),
              sibling_inspection_state_version:'monotonic_result_hash_v0_2_delivery_separated_from_acknowledgment',
              sibling_inspection_retry_applied:Boolean(siblingInspectionRetry),
              sibling_inspection_retry_missing_paths:asArray(siblingInspectionRetry?.missing_paths).map(text).filter(Boolean).slice(0,16),
              authoritative_sibling_result_hashes:siblingEvidence
                .filter(v=>text(v?.evidence_scope)!=='ancestor_dependency')
                .map(v=>({path:v.path,result_hash:v.result_hash})),
              authoritative_dependency_result_hashes:siblingEvidence
                .filter(v=>text(v?.evidence_scope)==='ancestor_dependency')
                .map(v=>({path:v.path,result_hash:v.result_hash})),
              remediation_prior_state:candidateDecision==='REMEDIATE'?{
                decision:text(priorCognitiveState.decision)||null,
                reason:clip(priorCognitiveState.reason,1800)||null,
                requirement_interpretation:clip(priorCognitiveState.requirement_interpretation,1800)||null,
                evidence_assessment:clip(priorCognitiveState.evidence_assessment,2200)||null,
                unresolved_gaps:asArray(priorCognitiveState.unresolved_gaps).map(v=>clip(text(v),600)).slice(0,12),
                context_fingerprint:text(priorCognitiveState.context_fingerprint)||null,
                authoritative_sibling_result_hashes:asArray(priorCognitiveState.authoritative_sibling_result_hashes).slice(0,12),
              }:null,
              remediation:candidateDecision==='REMEDIATE'?{
                observed_anomaly:clip(candidate?.remediation?.observed_anomaly,2400),
                prior_belief:clip(candidate?.remediation?.prior_belief,2400),
                contradicting_evidence:asArray(candidate?.remediation?.contradicting_evidence).slice(0,16),
                diagnosis:clip(candidate?.remediation?.diagnosis,3000),
                repair_type:text(candidate?.remediation?.repair_type).toUpperCase(),
                repair_payload:asObject(candidate?.remediation?.repair_payload),
                verification_criterion:clip(candidate?.remediation?.verification_criterion,2400),
              }:null,
              unresolved_gaps:asArray(candidate.unresolved_gaps).map(v=>clip(text(v),900)).filter(Boolean).slice(0,16),
              context_requests:asArray(candidate.context_requests).map(text).filter(Boolean).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND),
              research_queries:asArray(candidate.research_queries).map(text).filter(Boolean).slice(0,8),
              research_urls:asArray(candidate.research_urls).map(text).filter(v=>/^https:\/\//i.test(v)).slice(0,8),
              force_reconsider:Boolean(forceReconsider),
              atomic_unavailable:atomicUnavailable,
              atomic_execution_failures:atomicExecutionFailures,
              atomic_overflow_recovery:atomicOverflowRecovery,
              prior_atomic_rejection:priorAtomicRejection||null,
              semantic_runtime_contract:SEMANTIC_RUNTIME_CONTRACT,
              remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
              semantic_child_capacity:availableChildCapacity,
              semantic_branch_economics_contract:branchEconomics.contract,
              expected_child_lifecycle_units:branchEconomics.expected_child_lifecycle_units,
              completion_reserve_units:branchEconomics.completion_reserve_units,
              branch_economics_components:branchEconomics.components,
              storage_path_depth:normalizedBranchDepth,
              emergency_storage_path_depth:semanticRuntime.hard_storage_path_depth,
              multi_child_split_available:structuralBranchingAvailable,
              single_child_refinement_available:singleRefinementAvailable,
              context_resource_state:resourceView,
            };

            node=await saveNode({
              nodePath:node.node_path,
              parentPath:node.parent_path??parentPathOf(node.node_path),
              ordinal:node.ordinal||0,
              requirement:node.requirement_text,
              sourceKind:node.source_kind,
              sourceRef:node.source_ref,
              status:'deciding',
              decisionType:null,
              decisionPayload:{
                ...(node.decision_payload||{}),
                context_resource_state:contextState,
                routing_discovery_checkpoint:discovery,
                routing_discovery_checkpointed:true,
                routing_discovery_checkpointed_at:new Date().toISOString(),
                routing_protocol:'deep_discovery_then_commit_v0_2_agent_visible_context_resource',
              },
              contextPayload,
              resultArtifact:node.result_artifact||null,
            });
            node.parent_path=node.parent_path??parentPathOf(node.node_path);
            break;
          }catch(error){
            if(attempt===2)throw error;
            if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT'
               &&!String(error?.message||'').startsWith('autonomous_decomposition_discovery_invalid_available_action:'))throw error;
          }
        }
      }

      if(!discovery)throw new Error('autonomous_decomposition_discovery_checkpoint_missing:'+node.node_path);

      if(
        activeRemediation
        &&String(activeRemediation.status)==='applied'
        &&selfRemediationVerificationBoundary(activeRemediation.repair_type,activeRemediation)==='POST_FRESH_DISCOVERY'
      ){
        const verifiedRemediation=await verifyRemediationEpisode(node,activeRemediation,{
          contextPayload,
          pinnedEvidence,
          siblingEvidence,
          externalVerification:{
            kind:'fresh_discovery_checkpoint',
            ok:true,
            discovery_fingerprint:discovery.context_fingerprint,
            semantic_decision:discovery.decision,
            reason:'A fresh post-repair discovery checkpoint was produced from the repaired durable state.',
          },
          preserveCurrentCognition:true,
        });
        node=verifiedRemediation.node;
        contextPayload=verifiedRemediation.contextPayload;
        if(!verifiedRemediation.verified)continue;
      }

      let serialized=null;
      const routingCommitIdentity=sha256({
        discovery_fingerprint:discovery.context_fingerprint,
        decision:discovery.decision,
        reason:discovery.reason,
        context_requests:discovery.context_requests,
        research_queries:discovery.research_queries,
        research_urls:discovery.research_urls,
      });
      const durableRoutingCommit=await loadJsonPhaseCheckpoint(
        node.node_path,'ROUTE_COMMIT',routingCommitIdentity
      );
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=durableRoutingCommit.parsed
            ? {parsed:durableRoutingCommit.parsed,checkpoint_reused:true}
            : await callSerialize([
            {role:'system',content:[
              'You are serializing YOUR ALREADY-COMPLETED durable routing decision into the AAU protocol.',
              'Do not rethink, reinterpret, improve, or change the saved decision.',
              'Copy the saved decision faithfully into the required JSON shape.',
              'Return JSON only: {"decision":"ATOMIC|SPLIT|NEED_CONTEXT|BLOCKED|REMEDIATE","reason":"...","context_requests":[],"research_queries":[],"research_urls":[]}.',
            ].join('\n')},
            {role:'user',content:safeJson({
              saved_discovery_decision:{
                decision:discovery.decision,
                reason:discovery.reason,
                context_requests:discovery.context_requests,
                research_queries:discovery.research_queries,
                research_urls:discovery.research_urls,
              }
            })},
          ],700,'req_'+node.node_path.replaceAll('.','_')+'_routing_commit_'+(resourceView.context_rounds_attempted+1)+'_'+attempt);

          const candidate=asObject(response?.parsed);
          if(text(candidate.decision).toUpperCase()!==discovery.decision){
            if(attempt===2)throw new Error('autonomous_decomposition_routing_commit_mismatch:'+node.node_path);
            continue;
          }
          if(!durableRoutingCommit.parsed){
            await saveJsonPhaseCheckpoint(
              node.node_path,'ROUTE_COMMIT',routingCommitIdentity,candidate,{
                discovery_fingerprint:discovery.context_fingerprint,
                semantic_decision:discovery.decision,
              }
            );
          }
          serialized=candidate;
          break;
        }catch(error){
          if(attempt===2)throw error;
          if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT'
             &&!String(error?.message||'').startsWith('autonomous_decomposition_routing_commit_mismatch:'))throw error;
        }
      }

      if(!serialized)throw new Error('autonomous_decomposition_routing_commit_missing:'+node.node_path);

      const decision=discovery.decision;
      const decisionPayload={
        ...(node.decision_payload||{}),
        reason:discovery.reason,
        requirement_interpretation:discovery.requirement_interpretation,
        evidence_assessment:discovery.evidence_assessment,
        unresolved_gaps:discovery.unresolved_gaps,
        context_round:contextState.context_rounds_attempted,
        context_resource_state:contextState,
        force_reconsider:Boolean(forceReconsider),
        atomic_execution_failures:atomicExecutionFailures,
        atomic_unavailable:atomicUnavailable,
        atomic_overflow_recovery:atomicOverflowRecovery,
        prior_atomic_rejection:priorAtomicRejection||null,
        routing_discovery_checkpoint:discovery,
        routing_discovery_reused:Boolean(reusableDiscovery),
        routing_commit_serialized:true,
        routing_protocol:'deep_discovery_then_commit_v0_2_agent_visible_context_resource',
      };

      if(decision==='REMEDIATE'){
        const remediated=await executeSelfRemediation(node,discovery,{
          contextPayload,
          pinnedEvidence,
          siblingEvidence,
        });
        node=remediated.node;
        contextPayload=remediated.contextPayload;
        if(remediated.resume_mode==='SYNTHESIS')
          return {node,decision:'SPLIT',self_remediation_applied:true};
        continue;
      }

      let effectiveResourceView=resourceView;
      let evidenceRenewalAssessment=null;

      if(decision==='NEED_CONTEXT'&&!effectiveResourceView.available){
        const evidenceEconomics=projectedEvidenceRoundEconomics(
          contextPayload,pinnedEvidence,branchEconomics
        );
        const lastRound=asObject(contextState.last_round);
        const lastRoundProductive=
          !Object.keys(lastRound).length
          ||Number(lastRound.new_sources||0)>0
          ||Number(lastRound.new_local_context_paths||0)>0
          ||Number(lastRound.restored_pinned_evidence||0)>0;

        evidenceRenewalAssessment=autonomousEvidenceWindowDecision({
          resourceReasons:effectiveResourceView.reasons,
          remainingBudgetUnits:Number(runtimeView?.remaining_budget_units||0),
          projectedRoundUnits:evidenceEconomics.projected_round_units,
          completionReserveUnits:evidenceEconomics.completion_reserve_units,
          renewalsUsed:Number(contextState.evidence_window_renewals||0),
          maxRenewals:MAX_AUTONOMOUS_EVIDENCE_WINDOW_RENEWALS,
          lastRoundProductive,
        });

        if(evidenceRenewalAssessment.granted){
          const nextWindowNo=Math.max(0,Number(contextState.evidence_window_no||0))+1;
          const renewalAt=new Date().toISOString();
          contextState={
            ...contextState,
            version:'agent_visible_context_resource_v0_3_autonomous_evidence_windows',
            evidence_window_contract:'autonomous_evidence_window_v0_1',
            evidence_window_no:nextWindowNo,
            evidence_window_renewals:Number(contextState.evidence_window_renewals||0)+1,
            evidence_window_round_baseline:effectiveResourceView.context_rounds_attempted,
            evidence_window_source_baseline:effectiveResourceView.unique_sources,
            evidence_window_elapsed_baseline_ms:effectiveResourceView.active_context_elapsed_ms,
            evidence_window_started_at:renewalAt,
            evidence_window_last_grant:{
              ...evidenceRenewalAssessment,
              granted_at:renewalAt,
              prior_resource_reasons:effectiveResourceView.reasons,
              projected_economics:evidenceEconomics,
              last_round_productive:lastRoundProductive,
            },
          };

          await chargeSemanticRuntime({
            eventKind:'semantic_transition',
            materialKey:node.node_path+':evidence_window_renewal:'+String(nextWindowNo),
            nodePath:node.node_path,
            costUnits:1,
            eventFingerprint:sha256({
              node_path:node.node_path,
              phase:'autonomous_evidence_window_renewal',
              window_no:nextWindowNo,
              prior_resource_reasons:effectiveResourceView.reasons,
              unresolved_gaps:discovery.unresolved_gaps,
            }),
            metadata:{
              phase:'autonomous_evidence_window_renewal',
              contract:'autonomous_evidence_window_v0_1',
              window_no:nextWindowNo,
              prior_resource_reasons:effectiveResourceView.reasons,
              projected_round_units:evidenceEconomics.projected_round_units,
              completion_reserve_units:evidenceEconomics.completion_reserve_units,
              remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
              operator_approval_required:false,
            },
          });

          delete decisionPayload.routing_admission;
          decisionPayload.context_resource_state=contextState;
          decisionPayload.autonomous_evidence_window={
            status:'GRANTED',
            ...evidenceRenewalAssessment,
            window_no:nextWindowNo,
            granted_at:renewalAt,
            operator_approval_required:false,
          };
          effectiveResourceView=contextResourceView(contextState,contextPayload);

          console.log('AAU_AUTONOMOUS_EVIDENCE_WINDOW_GRANTED',JSON.stringify({
            agent_id:agentId,
            intent_execution_id:intentExecutionId,
            node_path:node.node_path,
            window_no:nextWindowNo,
            prior_resource_reasons:resourceView.reasons,
            remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
            projected_round_units:evidenceEconomics.projected_round_units,
            completion_reserve_units:evidenceEconomics.completion_reserve_units,
            operator_approval_required:false,
          }));

          node=await saveNode({
            nodePath:node.node_path,
            parentPath:node.parent_path??parentPathOf(node.node_path),
            ordinal:node.ordinal||0,
            requirement:node.requirement_text,
            sourceKind:node.source_kind,
            sourceRef:node.source_ref,
            status:'pending',
            decisionType:'NEED_CONTEXT',
            decisionPayload,
            contextPayload,
            resultArtifact:node.result_artifact||null,
          });
          node.parent_path=node.parent_path??parentPathOf(node.node_path);
        }else{
          decisionPayload.autonomous_evidence_window={
            status:'DENIED',
            ...evidenceRenewalAssessment,
            evaluated_at:new Date().toISOString(),
            operator_approval_required:
              evidenceRenewalAssessment.reason==='insufficient_semantic_budget'
              ||evidenceRenewalAssessment.reason==='evidence_window_renewal_limit',
          };
        }
      }

      if(
        decision==='NEED_CONTEXT'
        &&evidenceCeilingRequiresAgentResolution(evidenceRenewalAssessment)
      ){
        const resolutionAt=new Date().toISOString();
        const nextDecisionPayload={
          ...decisionPayload,
          autonomous_evidence_window:{
            status:'DENIED',
            ...evidenceRenewalAssessment,
            evaluated_at:resolutionAt,
            operator_approval_required:false,
          },
          evidence_ceiling_resolution:{
            status:'ACTIVE',
            contract:'bounded_evidence_ceiling_agent_resolution_v0_1',
            reason:evidenceRenewalAssessment.reason,
            resource_reasons:effectiveResourceView.reasons,
            hard_reasons:asArray(evidenceRenewalAssessment.hard_reasons),
            renewable_reasons:asArray(evidenceRenewalAssessment.renewable_reasons),
            prior_semantic_decision:'NEED_CONTEXT',
            prior_discovery_fingerprint:discovery.context_fingerprint,
            unresolved_gaps:asArray(discovery.unresolved_gaps),
            activated_at:resolutionAt,
            policy:'return_semantic_control_to_bound_agent_without_global_pause',
          },
        };
        delete nextDecisionPayload.routing_admission;
        delete nextDecisionPayload.routing_discovery_checkpoint;
        delete nextDecisionPayload.routing_discovery_checkpointed;
        delete nextDecisionPayload.routing_discovery_checkpointed_at;
        delete nextDecisionPayload.context_plan;

        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'pending',
          decisionType:null,
          decisionPayload:nextDecisionPayload,
          contextPayload,
          resultArtifact:node.result_artifact||null,
        });
        node.parent_path=node.parent_path??parentPathOf(node.node_path);
        forceReconsider=true;

        console.log('AAU_AUTONOMOUS_EVIDENCE_CEILING_RETURNED_TO_AGENT',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          reason:evidenceRenewalAssessment.reason,
          resource_reasons:effectiveResourceView.reasons,
          remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
          policy:'bound_agent_resolution_no_global_pause',
        }));
        continue;
      }

      const admissionReasons=[];
      if(decision==='SPLIT'&&!storageDepthAvailable)
        admissionReasons.push('emergency_storage_path_depth_reached');
      if(decision==='SPLIT'&&availableChildCapacity<1)
        admissionReasons.push('insufficient_branch_lifecycle_budget');
      if(decision==='ATOMIC'&&atomicUnavailable)
        admissionReasons.push('bounded_atomic_execution_admission_exhausted');
      if(decision==='ATOMIC'&&!atomicUnavailable&&atomicProtocolRecoveryExhausted)
        admissionReasons.push('atomic_protocol_recovery_exhausted');
      if(decision==='NEED_CONTEXT'&&!effectiveResourceView.available)
        admissionReasons.push('context_acquisition_resource_exhausted');
      if(decision==='REMEDIATE'&&!remediationAvailable)
        admissionReasons.push('self_remediation_admission_exhausted');

      if(admissionReasons.length){
        const admission={
          contract:'cognition_resource_admission_v0_2_autonomous_evidence_windows',
          status:'DEFERRED',
          semantic_decision:decision,
          reasons:admissionReasons,
          remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
          semantic_child_capacity:availableChildCapacity,
          expected_child_lifecycle_units:branchEconomics.expected_child_lifecycle_units,
          completion_reserve_units:branchEconomics.completion_reserve_units,
          storage_path_depth:normalizedBranchDepth,
          emergency_storage_path_depth:semanticRuntime.hard_storage_path_depth,
          context_resource_available:effectiveResourceView.available,
          context_resource_reasons:effectiveResourceView.reasons,
          evidence_window_renewal:evidenceRenewalAssessment,
          atomic_execution_failures:atomicExecutionFailures,
          atomic_protocol_failures:atomicProtocolFailures,
          atomic_protocol_recovery_exhausted:atomicProtocolRecoveryExhausted,
          prior_atomic_protocol_rejection:priorAtomicProtocolRejection||null,
          discovery_fingerprint:discovery.context_fingerprint,
          resume_policy:'reuse_semantic_decision_until_evidence_mutation',
          deferred_at:new Date().toISOString(),
        };
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'pending',
          decisionType:decision,
          decisionPayload:{
            ...decisionPayload,
            routing_admission:admission,
          },
          contextPayload,
          resultArtifact:node.result_artifact||null,
        });
        if(
          decision==='SPLIT'
          &&admissionReasons.includes('insufficient_branch_lifecycle_budget')
        ){
          const economicTerminal=await closeSemanticRuntime('budget_exhausted',{
            reason:'split_branch_lifecycle_budget_exhausted',
            node_path:node.node_path,
            semantic_decision:decision,
            remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
            expected_child_lifecycle_units:Number(branchEconomics.expected_child_lifecycle_units||0),
            completion_reserve_units:Number(branchEconomics.completion_reserve_units||0),
            semantic_child_capacity:availableChildCapacity,
            semantic_state_preserved:true,
            discovery_replay_forbidden_until_evidence_mutation:true,
          });
          const error=new Error(
            'semantic_runtime_budget_exhausted:split_admission:'+node.node_path
            +':remaining='+String(economicTerminal?.remaining_budget_units??0)
          );
          error.code='SEMANTIC_BUDGET_EXHAUSTED';
          error.semanticRuntime=economicTerminal;
          error.admission=admission;
          throw error;
        }
        if(
          decision==='NEED_CONTEXT'
          &&evidenceRenewalAssessment?.reason==='insufficient_semantic_budget'
        ){
          const economicTerminal=await closeSemanticRuntime('budget_exhausted',{
            reason:'protected_completion_reserve_economic_exhaustion',
            node_path:node.node_path,
            semantic_decision:decision,
            remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
            required_budget_units:Number(evidenceRenewalAssessment.required_budget_units||0),
            completion_reserve_units:Number(branchEconomics.completion_reserve_units||0),
            evidence_window_no:Number(contextState.evidence_window_no||0),
            evidence_window_renewals:Number(contextState.evidence_window_renewals||0),
            semantic_state_preserved:true,
            discovery_replay_forbidden_until_evidence_mutation:true,
          });
          const error=new Error(
            'semantic_runtime_budget_exhausted:economic_admission:'+node.node_path
            +':remaining='+String(economicTerminal?.remaining_budget_units??0)
          );
          error.code='SEMANTIC_BUDGET_EXHAUSTED';
          error.semanticRuntime=economicTerminal;
          error.admission=admission;
          throw error;
        }
        const error=new Error(
          'cognition_admission_deferred:'+node.node_path+':'+admissionReasons.join(',')
        );
        error.code='COGNITION_ADMISSION_DEFERRED';
        error.admission=admission;
        throw error;
      }

      if(decision==='NEED_CONTEXT'){

        let rawRequests=asArray(discovery.context_requests).map(text).filter(Boolean);
        let plannedResearchQueries=asArray(discovery.research_queries).map(text).filter(Boolean);
        let plannedResearchUrls=asArray(discovery.research_urls).map(text).filter(v=>/^https:\/\//i.test(v));

        if(!rawRequests.length&&!plannedResearchQueries.length&&!plannedResearchUrls.length){
          const windowNo=Math.max(0,Number(contextState.evidence_window_no||0));
          const contextPlanIdentity=sha256({
            node_path:node.node_path,
            discovery_fingerprint:discovery.context_fingerprint,
            semantic_decision:'NEED_CONTEXT',
            unresolved_gaps:discovery.unresolved_gaps,
            evidence_window_no:windowNo,
            prior_request_signal:contextState.last_request_signal||null,
            source_catalog_hash:sha256(
              asArray(contextPayload.research_source_catalog).map(v=>({
                source_id:v?.source_id||null,url:v?.url||null,sha256:v?.sha256||null
              }))
            ),
          });
          const durableContextPlan=await loadJsonPhaseCheckpoint(
            node.node_path,'CONTEXT_PLAN',contextPlanIdentity
          );
          let contextPlan=durableContextPlan.parsed;
          for(let attempt=1;attempt<=2&&!contextPlan;attempt++){
            const response=await callJson([
              {role:'system',content:[
                'You are the bound autonomous agent authoring an EXECUTABLE CONTEXT ACQUISITION PLAN for a semantic decision you already made: NEED_CONTEXT.',
                'Do not change, reinterpret, or revisit the NEED_CONTEXT decision in this phase.',
                'The runtime autonomously opened a bounded evidence window. Specify materially useful retrievals that can reduce the persisted unresolved gaps.',
                'Avoid repeating the prior request signal. Prefer exact URLs already present in research_source_catalog when a known source is relevant but its excerpt is insufficient; otherwise provide materially different research queries.',
                'Return JSON only: {"context_requests":[],"research_queries":[],"research_urls":[],"plan_reason":"why these retrievals target the unresolved gaps"}. At least one retrieval item is required.',
              ].join('\n')},
              {role:'user',content:safeJson({
                requirement:node.requirement_text,
                semantic_decision:'NEED_CONTEXT',
                persisted_reason:discovery.reason,
                unresolved_gaps:discovery.unresolved_gaps,
                evidence_assessment:discovery.evidence_assessment,
                prior_request_signal:contextState.last_request_signal||null,
                evidence_window:{
                  window_no:windowNo,
                  renewals:Number(contextState.evidence_window_renewals||0),
                  limits:effectiveResourceView.evidence_window_limits,
                },
                research_source_catalog:compactResearchCatalogForModel(
                  contextPayload.research_source_catalog,'minimal'
                ).slice(-120),
                available_context_index:idx,
              })},
            ],2500,'req_'+node.node_path.replaceAll('.','_')+'_context_plan_'+windowNo+'_'+attempt);
            const candidate=asObject(response?.parsed);
            const candidateRequests=asArray(candidate.context_requests).map(text).filter(Boolean).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND);
            const candidateQueries=asArray(candidate.research_queries).map(text).filter(Boolean).slice(0,8);
            const candidateUrls=asArray(candidate.research_urls).map(text).filter(v=>/^https:\/\//i.test(v)).slice(0,8);
            if(!candidateRequests.length&&!candidateQueries.length&&!candidateUrls.length){
              if(attempt===2){
                const error=new Error('autonomous_decomposition_context_plan_empty:'+node.node_path);
                error.code='COGNITION_CONTEXT_PLAN_EXHAUSTED';
                throw error;
              }
              continue;
            }
            contextPlan={
              context_requests:candidateRequests,
              research_queries:candidateQueries,
              research_urls:candidateUrls,
              plan_reason:clip(candidate.plan_reason,2200),
            };
          }
          if(!contextPlan)
            throw new Error('autonomous_decomposition_context_plan_missing:'+node.node_path);

          if(!durableContextPlan.parsed){
            await saveJsonPhaseCheckpoint(
              node.node_path,'CONTEXT_PLAN',contextPlanIdentity,contextPlan,{
                semantic_decision:'NEED_CONTEXT',
                evidence_window_no:windowNo,
                retrieval_item_count:
                  asArray(contextPlan.context_requests).length
                  +asArray(contextPlan.research_queries).length
                  +asArray(contextPlan.research_urls).length,
              }
            );
          }

          rawRequests=asArray(contextPlan.context_requests).map(text).filter(Boolean);
          plannedResearchQueries=asArray(contextPlan.research_queries).map(text).filter(Boolean);
          plannedResearchUrls=asArray(contextPlan.research_urls).map(text).filter(v=>/^https:\/\//i.test(v));

          decisionPayload.context_plan={
            contract:'autonomous_context_plan_v0_1',
            phase_checkpointed:true,
            evidence_window_no:windowNo,
            plan_reason:clip(contextPlan.plan_reason,2200),
            context_requests:rawRequests,
            research_queries:plannedResearchQueries,
            research_urls:plannedResearchUrls,
          };
          node=await saveNode({
            nodePath:node.node_path,
            parentPath:node.parent_path??parentPathOf(node.node_path),
            ordinal:node.ordinal||0,
            requirement:node.requirement_text,
            sourceKind:node.source_kind,
            sourceRef:node.source_ref,
            status:'pending',
            decisionType:'NEED_CONTEXT',
            decisionPayload,
            contextPayload,
            resultArtifact:node.result_artifact||null,
          });
          node.parent_path=node.parent_path??parentPathOf(node.node_path);
        }

        const urlRequestsFromContext=rawRequests.filter(v=>/^https:\/\//i.test(text(v)));
        const nonUrlRequests=rawRequests.filter(v=>!/^https:\/\//i.test(text(v)));
        const catalogSourceRequests=resolveCatalogSourceRequests(
          nonUrlRequests,
          contextPayload.research_source_catalog
        );
        const requests=catalogSourceRequests.unresolved;
        const researchQueries=plannedResearchQueries;
        const researchUrls=[...new Set([
          ...plannedResearchUrls,
          ...urlRequestsFromContext,
          ...catalogSourceRequests.resolved.map(v=>v.url),
        ].map(text).filter(v=>/^https:\/\//i.test(v)))].slice(0,8);
        if(!requests.length&&!researchQueries.length&&!researchUrls.length){
          const error=new Error('autonomous_decomposition_context_plan_resolved_to_empty:'+node.node_path);
          error.code='COGNITION_CONTEXT_PLAN_EXHAUSTED';
          throw error;
        }

        counters.context_requests+=requests.length+researchQueries.length+researchUrls.length;
        await chargeSemanticRuntime({
          eventKind:'context_acquisition',
          materialKey:node.node_path+':routing:'+String(contextState.context_rounds_attempted+1)+':'+sha256({requests,researchQueries,researchUrls}),
          nodePath:node.node_path,
          costUnits:semanticRuntime.context_acquire_units,
          eventFingerprint:sha256({
            node_path:node.node_path,
            phase:'routing_need_context',
            requests,
            research_queries:researchQueries,
            research_urls:researchUrls,
            prior_gap_signal:contextState.last_gap_signal||null,
          }),
          metadata:{
            phase:'routing_need_context',
            request_count:requests.length,
            query_count:researchQueries.length,
            url_count:researchUrls.length,
          },
        });
        const contextAcquisitionStartedAt=Date.now();

        const beforeCatalogCount=asArray(contextPayload.research_source_catalog).length;
        const resolved=resolveContext(packet,requests,cognitionContext);
        const newLocalContextPaths=Object.entries(resolved)
          .filter(([path,value])=>value?.available&&!Object.prototype.hasOwnProperty.call(contextPayload,path))
          .length;

        let researchObserved=null;
        if((researchQueries.length||researchUrls.length)&&typeof researchContext==='function'){
          researchObserved=await researchContext({
            nodePath:node.node_path,
            queries:researchQueries,
            urls:researchUrls,
          });
        }else if(researchQueries.length||researchUrls.length){
          researchObserved={status:'unavailable',reason:'research_runtime_not_configured'};
        }

        if(researchObserved?.audit_batch_id){
          await linkResearchBatch(node.node_path,researchObserved.audit_batch_id);
        }
        const researchCatalog=researchObserved
          ? mergeResearchSourceCatalog(contextPayload.research_source_catalog,researchObserved.source_index)
          : asArray(contextPayload.research_source_catalog);
        const newSourceCount=Math.max(0,researchCatalog.length-beforeCatalogCount);

        const pinnedResult=await persistExplicitResearchEvidence(node.node_path,researchUrls,researchObserved);
        const pinnedSave=pinnedResult.save;
        pinnedEvidence=pinnedResult.evidence;
        const restoredPinnedEvidence=Math.max(0,Number(pinnedSave?.restored_or_extended||0));

        const gapSignal=normalizedSignal(discovery.unresolved_gaps);
        const requestSignal=normalizedSignal([
          ...requests,
          ...researchQueries,
          ...researchUrls,
        ]);
        const gapSimilarity=contextState.last_gap_signal
          ? requirementSimilarity(contextState.last_gap_signal,gapSignal)
          : 0;
        const requestSimilarity=contextState.last_request_signal
          ? requirementSimilarity(contextState.last_request_signal,requestSignal)
          : 0;
        const productive=(newSourceCount>0||newLocalContextPaths>0||restoredPinnedEvidence>0);
        const contextAcquisitionElapsedMs=Math.max(0,Date.now()-contextAcquisitionStartedAt);

        contextState={
          ...contextState,
          version:'agent_visible_context_resource_v0_3_autonomous_evidence_windows',
          active_context_elapsed_ms:
            Math.max(0,Number(contextState.active_context_elapsed_ms||0))
            +contextAcquisitionElapsedMs,
          elapsed_accounting:'active_context_acquisition_only_v0_3_evidence_windows',
          context_rounds_attempted:Number(contextState.context_rounds_attempted||0)+1,
          research_rounds_attempted:Number(contextState.research_rounds_attempted||0)+((researchQueries.length||researchUrls.length)?1:0),
          local_context_rounds_attempted:Number(contextState.local_context_rounds_attempted||0)+(requests.length?1:0),
          stagnant_rounds:productive?0:Number(contextState.stagnant_rounds||0)+1,
          unchanged_gap_rounds:contextState.last_gap_signal&&gapSimilarity>=0.88
            ? Number(contextState.unchanged_gap_rounds||0)+1
            : 0,
          repeated_request_rounds:contextState.last_request_signal&&requestSimilarity>=0.90
            ? Number(contextState.repeated_request_rounds||0)+1
            : 0,
          total_new_sources:Number(contextState.total_new_sources||0)+newSourceCount,
          total_new_local_context_paths:Number(contextState.total_new_local_context_paths||0)+newLocalContextPaths,
          total_restored_pinned_evidence:Number(contextState.total_restored_pinned_evidence||0)+restoredPinnedEvidence,
          last_gap_signal:gapSignal||null,
          last_request_signal:requestSignal||null,
          last_round:{
            at:new Date().toISOString(),
            active_context_acquisition_ms:contextAcquisitionElapsedMs,
            cumulative_active_context_elapsed_ms:
              Math.max(0,Number(contextState.active_context_elapsed_ms||0))
              +contextAcquisitionElapsedMs,
            new_sources:newSourceCount,
            new_local_context_paths:newLocalContextPaths,
            gap_similarity:Number(gapSimilarity.toFixed(4)),
            request_similarity:Number(requestSimilarity.toFixed(4)),
            research_status:researchObserved?.status||null,
            audit_batch_id:researchObserved?.audit_batch_id||null,
            normalized_url_requests_from_context:urlRequestsFromContext.length,
            resolved_catalog_source_requests:catalogSourceRequests.resolved.map(v=>v.source_id),
            resolved_catalog_source_urls:catalogSourceRequests.resolved.map(v=>v.url),
            restored_pinned_evidence:restoredPinnedEvidence,
            pinned_evidence_items:pinnedEvidence.length,
          },
        };

        const researchRoundNumber=contextState.context_rounds_attempted;
        contextPayload=boundInMemoryContext({
          ...contextPayload,
          ...resolved,
          ...(researchCatalog.length?{research_source_catalog:researchCatalog}:{}),
          ...(researchObserved?{['external_research_round_'+researchRoundNumber]:researchObserved}:{}),
        },pinnedEvidence,10000);

        const nextResourceView=contextResourceView(contextState,contextPayload);
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'waiting_context',
          decisionType:'NEED_CONTEXT',
          decisionPayload:{
            ...decisionPayload,
            context_resource_state:contextState,
            context_requests:requests,
            research_queries:researchQueries,
            research_urls:researchUrls,
            context_resource_after_round:nextResourceView,
          },
          contextPayload,
          resultArtifact:node.result_artifact||null,
        });
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'pending',
          decisionType:'NEED_CONTEXT',
          decisionPayload:{
            ...decisionPayload,
            context_resource_state:contextState,
            context_requests:requests,
            research_queries:researchQueries,
            research_urls:researchUrls,
            context_supplied:true,
            context_resource_after_round:nextResourceView,
          },
          contextPayload,
          resultArtifact:node.result_artifact||null,
        });
        continue;
      }

      if(decision==='BLOCKED'){
        const resultArtifact=JSON.stringify({
          status:'BLOCKED',
          artifact:discovery.reason||'Requirement blocked because the bound agent determined the remaining evidence gap prevents honest completion under the available runtime resources.',
          handoff:{
            conclusions:[],
            facts:[],
            unresolved:discovery.unresolved_gaps,
          },
        });
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'blocked',
          decisionType:'BLOCKED',
          decisionPayload:{
            ...decisionPayload,
            blocked_by_bound_agent:true,
            block_reason:discovery.reason,
            context_resource_state:contextState,
            context_resource_at_block:resourceView,
          },
          contextPayload,
          resultArtifact,
        });
        return {node,decision};
      }

      const routeSupersession=decision==='ATOMIC'
        ?await retireUnresolvedDescendantsForRouteSupersession(node,decision)
        :{retired:[],preserved_completed:[]};
      const finalDecisionPayload=routeSupersession.retired.length
        ?{
            ...decisionPayload,
            route_supersession:{
              contract:'parent_route_supersession_v0_1',
              superseding_decision:decision,
              retired_descendants:routeSupersession.retired,
              preserved_completed_descendants:routeSupersession.preserved_completed,
              applied_at:new Date().toISOString(),
            },
          }
        :decisionPayload;

      node=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:decision==='SPLIT'?'split':'executing',
        decisionType:decision,
        decisionPayload:finalDecisionPayload,
        contextPayload,
        resultArtifact:node.result_artifact||null,
      });
      return {node,decision};
    }
  }

  async function reviewChildProposalProvenance(node,ordinal,proposal,childContextView,previous,revisionGuidance=''){
    if(text(proposal?.status).toUpperCase()!=='CHILD'){
      return {
        status:'ACCEPT',
        reason:'No child requirement was proposed; DONE contains no child factual bindings to audit.',
        issues:[],
        evidence_bindings:[],
        agent_authored:true,
      };
    }

    const response=await callJson([
      {role:'system',content:[
        'You are the same bound autonomous agent auditing YOUR OWN proposed child requirement before it becomes durable.',
        'This is a provenance-preservation review, not a new decomposition decision.',
        'Compare every source-bound factual premise, number, date, unit, scope, entity/value relationship, and named-source attribution in the proposed child against the authoritative sibling evidence and supplied context.',
        'REVISE if the proposed child swaps or recombines values that belong to different sources, changes a source/value pairing, changes units or forecast periods, strengthens an uncertain claim into a fact, or treats a derived/scenario value as though a source directly reported it.',
        'Derived calculations and hypothetical scenarios are allowed only when the child explicitly labels them as derived/hypothetical, preserves the exact source inputs, and states the transformation or formula. Never silently relabel a transformation as a sourced fact.',
        'If the evidence does not support a factual premise needed by the proposed child, REVISE the proposal so the child researches/resolves that gap instead of baking the unsupported premise into its requirement.',
        'Do not reject merely because the child is narrower. Do not solve the child.',
        'Return JSON only: {"status":"ACCEPT|REVISE","reason":"auditable explanation","issues":["..."],"evidence_bindings":[{"claim":"...","source_path_or_id":"...","preserved":true}],"revision_guidance":"specific guidance when REVISE; empty when ACCEPT"}.',
      ].join('\n')},
      {role:'user',content:safeJson({
        parent_requirement:node.requirement_text,
        agent_authored_discovery_state:agentDiscoveryState(node),
        proposed_child:{
          requirement:proposal.requirement,
          scope_removed:proposal.scope_removed,
          completion_criterion:proposal.completion_criterion,
          reason:proposal.reason,
        },
        authoritative_completed_sibling_evidence:childContextView.siblingEvidence,
        supplied_context:childContextView.suppliedContext,
        previously_authored_children:previous,
        prior_provenance_revision_guidance:revisionGuidance||null,
      })},
    ],stageBudgets.child_provenance_review,'req_'+node.node_path.replaceAll('.','_')+'_author_child_provenance_'+ordinal);

    const candidate=asObject(response?.parsed);
    const status=text(candidate.status).toUpperCase();
    if(!['ACCEPT','REVISE'].includes(status))
      throw new Error('autonomous_decomposition_child_provenance_status_invalid:'+node.node_path);

    return {
      status,
      reason:clip(candidate.reason,2400),
      issues:asArray(candidate.issues).map(v=>clip(v,800)).filter(Boolean).slice(0,16),
      evidence_bindings:asArray(candidate.evidence_bindings).map(v=>({
        claim:clip(v?.claim,800),
        source_path_or_id:clip(v?.source_path_or_id,500),
        preserved:Boolean(v?.preserved),
      })).filter(v=>v.claim||v.source_path_or_id).slice(0,24),
      revision_guidance:clip(candidate.revision_guidance,2400),
      agent_authored:true,
    };
  }

  async function authorChildren(node,{branchDepth=0,singleChildRefinements=0}={}){
    const allExisting=await children(node.node_path);
    const existing=allExisting
      .filter((child)=>String(child?.status||'')!=='cancelled')
      .sort((a,b)=>Number(a?.ordinal||0)-Number(b?.ordinal||0));
    let childAuthoringFinalized=Boolean(node?.decision_payload?.children_authored);
    const budgetConstrainedFinalizationRequiresContinuation=Boolean(
      node?.decision_payload?.conserved_branch_economics_constraint_applied
    )&&Number(node?.decision_payload?.semantic_child_capacity_at_stop??-1)<1;
    if(existing.length&&childAuthoringFinalized&&budgetConstrainedFinalizationRequiresContinuation){
      const continuationPayload={...(node.decision_payload||{})};
      delete continuationPayload.children_authored;
      delete continuationPayload.conserved_branch_economics_constraint_applied;
      delete continuationPayload.semantic_child_capacity_at_stop;
      delete continuationPayload.child_count;
      continuationPayload.budget_constrained_child_authoring_reopened=true;
      continuationPayload.budget_constrained_child_authoring_reopened_at=new Date().toISOString();
      node=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'split',
        decisionType:'SPLIT',
        decisionPayload:continuationPayload,
        contextPayload:node.context_payload||{},
        resultArtifact:null,
      });
      node.parent_path=node.parent_path??parentPathOf(node.node_path);
      childAuthoringFinalized=false;
      console.log('AAU_BUDGET_CONSTRAINED_CHILD_AUTHORING_REOPENED',JSON.stringify({
        agent_id:agentId,
        intent_execution_id:intentExecutionId,
        node_path:node.node_path,
        existing_child_count:existing.length,
        policy:'budget_exhaustion_cannot_imply_semantic_coverage_v0_1',
      }));
    }
    if(existing.length&&childAuthoringFinalized)
      return {children:existing,reconsider:false};

    // Durable children are authoritative accepted work. A restart continues from them;
    // it never starts the decomposition over from the parent requirement.
    const authored=existing.map(child=>({
      ...child,
      parent_path:child.parent_path??node.node_path,
    }));
    const normalizedBranchDepth=pathDepth(node.node_path);
    const storageDepthAvailable=Number.isFinite(normalizedBranchDepth)
      &&normalizedBranchDepth<semanticRuntime.hard_storage_path_depth;
    if(!storageDepthAvailable)
      throw new Error('autonomous_decomposition_split_mode_unavailable:'+node.node_path);
    const startOrdinal=Math.max(0,...allExisting.map((child)=>Number(child?.ordinal||0)))+1;

    const returnChildAuthoringFailure=async({ordinal,phase,error})=>{
      const failureCount=Math.max(0,Number(node?.decision_payload?.child_authoring_failure_count||0))+1;
      const priorDiscovery=asObject(node?.decision_payload?.routing_discovery_checkpoint);
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:null,
        decisionPayload:{
          ...(node.decision_payload||{}),
          reconsider_decomposition:true,
          child_authoring_failure_count:failureCount,
          child_authoring_failure:{
            version:'agent_visible_child_authoring_failure_v0_1',
            at:new Date().toISOString(),
            ordinal,
            phase,
            rejection_reason:String(error?.rejectionReason||error?.code||error?.message||'child_authoring_failed').slice(0,300),
            finish_reason:error?.finishReason||null,
            prior_split_discovery:{
              decision:text(priorDiscovery.decision)||'SPLIT',
              reason:clip(priorDiscovery.reason,1600)||null,
              context_fingerprint:text(priorDiscovery.context_fingerprint)||null,
            },
            rejected_attempt_evidence_durable:true,
            next_action_owned_by_bound_agent:true,
          },
        },
        contextPayload:node.context_payload||{},
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      console.warn('AAU_AUTONOMOUS_CHILD_AUTHORING_RETURNED_TO_AGENT',JSON.stringify({
        agent_id:agentId,
        intent_execution_id:intentExecutionId,
        node_path:node.node_path,
        ordinal,
        phase,
        child_authoring_failure_count:failureCount,
        rejection_reason:String(error?.rejectionReason||error?.code||error?.message||'child_authoring_failed').slice(0,300),
      }));
      return {children:[],reconsider:true,node:reset};
    };

    const finalizeBudgetConstrainedSplit=async({
      runtimeView,branchEconomics,availableChildCapacity
    })=>{
      const finalized=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'split',decisionType:'SPLIT',
        decisionPayload:{
          ...(node.decision_payload||{}),
          child_count:authored.length,
          children_authored:true,
          conserved_branch_economics_constraint_applied:true,
          semantic_branch_economics_contract:branchEconomics.contract,
          expected_child_lifecycle_units:branchEconomics.expected_child_lifecycle_units,
          completion_reserve_units:branchEconomics.completion_reserve_units,
          branch_economics_components:branchEconomics.components,
          remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
          semantic_child_capacity_at_stop:availableChildCapacity,
          storage_path_depth:normalizedBranchDepth,
          emergency_storage_path_depth:semanticRuntime.hard_storage_path_depth,
          child_authoring_protocol:'deep_formulation_checkpoint_then_nonthinking_serialization_v0_1',
        },
        contextPayload:node.context_payload||{},resultArtifact:null,
      });
      return {children:authored,reconsider:false,node:finalized};
    };

    for(let offset=0;offset<MAX_CHILDREN_PER_NODE;offset++){
      const ordinal=startOrdinal+offset;
      const previous=authored.map(c=>({
        node_path:c.node_path||null,
        ordinal:Number(c.ordinal||0),
        status:c.node_status||c.status||null,
        requirement:c.requirement_text,
        scope_removed:c?.decision_payload?.scope_removed||null,
        completion_criterion:c?.decision_payload?.completion_criterion||null,
      }));
      const runtimeView=await semanticRuntimeView();
      const childPinnedEvidence=await loadPinnedEvidence(node.node_path);
      const branchEconomics=projectedBranchEconomics(node.context_payload||{},childPinnedEvidence);
      const currentChildCapacity=semanticChildCapacity({
        remainingBudgetUnits:Number(runtimeView?.remaining_budget_units||0),
        nodeCreateUnits:semanticRuntime.node_create_units,
        safetyReserveUnits:semanticRuntime.safety_reserve_units,
        expectedChildLifecycleUnits:branchEconomics.expected_child_lifecycle_units,
        completionReserveUnits:branchEconomics.completion_reserve_units,
        maxChildren:MAX_CHILDREN_PER_NODE-authored.length,
      });
      const structuralBranchingAvailable=currentChildCapacity>=2;
      const singleRefinementAvailable=currentChildCapacity>=1;
      if(currentChildCapacity<1){
        const economicTerminal=await closeSemanticRuntime('budget_exhausted',{
          reason:authored.length
            ?'split_child_authoring_continuation_budget_exhausted'
            :'split_child_authoring_budget_exhausted',
          node_path:node.node_path,
          semantic_decision:'SPLIT',
          remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
          expected_child_lifecycle_units:Number(branchEconomics.expected_child_lifecycle_units||0),
          completion_reserve_units:Number(branchEconomics.completion_reserve_units||0),
          semantic_child_capacity:currentChildCapacity,
          authored_child_count:authored.length,
          semantic_state_preserved:true,
          remaining_scope_decision_preserved:true,
          budget_exhaustion_cannot_imply_semantic_coverage:true,
          discovery_replay_forbidden_until_evidence_mutation:true,
        });
        const error=new Error(
          'semantic_runtime_budget_exhausted:split_child_authoring:'+node.node_path
          +':remaining='+String(economicTerminal?.remaining_budget_units??0)
        );
        error.code='SEMANTIC_BUDGET_EXHAUSTED';
        error.semanticRuntime=economicTerminal;
        throw error;
      }
      const childContextView=agentModelContextView(
        node.context_payload||{},childPinnedEvidence,stageBudgets.child_formulation
      );

      let proposalCheckpoint=await loadChildProposalCheckpoint(node,ordinal,previous);
      let proposal=proposalCheckpoint?.proposal||null;

      if(!proposal){
        let formulationError=null;
        let provenanceRevisionGuidance='';
        for(let attempt=1;attempt<=2;attempt++){
          try{
            const response=await callJson([
              {role:'system',content:[
                'You are the bound autonomous agent FORMULATING the next child for ONE parent requirement.',
                'Thinking is enabled. Do the substantive decomposition reasoning here.',
                'You own the child requirement. The runtime will not invent, narrow, or repair it for you.',
                'Author exactly ONE next child requirement, or declare DONE when the children already authored adequately cover the parent.',
                'previously_authored_children are durable, accepted, and authoritative. Do NOT restate, paraphrase, re-research, or recreate work already assigned to any previous child.',
                'When supplied_context.expertise_candidate_ledger is available and the parent asks for repeated candidate/proposal work, bind each child to exactly ONE canonical ledger candidate. Preserve that candidate domain verbatim in the child requirement; include its proposal_id when useful. Different canonical proposal_ids/domains are distinct work instances even when they share the same analytical framework.',
                'Derive the NEXT child only from the parent scope that remains uncovered after subtracting previously_authored_children. If no independently executable scope remains, return DONE.',
                'The runtime performs terminal parent synthesis automatically after all children resolve. Do NOT create a child whose sole purpose is to merge, format, summarize, reconcile, or submit the other children; return DONE instead when only terminal synthesis remains.',
                'A CHILD must be independently completable, materially narrower than the parent, non-overlapping with accepted children, and include explicit scope removed plus a concrete completion criterion.',
                'Do not execute or solve the child.',
                'Return complete JSON only: {"status":"CHILD","requirement":"...","scope_removed":"...","completion_criterion":"...","reason":"brief"} OR {"status":"DONE","coverage_note":"brief"}.',
                'There is no required number of children. One child is valid only when genuinely narrower; use as many or as few children as your reasoning requires within the conserved work budget.',
                'Current semantic child capacity from the live remaining budget is '+currentChildCapacity+'. Each additional child is priced at approximately '+branchEconomics.expected_child_lifecycle_units+' units for first-pass lifecycle work, while '+branchEconomics.completion_reserve_units+' units remain protected for terminal reconciliation/synthesis. Tree depth is not the ordinary convergence rule; the '+semanticRuntime.hard_storage_path_depth+'-level path ceiling is only an emergency persistence guard.',
              ].join('\n')},
              {role:'user',content:safeJson({
                parent_requirement:node.requirement_text,
                agent_authored_discovery_state:agentDiscoveryState(node),
                authoritative_completed_sibling_evidence:childContextView.siblingEvidence,
                supplied_context:childContextView.suppliedContext,
                previously_authored_children:previous,
                prior_child_authoring_failure:asObject(node?.decision_payload?.child_authoring_failure),
                provenance_revision_guidance:provenanceRevisionGuidance||null,
                runtime_resource_constraints:{
                  semantic_runtime_contract:SEMANTIC_RUNTIME_CONTRACT,
                  remaining_budget_units:Number(runtimeView?.remaining_budget_units||0),
                  semantic_child_capacity:currentChildCapacity,
                  semantic_branch_economics_contract:branchEconomics.contract,
                  expected_child_lifecycle_units:branchEconomics.expected_child_lifecycle_units,
                  completion_reserve_units:branchEconomics.completion_reserve_units,
                  branch_economics_components:branchEconomics.components,
                  storage_path_depth:normalizedBranchDepth,
                  emergency_storage_path_depth:semanticRuntime.hard_storage_path_depth,
                  multi_child_split_available:structuralBranchingAvailable,
                  single_child_refinement_available:singleRefinementAvailable,
                  max_children_this_split:currentChildCapacity,
                },
              })},
            ],stageBudgets.child_formulation,'req_'+node.node_path.replaceAll('.','_')+'_author_child_formulate_'+ordinal+'_'+attempt);

            const candidate=asObject(response?.parsed);
            const candidateStatus=text(candidate.status).toUpperCase();
            if(!['CHILD','DONE'].includes(candidateStatus))
              throw new Error('autonomous_decomposition_child_formulation_status_invalid:'+node.node_path);
            if(candidateStatus==='CHILD'){
              const validation=childConvergenceValidation(
                node.requirement_text,
                candidate.requirement,
                candidate.scope_removed,
                candidate.completion_criterion
              );
              if(!validation.valid)
                throw new Error('autonomous_decomposition_nonconvergent_child:'+node.node_path+':'+validation.failures.join(','));
              candidate._convergence_validation=validation;

              if(runtimeOwnedTerminalSynthesisChild(candidate)){
                proposal={
                  status:'DONE',
                  coverage_note:'Remaining uncovered work is terminal synthesis/formatting/submission owned by the runtime under '+TERMINAL_SYNTHESIS_OWNERSHIP_VERSION+'.',
                  _runtime_terminal_synthesis_collapsed:true,
                };
                proposalCheckpoint={
                  row:await saveChildProposalCheckpoint(node,ordinal,proposal,previous),
                  proposal,
                };
                console.log('AAU_AUTONOMOUS_TERMINAL_SYNTHESIS_CHILD_COLLAPSED',JSON.stringify({
                  agent_id:agentId,
                  intent_execution_id:intentExecutionId,
                  node_path:node.node_path,
                  ordinal,
                  ownership_version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
                }));
                break;
              }

              const candidateCanonicalIdentity=canonicalCandidateIdentity(
                candidate,childContextView.suppliedContext
              );
              const siblingOverlap=previous
                .map(v=>({
                  node_path:text(v?.node_path)||null,
                  ordinal:Number(v?.ordinal||0),
                  status:text(v?.status)||null,
                  requirement:text(v?.requirement),
                  scope_removed:text(v?.scope_removed)||null,
                  completion_criterion:text(v?.completion_criterion)||null,
                  similarity:requirementSimilarity(candidate.requirement,v?.requirement),
                  explicit_instance_id:explicitRepeatedInstanceId(v),
                  explicit_instance_disjoint:explicitRepeatedInstancesDisjoint(candidate,v),
                  explicit_partition_disjoint:explicitPartitionsDisjoint(candidate,v),
                  explicit_partition_candidate:explicitPartitionValues(candidate),
                  explicit_partition_sibling:explicitPartitionValues(v),
                  canonical_identity:canonicalCandidateIdentity(
                    v,childContextView.suppliedContext
                  ),
                  canonical_instance_disjoint:canonicalRepeatedInstancesDisjoint(
                    candidate,v,childContextView.suppliedContext
                  ),
                }))
                .sort((a,b)=>b.similarity-a.similarity)[0]||null;
              const candidateInstanceId=explicitRepeatedInstanceId(candidate);
              if(
                siblingOverlap
                &&siblingOverlap.similarity>=0.78
                &&!siblingOverlap.explicit_instance_disjoint
                &&!siblingOverlap.explicit_partition_disjoint
                &&!siblingOverlap.canonical_instance_disjoint
              ){
                await persistChildProposalRejection(
                  node,ordinal,candidate,siblingOverlap,previous
                );
                provenanceRevisionGuidance=
                  'The proposed child overlaps accepted child ordinal '
                  +siblingOverlap.ordinal
                  +' (requirement similarity '+siblingOverlap.similarity.toFixed(3)+'). '
                  +'Treat that child as already assigned. Author only uncovered parent scope, or return DONE if only terminal parent synthesis remains.';
                const overlapError=new Error('autonomous_decomposition_overlapping_child:'+node.node_path);
                overlapError.code='COGNITION_CHILD_OVERLAP';
                throw overlapError;
              }
              candidate._sibling_overlap_validation={
                valid:true,
                max_similarity:Number(siblingOverlap?.similarity||0),
                compared_children:previous.length,
                explicit_instance_id:candidateInstanceId,
                explicit_partition_candidate:explicitPartitionValues(candidate),
                explicit_partition_sibling:siblingOverlap?.explicit_partition_sibling||{},
                explicit_partition_disjoint:Boolean(siblingOverlap?.explicit_partition_disjoint),
                canonical_candidate_identity:candidateCanonicalIdentity,
                compared_sibling_canonical_identity:siblingOverlap?.canonical_identity||null,
                disjoint_repeated_instance_override:Boolean(
                  siblingOverlap?.similarity>=0.78
                  &&(
                    siblingOverlap?.explicit_instance_disjoint
                    ||siblingOverlap?.explicit_partition_disjoint
                    ||siblingOverlap?.canonical_instance_disjoint
                  )
                ),
                override_basis:
                  siblingOverlap?.canonical_instance_disjoint
                    ?'canonical_candidate_identity'
                    :siblingOverlap?.explicit_instance_disjoint
                      ?'explicit_repeated_instance'
                      :siblingOverlap?.explicit_partition_disjoint
                        ?'explicit_partition'
                        :null,
              };

              const provenanceReview=await reviewChildProposalProvenance(
                node,
                ordinal,
                candidate,
                childContextView,
                previous,
                provenanceRevisionGuidance
              );
              console.log('AAU_AUTONOMOUS_CHILD_PROVENANCE_REVIEW',JSON.stringify({
                agent_id:agentId,
                intent_execution_id:intentExecutionId,
                node_path:node.node_path,
                ordinal,
                status:provenanceReview.status,
                issue_count:provenanceReview.issues.length,
              }));
              if(provenanceReview.status!=='ACCEPT'){
                provenanceRevisionGuidance=
                  provenanceReview.revision_guidance
                  ||provenanceReview.reason
                  ||'Revise the child requirement so every source-bound claim preserves the authoritative evidence bindings.';
                if(attempt===2)
                  throw new Error('autonomous_decomposition_child_provenance_rejected:'+node.node_path);
                continue;
              }
              candidate._provenance_review=provenanceReview;
            }
            proposal=candidate;
            proposalCheckpoint={row:await saveChildProposalCheckpoint(node,ordinal,proposal,previous),proposal};
            break;
          }catch(error){
            formulationError=error;
            const recoverable=
              error?.code==='COGNITION_RESPONSE_REJECTED'
              || error?.code==='NVIDIA_TIMEOUT'
              || String(error?.message||'').startsWith('autonomous_decomposition_nonconvergent_child:')
              || String(error?.message||'').startsWith('autonomous_decomposition_child_formulation_status_invalid:')
              || error?.code==='COGNITION_CHILD_OVERLAP'
              || String(error?.message||'').startsWith('autonomous_decomposition_overlapping_child:')
              || String(error?.message||'').startsWith('autonomous_decomposition_child_provenance_status_invalid:')
              || String(error?.message||'').startsWith('autonomous_decomposition_child_provenance_rejected:');
            if(!recoverable)throw error;
            if(attempt===2)
              return returnChildAuthoringFailure({ordinal,phase:'deep_formulation',error});
          }
        }
        if(!proposal&&formulationError)
          return returnChildAuthoringFailure({ordinal,phase:'deep_formulation',error:formulationError});
      }

      const proposalStatus=text(proposal?.status).toUpperCase();
      let parsed=null;
      if(proposalStatus==='CHILD'){
        parsed={status:'CHILD',requirement:text(proposal.requirement),scope_removed:text(proposal.scope_removed),completion_criterion:text(proposal.completion_criterion),reason:text(proposal.reason),_convergence_validation:proposal._convergence_validation,_sibling_overlap_validation:proposal._sibling_overlap_validation,_provenance_review:proposal._provenance_review};
      }else if(proposalStatus==='DONE'){
        parsed={status:'DONE',coverage_note:text(proposal.coverage_note)};
      }else{
        throw new Error('autonomous_decomposition_child_checkpoint_status_invalid:'+node.node_path);
      }
      console.log('AAU_AUTONOMOUS_CHILD_SERIALIZED_DETERMINISTIC',JSON.stringify({agent_id:agentId,intent_execution_id:intentExecutionId,node_path:node.node_path,ordinal,status:proposalStatus,policy:'checkpoint_exact_projection_v0_1'}));

      const status=text(parsed?.status).toUpperCase();
      if(status==='DONE'){
        if(authored.length<1){
          const collapsed=parsed?._runtime_terminal_synthesis_collapsed===true;
          const recoveryError=new Error(
            collapsed
              ?'runtime_terminal_synthesis_collapse_zero_child_reconsider'
              :'agent_split_done_without_child_reconsider'
          );
          recoveryError.code=collapsed
            ?'RUNTIME_TERMINAL_SYNTHESIS_COLLAPSE_ZERO_CHILD'
            :'COGNITION_SPLIT_DONE_WITHOUT_CHILD';
          recoveryError.rejectionReason=collapsed
            ?'terminal_synthesis_classifier_left_split_without_semantic_child'
            :'split_decision_produced_no_semantic_child';
          return returnChildAuthoringFailure({
            ordinal,
            phase:collapsed
              ?'terminal_synthesis_collapse_zero_child'
              :'split_done_without_child',
            error:recoveryError,
          });
        }
        await saveNode({
          nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
          requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
          status:'split',decisionType:'SPLIT',
          decisionPayload:{
            ...(node.decision_payload||{}),
            child_count:authored.length,
            coverage_note:clip(parsed?.coverage_note,1500),
            children_authored:true,
            child_authoring_protocol:'deep_formulation_checkpoint_then_nonthinking_serialization_v0_1',
          },
          contextPayload:node.context_payload||{},resultArtifact:null,
        });
        return {children:authored,reconsider:false};
      }

      const requirement=text(parsed?.requirement);
      if(requirement.length<5)throw new Error('autonomous_decomposition_child_requirement_empty:'+node.node_path);
      const duplicate=authored.some(c=>
        c.requirement_hash===sha256(requirement)
        || normalizedRequirement(c.requirement_text)===normalizedRequirement(requirement)
      );
      if(duplicate){
        const duplicateError=new Error('autonomous_decomposition_duplicate_child:'+node.node_path);
        duplicateError.code='COGNITION_CHILD_OVERLAP';
        duplicateError.rejectionReason=
          'accepted_child_already_covers_proposed_scope; formulate_only_remaining_scope_or_DONE';
        return returnChildAuthoringFailure({
          ordinal,
          phase:'duplicate_child_remaining_scope',
          error:duplicateError,
        });
      }

      const nodePath=node.node_path+'.'+String(ordinal).padStart(3,'0');
      const childRequirementHash=sha256(requirement);
      await chargeSemanticRuntime({
        eventKind:'semantic_node_created',
        materialKey:nodePath+':'+childRequirementHash,
        nodePath,
        costUnits:semanticRuntime.node_create_units,
        eventFingerprint:sha256({
          parent_path:node.node_path,
          child_path:nodePath,
          requirement_hash:childRequirementHash,
        }),
        metadata:{
          parent_path:node.node_path,
          ordinal,
          requirement_hash:childRequirementHash,
        },
      });
      const child=await saveNode({
        nodePath,parentPath:node.node_path,ordinal,
        requirement,sourceKind:'agent_decomposition',sourceRef:node.node_path,
        status:'pending',decisionType:null,
        decisionPayload:{
          authored_reason:clip(parsed?.reason,1200),
          authored_by_bound_agent:true,
          scope_removed:clip(parsed?.scope_removed,1600),
          completion_criterion:clip(parsed?.completion_criterion,1600),
          convergence_similarity:Number(parsed?._convergence_validation?.similarity||0),
          sibling_overlap_validation:asObject(parsed?._sibling_overlap_validation),
          provenance_review:asObject(parsed?._provenance_review),
          child_proposal_checkpoint_step_key:childProposalStepKey(node,ordinal),
          child_authoring_protocol:'deep_formulation_checkpoint_then_nonthinking_serialization_v0_1',
        },
        contextPayload:inheritedChildContext(node.context_payload),resultArtifact:null,
      });

      const inheritedPinned=await loadPinnedEvidence(node.node_path);
      if(inheritedPinned.length){
        const inheritedSave=await pinnedEvidenceRpc('save',nodePath,inheritedPinned.map(v=>({
          source_key:v.source_key,
          source_id:v.source_id,
          url:v.url,
          title:v.title,
          publisher:v.publisher,
          sha256:v.sha256,
          fetch_status:v.fetch_status,
          coverage:v.coverage,
          excerpt:v.excerpt,
          audit_batch_id:v.audit_batch_id,
        })));
        if(inheritedSave?.status!=='ready')
          throw new Error('autonomous_decomposition_pinned_evidence_inherit_failed:'+nodePath);
      }

      child.parent_path=node.node_path;
      authored.push(child);
      counters.nodes++;

    }
    throw new Error('autonomous_decomposition_child_resource_limit:'+node.node_path);
  }

  async function ensureQdaCurriculumRootSplit(node){
    if(node?.node_path!=='R')return null;
    const plan=qdaCurriculumFastPathPlan(packet);
    if(!plan.applies)return null;
    if(qda601AuthenticatorRemediation(packet).active)return null;

    const existing=(await children('R'))
      .filter(child=>String(child?.status||child?.node_status||'')!=='cancelled')
      .sort((x,y)=>Number(x?.ordinal||0)-Number(y?.ordinal||0));
    if(existing.length)return null;

    const authored=[];
    for(const spec of plan.children){
      const requirementHash=sha256(spec.requirement);
      await chargeSemanticRuntime({
        eventKind:'semantic_node_created',
        materialKey:spec.node_path+':'+requirementHash,
        nodePath:spec.node_path,
        costUnits:semanticRuntime.node_create_units,
        eventFingerprint:sha256({
          parent_path:'R',
          child_path:spec.node_path,
          requirement_hash:requirementHash,
          qda_curriculum_fast_path:true,
        }),
        metadata:{
          parent_path:'R',
          ordinal:spec.ordinal,
          requirement_hash:requirementHash,
          qda_curriculum_fast_path:true,
          qda_unit_code:plan.unit_code,
        },
      });
      const child=await saveNode({
        nodePath:spec.node_path,
        parentPath:'R',
        ordinal:spec.ordinal,
        requirement:spec.requirement,
        sourceKind:spec.source_kind,
        sourceRef:spec.source_ref,
        status:'pending',
        decisionType:'ATOMIC',
        decisionPayload:{
          authored_by_runtime_from_authoritative_curriculum:true,
          qda_curriculum_problem_fast_path:true,
          qda_curriculum_fast_path_contract:plan.contract,
          qda_unit_code:plan.unit_code,
          qda_problem_ordinal:spec.ordinal,
          qda_problem_sha256:sha256(spec.problem),
          qda_problem_dependencies:spec.depends_on,
          deterministic_execution_expected:true,
          statistical_verification_expected:spec.statistical===true,
          quantitative_math_verification_expected:spec.quantitative===true,
          sibling_dependency_required:spec.depends_on.length>0,
          provenance_review:{
            status:'ACCEPT',
            issue_count:0,
            reason:'Exact problem text is bound directly to the authoritative QDA exercise pack.',
            deterministic_guard:'qda_authoritative_curriculum_problem_binding_v0_1',
          },
        },
        contextPayload:boundContextPayload({
          ...inheritedChildContext(node.context_payload),
          qda_601_context:packet?.qda_601_context,
          qda_curriculum_problem_binding:{
            unit_code:plan.unit_code,
            exercise_pack_ref:plan.exercise_pack_ref,
            problem_ordinal:spec.ordinal,
            problem_sha256:sha256(spec.problem),
            depends_on:spec.depends_on,
            contract:'qda_authoritative_curriculum_problem_binding_v0_1',
          },
        }),
        resultArtifact:null,
      });
      child.parent_path='R';
      authored.push(child);
      counters.nodes++;
    }

    const split=await saveNode({
      nodePath:'R',
      parentPath:null,
      ordinal:node.ordinal||0,
      requirement:node.requirement_text,
      sourceKind:node.source_kind,
      sourceRef:node.source_ref,
      status:'split',
      decisionType:'SPLIT',
      decisionPayload:{
        ...(node.decision_payload||{}),
        child_count:authored.length,
        children_authored:true,
        qda_curriculum_fast_path:true,
        qda_curriculum_fast_path_contract:plan.contract,
        qda_curriculum_problem_count:plan.problem_count,
        qda_curriculum_dependency_waves:plan.dependency_waves,
        qda_curriculum_parallel_execution:true,
        qda_curriculum_parallelism:plan.max_parallelism,
        child_authoring_protocol:'authoritative_curriculum_deterministic_problem_split_v0_1',
        coverage_note:'Each authoritative exercise-pack problem is bound to exactly one direct child.',
        reconsider_decomposition:false,
      },
      contextPayload:boundContextPayload({
        ...(node.context_payload||{}),
        qda_601_context:packet?.qda_601_context,
      }),
      resultArtifact:null,
    });
    split.parent_path=null;
    console.log('AAU_QDA_CURRICULUM_FAST_PATH_SPLIT',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      unit_code:plan.unit_code,
      problem_count:plan.problem_count,
      child_paths:authored.map(child=>child.node_path),
      dependency_waves:plan.dependency_waves,
      max_parallelism:plan.max_parallelism,
      contract:plan.contract,
    }));
    return {node:split,children:authored,plan};
  }

  function qdaRootProblemExecutionPlan(node,kids){
    if(node?.node_path!=='R')return null;
    const plan=qdaCurriculumFastPathPlan(packet);
    if(!plan.applies||kids.length!==plan.problem_count)return null;
    const byOrdinal=new Map(kids.map(child=>[Number(child?.ordinal||0),child]));
    for(const spec of plan.children){
      const child=byOrdinal.get(spec.ordinal);
      if(!child)return null;
      const requirement=text(child?.requirement_text);
      if(!new RegExp('\\bProblem\\s+'+String(spec.ordinal)+'\\b','i').test(requirement))return null;
      if(/\\bProblems\\s+\\d+/i.test(requirement))return null;
    }
    return {plan,byOrdinal};
  }

  function qdaDirectProblemFastAtomic(node,parentPath){
    if(parentPath!=='R')return false;
    const plan=qdaCurriculumFastPathPlan(packet);
    if(!plan.applies)return false;
    const ordinal=Number(node?.ordinal||0);
    if(!Number.isInteger(ordinal)||ordinal<1||ordinal>plan.problem_count)return false;
    const statisticsRepairOnly=
      node?.decision_payload?.deterministic_statistics_reconciliation_required===true
      &&!text(node?.decision_payload?.prior_atomic_rejection);
    if(Boolean(node?.decision_payload?.reconsider_decomposition)&&!statisticsRepairOnly)return false;
    if(Number(node?.decision_payload?.atomic_execution_failures||0)>0&&!statisticsRepairOnly)return false;
    const requirement=text(node?.requirement_text);
    return new RegExp('\\bProblem\\s+'+String(ordinal)+'\\b','i').test(requirement)
      &&!/\\bProblems\\s+\\d+/i.test(requirement);
  }

  async function repairStatisticalAnalysisContract(
    node,proposedArtifact,verification
  ){
    if(
      verification?.required!==true
      ||(verification?.ok===true&&verification?.all_claims_match===true)
    )return null;

    let artifactObject=null;
    try{artifactObject=JSON.parse(String(proposedArtifact||''));}catch{}
    if(!artifactObject||typeof artifactObject!=='object'||Array.isArray(artifactObject))return null;

    const repairIdentity=sha256({
      node_path:node.node_path,
      requirement:node.requirement_text,
      artifact_sha256:sha256(proposedArtifact),
      failure:verification.error,
      contract:'qda_statistical_analysis_contract_repair_v0_2',
    });
    const durable=await loadJsonPhaseCheckpoint(
      node.node_path,'STATISTICAL_ANALYSIS_CONTRACT_REPAIR',repairIdentity
    );

    const normalizeAnalyses=value=>asArray(value).map(row=>{
      const item=asObject(row);
      const analysis=text(item.analysis);
      const spec=normalizeQdaStatisticalContractNumbers(item.spec);
      const claims={
        ...asObject(normalizeQdaStatisticalContractNumbers(item.claims)),
      };
      const moveClaim=(from,to)=>{
        if(claims[to]===undefined&&claims[from]!==undefined)claims[to]=claims[from];
        if(from!==to)delete claims[from];
      };
      if(analysis==='proportion_ci'){
        moveClaim('p','proportion');
        moveClaim('rate','proportion');
        moveClaim('lower','ci_low');
        moveClaim('lower_bound','ci_low');
        moveClaim('ci_lower','ci_low');
        moveClaim('upper','ci_high');
        moveClaim('upper_bound','ci_high');
        moveClaim('ci_upper','ci_high');
      }
      if(analysis==='difference_proportions_ci'){
        moveClaim('diff','difference_b_minus_a');
        moveClaim('difference','difference_b_minus_a');
        moveClaim('p_a','proportion_a');
        moveClaim('rate_a','proportion_a');
        moveClaim('p_b','proportion_b');
        moveClaim('rate_b','proportion_b');
        moveClaim('lower','ci_low');
        moveClaim('lower_bound','ci_low');
        moveClaim('ci_lower','ci_low');
        moveClaim('upper','ci_high');
        moveClaim('upper_bound','ci_high');
        moveClaim('ci_upper','ci_high');
      }
      const approximateCi=
        analysis==='proportion_ci'||analysis==='difference_proportions_ci';
      const roundedCoefficientT=analysis==='coefficient_t';
      return {
        ...item,
        spec,
        claims,
        ...(approximateCi&&item.absolute_tolerance===undefined
          ?{absolute_tolerance:1e-6}
          :{}),
        ...(roundedCoefficientT&&item.absolute_tolerance===undefined
          ?{absolute_tolerance:0.005}
          :{}),
      };
    });

    const verifyAnalyses=analyses=>{
      if(!analyses.length)return null;
      const repairedObject={...artifactObject,python_analyses:analyses};
      const repairedArtifact=safeJson(repairedObject);
      const repairedVerification=deterministicStatisticalVerification(
        packet,node,repairedArtifact
      );
      return {artifact:repairedArtifact,verification:repairedVerification};
    };

    const embeddedAnalyses=
      durable.parsed?.python_analyses
      ??artifactObject.python_analyses
      ??asObject(artifactObject.self_audit).python_analyses;
    let analyses=normalizeAnalyses(embeddedAnalyses);
    let verified=verifyAnalyses(analyses);
    const alreadyRepaired=
      verified?.verification?.required===true
      &&verified.verification.ok===true
      &&verified.verification.all_claims_match===true;
    if(!durable.parsed&&!alreadyRepaired){
      let priorFailure=verification;
      for(let compactAttempt=1;compactAttempt<=2;compactAttempt++){
        const response=await callJson([
          {role:'system',content:[
            'You are the same bound autonomous agent repairing ONLY the Python statistical verification contract for an already-written QDA answer.',
            'Do NOT rewrite, reconsider, or expand the substantive answer. Do NOT change its method, inputs, calculations, interpretation, units, assumptions, or conclusions.',
            'Return exactly one JSON object: {"python_analyses":[{"id":"...","analysis":"...","spec":{},"claims":{}}]}.',
            'CRITICAL JSON TYPE RULE: every numerical value inside spec and claims MUST be a raw JSON number, never a quoted string, expression, fraction string, object wrapper, or sentence.',
            'For proportion_ci use spec {"successes":NUMBER,"total":NUMBER,"confidence":NUMBER,"method":"wald"|"wilson"}. Method MUST match the frozen substantive artifact: use "wald" when it uses the normal approximation p ± z*sqrt(p(1-p)/n); use "wilson" when it uses the Wilson score interval.',
            'For difference_proportions_ci use exactly spec {"successes_a":NUMBER,"total_a":NUMBER,"successes_b":NUMBER,"total_b":NUMBER,"confidence":NUMBER}.',
            'For describe use spec {"values":[NUMBER,...]}.',
            'For pearson_correlation use spec {"x":[NUMBER,...],"y":[NUMBER,...]}.',
            'For simple_linear_regression use spec {"x":[NUMBER,...],"y":[NUMBER,...]}.',
            'For mean_ci use spec {"values":[NUMBER,...],"confidence":NUMBER}.',
            'For one_sample_t use spec {"values":[NUMBER,...],"mu0":NUMBER}.',
            'For welch_t use spec {"x":[NUMBER,...],"y":[NUMBER,...]}.',
            'For coefficient_t use spec {"estimate":NUMBER,"se":NUMBER,"df":NUMBER}. Use the exercise-design residual degrees of freedom when available. If the frozen answer reports only a rounded t-statistic, copy that rounded t claim; the runtime verifies it with a 0.005 absolute tolerance.',
            'Allowed analysis names also include bootstrap_ci and monte_carlo_expression when the frozen answer actually selected them.',
            'claims MUST copy the frozen answer numerical claims using result-field names such as proportion, ci_low, ci_high, difference_b_minus_a, mean, median, r, slope, t, or p_two_sided.',
            'Do not copy a rate expression such as "420/6000" into successes or total. successes is the count 420 and total is the count 6000.',
            'For approximate proportion confidence intervals, the runtime applies absolute_tolerance 0.000001 so a six-decimal reported bound is verified at its stated numerical precision rather than against hidden extra digits.',
            'Do not invent a claim or substitute Python output for a claim from the frozen answer.',
          ].join('\n')},
          {role:'user',content:safeJson({
            requirement:node.requirement_text,
            frozen_substantive_artifact:artifactObject,
            prior_python_analyses:compactAttempt>1?analyses:[],
            python_verifier_feedback:priorFailure,
            compact_repair_attempt:compactAttempt,
          })},
        ],stageBudgets.atomic_execution,
        'req_'+node.node_path.replaceAll('.','_')+'_statistics_contract_repair_'+compactAttempt);

        analyses=normalizeAnalyses(response?.parsed?.python_analyses);
        verified=verifyAnalyses(analyses);
        if(
          verified?.verification?.required===true
          &&verified.verification.ok===true
          &&verified.verification.all_claims_match===true
        )break;
        priorFailure=verified?.verification||priorFailure;
      }
    }

    if(
      verified?.verification?.required===true
      &&verified.verification.ok===true
      &&verified.verification.all_claims_match===true
    ){
      if(!durable.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'STATISTICAL_ANALYSIS_CONTRACT_REPAIR',repairIdentity,
          {python_analyses:analyses},{
            repaired:true,
            analysis_count:analyses.length,
            verification_engine:'aau_quantitative_python_v0_1',
            contract:'qda_statistical_analysis_contract_repair_v0_2',
          }
        );
      }
      console.log('AAU_QDA_STATISTICAL_ANALYSIS_CONTRACT_REPAIRED',JSON.stringify({
        agent_id:agentId,
        intent_execution_id:intentExecutionId,
        node_path:node.node_path,
        analysis_count:analyses.length,
        policy:'statistical_contract_compact_repair_v0_3',
      }));
      return {
        artifact:verified.artifact,
        verification:verified.verification,
        analysis_count:analyses.length,
      };
    }

    const rejectedVerification=verified?.verification||verification;
    console.warn('AAU_QDA_STATISTICAL_ANALYSIS_CONTRACT_REPAIR_REJECTED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:node.node_path,
      analysis_count:analyses.length,
      error:rejectedVerification.error||null,
      failure_class:rejectedVerification.failure_class||null,
      all_claims_match:rejectedVerification.all_claims_match===true,
      repair_shape:clip(safeJson(analyses),1800),
      policy:'statistical_contract_compact_repair_v0_3',
    }));
    return {
      artifact:verified?.artifact||proposedArtifact,
      verification:rejectedVerification,
      analysis_count:analyses.length,
      rejected:true,
    };
  }

  async function repairMathCheckCoverageContract(
    node,proposedArtifact,verification
  ){
    if(
      verification?.required!==true
      ||(verification?.ok===true&&verification?.all_match===true)
    )return null;

    const failureClass=text(verification?.failure_class);
    const errorText=text(verification?.error);
    const compactRepairEligible=
      failureClass==='input_contract'
      &&(
        errorText==='python_checks_required'
        ||errorText.includes('python_checks_insufficient_material_coverage')
        ||errorText.includes('python_checks_must_be_array')
      );
    if(!compactRepairEligible)return null;

    const artifactObject=parsedStructuredArtifact(proposedArtifact);
    if(!artifactObject)return null;

    const requiredCheckCount=Math.max(
      1,
      Number(verification?.required_check_count||0),
      atomicMaterialCalculationCount(artifactObject)
    );
    const repairIdentity=sha256({
      node_path:node.node_path,
      requirement:node.requirement_text,
      artifact_sha256:sha256(proposedArtifact),
      failure:errorText,
      required_check_count:requiredCheckCount,
      contract:'qda_math_check_contract_repair_v0_2_batched',
    });
    const durable=await loadJsonPhaseCheckpoint(
      node.node_path,'MATH_CHECK_CONTRACT_REPAIR',repairIdentity
    );

    const verifyChecks=checks=>{
      if(!Array.isArray(checks)||!checks.length)return null;
      const repairedObject={...artifactObject,python_checks:checks};
      const repairedArtifact=safeJson(repairedObject);
      const repairedVerification=deterministicMathVerification(
        packet,node,repairedArtifact
      );
      return {artifact:repairedArtifact,verification:repairedVerification,checks};
    };

    let checks=asArray(durable.parsed?.python_checks);
    let verified=verifyChecks(checks);
    const alreadyRepaired=
      verified?.verification?.required===true
      &&verified.verification.ok===true
      &&verified.verification.all_match===true;

    if(!alreadyRepaired){
      // Build an explicit list of the material calculation leaves that the
      // coverage validator itself counts. This keeps the repair surface small:
      // the model sees only the target results plus the local inputs/formula,
      // never the entire QDA artifact.
      const artifactBody=quantitativeArtifactBody(artifactObject);
      const materialTargets=[];
      const problemContexts=new Map();

      const compactJson=(value,limit=6000)=>{
        const raw=safeJson(value);
        return raw.length<=limit?raw:raw.slice(0,limit)+'...[truncated]';
      };
      const addMaterialTargets=(value,key,path,problemIndex)=>{
        if(value===null||value===undefined)return;
        if(NON_MATERIAL_CALCULATION_KEYS.test(String(key)))return;
        if(typeof value==='number'){
          if(Number.isFinite(value))materialTargets.push({
            problem_index:problemIndex,
            path,
            stated_result:value,
          });
          return;
        }
        if(typeof value==='string'){
          const descriptor=materialCalculationStringDescriptor(value);
          if(descriptor)materialTargets.push({
            problem_index:problemIndex,
            path,
            stated_result:descriptor.claimed_result,
            deterministic_expression:descriptor.expression,
            claimed_result:descriptor.claimed_result,
          });
          return;
        }
        if(typeof value==='boolean')return;
        if(Array.isArray(value)){
          value.forEach((item,index)=>
            addMaterialTargets(item,String(index),path+'['+String(index)+']',problemIndex)
          );
          return;
        }
        if(typeof value==='object'){
          Object.entries(value).forEach(([childKey,child])=>
            addMaterialTargets(
              child,childKey,
              path?path+'.'+childKey:childKey,
              problemIndex
            )
          );
        }
      };

      const responses=Array.isArray(artifactBody.problem_responses)
        ?artifactBody.problem_responses:[];
      if(responses.length){
        responses.forEach((response,index)=>{
          const body=asObject(response);
          problemContexts.set(index,{
            problem_id:body.problem_id??body.id??index+1,
            inputs_json:compactJson(body.inputs),
            formula_or_model_json:compactJson(body.formula_or_model),
            units_json:compactJson(body.units),
          });
          const before=materialTargets.length;
          addMaterialTargets(
            body.calculation,'calculation',
            'problem_responses['+String(index)+'].calculation',
            index
          );
          if(materialTargets.length===before){
            materialTargets.push({
              problem_index:index,
              path:'problem_responses['+String(index)+'].calculation',
              stated_result:compactJson(body.calculation,3000),
              fallback_target:true,
            });
          }
        });
      }else{
        problemContexts.set(-1,{
          problem_id:null,
          inputs_json:compactJson(artifactBody.inputs),
          formula_or_model_json:compactJson(artifactBody.formula_or_model),
          units_json:compactJson(artifactBody.units),
        });
        addMaterialTargets(
          artifactBody.calculation,'calculation','calculation',-1
        );
        if(!materialTargets.length){
          materialTargets.push({
            problem_index:-1,
            path:'calculation',
            stated_result:compactJson(artifactBody.calculation,3000),
            fallback_target:true,
          });
        }
      }

      // The validator's count is authoritative. In the rare verified-descendant
      // case where presentation leaves are fewer than the required slots, add
      // bounded fallback slots rather than resending the full artifact.
      while(materialTargets.length<requiredCheckCount){
        materialTargets.push({
          problem_index:responses.length?0:-1,
          path:'verification_slot_'+String(materialTargets.length+1),
          stated_result:'Select one still-uncovered material result from the supplied local calculation context.',
          fallback_target:true,
        });
      }
      // Some material results are conditional numeric leaves rather than
      // arithmetic strings. Derive deterministic safe-math expressions when
      // the artifact contains the authoritative sibling value needed to do so.
      // Burn is max(-operating_contribution, 0); express it using abs because
      // min/max/conditionals are intentionally outside the safe-math grammar.
      for(const target of materialTargets){
        if(
          typeof target?.stated_result==='number'
          &&Number.isFinite(target.stated_result)
          &&/\.burn$/i.test(text(target.path))
          &&!text(target.deterministic_expression)
        ){
          const contributionPath=text(target.path).replace(/\.burn$/i,'.operating_contribution');
          const contributionTarget=materialTargets.find(candidate=>
            text(candidate?.path)===contributionPath
          );
          const contributionExpression=text(contributionTarget?.deterministic_expression);
          if(contributionExpression){
            target.deterministic_expression=
              '(abs(('+contributionExpression+')) - ('+contributionExpression+')) / 2';
            target.claimed_result=target.stated_result;
            target.derivation_contract='qda_burn_from_operating_contribution_v0_1';
            target.derivation_source_path=contributionPath;
          }
        }
      }

      // If the frozen artifact already contains a safe arithmetic expression
      // for a material leaf, distinguish a genuine numerical disagreement from
      // a missing/invalid check-packaging contract BEFORE asking the serializer
      // to repair coverage. A serializer must never be asked to manufacture a
      // different expression merely to make an incorrect claimed result pass.
      const substantiveMismatches=[];
      for(const target of materialTargets){
        const expression=text(target?.deterministic_expression);
        const claimedResult=target?.claimed_result;
        if(!expression||typeof claimedResult!=='number'||!Number.isFinite(claimedResult)){
          continue;
        }
        const check={
          label:text(target?.path)+' :: deterministic substantive check',
          expression,
          claimed_result:claimedResult,
          problem:text(target?.path),
        };
        const observed=verifyPythonMathChecksChunked(
          [check],{absoluteTolerance:0.005,relativeTolerance:1e-9}
        );
        const row=asArray(observed?.results)[0];
        if(
          observed?.ok===true
          &&row?.valid===true
          &&row?.matched===false
          &&typeof row?.actual==='number'
          &&Number.isFinite(row.actual)
        ){
          substantiveMismatches.push({
            path:text(target?.path),
            expression,
            claimed_result:claimedResult,
            actual:row.actual,
            absolute_tolerance:row.absolute_tolerance??null,
            relative_tolerance:row.relative_tolerance??null,
            error_code:row.error_code??null,
          });
        }
      }

      if(substantiveMismatches.length){
        const mismatchVerification={
          required:true,
          ok:true,
          all_match:false,
          all_valid:true,
          failure_class:'numeric_mismatch',
          error:'deterministic_material_result_mismatch',
          check_count:substantiveMismatches.length,
          required_check_count:requiredCheckCount,
          results:substantiveMismatches.map((mismatch,index)=>({
            index,
            label:mismatch.path+' :: deterministic substantive check',
            problem:mismatch.path,
            valid:true,
            matched:false,
            actual:mismatch.actual,
            claimed_result:mismatch.claimed_result,
            absolute_tolerance:mismatch.absolute_tolerance,
            relative_tolerance:mismatch.relative_tolerance,
            error_code:mismatch.error_code,
            expression:mismatch.expression,
          })),
          validation_failures:[],
          substantive_mismatch:true,
          contract:'qda_material_numeric_mismatch_v0_1',
        };
        console.warn('AAU_QDA_MATH_SUBSTANTIVE_MISMATCH_ROUTED_TO_AGENT',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          mismatch_count:substantiveMismatches.length,
          mismatches:substantiveMismatches.slice(0,8),
          policy:'substantive_numeric_mismatch_precedes_serializer_repair_v0_1',
        }));
        return {
          artifact:proposedArtifact,
          verification:mismatchVerification,
          check_count:0,
          substantive_mismatch:true,
        };
      }

      const targets=materialTargets.slice(0,requiredCheckCount);
      checks=[];

      const generateBatch=async(batchTargets,batchOrdinal)=>{
        const contextIndexes=[...new Set(
          batchTargets.map(target=>Number(target.problem_index))
        )];
        const localContexts=contextIndexes.map(index=>({
          problem_index:index,
          ...asObject(problemContexts.get(index)),
        }));
        const batchIdentity=sha256({
          repair_identity:repairIdentity,
          batch_ordinal:batchOrdinal,
          target_paths:batchTargets.map(target=>target.path),
          contract:'qda_math_check_contract_repair_batch_v0_2',
        });
        const prior=await loadJsonPhaseCheckpoint(
          node.node_path,'MATH_CHECK_CONTRACT_REPAIR_BATCH',batchIdentity
        );
        const bindChecksToTargets=(rawChecks,targetSubset)=>
          asArray(rawChecks).map((check,index)=>{
            const targetPath=text(targetSubset[index]?.path)
              ||('material_result_'+String(index+1));
            const rawLabel=text(check?.label)||'check';
            // Avoid stacking the same prefix when a checkpoint was already
            // produced by the path-bound version.
            const label=rawLabel.startsWith(targetPath+' :: ')
              ?rawLabel:(targetPath+' :: '+rawLabel);
            return {
              ...asObject(check),
              label,
              problem:targetPath,
            };
          });

        const priorChecks=asArray(prior.parsed?.python_checks);
        if(priorChecks.length===batchTargets.length){
          const priorBoundChecks=bindChecksToTargets(priorChecks,batchTargets);
          const priorVerification=verifyPythonMathChecksChunked(
            priorBoundChecks,{absoluteTolerance:0.005,relativeTolerance:1e-9}
          );
          if(priorVerification.ok===true&&priorVerification.all_match===true){
            return priorBoundChecks;
          }
        }

        const localCheckForTarget=target=>{
          const expression=text(target?.deterministic_expression);
          const claimedResult=target?.claimed_result;
          if(!expression||typeof claimedResult!=='number'||!Number.isFinite(claimedResult)){
            return null;
          }
          const check={
            label:text(target?.path)+' :: deterministic calculation',
            expression,
            claimed_result:claimedResult,
            problem:text(target?.path),
          };
          const verification=verifyPythonMathChecksChunked(
            [check],{absoluteTolerance:0.005,relativeTolerance:1e-9}
          );
          return verification.ok===true&&verification.all_match===true?check:null;
        };

        const callBatch=async(targetSubset,suffix,repairFeedback=null)=>{
          const messages=[
            {role:'system',content:[
              'You are mechanically packaging deterministic Python checks for an already-written quantitative QDA calculation.',
              'Do not rewrite, reconsider, explain, or summarize the answer. Return only {"python_checks":[...]} and nothing else.',
              'Produce EXACTLY one check for each supplied material_result target, in the same order. Do not add extra checks.',
              'Each check must contain nonempty label, safe arithmetic expression, and finite raw JSON-number claimed_result.',
              'The expression must independently reconstruct the stated material result from the supplied frozen inputs/formula. Never use the claimed result itself as a trivial constant-only expression.',
              'SAFE MATH: numeric constants, + - * / ** %, parentheses, pi/e, sqrt/log/log10/exp/abs/round only. No variables, assignments, arrays, indexing, imports, comprehensions, lambdas, attributes, sum(), or range(). Expand finite sums explicitly.',
              'No prose outside JSON. Keep labels short and expressions minimal.',
            ].join('\n')},
            {role:'user',content:safeJson({
              requirement:clip(text(node.requirement_text),1200),
              local_problem_contexts:localContexts,
              material_results:targetSubset,
              required_output_check_count:targetSubset.length,
              repair_batch:batchOrdinal,
              ...(repairFeedback?{prior_verifier_feedback:repairFeedback}:{}),
            })},
          ];
          const phase='req_'+node.node_path.replaceAll('.','_')
            +'_math_check_contract_batch_'+String(batchOrdinal)+suffix;
          // Math-check repair is a protocol packaging task. It is permanently
          // serializer-only: no path may escalate a single check into deep
          // cognition or a multi-thousand-token response.
          const response=await callSerialize(messages,900,phase);
          let batchChecks=asArray(response?.parsed?.python_checks);
          if(batchChecks.length!==targetSubset.length){
            const error=new Error('qda_math_check_batch_count_mismatch');
            error.code='QDA_MATH_CHECK_BATCH_INVALID';
            throw error;
          }
          batchChecks=bindChecksToTargets(batchChecks,targetSubset);
          const batchVerification=verifyPythonMathChecksChunked(
            batchChecks,{absoluteTolerance:0.005,relativeTolerance:1e-9}
          );
          if(batchVerification.ok!==true||batchVerification.all_match!==true){
            const error=new Error('qda_math_check_batch_verification_failed');
            error.code='QDA_MATH_CHECK_BATCH_INVALID';
            error.verification=batchVerification;
            throw error;
          }
          return batchChecks;
        };

        const generateSingleton=async(target,index)=>{
          const singletonIdentity=sha256({
            repair_identity:repairIdentity,
            batch_ordinal:batchOrdinal,
            singleton_ordinal:index+1,
            target_path:target.path,
            contract:'qda_math_check_contract_repair_single_v0_1',
          });
          const priorSingleton=await loadJsonPhaseCheckpoint(
            node.node_path,'MATH_CHECK_CONTRACT_REPAIR_SINGLE',singletonIdentity
          );
          const priorChecks=asArray(priorSingleton.parsed?.python_checks);
          if(priorChecks.length===1){
            const priorVerification=verifyPythonMathChecksChunked(
              priorChecks,{absoluteTolerance:0.005,relativeTolerance:1e-9}
            );
            if(priorVerification.ok===true&&priorVerification.all_match===true){
              return priorChecks;
            }
          }

          const local=localCheckForTarget(target);
          let one=local?[local]:null;
          if(!one){
            try{
              one=await callBatch([target],'_single_'+String(index+1));
            }catch(firstError){
              // One bounded serializer retry may use verifier feedback. Never
              // escalate deterministic packaging into deep reasoning.
              console.warn('AAU_QDA_MATH_CHECK_SINGLE_SERIALIZER_RETRY',JSON.stringify({
                agent_id:agentId,
                intent_execution_id:intentExecutionId,
                node_path:node.node_path,
                batch_ordinal:batchOrdinal,
                singleton_ordinal:index+1,
                error:clip(String(firstError?.message||firstError),400),
                policy:'single_result_serializer_bounded_retry_v0_2_no_deep_fallback',
              }));
              try{
                one=await callBatch(
                  [target],
                  '_single_'+String(index+1)+'_retry_2',
                  firstError?.verification||{error:clip(String(firstError?.message||firstError),300)}
                );
              }catch(secondError){
                const error=new Error('qda_math_check_singleton_bounded_repair_exhausted');
                error.code='QDA_MATH_CHECK_SINGLETON_REPAIR_EXHAUSTED';
                error.cause=secondError;
                error.target_path=target?.path||null;
                throw error;
              }
            }
          }
          await saveJsonPhaseCheckpoint(
            node.node_path,'MATH_CHECK_CONTRACT_REPAIR_SINGLE',singletonIdentity,
            {python_checks:one},{
              repaired:true,
              batch_ordinal:batchOrdinal,
              singleton_ordinal:index+1,
              target_path:target.path,
              check_count:1,
              contract:'qda_math_check_contract_repair_single_v0_1',
            }
          );
          return one;
        };

        let batchChecks=[];
        try{
          // This is protocol packaging, not fresh substantive cognition.
          // Serializer mode has Thinking OFF and a 900-token ceiling, which
          // prevents the former repair stage from spending thousands of tokens
          // narrating a small verification structure.
          const localBatch=batchTargets.map(localCheckForTarget);
          if(localBatch.every(Boolean)){
            batchChecks=localBatch;
          }else{
            batchChecks=await callBatch(batchTargets,'');
          }
        }catch(error){
          if(batchTargets.length===1)throw error;
          console.warn('AAU_QDA_MATH_CHECK_BATCH_SPLIT_TO_SINGLETONS',JSON.stringify({
            agent_id:agentId,
            intent_execution_id:intentExecutionId,
            node_path:node.node_path,
            batch_ordinal:batchOrdinal,
            target_count:batchTargets.length,
            error:clip(String(error?.message||error),400),
            policy:'batch_to_durable_singletons_v0_1',
          }));
          for(let index=0;index<batchTargets.length;index+=1){
            const one=await generateSingleton(batchTargets[index],index);
            batchChecks.push(...one);
          }
        }

        await saveJsonPhaseCheckpoint(
          node.node_path,'MATH_CHECK_CONTRACT_REPAIR_BATCH',batchIdentity,
          {python_checks:batchChecks},{
            repaired:true,
            batch_ordinal:batchOrdinal,
            target_count:batchTargets.length,
            check_count:batchChecks.length,
            contract:'qda_math_check_contract_repair_batch_v0_2',
          }
        );
        return batchChecks;
      };

      const batchSize=3;
      let batchOrdinal=0;
      for(let startIndex=0;startIndex<targets.length;startIndex+=batchSize){
        batchOrdinal++;
        const batchTargets=targets.slice(startIndex,startIndex+batchSize);
        const batchChecks=await generateBatch(batchTargets,batchOrdinal);
        checks.push(...batchChecks);
      }
      verified=verifyChecks(checks);
    }

    if(
      verified?.verification?.required===true
      &&verified.verification.ok===true
      &&verified.verification.all_match===true
    ){
      if(!durable.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'MATH_CHECK_CONTRACT_REPAIR',repairIdentity,
          {python_checks:checks},{
            repaired:true,
            check_count:checks.length,
            required_check_count:Number(verified.verification.required_check_count||0),
            verification_engine:'python3_safe_math_v0_1',
            contract:'qda_math_check_contract_repair_v0_2_batched',
          }
        );
      }
      console.log('AAU_QDA_MATH_CHECK_CONTRACT_REPAIRED',JSON.stringify({
        agent_id:agentId,
        intent_execution_id:intentExecutionId,
        node_path:node.node_path,
        check_count:checks.length,
        required_check_count:Number(verified.verification.required_check_count||0),
        batch_size:3,
        policy:'math_check_contract_batched_repair_v0_5_serializer_only_no_deep_fallback',
      }));
      return {
        artifact:verified.artifact,
        verification:verified.verification,
        check_count:checks.length,
      };
    }

    console.warn('AAU_QDA_MATH_CHECK_CONTRACT_REPAIR_REJECTED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:node.node_path,
      error:text(verified?.verification?.error)||errorText||null,
      check_count:checks.length,
      required_check_count:Number(
        verified?.verification?.required_check_count
        ||verification?.required_check_count
        ||0
      ),
      policy:'math_check_contract_batched_repair_v0_5_numeric_leaf_coverage',
    }));
    return null;
  }
  async function executeAtomic(node){
    let pinnedEvidence=await loadPinnedEvidence(node.node_path);
    const atomicDurableCatalog=await loadDurableResearchCatalog(node.node_path);
    const verifiedResultsSynthesis=qdaVerifiedResultsSynthesisRequirement(node);
    const nodeContext=asObject(node.context_payload);
    const atomicScopeContext=verifiedResultsSynthesis
      ? {
          qda_601_context:nodeContext.qda_601_context,
          dependency_context_contract:nodeContext.dependency_context_contract,
          completed_sibling_results:nodeContext.completed_sibling_results,
          inherited_completed_sibling_results:nodeContext.inherited_completed_sibling_results,
        }
      : nodeContext;
    const authoritativePythonCalculation=qdaM7U4AuthoritativePythonCalculation(packet);
    const atomicBaseContext={
      ...atomicScopeContext,
      ...(authoritativePythonCalculation?{
        runtime_python_calculation:authoritativePythonCalculation,
      }:{}),
      ...(!verifiedResultsSynthesis&&atomicDurableCatalog.length?{
        research_source_catalog:mergeResearchSourceCatalog(
          nodeContext.research_source_catalog,
          atomicDurableCatalog
        )
      }:{})
    };
    const atomicContextView=()=>agentModelContextView(
      atomicBaseContext,pinnedEvidence,stageBudgets.atomic_execution
    );
    const siblingEvidence=atomicContextView().siblingEvidence;
    const atomicCognitionContext=()=>atomicContextView().suppliedContext;
    const mathRetryState=qdaQuantitativeAtomicRequirement(packet,node)?{
      required:Boolean(node?.decision_payload?.deterministic_math_reconciliation_required),
      attempt:Math.max(0,Number(node?.decision_payload?.deterministic_math_attempts||0)),
      gate:text(node?.decision_payload?.deterministic_math_gate)||null,
      feedback:asObject(node?.context_payload?.deterministic_math_feedback),
    }:null;
    const statisticsRetryState=qdaStatisticalAtomicRequirement(packet,node)?{
      required:Boolean(node?.decision_payload?.deterministic_statistics_reconciliation_required),
      attempt:Math.max(0,Number(node?.decision_payload?.deterministic_statistics_attempts||0)),
      gate:text(node?.decision_payload?.deterministic_statistics_gate)||null,
      feedback:asObject(node?.context_payload?.deterministic_statistics_feedback),
    }:null;
    const correctionSuppliedContext=()=>{
      const full=asObject(atomicCognitionContext());
      if(!mathRetryState?.required)return full;
      const qda=asObject(full.qda_601_context);
      return {
        qda_601_context:{
          program_code:qda.program_code,
          program_version:qda.program_version,
          next_unit:qda.next_unit,
          hard_gates:qda.hard_gates,
          governing_loop:qda.governing_loop,
          required_submission_fields:qda.required_submission_fields,
          evidence_state_labels:qda.evidence_state_labels,
        },
        qda_curriculum_problem_binding:
          full.qda_curriculum_problem_binding
          ||nodeContext.qda_curriculum_problem_binding
          ||null,
        dependency_context_contract:
          full.dependency_context_contract
          ||nodeContext.dependency_context_contract
          ||null,
        completed_sibling_results:
          full.completed_sibling_results
          ||nodeContext.completed_sibling_results
          ||[],
        inherited_completed_sibling_results:
          full.inherited_completed_sibling_results
          ||nodeContext.inherited_completed_sibling_results
          ||[],
        runtime_python_calculation:
          full.runtime_python_calculation
          ||atomicBaseContext.runtime_python_calculation
          ||null,
      };
    };
    const atomicSemanticIdentity=sha256({
      node_path:node.node_path,
      requirement:node.requirement_text,
      qda_execution_scope_version:'verified_results_synthesis_v0_2_lean_context',
      qda_verified_results_synthesis:verifiedResultsSynthesis,
      discovery_fingerprint:text(node?.decision_payload?.routing_discovery_checkpoint?.context_fingerprint)||null,
      deterministic_math_retry:mathRetryState,
      deterministic_statistics_retry:statisticsRetryState,
      authoritative_sibling_results:siblingEvidence.map(v=>({
        path:v.path,status:v.status,decision_type:v.decision_type,result_hash:v.result_hash
      })),
      supplied_context:correctionSuppliedContext(),
      pinned_evidence:pinnedEvidence.map(v=>({
        source_key:v.source_key,url:v.url,sha256:v.sha256,excerpt_bytes:v.excerpt_bytes
      })),
    });
    const durableAtomic=await loadJsonPhaseCheckpoint(
      node.node_path,'ATOMIC_EXECUTION',atomicSemanticIdentity
    );
    let parsed=durableAtomic.parsed;
    const atomicExecutionBaseBudget=Math.max(1,Number(stageBudgets.atomic_execution||7000));
    const atomicExecutionBudgetForAttempt=attempt=>{
      if(!mathRetryState?.required)return atomicExecutionBaseBudget;
      // A verifier-directed correction is still the same bounded atomic
      // requirement. Give the bound agent enough output room to reason through
      // the supplied numerical disagreement before considering decomposition.
      return Math.min(
        18000,
        Math.max(atomicExecutionBaseBudget,attempt===1?12000:16000)
      );
    };
    if(!parsed){
    try{
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=await callJson([
            {role:'system',content:[
              'You are the bound autonomous agent executing exactly ONE requirement you previously judged ATOMIC.',
              'Complete only this requirement. Do not silently expand into unrelated work.',
              'authoritative_completed_sibling_evidence contains durable outputs from direct siblings and inherited ancestor prerequisites. Treat both as available evidence and inspect them before asking for information already supplied anywhere in the dependency chain.',
              'If you discover it is not actually bounded, return {"status":"SPLIT","reason":"..."} instead of forcing an oversized answer.',
              'If context is missing, return {"status":"NEED_CONTEXT","context_requests":["exact.path"],"research_queries":["query"],"research_urls":["https://..."],"reason":"..."}. You choose any research questions; do not fabricate findings.',
              'Otherwise return JSON only: {"status":"COMPLETE","artifact":"concise auditable work product OR a real nested JSON object when the requirement names a structured lifecycle contract","handoff":{"conclusions":[],"facts":[],"unresolved":[]}}.',
              'Never stringify an object as "[object Object]". If the work product is structured, place the actual JSON object in artifact.',
              'Keep the artifact bounded. Preserve uncertainty and do not claim external facts without supplied evidence.',
              ...(verifiedResultsSynthesis?[
                'VERIFIED-RESULTS SYNTHESIS SCOPE: the quantitative/statistical execution is already complete in authoritative_completed_sibling_evidence. Do not recompute it, do not recreate its full calculation tree, and do not invent replacement python_checks/python_analyses.',
                'Use the verified sibling result as evidence. Produce only the interpretation, sanity check, evidence linkage, self-audit, decision relevance, or other synthesis fields explicitly requested by this requirement. You may quote the verified final result and key inputs needed to explain the conclusion.'
              ]:[]),
              ...(qdaQuantitativeAtomicRequirement(packet,node)?[
                'DETERMINISTIC MATH COMPANION: this is a quantitative QDA requirement. Return artifact as a real JSON object and put python_checks INSIDE that artifact object, not beside the wrapper. python_checks MUST be an array. Every check MUST be an object with label as a nonempty string, expression as a nonempty string, and claimed_result as a finite JSON number (never a quoted number, boolean, null, array, or object). Each material numerical result must have its own check.',
                ...(authoritativePythonCalculation?[
                  'AUTHORITATIVE PYTHON CALCULATION: supplied_context.runtime_python_calculation was computed by the runtime from the canonical curriculum case data using the sandboxed Python safe-math evaluator. Treat those numeric values as authoritative. Do not recompute, round early, or replace them with approximate mental arithmetic. Your job is to explain, structure, sanity-check, and bind those results to the requested submission fields.',
                  'When you emit python_checks for a value already present in runtime_python_calculation, use an expression consistent with the canonical formula and set claimed_result to the supplied Python value (or a presentation-rounded value only when that rounding is explicit and within the runtime tolerance).'
                ]:[]),
                'SAFE MATH EXPRESSION CONTRACT: expressions may contain numeric constants, + - * / ** %, parentheses, pi/e, and safe functions sqrt/log/log10/exp/abs/round only. Do NOT use variables, assignments, sum(), range(), list/dict/tuple literals, comprehensions, lambdas, indexing, attributes, imports, or other Python syntax. Expand a finite sum explicitly with + terms.',
                'Python verifies arithmetic only; you remain responsible for selecting the correct formula, units, assumptions, and interpretation.',
                'Do your reasoning first. Treat a later Python disagreement as evidence that your numerical execution must be reconciled; never change the formula merely to force a match.',
                'If deterministic_math_feedback is present, this is a fresh correction attempt. Inspect that feedback explicitly and return NEW python_checks; do not repeat or reuse an earlier artifact.'
              ]:[]),
              ...(qdaStatisticalAtomicRequirement(packet,node)?[
                'QUANTITATIVE PYTHON STATISTICS COMPANION: choose the statistical method yourself, state why it is appropriate, state assumptions/limitations, then return artifact as a real JSON object containing python_analyses INSIDE that artifact object, not beside the wrapper.',
                'Each python_analyses item must contain id, analysis, spec, and claims. claims are YOUR numerical/statistical conclusions keyed to result fields (for example mean, median, r, ci_low, ci_high, t, p_two_sided). Python recomputes them independently.',
                'Allowed analyses include describe, pearson_correlation, simple_linear_regression, proportion_ci, difference_proportions_ci, mean_ci, one_sample_t, welch_t, coefficient_t, bootstrap_ci, and monte_carlo_expression.',
                'Python owns numerical execution only. You own method selection, assumptions, causal limits, interpretation, and decision relevance. A p-value or correlation is not a causal conclusion.',
                'If deterministic_statistics_feedback is present, this is a fresh correction attempt. Inspect the returned calculations/diagnostics explicitly and return NEW python_analyses and revised interpretation; do not reuse the rejected artifact.'
              ]:[]),
               'EPISTEMIC THRESHOLD POLICY: '+THRESHOLD_EVIDENCE_POLICY.RULE+' '+THRESHOLD_EVIDENCE_POLICY.PASS+' '+THRESHOLD_EVIDENCE_POLICY.FAIL+' '+THRESHOLD_EVIDENCE_POLICY.UNKNOWN,
            ].join('\n')},
            {role:'user',content:safeJson({
              requirement:node.requirement_text,
              agent_authored_discovery_state:mathRetryState?.required?null:agentDiscoveryState(node),
              authoritative_completed_sibling_evidence:siblingEvidence,
              supplied_context:correctionSuppliedContext(),
              deterministic_math_feedback:mathRetryState?.feedback||null,
              deterministic_math_retry_attempt:mathRetryState?.attempt||0,
              deterministic_statistics_feedback:statisticsRetryState?.feedback||null,
              deterministic_statistics_retry_attempt:statisticsRetryState?.attempt||0,
              available_context_index:mathRetryState?.required?[]:idx,
              available_supplied_context_index:indexObject(correctionSuppliedContext()),
            })},
          ],atomicExecutionBudgetForAttempt(attempt),'req_'+node.node_path.replaceAll('.','_')+'_atomic_'+attempt);
          parsed=response?.parsed;
          break;
        }catch(error){
          // Bounded continuation invariant: a length-truncated candidate is
          // durable rejected-attempt evidence, never a cue to replay the same
          // oversized atomic request. Return semantic control immediately so
          // the bound agent must narrow/decompose before another attempt.
          if(error?.code==='COGNITION_RESPONSE_REJECTED'
             &&String(error?.rejectionReason||'').toUpperCase()==='TRUNCATED_RESPONSE'){
            if(mathRetryState?.required&&attempt===1){
              console.warn('AAU_QDA_MATH_CORRECTION_TRUNCATION_RETRY',JSON.stringify({
                agent_id:agentId,
                intent_execution_id:intentExecutionId,
                node_path:node.node_path,
                deterministic_math_attempt:mathRetryState.attempt,
                first_output_budget:atomicExecutionBudgetForAttempt(1),
                retry_output_budget:atomicExecutionBudgetForAttempt(2),
                policy:'math_correction_same_atomic_expanded_retry_v0_1',
              }));
              continue;
            }
            throw error;
          }
          if(attempt===2)throw error;
          if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT')throw error;
        }
      }
    }catch(error){
      if(error?.code==='NVIDIA_TIMEOUT')throw error;
      if(error?.code==='COGNITION_RESPONSE_REJECTED'){
        const atomicExecutionFailures=Math.max(0,Number(node?.decision_payload?.atomic_execution_failures||0))+1;
        const reset=await saveNode({
          nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
          requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
          status:'pending',decisionType:null,
          decisionPayload:{
            ...(node.decision_payload||{}),
            prior_atomic_rejection:String(error?.rejectionReason||error?.code||'incomplete'),
            reconsider_decomposition:true,
            atomic_execution_failures:atomicExecutionFailures,
            atomic_unavailable:atomicExecutionFailures>=MAX_ATOMIC_EXECUTION_FAILURES,
          },
          contextPayload:node.context_payload||{},resultArtifact:null,
        });
        reset.parent_path=node.parent_path??parentPathOf(node.node_path);
        return {reconsider:true,node:reset};
      }
      throw error;
    }
    }

    const atomicStageContractForProtocol=
      stageContractForRequirement(packet,node.requirement_text,node.node_path);
    let status=text(parsed?.status).toUpperCase();

    // Structured lifecycle contracts are allowed to arrive as the contract
    // object itself instead of the generic atomic wrapper. Treat that as a
    // mechanical protocol variant only when the object actually validates
    // against the authoritative current stage contract.
    if(!['SPLIT','NEED_CONTEXT','COMPLETE'].includes(status)
       &&atomicStageContractForProtocol.applies){
      const directCandidates=[
        asObject(parsed?.proposal),
        (parsed?.artifact&&typeof parsed.artifact==='object'&&!Array.isArray(parsed.artifact))
          ?asObject(parsed.artifact):{},
        asObject(parsed),
      ].filter(v=>Object.keys(v).length);
      const directProposal=directCandidates.find(candidate=>
        validateStageContractArtifact(
          atomicStageContractForProtocol.definition,
          safeJson(candidate)
        ).valid
      );
      if(directProposal){
        parsed={
          status:'COMPLETE',
          artifact:directProposal,
          handoff:asObject(parsed?.handoff),
          _atomic_protocol_normalization:{
            version:'structured_stage_contract_direct_atomic_v0_1',
            original_status:text(parsed?.status)||null,
            original_outcome:text(parsed?.outcome)||null,
            normalized_status:'COMPLETE',
            stage_contract_name:atomicStageContractForProtocol.name,
          },
        };
        status='COMPLETE';
        console.log('AAU_AUTONOMOUS_ATOMIC_PROTOCOL_NORMALIZED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          normalization:'structured_stage_contract_direct_atomic_v0_1',
          stage_contract_name:atomicStageContractForProtocol.name,
        }));
      }
    }

    // Also accept the generic outcome label as a mechanical alias when the
    // model otherwise followed the atomic response contract.
    if(!['SPLIT','NEED_CONTEXT','COMPLETE'].includes(status)){
      const outcomeAlias=text(parsed?.outcome).toUpperCase();
      if(['SPLIT','NEED_CONTEXT','COMPLETE'].includes(outcomeAlias)){
        parsed={...parsed,status:outcomeAlias};
        status=outcomeAlias;
      }
    }

    // QDA quantitative/statistical atomic work sometimes arrives as the
    // artifact object itself rather than the generic {status,artifact} wrapper.
    // This is a protocol-shape normalization only. It does NOT certify the
    // computation: deterministic Python verification still runs immediately
    // afterward and blocks any numerical/statistical disagreement.
    if(!['SPLIT','NEED_CONTEXT','COMPLETE'].includes(status)
       &&(qdaQuantitativeAtomicRequirement(packet,node)
          ||qdaStatisticalAtomicRequirement(packet,node))){
      const directQdaObject=qdaDirectAtomicArtifactCandidate(parsed);
      const hasQdaBody=
        Object.keys(directQdaObject).length>0
        &&(
          directQdaObject.calculation!==undefined
          ||directQdaObject.formula_or_model!==undefined
          ||Array.isArray(directQdaObject.python_checks)
          ||Array.isArray(directQdaObject.python_analyses)
        );
      if(hasQdaBody){
        parsed={
          status:'COMPLETE',
          artifact:directQdaObject,
          handoff:asObject(parsed?.handoff),
          _atomic_protocol_normalization:{
            version:'qda_direct_atomic_artifact_v0_1',
            original_status:text(parsed?.status)||null,
            original_outcome:text(parsed?.outcome)||null,
            normalized_status:'COMPLETE',
            python_verification_still_required:true,
          },
        };
        status='COMPLETE';
        console.log('AAU_AUTONOMOUS_ATOMIC_PROTOCOL_NORMALIZED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          normalization:'qda_direct_atomic_artifact_v0_1',
          python_verification_still_required:true,
        }));
      }
    }

    if(!['SPLIT','NEED_CONTEXT','COMPLETE'].includes(status)){
      if(!durableAtomic.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'ATOMIC_PROTOCOL_REJECTED',atomicSemanticIdentity,
          asObject(parsed),{
            atomic_status:text(parsed?.status)||null,
            atomic_outcome:text(parsed?.outcome)||null,
            rejection_reason:'atomic_status_invalid_after_protocol_normalization',
          }
        );
      }
      const atomicProtocolFailures=
        Math.max(0,Number(node?.decision_payload?.atomic_protocol_failures||0))+1;
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:null,
        decisionPayload:{
          ...(node.decision_payload||{}),
          // A valid JSON response with an invalid/missing atomic wrapper is a
          // protocol-shape failure. It must not poison the agent's semantic
          // ATOMIC allowance or be reported as failed cognition.
          prior_atomic_protocol_rejection:'atomic_status_invalid_after_protocol_normalization',
          atomic_protocol_failures:atomicProtocolFailures,
          atomic_protocol_recovery_exhausted:atomicProtocolFailures>=MAX_ATOMIC_PROTOCOL_FAILURES,
          reconsider_decomposition:false,
          atomic_protocol_recovery_version:'separate_protocol_failure_accounting_v0_2',
        },
        contextPayload:node.context_payload||{},
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }

    if(status==='SPLIT'){
      if(!durableAtomic.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'ATOMIC_EXECUTION',atomicSemanticIdentity,parsed,{
            atomic_status:'SPLIT',
          }
        );
      }
      const split=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'split',decisionType:'SPLIT',
        decisionPayload:{...(node.decision_payload||{}),reason:clip(parsed?.reason,1200),reclassified_during_execution:true},
        contextPayload:node.context_payload||{},resultArtifact:null,
      });
      split.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {split:true,node:split};
    }
    if(status==='NEED_CONTEXT'){
      const rawRequests=asArray(parsed?.context_requests).map(text).filter(Boolean).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND);
      const urlRequestsFromContext=rawRequests.filter(v=>/^https:\/\//i.test(v));
      const requests=rawRequests.filter(v=>!/^https:\/\//i.test(v));
      const researchQueries=asArray(parsed?.research_queries).map(text).filter(Boolean).slice(0,8);
      const researchUrls=[...new Set([
        ...asArray(parsed?.research_urls),
        ...urlRequestsFromContext,
      ].map(text).filter(v=>/^https:\/\//i.test(v)))].slice(0,8);
      if(!requests.length&&!researchQueries.length&&!researchUrls.length)
        throw new Error('autonomous_decomposition_atomic_context_empty:'+node.node_path);
      if(!durableAtomic.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'ATOMIC_EXECUTION',atomicSemanticIdentity,parsed,{
            atomic_status:'NEED_CONTEXT',
          }
        );
      }
      await chargeSemanticRuntime({
        eventKind:'context_acquisition',
        materialKey:node.node_path+':atomic:'+sha256({requests,researchQueries,researchUrls}),
        nodePath:node.node_path,
        costUnits:semanticRuntime.context_acquire_units,
        eventFingerprint:sha256({
          node_path:node.node_path,
          phase:'atomic_need_context',
          requests,
          research_queries:researchQueries,
          research_urls:researchUrls,
        }),
        metadata:{
          phase:'atomic_need_context',
          request_count:requests.length,
          query_count:researchQueries.length,
          url_count:researchUrls.length,
        },
      });
      let researchObserved=null;
      if((researchQueries.length||researchUrls.length)&&typeof researchContext==='function'){
        researchObserved=await researchContext({nodePath:node.node_path,queries:researchQueries,urls:researchUrls});
      }else if(researchQueries.length||researchUrls.length){
        researchObserved={status:'unavailable',reason:'research_runtime_not_configured'};
      }
      if(researchObserved?.audit_batch_id){
        await linkResearchBatch(node.node_path,researchObserved.audit_batch_id);
      }
      const pinnedResult=await persistExplicitResearchEvidence(node.node_path,researchUrls,researchObserved);
      pinnedEvidence=pinnedResult.evidence;
      const contextPayload=boundInMemoryContext({
        ...atomicBaseContext,
        ...resolveContext(packet,requests,atomicCognitionContext()),
        ...(researchObserved?{external_research_atomic:researchObserved}:{}),
      },pinnedEvidence,stageBudgets.atomic_execution);
      counters.context_requests+=requests.length+researchQueries.length+researchUrls.length;
      const reset=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'pending',decisionType:'NEED_CONTEXT',
        decisionPayload:{
          ...(node.decision_payload||{}),
          reason:clip(parsed?.reason,1200),
          context_requests:requests,
          research_queries:researchQueries,
          research_urls:researchUrls,
          reclassified_during_execution:true
        },
        contextPayload,resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }
    let proposedArtifact=artifactText(companionNormalizedArtifact(parsed));
    if(!proposedArtifact)throw new Error('autonomous_decomposition_atomic_artifact_empty:'+node.node_path);
    const proposedHandoff=asObject(parsed?.handoff);

    // Persist the model's completed atomic answer before deterministic verifier
    // repair. A worker replacement during a compact repair must never force the
    // expensive atomic solve to run again.
    if(!durableAtomic.parsed){
      await saveJsonPhaseCheckpoint(
        node.node_path,'ATOMIC_EXECUTION',atomicSemanticIdentity,parsed,{
          atomic_status:'COMPLETE',
          artifact_hash:sha256(proposedArtifact),
          deterministic_verification_pending:true,
          checkpoint_boundary:'pre_deterministic_repair_v0_1',
        }
      );
    }

    let proposedMathVerification=deterministicMathVerification(packet,node,proposedArtifact);
    if(
      proposedMathVerification.required===true
      &&(!proposedMathVerification.ok||!proposedMathVerification.all_match)
    ){
      const repairedMath=await repairMathCheckCoverageContract(
        node,proposedArtifact,proposedMathVerification
      );
      if(repairedMath?.artifact){
        proposedArtifact=repairedMath.artifact;
        proposedMathVerification=repairedMath.verification;
      }
    }
    let proposedStatisticsVerification=deterministicStatisticalVerification(packet,node,proposedArtifact);
    if(
      proposedStatisticsVerification.required===true
      &&(!proposedStatisticsVerification.ok
        ||!proposedStatisticsVerification.all_claims_match)
    ){
      const repaired=await repairStatisticalAnalysisContract(
        node,proposedArtifact,proposedStatisticsVerification
      );
      if(repaired?.artifact){
        proposedArtifact=repaired.artifact;
        proposedStatisticsVerification=repaired.verification;
      }
    }

    // Deterministic arithmetic is checked BEFORE model reconciliation. A known
    // arithmetic mismatch is not a reason to spend another long reasoning call.
    // Return the exact Python observations to the same bound agent on the next
    // atomic attempt; the changed context invalidates reuse of the bad checkpoint.
    if(proposedMathVerification.required
       &&(!proposedMathVerification.ok||!proposedMathVerification.all_match)){
      const priorMathAttempts=Math.max(
        0,
        Number(node?.decision_payload?.deterministic_math_attempts||0)
      );
      const mathAttempt=priorMathAttempts+1;
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:'ATOMIC',
        decisionPayload:{
          ...(node.decision_payload||{}),
          deterministic_math_reconciliation_required:true,
          deterministic_math_attempts:mathAttempt,
          deterministic_math_verification:proposedMathVerification,
          deterministic_math_gate:'pre_reconciliation_python_v0_3_checkpoint_identity',
          deterministic_math_retry_nonce:sha256({
            node_path:node.node_path,
            attempt:mathAttempt,
            verification:proposedMathVerification,
          }).slice(0,24),
          reconsider_decomposition:false,
        },
        contextPayload:{
          ...(node.context_payload||{}),
          deterministic_math_feedback:{
            attempt:mathAttempt,
            verifier:'python3_safe_math_v0_1',
            verification:proposedMathVerification,
            instruction:'Correct the numerical work and python_checks from first principles. First inspect failure_class, validation_failures, per-check valid/error_code fields, required_check_count, and mismatched actual values. Fix shape/type/safe-expression errors without changing a correct model. Use only explicit constant arithmetic and approved safe functions; expand finite sums with + terms. Preserve the correct formula, units, and assumptions; do not force a match by changing the model.'
          },
        },
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }

    if(proposedStatisticsVerification.required
       &&(!proposedStatisticsVerification.ok||!proposedStatisticsVerification.all_claims_match)){
      const priorStatisticsAttempts=Math.max(
        0,
        Number(node?.decision_payload?.deterministic_statistics_attempts||0)
      );
      const statisticsAttempt=priorStatisticsAttempts+1;
      if(statisticsAttempt>=3){
        const reset=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'pending',
          decisionType:null,
          decisionPayload:{
            ...(node.decision_payload||{}),
            deterministic_statistics_reconciliation_required:true,
            deterministic_statistics_attempts:statisticsAttempt,
            deterministic_statistics_verification:proposedStatisticsVerification,
            deterministic_statistics_gate:'bounded_statistics_repair_exhausted_v0_1',
            atomic_unavailable:true,
            reconsider_decomposition:true,
          },
          contextPayload:{
            ...(node.context_payload||{}),
            deterministic_statistics_feedback:{
              attempt:statisticsAttempt,
              verifier:'aau_quantitative_python_v0_1',
              verification:proposedStatisticsVerification,
              instruction:'The bounded direct statistical repair path is exhausted. Narrow or decompose the requirement while preserving the exact curriculum problem and verified inputs.',
            },
          },
          resultArtifact:null,
        });
        reset.parent_path=node.parent_path??parentPathOf(node.node_path);
        console.warn('AAU_QDA_STATISTICAL_REPAIR_BOUNDED_DECOMPOSITION',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          attempts:statisticsAttempt,
          error:proposedStatisticsVerification.error||null,
          policy:'statistics_repair_max_two_full_retries_v0_1',
        }));
        return {reconsider:true,node:reset};
      }
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:'ATOMIC',
        decisionPayload:{
          ...(node.decision_payload||{}),
          deterministic_statistics_reconciliation_required:true,
          deterministic_statistics_attempts:statisticsAttempt,
          deterministic_statistics_verification:proposedStatisticsVerification,
          deterministic_statistics_gate:'pre_reconciliation_python_statistics_v0_1',
          deterministic_statistics_retry_nonce:sha256({
            node_path:node.node_path,
            attempt:statisticsAttempt,
            verification:proposedStatisticsVerification,
          }).slice(0,24),
          reconsider_decomposition:false,
        },
        contextPayload:{
          ...(node.context_payload||{}),
          deterministic_statistics_feedback:{
            attempt:statisticsAttempt,
            verifier:'aau_quantitative_python_v0_1',
            verification:proposedStatisticsVerification,
            instruction:'Reassess method, inputs, claims, and interpretation. Correct the statistical claims from first principles. Python executes the selected analysis; it does not choose the method or causal conclusion for you.'
          },
        },
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }

    // Cognitive continuity: before runtime may persist completion, the same bound
    // agent reconciles its proposed result against its own discovery state.
    const reconciliationSemanticIdentity=sha256({
      atomic_semantic_identity:atomicSemanticIdentity,
      proposed_artifact_hash:sha256(proposedArtifact),
      proposed_handoff:proposedHandoff,
      authoritative_sibling_results:siblingEvidence.map(v=>({
        path:v.path,status:v.status,decision_type:v.decision_type,result_hash:v.result_hash
      })),
      supplied_context:atomicCognitionContext(),
      verified_results_synthesis_bypass:verifiedResultsSynthesis,
    });
    const durableReconciliation=await loadJsonPhaseCheckpoint(
      node.node_path,'RECONCILIATION',reconciliationSemanticIdentity
    );
    let reconciliation=verifiedResultsSynthesis
      ? {
          status:'COMPLETE',
          reason:'Verified-results synthesis uses already reconciled authoritative sibling calculations; no duplicate model reconciliation is required.',
          criterion_assessment:'The requested synthesis fields were authored from authoritative completed sibling evidence.',
          gaps:[],
          artifact:proposedArtifact,
          handoff:proposedHandoff,
          _runtime_reconciliation_bypass:{
            version:'verified_results_synthesis_reconciliation_bypass_v0_1',
            sibling_result_hashes:siblingEvidence.map(v=>({path:v.path,result_hash:v.result_hash||null})),
          },
        }
      : durableReconciliation.parsed;
    if(!reconciliation){
    try{
      for(let attempt=1;attempt<=2;attempt++){
        try{
          const response=await callJson([
            {role:'system',content:[
              'You are the bound autonomous agent reconciling YOUR proposed completion against YOUR OWN prior discovery state.',
              'This is not an external verifier. The runtime has made no substantive judgment and must not reinterpret your task for you.',
              'Re-read your requirement, your authored discovery state, your proposed artifact, the authoritative completed sibling evidence, and the supplied evidence.',
              'Completed sibling outputs are already available evidence. Do not reopen a missing-context claim solely because the original source excerpt is absent when the sibling output already carries the required result.',
              'Decide whether YOU consider your own completion criterion actually satisfied.',
              'Return one status only:',
              'COMPLETE = you judge the requirement and your own completion criterion genuinely satisfied by the evidence. You may correct wording/calculation in artifact and handoff before finalizing.',
              'When COMPLETE, artifact is a COMPLETE REPLACEMENT work product, not a critique summary. Preserve every material derivation, assumption, unit, evidence distinction, unresolved limitation, and substantive section from the proposed artifact unless you explicitly correct or retire it. Do not shorten a multi-part artifact into a fragment.',
              'NEED_CONTEXT = evidence or stored context is still missing. Supply at least one exact context_request and/or research_query/research_url you choose.',
              'A formatting/serialization defect is NOT missing context. If the proposed completion already contains the underlying structured work product, choose COMPLETE and correct the artifact representation.',
              'SPLIT = you now judge the requirement is not actually bounded and should be decomposed by you.',
              'Do not treat a nearby metric, label, time horizon, population, market definition, or proxy as equivalent unless you can justify that equivalence from the supplied evidence.',
              'Preserve uncertainty. A retrieved source is evidence only for what it actually supports.',
              ...(qdaQuantitativeAtomicRequirement(packet,node)?[
                'DETERMINISTIC MATH COMPANION is authoritative for arithmetic execution only. Inspect deterministic_math_verification below, including failure_class, validation_failures, valid/error_code for each check, required_check_count, and actual values. If any check is missing, wrong-typed, unsafe-syntax, invalid, or mismatched, correct your numerical work and python_checks before choosing COMPLETE. Use explicit constant arithmetic rather than sum/range/comprehensions. Do not defer arithmetic disagreement as NEED_CONTEXT.',
                'When you return COMPLETE for a quantitative QDA requirement, artifact must remain a JSON object containing python_checks for every material numerical result.'
              ]:[]),
              ...(qdaStatisticalAtomicRequirement(packet,node)?[
                'QUANTITATIVE PYTHON STATISTICS COMPANION is authoritative for statistical computation only. Inspect deterministic_statistics_verification below.',
                'Do not convert statistical significance, correlation, model fit, or simulation output into causal certainty. Re-check assumptions, sample size, design, and alternative explanations before COMPLETE.',
                'When you return COMPLETE for a statistical QDA requirement, artifact must remain a JSON object containing python_analyses with explicit claims.'
              ]:[]),
               'EPISTEMIC THRESHOLD POLICY: '+THRESHOLD_EVIDENCE_POLICY.RULE+' '+THRESHOLD_EVIDENCE_POLICY.PASS+' '+THRESHOLD_EVIDENCE_POLICY.FAIL+' '+THRESHOLD_EVIDENCE_POLICY.UNKNOWN,
               'If a scoring framework is binary but evidence for a criterion is insufficient, preserve UNKNOWN explicitly rather than coercing UNKNOWN to FAIL. Do not compute a fully-known score by silently counting UNKNOWN as zero unless the framework itself explicitly defines that treatment.',
              'Return JSON only: {"status":"COMPLETE|NEED_CONTEXT|SPLIT","reason":"brief auditable reason","criterion_assessment":"brief comparison to your own criterion","gaps":["..."],"artifact":"required when COMPLETE","handoff":{"conclusions":[],"facts":[],"unresolved":[]},"context_requests":[],"research_queries":[],"research_urls":[]}.',
            ].join('\n')},
            {role:'user',content:safeJson({
              requirement:node.requirement_text,
              agent_authored_discovery_state:agentDiscoveryState(node),
              proposed_completion:{artifact:proposedArtifact,handoff:proposedHandoff},
              deterministic_math_verification:proposedMathVerification,
              deterministic_statistics_verification:proposedStatisticsVerification,
              authoritative_completed_sibling_evidence:siblingEvidence,
              supplied_context:atomicCognitionContext(),
              available_context_index:idx,
              available_supplied_context_index:indexObject(atomicCognitionContext()),
            })},
          ],stageBudgets.atomic_reconciliation,'req_'+node.node_path.replaceAll('.','_')+'_reconcile_'+attempt);
          const candidate=asObject(response?.parsed);
          const candidateStatus=text(candidate?.status).toUpperCase();
          if(candidateStatus==='NEED_CONTEXT'){
            const hasContextRequest=
              asArray(candidate?.context_requests).map(text).some(Boolean)
              ||asArray(candidate?.research_queries).map(text).some(Boolean)
              ||asArray(candidate?.research_urls).map(text).some(Boolean);
            if(!hasContextRequest){
              const validationError=new Error(
                'reconciliation_need_context_requires_retrieval_request:'+node.node_path
              );
              validationError.code='COGNITION_RESPONSE_REJECTED';
              validationError.rejectionReason=
                'NEED_CONTEXT requires an actual retrieval request. Formatting or serialization defects must be corrected under COMPLETE using the durable proposed artifact.';
              throw validationError;
            }
          }
          if(candidateStatus==='COMPLETE'){
            const candidateArtifact=artifactText(companionNormalizedArtifact(candidate));
            const replacementQuality=reconciliationReplacementQuality(
              proposedArtifact,candidateArtifact
            );
            if(!replacementQuality.acceptable){
              console.warn('AAU_RECONCILIATION_REPLACEMENT_REJECTED',JSON.stringify({
                agent_id:agentId,intent_execution_id:intentExecutionId,
                node_path:node.node_path,attempt,
                ...replacementQuality,
                policy:'complete_replacement_or_preserve_proposed_v0_1',
              }));
              if(attempt<2){
                const validationError=new Error(
                  'reconciliation_complete_artifact_abbreviated:'+node.node_path
                );
                validationError.code='COGNITION_RESPONSE_REJECTED';
                validationError.rejectionReason='RECONCILIATION_ARTIFACT_ABBREVIATED';
                throw validationError;
              }
              reconciliation={
                ...candidate,
                status:'COMPLETE',
                artifact:proposedArtifact,
                handoff:proposedHandoff,
                _runtime_reconciliation_fallback:{
                  version:'preserve_proposed_when_critic_replacement_abbreviated_v0_1',
                  reason:replacementQuality.reason,
                  proposed_bytes:replacementQuality.proposed_bytes,
                  rejected_candidate_bytes:replacementQuality.candidate_bytes,
                  minimum_replacement_bytes:replacementQuality.minimum_bytes||null,
                },
              };
              break;
            }
          }
          reconciliation=candidate;
          break;
        }catch(error){
          if(attempt===2)throw error;
          if(error?.code!=='COGNITION_RESPONSE_REJECTED'&&error?.code!=='NVIDIA_TIMEOUT')throw error;
        }
      }
    }catch(error){
      if(error?.code==='NVIDIA_TIMEOUT')throw error;
      if(error?.code==='COGNITION_RESPONSE_REJECTED'){
        const phaseError=new Error(
          'autonomous_decomposition_reconciliation_response_exhausted:'+node.node_path
        );
        phaseError.code='COGNITION_PHASE_VALIDATION_EXHAUSTED';
        phaseError.cause=error;
        throw phaseError;
      }
      throw error;
    }
    }

    const reconciliationStatus=text(reconciliation?.status).toUpperCase();
    const reconciliationMeta={
      reconciliation_performed:!verifiedResultsSynthesis,
      reconciliation_bypassed:verifiedResultsSynthesis,
      reconciliation_bypass_version:verifiedResultsSynthesis
        ?'verified_results_synthesis_reconciliation_bypass_v0_1'
        :null,
      reconciliation_reason:clip(reconciliation?.reason,1600),
      reconciliation_criterion_assessment:clip(reconciliation?.criterion_assessment,2200),
      reconciliation_gaps:asArray(reconciliation?.gaps).map(v=>clip(text(v),700)).filter(Boolean).slice(0,12),
      cognitive_continuity_policy:'agent_discovery_restore_and_reconcile_v0_1',
      reconciliation_replacement_fallback:
        asObject(reconciliation?._runtime_reconciliation_fallback),
    };

    if(reconciliationStatus==='SPLIT'){
      if(!durableReconciliation.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'RECONCILIATION',reconciliationSemanticIdentity,reconciliation,{
            reconciliation_status:'SPLIT',
          }
        );
      }
      const split=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'split',decisionType:'SPLIT',
        decisionPayload:{
          ...(node.decision_payload||{}),
          ...reconciliationMeta,
          reason:clip(reconciliation?.reason,1200),
          reclassified_during_reconciliation:true,
        },
        contextPayload:node.context_payload||{},resultArtifact:null,
      });
      split.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {split:true,node:split};
    }

    if(reconciliationStatus==='NEED_CONTEXT'){
      const rawRequests=asArray(reconciliation?.context_requests).map(text).filter(Boolean).slice(0,MAX_CONTEXT_REQUESTS_PER_ROUND);
      const urlRequestsFromContext=rawRequests.filter(v=>/^https:\/\//i.test(v));
      const requests=rawRequests.filter(v=>!/^https:\/\//i.test(v));
      const researchQueries=asArray(reconciliation?.research_queries).map(text).filter(Boolean).slice(0,8);
      const researchUrls=[...new Set([
        ...asArray(reconciliation?.research_urls),
        ...urlRequestsFromContext,
      ].map(text).filter(v=>/^https:\/\//i.test(v)))].slice(0,8);
      if(!requests.length&&!researchQueries.length&&!researchUrls.length)
        throw new Error('autonomous_decomposition_reconciliation_context_empty:'+node.node_path);
      if(!durableReconciliation.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'RECONCILIATION',reconciliationSemanticIdentity,reconciliation,{
            reconciliation_status:'NEED_CONTEXT',
          }
        );
      }
      await chargeSemanticRuntime({
        eventKind:'context_acquisition',
        materialKey:node.node_path+':reconciliation:'+sha256({requests,researchQueries,researchUrls}),
        nodePath:node.node_path,
        costUnits:semanticRuntime.context_acquire_units,
        eventFingerprint:sha256({
          node_path:node.node_path,
          phase:'reconciliation_need_context',
          requests,
          research_queries:researchQueries,
          research_urls:researchUrls,
        }),
        metadata:{
          phase:'reconciliation_need_context',
          request_count:requests.length,
          query_count:researchQueries.length,
          url_count:researchUrls.length,
        },
      });
      let researchObserved=null;
      if((researchQueries.length||researchUrls.length)&&typeof researchContext==='function'){
        researchObserved=await researchContext({nodePath:node.node_path,queries:researchQueries,urls:researchUrls});
      }else if(researchQueries.length||researchUrls.length){
        researchObserved={status:'unavailable',reason:'research_runtime_not_configured'};
      }
      if(researchObserved?.audit_batch_id){
        await linkResearchBatch(node.node_path,researchObserved.audit_batch_id);
      }
      const pinnedResult=await persistExplicitResearchEvidence(node.node_path,researchUrls,researchObserved);
      pinnedEvidence=pinnedResult.evidence;
      const contextPayload=boundInMemoryContext({
        ...atomicBaseContext,
        ...resolveContext(packet,requests,atomicCognitionContext()),
        ...(researchObserved?{external_research_reconciliation:researchObserved}:{}),
      },pinnedEvidence,stageBudgets.atomic_reconciliation);
      counters.context_requests+=requests.length+researchQueries.length+researchUrls.length;
      const reset=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'pending',decisionType:'NEED_CONTEXT',
        decisionPayload:{
          ...(node.decision_payload||{}),
          ...reconciliationMeta,
          reason:clip(reconciliation?.reason,1200),
          context_requests:requests,
          research_queries:researchQueries,
          research_urls:researchUrls,
          reclassified_during_reconciliation:true,
        },
        contextPayload,resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }

    if(reconciliationStatus!=='COMPLETE')
      throw new Error('autonomous_decomposition_reconciliation_status_invalid:'+node.node_path);

    let artifact=artifactText(companionNormalizedArtifact(reconciliation))||proposedArtifact;
    if(!artifact)throw new Error('autonomous_decomposition_reconciliation_artifact_empty:'+node.node_path);
    const handoff=Object.keys(asObject(reconciliation?.handoff)).length?asObject(reconciliation?.handoff):proposedHandoff;
    const finalMathVerification=deterministicMathVerification(packet,node,artifact);
    const finalStatisticsVerification=deterministicStatisticalVerification(packet,node,artifact);
    if(finalMathVerification.required && (!finalMathVerification.ok || !finalMathVerification.all_match)){
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:'ATOMIC',
        decisionPayload:{
          ...(node.decision_payload||{}),
          ...reconciliationMeta,
          deterministic_math_reconciliation_required:true,
          deterministic_math_verification:finalMathVerification,
          reconsider_decomposition:false,
        },
        contextPayload:{
          ...(node.context_payload||{}),
          deterministic_math_verification:finalMathVerification,
        },
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }

    if(finalStatisticsVerification.required
       &&(!finalStatisticsVerification.ok||!finalStatisticsVerification.all_claims_match)){
      const reset=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:'ATOMIC',
        decisionPayload:{
          ...(node.decision_payload||{}),
          deterministic_statistics_reconciliation_required:true,
          deterministic_statistics_verification:finalStatisticsVerification,
          deterministic_statistics_gate:'post_reconciliation_python_statistics_v0_1',
          reconsider_decomposition:false,
        },
        contextPayload:{
          ...(node.context_payload||{}),
          deterministic_statistics_feedback:{
            attempt:Math.max(1,Number(node?.decision_payload?.deterministic_statistics_attempts||0)+1),
            verifier:'aau_quantitative_python_v0_1',
            verification:finalStatisticsVerification,
            instruction:'Your reconciled artifact still disagrees with deterministic statistical computation. Correct the claims and interpretation before completion.'
          },
        },
        resultArtifact:null,
      });
      reset.parent_path=node.parent_path??parentPathOf(node.node_path);
      return {reconsider:true,node:reset};
    }
    const atomicStageContract=stageContractForRequirement(packet,node.requirement_text,node.node_path);
    let atomicStageProposal=null;
    let atomicStageMaterializationVersion=null;
    if(atomicStageContract.applies&&atomicStageContract.name==='expertise_viability_proposal_v0_1'){
      const directValidation=validateStageContractArtifact(
        atomicStageContract.definition,
        artifact
      );
      if(directValidation.valid){
        atomicStageProposal=directValidation.artifact;
        artifact=safeJson(atomicStageProposal);
        atomicStageMaterializationVersion='atomic_stage_contract_direct_v0_1';
      }else{
        atomicStageProposal=await materializeTerminalStageContract(
          node,[],{},{
            outcome:'COMPLETE',
            reason:reconciliation?.reason,
            artifact,
            handoff,
          },atomicStageContract
        );
        artifact=safeJson(atomicStageProposal);
        atomicStageMaterializationVersion=STAGE_CONTRACT_MATERIALIZATION_VERSION;
      }
    }
    if(!durableReconciliation.parsed){
      await saveJsonPhaseCheckpoint(
        node.node_path,'RECONCILIATION',reconciliationSemanticIdentity,reconciliation,{
          reconciliation_status:'COMPLETE',
          artifact_hash:sha256(artifact),
        }
      );
    }
    const resultArtifact=JSON.stringify({artifact,handoff});
    const completionDecisionPayload={...(node.decision_payload||{})};
    const completionContextPayload={...(node.context_payload||{})};
    if(!finalMathVerification.required){
      for(const key of [
        'deterministic_math_reconciliation_required','deterministic_math_attempts',
        'deterministic_math_verification','deterministic_math_gate','deterministic_math_retry_nonce'
      ])delete completionDecisionPayload[key];
      delete completionContextPayload.deterministic_math_feedback;
      delete completionContextPayload.deterministic_math_verification;
    }
    if(!finalStatisticsVerification.required){
      for(const key of [
        'deterministic_statistics_reconciliation_required','deterministic_statistics_attempts',
        'deterministic_statistics_verification','deterministic_statistics_gate','deterministic_statistics_retry_nonce'
      ])delete completionDecisionPayload[key];
      delete completionContextPayload.deterministic_statistics_feedback;
      delete completionContextPayload.deterministic_statistics_verification;
    }
    const done=await saveNode({
      nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
      requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
      status:'completed',decisionType:'ATOMIC',
      decisionPayload:{
        ...completionDecisionPayload,
        ...reconciliationMeta,
        completed_as_atomic:true,
        ...(finalMathVerification.required?{
          deterministic_math_verified:true,
          deterministic_math_check_count:finalMathVerification.check_count,
          deterministic_math_verification:finalMathVerification,
        }:{}),
        ...(finalStatisticsVerification.required?{
          deterministic_statistics_verified:true,
          deterministic_statistics_analysis_count:finalStatisticsVerification.analysis_count,
          deterministic_statistics_verification:finalStatisticsVerification,
        }:{}),
        ...(atomicStageProposal?{
          atomic_stage_contract_validated:true,
          terminal_stage_contract_name:atomicStageContract.name,
          stage_contract_materialization_version:atomicStageMaterializationVersion,
        }:{}),
      },
      contextPayload:completionContextPayload,resultArtifact,
    });
    done.parent_path=node.parent_path??parentPathOf(node.node_path);
    const persistedDone=atomicStageProposal
      ? await ensureCanonicalStageCandidateSubmission(done,atomicStageProposal)
      : done;
    return {completed:true,node:persistedDone};
  }

  async function reviewSynthesisProvenance(node,childRows,accumulator,proposedFinal,revisionGuidance=''){
    const childEvidence=childRows.map(child=>{
      const parts=resultParts(child.result_artifact);
      return {
        path:child.node_path,
        status:child.node_status||child.status||null,
        decision_type:child.decision_type||null,
        requirement:child.requirement_text,
        artifact:clip(parts.artifact,7000),
        handoff:parts.handoff,
      };
    });
    const provenanceSemanticIdentity=sha256({
      parent_path:node.node_path,
      parent_requirement:node.requirement_text,
      child_evidence:childEvidence.map(v=>({
        path:v.path,status:v.status,decision_type:v.decision_type,
        artifact_hash:sha256(v.artifact||''),handoff:v.handoff,
      })),
      accumulator,
      proposed_final:proposedFinal,
      revision_guidance:revisionGuidance||null,
      terminal_synthesis_ownership_version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
      lifecycle_stage_contract:lifecycleStageContract(packet),
    });
    const durableProvenance=await loadJsonPhaseCheckpoint(
      node.node_path,'SYNTHESIS_PROVENANCE',provenanceSemanticIdentity
    );
    const response=durableProvenance.parsed
      ? {parsed:durableProvenance.parsed,checkpoint_reused:true}
      : await callJson([
      {role:'system',content:[
        'You are the same bound autonomous agent auditing YOUR OWN proposed parent synthesis before it becomes durable.',
        'This is a provenance-preservation review, not a new task or a runtime verdict.',
        'Compare every number, unit, date, forecast period, source/value relationship, scope claim, and derived conclusion in the proposed synthesis against the resolved child evidence.',
        'REVISE if the synthesis swaps values between sources, silently changes a source/value pairing, changes units or time horizons, converts a derived scenario into a sourced fact, or strengthens uncertainty beyond what the children support.',
        'Derived calculations and scenarios are allowed only when explicitly labeled as derived, their exact source inputs remain correctly paired, and the transformation/formula is stated.',
        'BLOCKED child gaps must remain visible when they are material to the parent requirement.',
        'Terminal synthesis/formatting/submission is runtime-owned. Do NOT ACCEPT a proposed BLOCKED outcome merely because no separate synthesis child previously created the final formatted artifact.',
        'When the parent requirement names the lifecycle stage contract, the proposed final artifact itself must satisfy that contract from the resolved evidence, while preserving unresolved evidence gaps honestly.',
        'Return JSON only: {"status":"ACCEPT|REVISE","reason":"auditable explanation","issues":["..."],"evidence_bindings":[{"claim":"...","source_path_or_id":"...","preserved":true}],"revision_guidance":"specific correction when REVISE; empty when ACCEPT"}.',
      ].join('\n')},
      {role:'user',content:safeJson({
        parent_requirement:node.requirement_text,
        agent_authored_discovery_state:agentDiscoveryState(node),
        resolved_child_evidence:childEvidence,
        cumulative_synthesis:accumulator,
        terminal_synthesis_ownership:{
          version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
          lifecycle_stage_contract:lifecycleStageContract(packet),
        },
        proposed_final:{
          outcome:text(proposedFinal?.outcome).toUpperCase(),
          reason:proposedFinal?.reason,
          artifact:proposedFinal?.artifact,
          handoff:asObject(proposedFinal?.handoff),
        },
        prior_provenance_revision_guidance:revisionGuidance||null,
      })},
    ],stageBudgets.synthesis_provenance_review,'req_'+node.node_path.replaceAll('.','_')+'_synthesis_provenance');

    const candidate=asObject(response?.parsed);
    const status=text(candidate.status).toUpperCase();
    if(!['ACCEPT','REVISE'].includes(status))
      throw new Error('autonomous_decomposition_synthesis_provenance_status_invalid:'+node.node_path);
    if(!durableProvenance.parsed){
      await saveJsonPhaseCheckpoint(
        node.node_path,'SYNTHESIS_PROVENANCE',provenanceSemanticIdentity,candidate,{
          provenance_status:status,
        }
      );
    }
    return {
      status,
      reason:clip(candidate.reason,2400),
      issues:asArray(candidate.issues).map(v=>clip(v,800)).filter(Boolean).slice(0,16),
      evidence_bindings:asArray(candidate.evidence_bindings).map(v=>({
        claim:clip(v?.claim,800),
        source_path_or_id:clip(v?.source_path_or_id,500),
        preserved:Boolean(v?.preserved),
      })).filter(v=>v.claim||v.source_path_or_id).slice(0,24),
      revision_guidance:clip(candidate.revision_guidance,2400),
      agent_authored:true,
    };
  }

  async function materializeTerminalStageContract(
    node,childRows,accumulator,semanticFinal,terminalStageContract
  ){
    const childEvidence=childRows.map(child=>{
      const parts=resultParts(child.result_artifact);
      return {
        path:child.node_path,
        status:child.node_status||child.status||null,
        decision_type:child.decision_type||null,
        requirement:child.requirement_text,
        artifact:clip(parts.artifact,7000),
        handoff:parts.handoff,
      };
    });
    const materializationIdentity=sha256({
      version:STAGE_CONTRACT_MATERIALIZATION_VERSION,
      node_path:node.node_path,
      parent_requirement:node.requirement_text,
      stage_contract_name:terminalStageContract.name,
      stage_contract_hash:sha256(terminalStageContract.definition),
      semantic_final:{
        outcome:text(semanticFinal?.outcome).toUpperCase(),
        reason:text(semanticFinal?.reason),
        artifact:text(semanticFinal?.artifact),
        handoff:asObject(semanticFinal?.handoff),
      },
      accumulator,
      child_result_hashes:childRows.map(v=>({
        path:v.node_path,
        result_hash:v.result_hash||sha256(v.result_artifact||''),
      })),
    });
    const durable=await loadJsonPhaseCheckpoint(
      node.node_path,'STAGE_CONTRACT_MATERIALIZE',materializationIdentity
    );
    if(durable.parsed){
      const persistedProposal=asObject(durable.parsed?.proposal||durable.parsed);
      const persistedValidation=validateStageContractArtifact(
        terminalStageContract.definition,
        safeJson(persistedProposal)
      );
      if(persistedValidation.valid)return persistedProposal;
    }

    let validationGuidance='';
    for(let attempt=1;attempt<=3;attempt++){
      const response=await callJson([
        {role:'system',content:[
          'You are the bound autonomous agent materializing YOUR already-completed semantic synthesis into the authoritative lifecycle stage contract.',
          'This phase is contract materialization, not new research and not a new domain decision.',
          'Use only the resolved child evidence, cumulative synthesis, and semantic final result supplied here.',
          'Do not invent customers, revenue, employment, funding, competence, pricing, market segmentation, or source claims.',
          'Preserve unresolved evidence gaps explicitly in confidence_and_gaps and keep unsupported demand/economic assertions labeled as hypotheses.',
          'Return JSON only in exactly this wrapper: {"proposal":{...}} where proposal satisfies every required field in stage_contract_definition.',
          'Do NOT JSON-encode proposal as a string. proposal must be a real nested JSON object.',
        ].join('\n')},
        {role:'user',content:safeJson({
          parent_requirement:node.requirement_text,
          stage_contract_name:terminalStageContract.name,
          stage_contract_definition:terminalStageContract.definition,
          cumulative_synthesis:accumulator,
          resolved_child_evidence:childEvidence,
          semantic_final:{
            outcome:text(semanticFinal?.outcome).toUpperCase(),
            reason:semanticFinal?.reason,
            artifact:semanticFinal?.artifact,
            handoff:asObject(semanticFinal?.handoff),
          },
          validation_guidance:validationGuidance||null,
          materialization_version:STAGE_CONTRACT_MATERIALIZATION_VERSION,
        })},
      ],stageBudgets.synthesis_final,
      'req_'+node.node_path.replaceAll('.','_')+'_stage_contract_materialize_'+attempt);

      const proposal=asObject(response?.parsed?.proposal);
      const validation=validateStageContractArtifact(
        terminalStageContract.definition,
        safeJson(proposal)
      );
      if(validation.valid){
        await saveJsonPhaseCheckpoint(
          node.node_path,'STAGE_CONTRACT_MATERIALIZE',materializationIdentity,
          {proposal},{
            stage_contract_name:terminalStageContract.name,
            materialization_version:STAGE_CONTRACT_MATERIALIZATION_VERSION,
            proposal_hash:sha256(proposal),
          }
        );
        console.log('AAU_AUTONOMOUS_STAGE_CONTRACT_MATERIALIZED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          stage_contract_name:terminalStageContract.name,
          materialization_version:STAGE_CONTRACT_MATERIALIZATION_VERSION,
          attempt,
        }));
        return proposal;
      }
      validationGuidance=
        'Previous proposal failed structural validation: '
        +validation.issues.join(', ')
        +'. Correct only the contract structure/content sufficiency using the same evidence.';
    }
    const error=new Error('autonomous_decomposition_stage_contract_materialization_invalid:'+node.node_path);
    error.code='COGNITION_RESPONSE_REJECTED';
    throw error;
  }

  function isTopLevelViabilityCandidateNode(node){
    return /^R[.]\d{3}$/.test(text(node?.node_path));
  }

  function materializedStageProposalFromNode(node){
    const version=text(node?.decision_payload?.stage_contract_materialization_version);
    const directAtomic=Boolean(node?.decision_payload?.atomic_stage_contract_validated);
    if(version!==STAGE_CONTRACT_MATERIALIZATION_VERSION&&!directAtomic)return null;
    const parts=resultParts(node?.result_artifact);
    if(!parts.artifact)return null;
    try{
      const proposal=JSON.parse(parts.artifact);
      return proposal&&typeof proposal==='object'&&!Array.isArray(proposal)?proposal:null;
    }catch{return null;}
  }

  async function ensureCanonicalStageCandidateSubmission(node,proposalOverride=null){
    if(node?.node_status!=='completed'||!isTopLevelViabilityCandidateNode(node))
      return node;
    const stageContract=stageContractForRequirement(packet,node.requirement_text,node.node_path);
    if(!stageContract.applies||stageContract.name!=='expertise_viability_proposal_v0_1')
      return node;

    const prior=asObject(node?.decision_payload?.canonical_stage_candidate_submission);
    if(text(prior.proposal_id)&&prior.persisted===true)return node;

    let proposal=proposalOverride||materializedStageProposalFromNode(node);

    // A completed top-level Stage-4 candidate is not canonically complete until
    // its durable semantic result has been materialized under the current
    // lifecycle contract. This also repairs completed nodes created by older
    // phrase-matching ownership logic without re-running their research.
    if(!proposal){
      const parts=resultParts(node?.result_artifact);
      if(!parts.artifact)return node;

      // Mechanical serialization recovery comes before another model call.
      // Only trailing unmatched closing braces are eligible, and the recovered
      // object must pass the full authoritative stage contract. No semantic
      // content is added, removed, or rewritten.
      let serializationRecovered=false;
      const rawArtifact=text(parts.artifact).trim();
      for(let trimCount=1;trimCount<=3&&!proposal;trimCount++){
        if(!rawArtifact.endsWith('}'.repeat(trimCount)))continue;
        const candidateText=rawArtifact.slice(0,-trimCount);
        try{
          const candidate=JSON.parse(candidateText);
          const check=validateStageContractArtifact(
            stageContract.definition,
            safeJson(candidate)
          );
          if(check.valid){
            proposal=candidate;
            serializationRecovered=true;
          }
        }catch{}
      }

      if(!proposal){
        proposal=await materializeTerminalStageContract(
          node,[],{},{
            outcome:'COMPLETE',
            reason:'Canonical completion invariant: materialize the already-completed durable candidate result under the current Stage-4 contract.',
            artifact:parts.artifact,
            handoff:parts.handoff,
          },stageContract
        );
      }

      const repairedArtifact=JSON.stringify({
        artifact:safeJson(proposal),
        handoff:parts.handoff,
      });
      node=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'completed',
        decisionType:node.decision_type||'ATOMIC',
        decisionPayload:{
          ...(node.decision_payload||{}),
          atomic_stage_contract_validated:true,
          terminal_stage_contract_name:stageContract.name,
          stage_contract_materialization_version:
            serializationRecovered
              ?'atomic_stage_contract_trailing_brace_repair_v0_1'
              :STAGE_CONTRACT_MATERIALIZATION_VERSION,
          canonical_completion_invariant_repaired:true,
          canonical_completion_invariant_repair_kind:
            serializationRecovered
              ?'deterministic_trailing_brace_serialization_repair'
              :'runtime_owned_stage_contract_materialization',
          canonical_completion_invariant_repaired_at:new Date().toISOString(),
        },
        contextPayload:node.context_payload||{},
        resultArtifact:repairedArtifact,
      });
      node.parent_path=node.parent_path??parentPathOf(node.node_path);

      if(serializationRecovered){
        console.log('AAU_AUTONOMOUS_STAGE_CONTRACT_SERIALIZATION_REPAIRED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          repair:'deterministic_trailing_brace_serialization_repair',
          stage_contract_name:stageContract.name,
        }));
      }
    }

    const validation=validateStageContractArtifact(stageContract.definition,safeJson(proposal));
    if(!validation.valid){
      const error=new Error(
        'autonomous_decomposition_canonical_candidate_contract_invalid:'
        +node.node_path+':'+validation.issues.join(',')
      );
      error.code='COGNITION_RUNTIME_ACCOUNTING_FAULT';
      throw error;
    }

    const persisted=await rpc('aau_bridge_ensure_expertise_viability_candidate_v0_1',{
      p_agent_id:agentId,
      p_wake_request_id:intentExecutionId,
      p_proposal:proposal,
    });
    if(!persisted?.proposal_id){
      const error=new Error(
        'autonomous_decomposition_canonical_candidate_persistence_failed:'
        +node.node_path
      );
      error.code='COGNITION_RUNTIME_ACCOUNTING_FAULT';
      throw error;
    }

    const decisionPayload={
      ...(node.decision_payload||{}),
      canonical_stage_candidate_submission:{
        persisted:true,
        proposal_id:persisted.proposal_id,
        domain:persisted.domain||proposal.domain||null,
        status:persisted.status||null,
        candidate_ordinal:persisted.candidate_ordinal??null,
        candidate_count:persisted.candidate_count??persisted.revised_count??null,
        target_count:persisted.target_count??null,
        candidate_cohort:persisted.candidate_cohort??null,
        idempotent_domain_replay:Boolean(persisted.idempotent_domain_replay),
        revision_cycle_id:persisted.revision_cycle_id??null,
        revision_number:persisted.revision_number??null,
        revised_count:persisted.revised_count??null,
        review_pending:Boolean(persisted.review_pending),
        persistence_contract:
          text(persisted.status)==='candidate_revised'
          ||text(persisted.status)==='already_revised'
            ?'canonical_stage_candidate_revision_v0_1'
            :'canonical_stage_candidate_submission_v0_1',
        persisted_at:new Date().toISOString(),
      },
      ...(persisted.revision_cycle_id?{
        candidate_revision_submission:{
          persisted:true,
          proposal_id:persisted.proposal_id,
          domain:persisted.domain||proposal.domain||null,
          revision_cycle_id:persisted.revision_cycle_id,
          revision_number:persisted.revision_number??null,
          revised_count:persisted.revised_count??null,
          target_count:persisted.target_count??null,
          review_pending:Boolean(persisted.review_pending),
          persistence_contract:'canonical_stage_candidate_revision_v0_1',
          persisted_at:new Date().toISOString(),
        },
      }:{}),
    };
    const saved=await saveNode({
      nodePath:node.node_path,
      parentPath:node.parent_path??parentPathOf(node.node_path),
      ordinal:node.ordinal||0,
      requirement:node.requirement_text,
      sourceKind:node.source_kind,
      sourceRef:node.source_ref,
      status:'completed',
      decisionType:node.decision_type||'SPLIT',
      decisionPayload,
      contextPayload:node.context_payload||{},
      resultArtifact:node.result_artifact,
    });
    saved.parent_path=node.parent_path??parentPathOf(node.node_path);
    console.log('AAU_AUTONOMOUS_CANONICAL_STAGE_CANDIDATE_PERSISTED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:node.node_path,
      proposal_id:persisted.proposal_id,
      domain:persisted.domain||proposal.domain||null,
      status:persisted.status||null,
      candidate_ordinal:persisted.candidate_ordinal??null,
      candidate_count:persisted.candidate_count??null,
      target_count:persisted.target_count??null,
      idempotent_domain_replay:Boolean(persisted.idempotent_domain_replay),
    }));
    return saved;
  }

  function synthesisEvidenceArtifactObject(raw){
    let value=raw;
    for(let depth=0;depth<3;depth++){
      if(typeof value!=='string')break;
      try{value=JSON.parse(value);}catch{return null;}
    }
    return value&&typeof value==='object'&&!Array.isArray(value)?value:null;
  }

  function synthesisChildHasVerifiedQuantitativeEvidence(child){
    const payload=asObject(child?.decision_payload);
    const decision=text(child?.decision_type).toUpperCase();
    if(decision==='ATOMIC'){
      return payload.deterministic_math_verified===true
        ||text(payload.deterministic_math_verified).toLowerCase()==='true';
    }
    if(decision==='SPLIT'){
      const review=asObject(payload.synthesis_provenance_review);
      return text(review.status).toUpperCase()==='ACCEPT';
    }
    return false;
  }

  function synthesisNumericLeaves(value,path=[],out=[]){
    if(typeof value==='number'&&Number.isFinite(value)){
      out.push({path:path.join('.'),key:text(path[path.length-1]),value});
      return out;
    }
    if(Array.isArray(value)){
      value.forEach((item,index)=>synthesisNumericLeaves(item,[...path,String(index)],out));
      return out;
    }
    if(value&&typeof value==='object'){
      Object.entries(value).forEach(([key,item])=>
        synthesisNumericLeaves(item,[...path,key],out)
      );
    }
    return out;
  }

  function normalizedEvidenceLabel(raw){
    return text(raw)
      .replace(/([a-z0-9])([A-Z])/g,'$1 $2')
      .replace(/[_-]+/g,' ')
      .replace(/\s+/g,' ')
      .trim()
      .toLowerCase();
  }

  function synthesisQuantitativeEvidence(childRows){
    const allowedLabels=new Set([
      'annual payment','term years','discount rate','total pv',
      'fv result','pv result','pass a result','pass b result','variance',
    ]);
    const evidence=[];
    for(const child of childRows){
      if(!synthesisChildHasVerifiedQuantitativeEvidence(child))continue;
      const parts=resultParts(child.result_artifact);
      const artifact=synthesisEvidenceArtifactObject(parts.artifact);
      if(!artifact)continue;
      for(const leaf of synthesisNumericLeaves(artifact)){
        const label=normalizedEvidenceLabel(leaf.key);
        const numbered=/^(?:year|yr|y)\s*\d+$/i.test(label);
        if(!numbered&&!allowedLabels.has(label))continue;
        evidence.push({
          source_path:child.node_path,
          source_result_hash:child.result_hash||sha256(child.result_artifact||''),
          claim_path:leaf.path,
          label,
          value:leaf.value,
        });
      }
    }
    const deduped=[];
    const seen=new Set();
    const valuesByLabel=new Map();
    for(const item of evidence){
      const labelValues=valuesByLabel.get(item.label)||new Set();
      labelValues.add(String(item.value));
      valuesByLabel.set(item.label,labelValues);
      const key=item.label+'|'+String(item.value);
      if(seen.has(key))continue;
      seen.add(key);
      deduped.push(item);
    }
    return deduped.slice(0,160).map(item=>({
      ...item,
      deterministic_guard_eligible:(valuesByLabel.get(item.label)?.size||0)===1,
    }));
  }

  function synthesisQuantitativeClaimPattern(label){
    const year=label.match(/^(?:year|yr|y)\s*(\d+)$/i);
    const number='(-?\\d[\\d,]*(?:\\.\\d+)?)';
    if(year){
      return new RegExp('\\b(?:year|yr|y)\\s*'+year[1]+'\\s*[:=]\\s*\\$?\\s*'+number,'gi');
    }
    if(label==='total pv'){
      return new RegExp('\\b(?:total(?:\\s+(?:aggregate\\s+)?pv)?|total\\s+sum)\\s*[:=]\\s*\\$?\\s*'+number,'gi');
    }
    const parts=label.split(' ').filter(Boolean).map(v=>v.replace(/[.*+?^$()|[\]\\]/g,'\\$&'));
    if(!parts.length)return null;
    return new RegExp('\\b'+parts.join('[\\s_-]*')+'\\b\\s*[:=]\\s*\\$?\\s*'+number,'gi');
  }

  function synthesisQuantitativeDriftReview(finalCandidate,evidence){
    if(!evidence.length)return null;
    const candidateText=artifactText(finalCandidate?.artifact);
    if(!candidateText)return null;
    const issues=[];
    const bindings=[];
    for(const item of evidence){
      if(item?.deterministic_guard_eligible===false)continue;
      const pattern=synthesisQuantitativeClaimPattern(item.label);
      if(!pattern)continue;
      let match=null;
      while((match=pattern.exec(candidateText))!==null){
        const observed=Number(String(match[1]||'').replaceAll(',',''));
        if(!Number.isFinite(observed))continue;
        const tolerance=Math.max(0.005,Math.abs(Number(item.value))*1e-9);
        const preserved=Math.abs(observed-Number(item.value))<=tolerance;
        bindings.push({
          claim:item.label+': '+String(item.value),
          source_path_or_id:item.source_path,
          preserved,
        });
        if(!preserved){
          issues.push(
            item.label+' changed from verified '+String(item.value)
            +' to '+String(observed)+' during parent synthesis.'
          );
        }
        break;
      }
    }
    if(!issues.length)return null;
    return {
      status:'REVISE',
      reason:'Parent synthesis changed numerical claims already established by verified child evidence. Ordinary synthesis may summarize or interpret verified quantitative evidence but must not silently recompute or alter it.',
      issues:[...new Set(issues)].slice(0,20),
      evidence_bindings:bindings.slice(0,80),
      revision_guidance:'Preserve the AUTHORITATIVE_VERIFIED_NUMERICAL_EVIDENCE values exactly at their established display precision. Correct only the transcription drift in the parent artifact; do not recompute those child results during ordinary synthesis.',
      deterministic_guard:'verified_child_quantitative_evidence_v0_1',
    };
  }
  async function materializeQdaQuantitativeFromVerifiedDescendants(node,artifact){
    // Quantitative verification is subtree-scoped, not depth-scoped. Any QDA
    // split node may inherit deterministic evidence from verified atomic leaves
    // beneath it, regardless of how deeply the bound agent decomposed the work.
    if(!qdaQuantitativeAtomicRequirement(packet,node)){
      return {artifact,materialized:false,check_count:0};
    }
    const parsed=typeof artifact==='string'
      ? (()=>{try{return JSON.parse(artifact);}catch{return null;}})()
      : artifact;
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)){
      return {artifact,materialized:false,check_count:0};
    }
    if([
         'qda_problem_verified_descendant_materialization_v0_1',
         'qda_verified_descendant_materialization_v0_2_recursive',
       ].includes(parsed?.runtime_verified_descendant_materialization?.contract)
       &&Array.isArray(parsed.python_checks)
       &&parsed.python_checks.length){
      const verification=verifyPythonMathChecksChunked(
        parsed.python_checks,{absoluteTolerance:0.005,relativeTolerance:1e-9}
      );
      if(verification.ok===true&&verification.all_match===true){
        return {
          artifact:parsed,materialized:false,already_materialized:true,
          check_count:parsed.python_checks.length,
          sources:asArray(parsed.runtime_verified_descendant_materialization.descendants),
          verification,
        };
      }
    }

    const checks=[];
    const sources=[];
    const unverifiedQuantitativeAtomicDescendants=[];
    const visited=new Set();
    const walk=async(parentPath)=>{
      if(visited.has(parentPath))return;
      visited.add(parentPath);
      const refs=(await children(parentPath))
        .filter(child=>String(child?.status||child?.node_status||'')!=='cancelled')
        .sort((a,b)=>Number(a?.ordinal||0)-Number(b?.ordinal||0));
      for(const ref of refs){
        const child=await getNode(ref.node_path);
        if(child?.status!=='ready')continue;
        const status=String(child?.node_status||'').toLowerCase();
        if(status!=='completed')continue;
        const decision=String(child?.decision_type||'').toUpperCase();
        if(decision==='ATOMIC'){
          if(!qdaQuantitativeAtomicRequirement(packet,child))continue;
          const childDecision=asObject(child.decision_payload);
          const childRecordedVerification=
            asObject(childDecision.deterministic_math_verification);
          const childRecordedVerified=
            childDecision.deterministic_math_verified===true
            &&childRecordedVerification.ok===true
            &&childRecordedVerification.all_match===true;
          const parts=resultParts(child.result_artifact);
          const field=pythonChecksFromArtifact(parts.artifact);
          const childChecks=field?.type_ok===true?field.value:[];
          const verification=childChecks.length
            ?verifyPythonMathChecks(
                childChecks,{absoluteTolerance:0.005,relativeTolerance:1e-9}
              )
            :{ok:false,all_match:false,error:field?.error||'python_checks_required'};
          if(
            childRecordedVerified
            &&verification.ok===true
            &&verification.all_match===true
          ){
            childChecks.forEach(check=>checks.push({
              ...check,
              label:String(child.node_path)+':'+String(check?.label||'check'),
            }));
            sources.push({
              node_path:child.node_path,
              result_hash:child.result_hash||null,
              check_count:childChecks.length,
              deterministic_math_gate:
                text(childDecision.deterministic_math_gate)||null,
            });
          }else{
            unverifiedQuantitativeAtomicDescendants.push({
              node_path:child.node_path,
              result_hash:child.result_hash||null,
              recorded_verified:childDecision.deterministic_math_verified===true,
              recorded_ok:childRecordedVerification.ok===true,
              recorded_all_match:childRecordedVerification.all_match===true,
              executable_check_count:childChecks.length,
              rerun_ok:verification.ok===true,
              rerun_all_match:verification.all_match===true,
              error:verification.error||childRecordedVerification.error||null,
            });
          }
          continue;
        }
        if(decision==='SPLIT')await walk(child.node_path);
      }
    };
    await walk(node.node_path);
    if(unverifiedQuantitativeAtomicDescendants.length){
      return {
        artifact:parsed,
        materialized:false,
        check_count:checks.length,
        sources,
        unverified_descendants:unverifiedQuantitativeAtomicDescendants,
        verification:{
          required:true,
          ok:false,
          all_match:false,
          failure_class:'descendant_verification',
          error:'unverified_quantitative_atomic_descendants',
          check_count:checks.length,
          unverified_descendant_count:unverifiedQuantitativeAtomicDescendants.length,
          unverified_descendants:unverifiedQuantitativeAtomicDescendants,
        },
        verification_blocked:true,
      };
    }
    if(!checks.length){
      const verification=deterministicMathVerification(packet,node,parsed);
      return {
        artifact:parsed,
        materialized:false,
        check_count:0,
        verification,
        verification_blocked:
          verification.required===true
          &&(verification.ok!==true||verification.all_match!==true),
      };
    }

    const authoritativeCaseInputs=asObject(
      packet?.qda_601_context?.next_unit?.exercise_pack?.case_data
    );
    const existingInputs=asObject(parsed.inputs);
    const normalized={
      ...parsed,
      inputs:Object.keys(authoritativeCaseInputs).length
        ?{...existingInputs,...authoritativeCaseInputs}
        :parsed.inputs,
      assumptions:Array.isArray(parsed.assumptions)
        ?parsed.assumptions
        :parsed.assumptions===null||parsed.assumptions===undefined
          ?[]
          :[parsed.assumptions],
      evidence:Array.isArray(parsed.evidence)
        ?parsed.evidence
        :parsed.evidence===null||parsed.evidence===undefined
          ?[]
          :[parsed.evidence],
      python_checks:checks,
      runtime_verified_descendant_materialization:{
        contract:'qda_verified_descendant_materialization_v0_2_recursive',
        arithmetic_recomputation_forbidden:true,
        aggregation_scope:'recursive_node_subtree',
        materialized_node_path:node.node_path,
        materialized_node_depth:pathDepth(node.node_path),
        source:'completed_verified_atomic_descendants',
        descendants:sources,
      },
    };
    const verification=deterministicMathVerification(packet,node,normalized);
    if(verification.required===true && (verification.ok!==true||verification.all_match!==true)){
      throw new Error(
        'qda_recursive_verified_descendant_materialization_invalid:'
        +node.node_path+':'+String(verification.error||'verification_failed')
      );
    }
    return {
      artifact:normalized,
      materialized:true,
      check_count:checks.length,
      sources,
      verification,
    };
  }

  async function verifiedStatAnalysesBelow(path){
    const out=[];
    for(const ref of await children(path)){
      const n=await getNode(ref.node_path);
      if(n?.status!=='ready'||String(n?.node_status||'').toLowerCase()!=='completed')continue;
      if(String(n?.decision_type||'').toUpperCase()==='SPLIT'){out.push(...await verifiedStatAnalysesBelow(n.node_path));continue;}
      const d=asObject(n.decision_payload);
      if(d.deterministic_statistics_verified!==true)continue;
      const f=pythonAnalysesFromArtifact(resultParts(n.result_artifact).artifact);
      if(f?.type_ok===true)out.push(...asArray(f.value));
    }
    return out;
  }

  async function completeQdaRootFromVerifiedChildren(node,childRows){
    if(
      node?.node_path!=='R'
      ||packet?.qda_601_context?.assigned!==true
      ||packet?.qda_601_context?.status!=='in_progress'
    )return null;

    const expectedProblems=asArray(packet?.qda_601_context?.next_unit?.exercise_pack?.problems);
    if(!expectedProblems.length||!childRows.length)return null;
    if(!childRows.every(child=>
      String(child?.node_status||child?.status||'').toLowerCase()==='completed'
    ))return null;

    const authoritativeChildren=await Promise.all(childRows.map(async child=>{
      const decision=asObject(child?.decision_payload);
      let resultArtifact=child.result_artifact;
      let statisticalVerified=decision.deterministic_statistics_verified===true;
      let statisticalCount=Number(decision.deterministic_statistics_analysis_count||0);
      let statisticalDescendantMaterialized=false;
      if(qdaStatisticalAtomicRequirement(packet,child)){
        const parts=resultParts(resultArtifact);
        const direct=pythonAnalysesFromArtifact(parts.artifact);
        if(!(direct?.type_ok===true&&asArray(direct.value).length)){
          const recovered=await verifiedStatAnalysesBelow(child.node_path);
          if(recovered.length){
            let parsed=null;
            try{parsed=JSON.parse(String(parts.artifact||''));}catch{}
            if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)){
              throw new Error('qda_root_statistical_parent_artifact_invalid:'+String(child.node_path));
            }
            parsed={...parsed,python_analyses:recovered};
            resultArtifact=JSON.stringify({status:'COMPLETE',artifact:parsed,handoff:parts.handoff});
            statisticalVerified=true;
            statisticalCount=recovered.length;
            statisticalDescendantMaterialized=true;
            console.log('AAU_QDA_STATISTICAL_DESCENDANTS_MATERIALIZED',JSON.stringify({
              agent_id:agentId,intent_execution_id:intentExecutionId,
              node_path:child.node_path,analysis_count:recovered.length
            }));
          }
        }
      }
      return {
        node_path:child.node_path,
        status:'completed',
        requirement_text:child.requirement_text,
        result_artifact:resultArtifact,
        result_hash:child.result_hash||null,
        deterministic_math_verified:decision.deterministic_math_verified===true,
        deterministic_math_check_count:Number(decision.deterministic_math_check_count||0),
        deterministic_statistics_verified:statisticalVerified,
        deterministic_statistics_analysis_count:statisticalCount,
        qda_verified_descendant_materialized:
          decision.qda_verified_descendant_materialized===true||statisticalDescendantMaterialized,
        qda_verified_descendant_check_count:
          Number(decision.qda_verified_descendant_check_count||0),
      };
    }));

    const canonical=materializeQda601UnitFromVerifiedChildren(
      packet,{authoritativeChildren}
    );
    if(!canonical.applies)return null;
    if(!canonical.payload){
      const error=new Error(
        'qda_root_verified_child_materialization_invalid:'
        +canonical.failures.join('|')
      );
      error.code='COGNITION_RESPONSE_REJECTED';
      throw error;
    }

    const artifact=canonical.payload;
    const aggregateChecks=asArray(artifact?.python_checks);
    const aggregateAnalyses=asArray(artifact?.python_analyses);
    let verificationMode='schema_only_verified_children';
    let mathVerification=null;
    let statisticsVerification=null;

    if(aggregateAnalyses.length || qdaStatisticalAtomicRequirement(packet,node)){
      verificationMode='statistics';
      statisticsVerification=runPythonStatisticalAnalysesChunked(
        aggregateAnalyses,{timeoutMs:12000}
      );
      if(
        statisticsVerification.ok!==true
        ||statisticsVerification.all_claims_match!==true
      ){
        const error=new Error(
          'qda_root_statistical_verification_invalid:'
          +String(statisticsVerification.error||'claim_disagreement')
        );
        error.code='COGNITION_RESPONSE_REJECTED';
        throw error;
      }
    }else if(aggregateChecks.length){
      verificationMode='deterministic_math';
      mathVerification=verifyPythonMathChecksChunked(
        aggregateChecks,{absoluteTolerance:0.005,relativeTolerance:1e-9}
      );
      if(mathVerification.ok!==true||mathVerification.all_match!==true){
        const error=new Error(
          'qda_root_recursive_verification_invalid:'
          +String(mathVerification.error||'verification_failed')
        );
        error.code='COGNITION_RESPONSE_REJECTED';
        throw error;
      }
    }

    const currentChildResultHashes=childRows.map(child=>({
      path:child.node_path,
      result_hash:child.result_hash||sha256(child.result_artifact||''),
      status:child.node_status||child.status||null,
      decision_type:child.decision_type||null,
    }));
    const completedDecisionPayload={...asObject(node.decision_payload)};
    for(const key of [
      'synthesis_provenance_pending',
      'routing_discovery_checkpoint',
      'routing_discovery_checkpointed',
      'routing_discovery_checkpointed_at',
      'routing_discovery_reused',
      'routing_admission',
      'context_resource_state',
      'synthesis_accumulator',
      'provenance_review',
      'sibling_overlap_validation',
      'deterministic_math_reconciliation_required',
      'deterministic_math_retry_nonce',
      'deterministic_math_verification',
      'deterministic_statistics_reconciliation_required',
      'deterministic_statistics_retry_nonce',
      'deterministic_statistics_verification',
      'synthesis_failure',
      'self_remediation_in_progress',
      'synthesis_remediation_nonce',
      'reconsider_decomposition',
      'synthesis_recovery_routing_required',
      'synthesis_recovery_routing_at',
    ])delete completedDecisionPayload[key];
    const completedExternalRemediation=qda601AuthenticatorRemediation(packet);
    if(completedExternalRemediation.active){
      completedDecisionPayload.external_authenticator_remediation_review_id=
        completedExternalRemediation.review_id;
      completedDecisionPayload.external_authenticator_remediation_rejected_file_id=
        completedExternalRemediation.rejected_file_id;
      completedDecisionPayload.external_authenticator_remediation_resolved_at=
        new Date().toISOString();
      completedDecisionPayload.external_authenticator_remediation_resolution_contract=
        'qda_verified_root_materialization_closes_review_v0_1';
    }

    const canonicalMaterializationSha256=sha256(artifact);
    const compactConclusions=asArray(artifact?.problem_responses).map((response,index)=>({
      problem_id:response?.problem_id??index+1,
      interpretation:clip(
        text(response?.interpretation)
        ||'Problem '+String(index+1)+' verified and preserved.',
        600
      ),
    }));
    const resultArtifact=JSON.stringify({
      status:'COMPLETE',
      artifact:{
        contract:'qda_root_verified_child_summary_v0_2',
        unit_code:packet?.qda_601_context?.next_unit?.unit_code||null,
        exercise_pack_ref:packet?.qda_601_context?.next_unit?.exercise_pack_ref||null,
        canonical_materialization_sha256:canonicalMaterializationSha256,
        problem_count:expectedProblems.length,
        verification_mode:verificationMode,
        python_check_count:aggregateChecks.length,
        python_analysis_count:aggregateAnalyses.length,
        child_result_chain:currentChildResultHashes.map(child=>({
          path:child.path,
          result_hash:child.result_hash,
        })),
        conclusions:compactConclusions,
      },
      handoff:{
        conclusions:compactConclusions.map(item=>item.interpretation),
        facts:currentChildResultHashes.map(child=>
          String(child.path||'child')+':'+String(child.result_hash||'')
        ),
        unresolved:[],
      },
    });

    const provenanceChildren=asArray(artifact?.verification_provenance?.children);
    const done=await saveNode({
      nodePath:node.node_path,
      parentPath:node.parent_path??parentPathOf(node.node_path),
      ordinal:node.ordinal||0,
      requirement:node.requirement_text,
      sourceKind:node.source_kind,
      sourceRef:node.source_ref,
      status:'completed',
      decisionType:'SPLIT',
      decisionPayload:{
        ...completedDecisionPayload,
        completion_state_compaction:'durable_checkpoint_references_v0_1',
        synthesis_cursor:childRows.length,
        synthesis_child_result_hashes:currentChildResultHashes,
        synthesis_complete:true,
        synthesis_outcome:'COMPLETE',
        synthesis_reason:
          'Canonical QDA root materialized deterministically from exact verified child artifacts.',
        decomposition_decision:'SPLIT',
        blocked_child_count:0,
        synthesis_provenance_review:{
          status:'ACCEPT',
          issue_count:0,
          reason:'Exact verified child problem responses were preserved without model rewriting.',
          deterministic_guard:'qda_root_verified_child_materialization_v0_2',
        },
        qda_root_verified_child_materialized:true,
        qda_root_materialization_contract:
          text(artifact?.runtime_materialization?.contract)
          ||'qda_verified_child_artifact_materialization_v0_4_problem_coverage',
        qda_root_canonical_materialization_sha256:canonicalMaterializationSha256,
        qda_root_result_storage_contract:'qda_root_verified_child_summary_v0_2',
        qda_root_verification_mode:verificationMode,
        qda_verified_descendant_materialized:true,
        qda_verified_descendant_check_count:aggregateChecks.length,
        qda_verified_descendant_analysis_count:aggregateAnalyses.length,
        qda_verified_descendant_sources:provenanceChildren,
        ...(mathVerification?{
          deterministic_math_verified:true,
          deterministic_math_check_count:aggregateChecks.length,
          deterministic_math_verification:
            compactMathVerificationForPersistence({required:true,...mathVerification}),
          deterministic_math_gate:'qda_root_verified_children_chunked_v0_2',
        }:{}),
        ...(statisticsVerification?{
          deterministic_statistics_verified:true,
          deterministic_statistics_analysis_count:aggregateAnalyses.length,
          deterministic_statistics_verification:{
            required:true,
            ok:statisticsVerification.ok===true,
            all_claims_match:statisticsVerification.all_claims_match===true,
            analysis_count:Number(statisticsVerification.analysis_count||0),
            failure_class:statisticsVerification.failure_class||null,
            error:statisticsVerification.error||null,
            chunked:statisticsVerification.chunked===true,
            batch_count:Number(statisticsVerification.batch_count||0),
          },
          deterministic_statistics_gate:'qda_root_verified_children_chunked_v0_1',
        }:{}),
      },
      contextPayload:node.context_payload||{},
      resultArtifact,
    });
    done.parent_path=node.parent_path??parentPathOf(node.node_path);

    // Canonical verified-root materialization is a stronger terminal boundary
    // than a still-open root remediation checkpoint. Close any remediation
    // episode that was already mechanically applied (or was mid-verification)
    // so a later re-entry cannot resurrect stale remediation state and reopen
    // an otherwise completed QDA assignment. Preserve the audit distinction:
    // this is runtime/external verification, not agent-authored self-verification.
    const completedRootRemediationClosures=[];
    const rootRemediationEpisodes=await loadRemediationEpisodes(node.node_path);
    for(const episode of rootRemediationEpisodes){
      const episodeStatus=String(episode?.status||'').toLowerCase();
      if(!['applied','verifying'].includes(episodeStatus))continue;
      const priorVerificationBoundary=selfRemediationVerificationBoundary(
        episode.repair_type,episode
      );
      const operationalVerification={
        status:'VERIFIED',
        reason:'Canonical QDA root completion from exact verified child artifacts supersedes the pending remediation verification boundary.',
        observed_after:'The QDA root is completed from verified children and passed runtime-owned canonical materialization plus deterministic/statistical verification.',
        remaining_problem:'',
        agent_authored:false,
        verification_boundary:'POST_QDA_CANONICAL_ROOT_MATERIALIZATION',
        superseded_verification_boundary:priorVerificationBoundary,
        external_verification:{
          kind:'qda_verified_root_materialization',
          ok:true,
          root_result_hash:done.result_hash||sha256(resultArtifact),
          canonical_materialization_sha256:canonicalMaterializationSha256,
          verification_mode:verificationMode,
          child_count:authoritativeChildren.length,
        },
        operational_closure:true,
      };
      await remediationRpc('update',node.node_path,{
        remediation_id:episode.remediation_id,
        status:'succeeded',
        post_state:asObject(episode.post_state),
        verification_result:operationalVerification,
      });
      completedRootRemediationClosures.push({
        remediation_id:episode.remediation_id,
        prior_status:episodeStatus,
        repair_type:episode.repair_type,
        superseded_verification_boundary:priorVerificationBoundary,
      });
    }
    if(completedRootRemediationClosures.length){
      console.log('AAU_QDA_ROOT_REMEDIATION_CLOSED',JSON.stringify({
        agent_id:agentId,
        intent_execution_id:intentExecutionId,
        assignment_key:assignmentKey,
        node_path:node.node_path,
        closures:completedRootRemediationClosures,
        policy:'canonical_verified_root_closes_applied_remediation_v0_1',
      }));
    }

    console.log('AAU_QDA_ROOT_VERIFIED_CHILDREN_MATERIALIZED',JSON.stringify({
      agent_id:agentId,
      intent_execution_id:intentExecutionId,
      node_path:node.node_path,
      unit_code:packet?.qda_601_context?.next_unit?.unit_code||null,
      problem_count:expectedProblems.length,
      child_count:authoritativeChildren.length,
      verification_mode:verificationMode,
      python_check_count:aggregateChecks.length,
      python_analysis_count:aggregateAnalyses.length,
      child_paths:authoritativeChildren.map(child=>child.node_path),
      contract:'qda_root_verified_child_materialization_v0_2',
    }));
    return done;
  }

  async function synthesize(node,childRows){
    const qdaRootCompletion=await completeQdaRootFromVerifiedChildren(node,childRows);
    if(qdaRootCompletion)return qdaRootCompletion;

    const currentChildResultHashes=childRows.map(child=>({
      path:child.node_path,
      result_hash:child.result_hash||sha256(child.result_artifact||''),
      status:child.node_status||child.status||null,
      decision_type:child.decision_type||null,
    }));
    const priorChildResultHashes=asArray(node?.decision_payload?.synthesis_child_result_hashes);
    const synthesisInputsChanged=
      priorChildResultHashes.length!==currentChildResultHashes.length
      ||priorChildResultHashes.some((prior,index)=>{
        const current=currentChildResultHashes[index];
        return !current
          ||text(prior?.path)!==text(current.path)
          ||text(prior?.result_hash)!==text(current.result_hash)
          ||text(prior?.status)!==text(current.status)
          ||text(prior?.decision_type)!==text(current.decision_type);
      });

    let accumulator=synthesisInputsChanged
      ?{}
      :asObject(node?.decision_payload?.synthesis_accumulator);
    let cursor=synthesisInputsChanged
      ?0
      :Number(node?.decision_payload?.synthesis_cursor||0);

    if(synthesisInputsChanged){
      const nextPayload={...(node.decision_payload||{})};
      delete nextPayload.synthesis_accumulator;
      delete nextPayload.synthesis_provenance_pending;
      delete nextPayload.synthesis_complete;
      delete nextPayload.synthesis_outcome;
      delete nextPayload.synthesis_reason;
      delete nextPayload.synthesis_provenance_review;
      node=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'split',
        decisionType:'SPLIT',
        decisionPayload:{
          ...nextPayload,
          synthesis_cursor:0,
          synthesis_child_result_hashes:currentChildResultHashes,
          synthesis_rebuild_reason:'child_result_hash_changed',
          synthesis_rebuild_at:new Date().toISOString(),
        },
        contextPayload:node.context_payload||{},
        resultArtifact:null,
      });
      node.parent_path=node.parent_path??parentPathOf(node.node_path);
    }

    for(let i=cursor;i<childRows.length;i++){
      const child=childRows[i];
      const parts=resultParts(child.result_artifact);
      const mergeSemanticIdentity=sha256({
        parent_path:node.node_path,
        parent_requirement:node.requirement_text,
        discovery_fingerprint:text(node?.decision_payload?.routing_discovery_checkpoint?.context_fingerprint)||null,
        prior_accumulator:accumulator,
        child_path:child.node_path,
        child_status:child.node_status||child.status||null,
        child_decision_type:child.decision_type||null,
        child_requirement:child.requirement_text,
        child_result_hash:child.result_hash||sha256(child.result_artifact||''),
      });
      const durableMerge=await loadJsonPhaseCheckpoint(
        node.node_path,'SYNTHESIS_MERGE_'+String(i+1),mergeSemanticIdentity
      );
      let response=durableMerge.parsed
        ? {parsed:durableMerge.parsed,checkpoint_reused:true}
        : null;
      for(let attempt=1;attempt<=2&&!response;attempt++){
        try{
          response=await callJson([
            {role:'system',content:[
              'You are the bound autonomous agent synthesizing YOUR resolved child requirements back into their parent.',
              'A child may be COMPLETED or BLOCKED. BLOCKED is not successful completion; preserve its unresolved evidence or dependency explicitly.',
              'Update a compact accumulator using exactly one newly resolved child.',
              'Do not invent facts, erase a blocked gap, or change the parent requirement.',
               'EPISTEMIC THRESHOLD POLICY: '+THRESHOLD_EVIDENCE_POLICY.RULE+' '+THRESHOLD_EVIDENCE_POLICY.PASS+' '+THRESHOLD_EVIDENCE_POLICY.FAIL+' '+THRESHOLD_EVIDENCE_POLICY.UNKNOWN,
               'When merging child scoring results, preserve PASS, FAIL, and UNKNOWN distinctions; never convert missing evidence into a negative finding.',
              'Return JSON only: {"summary":"compact cumulative synthesis","handoff":{"conclusions":[],"facts":[],"unresolved":[]}}.',
            ].join('\n')},
            {role:'user',content:safeJson({
              parent_requirement:node.requirement_text,
              agent_authored_discovery_state:agentDiscoveryState(node),
              prior_accumulator:accumulator,
              child:{
                path:child.node_path,
                status:child.node_status||child.status||null,
                decision_type:child.decision_type||null,
                requirement:child.requirement_text,
                artifact:clip(parts.artifact,7000),
                handoff:parts.handoff,
              },
            })},
          ],stageBudgets.synthesis_merge,'req_'+node.node_path.replaceAll('.','_')+'_synthesis_merge_'+(i+1)+'_'+attempt);
          break;
        }catch(error){
          const recoverable=error?.code==='COGNITION_RESPONSE_REJECTED'||error?.code==='NVIDIA_TIMEOUT';
          if(!recoverable||attempt===2)throw error;
        }
      }
      if(!durableMerge.parsed){
        await saveJsonPhaseCheckpoint(
          node.node_path,'SYNTHESIS_MERGE_'+String(i+1),mergeSemanticIdentity,
          asObject(response?.parsed),{
            child_path:child.node_path,
            child_result_hash:child.result_hash||sha256(child.result_artifact||''),
          }
        );
      }
      accumulator={
        summary:clip(response?.parsed?.summary,9000),
        handoff:asObject(response?.parsed?.handoff),
      };
      cursor=i+1;
      node=await saveNode({
        nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
        requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
        status:'split',decisionType:'SPLIT',
        decisionPayload:{
          ...(node.decision_payload||{}),
          synthesis_cursor:cursor,
          synthesis_accumulator:accumulator,
          synthesis_child_result_hashes:currentChildResultHashes,
        },
        contextPayload:node.context_payload||{},resultArtifact:null,
      });
      node.parent_path=node.parent_path??parentPathOf(node.node_path);
    }

    const childStates=childRows.map(child=>({
      path:child.node_path,
      status:child.node_status||child.status||null,
      decision_type:child.decision_type||null,
    }));
    const terminalStageContract=stageContractForRequirement(packet,node.requirement_text,node.node_path);
    const authoritativeVerifiedNumericalEvidence=synthesisQuantitativeEvidence(childRows);
    const synthesisRemediationEpisodes=await loadRemediationEpisodes(node.node_path);
    let activeSynthesisRemediation=latestActiveRemediation(
      synthesisRemediationEpisodes,'REBUILD_SYNTHESIS_FROM_RESOLVED_EVIDENCE'
    );

    const returnSynthesisFailureToAgent=async({
      failureType,reason,review=null,continuation=null,externalVerification=null
    })=>{
      let remediationFailure=null;
      if(activeSynthesisRemediation){
        remediationFailure=await failRemediationEpisode(node,activeSynthesisRemediation,{
          reason:'The post-repair synthesis did not satisfy its verification boundary.',
          remainingProblem:reason||failureType,
          externalVerification:externalVerification||{
            kind:'synthesis_provenance',
            ok:false,
            status:text(review?.status)||'REVISE',
            reason:reason||failureType,
          },
        });
      }
      const nextPayload={...asObject(node.decision_payload)};
      delete nextPayload.synthesis_provenance_pending;
      delete nextPayload.synthesis_complete;
      delete nextPayload.synthesis_outcome;
      delete nextPayload.synthesis_reason;
      delete nextPayload.synthesis_provenance_review;
      delete nextPayload.self_remediation_in_progress;
      if(activeSynthesisRemediation){
        nextPayload.last_self_remediation={
          remediation_id:activeSynthesisRemediation.remediation_id,
          attempt_no:Number(activeSynthesisRemediation.attempt_no||0),
          repair_type:activeSynthesisRemediation.repair_type,
          status:'FAILED',
          reason:clip(remediationFailure?.reason||reason||failureType,1600),
          verification_boundary:'POST_SYNTHESIS_PROVENANCE',
          verification_agent_authored:false,
          external_verification:externalVerification||null,
          verified_by_bound_agent:false,
        };
        nextPayload.self_remediation_attempts_used=Number(activeSynthesisRemediation.attempt_no||0);
      }
      nextPayload.synthesis_cursor=childRows.length;
      nextPayload.synthesis_accumulator=accumulator;
      nextPayload.synthesis_child_result_hashes=currentChildResultHashes;
      nextPayload.synthesis_failure={
        contract:'agent_visible_synthesis_failure_v0_2',
        failure_type:failureType,
        reason:clip(reason,4000),
        review:compactSynthesisReviewState(review),
        continuation:asObject(continuation),
        child_state_hash:sha256(childStates),
        accumulator_hash:sha256(accumulator),
        child_result_hashes:currentChildResultHashes,
        prior_synthesis_remediation_id:activeSynthesisRemediation?.remediation_id||null,
        remediation_verification:remediationFailure,
        failed_at:new Date().toISOString(),
        preserved_children:true,
        preserved_accumulator:true,
        recovery_policy:'return_to_bound_agent_REMEDIATE_decision',
      };
      nextPayload.reconsider_decomposition=true;

      node=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:null,
        decisionPayload:nextPayload,
        contextPayload:node.context_payload||{},
        resultArtifact:null,
      });
      node.parent_path=node.parent_path??parentPathOf(node.node_path);

      console.warn('AAU_SYNTHESIS_FAILURE_RETURNED_TO_SELF_REMEDIATION',JSON.stringify({
        agent_id:agentId,
        intent_execution_id:intentExecutionId,
        node_path:node.node_path,
        failure_type:failureType,
        active_remediation_id:activeSynthesisRemediation?.remediation_id||null,
        remediation_attempts_used:Number(nextPayload.self_remediation_attempts_used||0),
      }));

      return process(node.node_path,node.parent_path,pathDepth(node.node_path),0);
    };

    let final=null;
    let synthesisProvenanceReview=null;
    const deterministicEvidenceLedger=
      !terminalStageContract.applies
        ?deterministicEvidenceLedgerSynthesis(packet,node,childRows)
        :null;
    const priorProvenanceContinuation=asObject(node?.decision_payload?.synthesis_provenance_pending);
    let synthesisProvenanceGuidance=clip(priorProvenanceContinuation.revision_guidance,5000);
    let provenanceContinuationRound=Math.max(0,Number(priorProvenanceContinuation.continuation_round||0));
    const MAX_SYNTHESIS_PROVENANCE_CONTINUATION_ROUNDS=3;
    for(let attempt=1;attempt<=2;attempt++){
      try{
        const finalSemanticIdentity=sha256({
          parent_path:node.node_path,
          parent_requirement:node.requirement_text,
          discovery_fingerprint:text(node?.decision_payload?.routing_discovery_checkpoint?.context_fingerprint)||null,
          child_states:childStates,
          accumulator,
          provenance_revision_guidance:synthesisProvenanceGuidance||null,
          terminal_synthesis_ownership_version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
          stage_contract_materialization_version:STAGE_CONTRACT_MATERIALIZATION_VERSION,
          lifecycle_stage_contract_applies:Boolean(terminalStageContract.applies),
          lifecycle_stage_contract_ownership_scope:terminalStageContract.ownership_scope||null,
          lifecycle_stage_contract_name:terminalStageContract.name||null,
          lifecycle_stage_contract_hash:terminalStageContract.definition
            ?sha256(terminalStageContract.definition):null,
          authoritative_verified_numerical_evidence_hash:
            authoritativeVerifiedNumericalEvidence.length
              ?sha256(authoritativeVerifiedNumericalEvidence):null,
          synthesis_remediation_nonce:text(node?.decision_payload?.synthesis_remediation_nonce)||null,
          provenance_continuation_round:provenanceContinuationRound,
        });
        const durableFinal=await loadJsonPhaseCheckpoint(
          node.node_path,'FINAL_SYNTHESIS',finalSemanticIdentity
        );
        final=deterministicEvidenceLedger
          ? {parsed:deterministicEvidenceLedger.final_candidate,deterministic_exact_materialization:true}
          : durableFinal.parsed
            ? {parsed:durableFinal.parsed,checkpoint_reused:true}
            : await callJson([
          {role:'system',content:[
            'You are the bound autonomous agent closing a parent requirement after all child requirements have resolved.',
            'Some children may be BLOCKED. Decide whether the parent can honestly be COMPLETE from the resolved evidence or must itself be BLOCKED.',
            'The runtime does not make the substantive COMPLETE/BLOCKED decision for you, but terminal synthesis/formatting/submission is explicitly YOUR task in this phase.',
            'If the parent requirement names a lifecycle stage contract, the runtime owns the exact contract materialization immediately AFTER this semantic decision. The absence of a separate synthesis child or previously formatted proposal is NOT a blocking gap.',
            'Choose BLOCKED only when a substantive evidence/dependency gap prevents truthful satisfaction of the parent requirement; never choose BLOCKED merely because synthesis, formatting, or submission remains to be performed.',
            'When a lifecycle stage contract applies, keep artifact as a concise semantic synthesis. Do NOT embed or stringify the contract object here; the next runtime-owned materialization phase will produce the exact JSON object.',
            'If any essential child gap prevents the parent requirement from being satisfied, choose BLOCKED and preserve the unresolved gap.',
            'Return JSON only: {"outcome":"COMPLETE|BLOCKED","reason":"auditable reason","artifact":"concise semantic parent result OR a real nested JSON object when the parent requirement or prior provenance guidance requires structured fields","handoff":{"conclusions":[],"facts":[],"unresolved":[]}}.',
            'STRUCTURED ARTIFACT RULE: when the parent requirement or prior_provenance_revision_guidance names required fields/schema, artifact MUST be the actual nested JSON object with those fields. Do not encode that object as a string, prose blob, markdown, or JSON-inside-a-string.',
            'When prior provenance guidance requests a shape correction, the corrected shape is authoritative for this synthesis attempt and must be reflected directly in artifact.',
            ...(authoritativeVerifiedNumericalEvidence.length?[
              'AUTHORITATIVE VERIFIED NUMERICAL EVIDENCE is supplied below from completed child work that already passed deterministic/provenance checks. Treat these values as evidence, not as prompts to recalculate.',
              'When you repeat one of those numerical claims, preserve the established value at its displayed precision. Ordinary parent synthesis may interpret or summarize it but must not silently change it. If you believe a verified child value is wrong, preserve it and state the concern as unresolved rather than substituting a new number during synthesis.'
            ]:[]),
            'Do not add requirements or conclusions that are not supported by the resolved children.',
             'EPISTEMIC THRESHOLD POLICY: '+THRESHOLD_EVIDENCE_POLICY.RULE+' '+THRESHOLD_EVIDENCE_POLICY.PASS+' '+THRESHOLD_EVIDENCE_POLICY.FAIL+' '+THRESHOLD_EVIDENCE_POLICY.UNKNOWN,
             'If a child contains UNKNOWN threshold states, preserve them as UNKNOWN in the parent synthesis unless later resolved by explicit evidence.',
          ].join('\n')},
          {role:'user',content:safeJson({
            parent_requirement:node.requirement_text,
            agent_authored_discovery_state:agentDiscoveryState(node),
            child_states:childStates,
            cumulative_synthesis:accumulator,
            terminal_synthesis_ownership:{
              version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
              applies_to_parent:terminalStageContract.applies,
              ownership_scope:terminalStageContract.ownership_scope||null,
              stage_contract_name:terminalStageContract.name||null,
              stage_contract_definition:terminalStageContract.applies
                ?terminalStageContract.definition
                :null,
            },
            prior_provenance_revision_guidance:synthesisProvenanceGuidance||null,
            synthesis_failure:asObject(node?.decision_payload?.synthesis_failure),
            active_self_remediation:activeSynthesisRemediation
              ?compactRemediationEpisodes([activeSynthesisRemediation])[0]
              :null,
            authoritative_verified_numerical_evidence:
              authoritativeVerifiedNumericalEvidence.length
                ?authoritativeVerifiedNumericalEvidence
                :null,
          })},
        ],stageBudgets.synthesis_final,'req_'+node.node_path.replaceAll('.','_')+'_synthesis_final_'+attempt);

        const finalCandidate=asObject(final?.parsed);
        const candidateOutcome=text(finalCandidate.outcome).toUpperCase();
        if(!['COMPLETE','BLOCKED'].includes(candidateOutcome)){
          const error=new Error('autonomous_decomposition_synthesis_outcome_invalid:'+node.node_path);
          error.code='COGNITION_RESPONSE_REJECTED';
          error.response_contract='final_synthesis_outcome_complete_or_blocked_v0_1';
          throw error;
        }
        if(!artifactText(finalCandidate.artifact)){
          const error=new Error('autonomous_decomposition_synthesis_empty:'+node.node_path);
          error.code='COGNITION_RESPONSE_REJECTED';
          error.response_contract='final_synthesis_nonempty_artifact_v0_1';
          throw error;
        }

        if(terminalStageContract.applies){
          const allChildrenSubstantivelyResolved=childStates.every(v=>v.status==='completed');
          const blockText=normalizedRequirement(
            text(finalCandidate.reason)+' '+text(finalCandidate.artifact)
          );
          if(candidateOutcome==='BLOCKED'
            &&allChildrenSubstantivelyResolved
            &&/(synthesis|synthesize|synthesise|format|submit|submission|proposal pending)/.test(blockText)){
            synthesisProvenanceGuidance=
              'Terminal synthesis is runtime-owned. All substantive children are complete, so do not BLOCK because the proposal has not yet been formatted/submitted. Construct the '+terminalStageContract.name+' artifact now from the resolved evidence; BLOCK only for a substantive evidence gap.';
            const ownershipError=new Error('autonomous_decomposition_terminal_synthesis_ownership_violation:'+node.node_path);
            ownershipError.code='COGNITION_RESPONSE_REJECTED';
            throw ownershipError;
          }
          if(candidateOutcome==='COMPLETE'){
            const proposal=await materializeTerminalStageContract(
              node,childRows,accumulator,finalCandidate,terminalStageContract
            );
            finalCandidate.artifact=safeJson(proposal);
            finalCandidate.terminal_stage_contract_materialized=true;
            finalCandidate.stage_contract_name=terminalStageContract.name;
            finalCandidate.stage_contract_materialization_version=
              STAGE_CONTRACT_MATERIALIZATION_VERSION;
            final={...final,parsed:finalCandidate};
          }
        }

        // QDA quantitative parent synthesis is a presentation layer over
        // already-verified descendants. Materialize authoritative case inputs
        // and executable descendant checks BEFORE provenance review so a model
        // is never asked to reconstruct deterministic verification structure.
        if(candidateOutcome==='COMPLETE'&&qdaQuantitativeAtomicRequirement(packet,node)){
          const preReviewMaterialization=
            await materializeQdaQuantitativeFromVerifiedDescendants(
              node,finalCandidate.artifact
            );
          if(preReviewMaterialization?.artifact){
            finalCandidate.artifact=preReviewMaterialization.artifact;
            finalCandidate.runtime_verified_descendant_materialization_applied=
              preReviewMaterialization.materialized===true
              ||preReviewMaterialization.already_materialized===true;
            finalCandidate.runtime_verified_descendant_check_count=
              Number(preReviewMaterialization.check_count||0);
            final={...final,parsed:finalCandidate};
            console.log('AAU_QDA_PRE_PROVENANCE_DESCENDANT_MATERIALIZATION',JSON.stringify({
              agent_id:agentId,
              intent_execution_id:intentExecutionId,
              node_path:node.node_path,
              check_count:Number(preReviewMaterialization.check_count||0),
              materialized:preReviewMaterialization.materialized===true,
              already_materialized:preReviewMaterialization.already_materialized===true,
              authoritative_case_inputs:
                Object.keys(asObject(
                  packet?.qda_601_context?.next_unit?.exercise_pack?.case_data
                )).length,
              contract:'qda_pre_provenance_verified_descendant_materialization_v0_1',
            }));
          }
        }

        if(!durableFinal.parsed){
          await saveJsonPhaseCheckpoint(
            node.node_path,'FINAL_SYNTHESIS',finalSemanticIdentity,finalCandidate,{
              synthesis_outcome:candidateOutcome,
              artifact_hash:sha256(artifactText(finalCandidate.artifact)),
              stage_contract_materialization_version:
                terminalStageContract.applies?STAGE_CONTRACT_MATERIALIZATION_VERSION:null,
            }
          );
        }

        const quantitativeDriftReview=synthesisQuantitativeDriftReview(
          final?.parsed,
          authoritativeVerifiedNumericalEvidence
        );
        if(deterministicEvidenceLedger){
          synthesisProvenanceReview=deterministicEvidenceLedger.provenance_review;
          console.log('AAU_DETERMINISTIC_EVIDENCE_LEDGER_MATERIALIZED',JSON.stringify({
            agent_id:agentId,
            intent_execution_id:intentExecutionId,
            node_path:node.node_path,
            ledger_entry_count:
              deterministicEvidenceLedger.provenance_review?.deterministic_guard?.ledger_entry_count||0,
            child_count:
              deterministicEvidenceLedger.provenance_review?.deterministic_guard?.child_count||0,
            contract:'exact_completed_child_ledger_v0_1',
          }));
        }else if(quantitativeDriftReview){
          synthesisProvenanceReview=quantitativeDriftReview;
          console.log('AAU_SYNTHESIS_QUANTITATIVE_EVIDENCE_DRIFT',JSON.stringify({
            agent_id:agentId,
            intent_execution_id:intentExecutionId,
            node_path:node.node_path,
            issue_count:quantitativeDriftReview.issues.length,
            guard:quantitativeDriftReview.deterministic_guard,
          }));
        }else{
          synthesisProvenanceReview=await reviewSynthesisProvenance(
            node,
            childRows,
            accumulator,
            final?.parsed,
            synthesisProvenanceGuidance
          );
        }
        console.log('AAU_AUTONOMOUS_SYNTHESIS_PROVENANCE_REVIEW',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          status:synthesisProvenanceReview.status,
          issue_count:synthesisProvenanceReview.issues.length,
        }));
        if(synthesisProvenanceReview.status!=='ACCEPT'){
          synthesisProvenanceGuidance=
            synthesisProvenanceReview.revision_guidance
            ||synthesisProvenanceReview.reason
            ||'Revise the parent synthesis so all source/value bindings and derived transformations remain faithful to the resolved child evidence.';
          if(attempt===2){
            const nextContinuationRound=provenanceContinuationRound+1;
            const continuation={
              contract:'synthesis_provenance_continuation_v0_1',
              phase:'FINAL_SYNTHESIS_TO_PROVENANCE',
              node_path:node.node_path,
              continuation_round:nextContinuationRound,
              max_continuation_rounds:MAX_SYNTHESIS_PROVENANCE_CONTINUATION_ROUNDS,
              revision_guidance:synthesisProvenanceGuidance,
              review:compactSynthesisReviewState(synthesisProvenanceReview),
              child_state_hash:sha256(childStates),
              accumulator_hash:sha256(accumulator),
              semantic_state_preserved:true,
              merges_reused:true,
              deferred_at:new Date().toISOString(),
            };
            node=await saveNode({
              nodePath:node.node_path,
              parentPath:node.parent_path??parentPathOf(node.node_path),
              ordinal:node.ordinal||0,
              requirement:node.requirement_text,
              sourceKind:node.source_kind,
              sourceRef:node.source_ref,
              status:'split',
              decisionType:'SPLIT',
              decisionPayload:{
                ...(()=>{
                  const compact={...asObject(node.decision_payload)};
                  if(Object.keys(asObject(compact.synthesis_failure)).length)
                    compact.synthesis_failure=compactSynthesisFailureState(compact.synthesis_failure);
                  for(const key of [
                    'routing_discovery_checkpoint','routing_discovery_checkpointed',
                    'routing_discovery_checkpointed_at','routing_discovery_reused',
                    'routing_commit_serialized'
                  ]) delete compact[key];
                  return compact;
                })(),
                synthesis_cursor:childRows.length,
                synthesis_accumulator:accumulator,
                synthesis_complete:false,
                synthesis_provenance_pending:continuation,
              },
              contextPayload:node.context_payload||{},
              resultArtifact:null,
            });
            node.parent_path=node.parent_path??parentPathOf(node.node_path);
            const exhausted=nextContinuationRound>=MAX_SYNTHESIS_PROVENANCE_CONTINUATION_ROUNDS;
            if(exhausted){
              return returnSynthesisFailureToAgent({
                failureType:'synthesis_provenance_continuation_exhausted',
                reason:synthesisProvenanceGuidance,
                review:synthesisProvenanceReview,
                continuation,
                externalVerification:{
                  kind:'synthesis_provenance',
                  ok:false,
                  status:text(synthesisProvenanceReview?.status)||'REVISE',
                  issue_count:asArray(synthesisProvenanceReview?.issues).length,
                  reason:synthesisProvenanceGuidance,
                },
              });
            }
            const error=new Error('cognition_provenance_continuation_required:'+node.node_path);
            error.code='COGNITION_PROVENANCE_CONTINUATION_REQUIRED';
            error.provenanceContinuation=continuation;
            throw error;
          }
          continue;
        }

        if(
          activeSynthesisRemediation
          &&['applied','verifying'].includes(String(activeSynthesisRemediation.status||''))
        ){
          const remediationPinnedEvidence=await loadPinnedEvidence(node.node_path);
          const remediationSiblingEvidence=authoritativeSiblingEvidence(node.context_payload||{});
          const remediationBoundary=selfRemediationVerificationBoundary(
            activeSynthesisRemediation.repair_type,
            activeSynthesisRemediation
          );
          const internalVerification={
            kind:'synthesis_provenance',
            ok:true,
            status:'ACCEPT',
            issue_count:0,
            quantitative_drift_guard_passed:true,
            deterministic_provenance_guard:asObject(synthesisProvenanceReview?.deterministic_guard),
            artifact_hash:sha256(artifactText(final?.parsed?.artifact)),
            provenance_reason:clip(synthesisProvenanceReview?.reason,2200),
          };

          if(remediationBoundary==='POST_INDEPENDENT_AUTHENTICATOR'){
            const postState=remediationStateSnapshot(
              node,node.context_payload||{},remediationPinnedEvidence,remediationSiblingEvidence
            );
            const triggeringFailure=asObject(node?.decision_payload?.synthesis_failure);
            await remediationRpc('update',node.node_path,{
              remediation_id:activeSynthesisRemediation.remediation_id,
              status:'verifying',
              post_state:postState,
              verification_result:{
                status:'PENDING',
                verification_boundary:'POST_INDEPENDENT_AUTHENTICATOR',
                internal_synthesis_verification:internalVerification,
                triggering_authenticator_review_id:
                  text(triggeringFailure.authenticator_review_id)||null,
                verification_started_at:new Date().toISOString(),
              },
            });
            node.decision_payload={
              ...asObject(node.decision_payload),
              self_remediation_in_progress:{
                ...asObject(node?.decision_payload?.self_remediation_in_progress),
                remediation_id:activeSynthesisRemediation.remediation_id,
                verification_boundary:'POST_INDEPENDENT_AUTHENTICATOR',
                fresh_cognition_required:false,
                internal_synthesis_verified:true,
                awaiting_independent_authenticator:true,
                internal_synthesis_verified_at:new Date().toISOString(),
              },
            };
            console.log('AAU_AUTONOMOUS_SELF_REMEDIATION_AWAITING_AUTHENTICATOR',JSON.stringify({
              agent_id:agentId,
              intent_execution_id:intentExecutionId,
              node_path:node.node_path,
              remediation_id:activeSynthesisRemediation.remediation_id,
              triggering_review_id:text(triggeringFailure.authenticator_review_id)||null,
              artifact_hash:internalVerification.artifact_hash,
            }));
            activeSynthesisRemediation=null;
          }else{
            const verifiedRemediation=await verifyRemediationEpisode(node,activeSynthesisRemediation,{
              contextPayload:node.context_payload||{},
              pinnedEvidence:remediationPinnedEvidence,
              siblingEvidence:remediationSiblingEvidence,
              externalVerification:internalVerification,
              preserveCurrentCognition:true,
            });
            node=verifiedRemediation.node;
            if(!verifiedRemediation.verified){
              activeSynthesisRemediation=null;
              return returnSynthesisFailureToAgent({
                failureType:'self_remediation_verification_failed',
                reason:verifiedRemediation.verification?.remaining_problem
                  ||verifiedRemediation.verification?.reason
                  ||'The bound agent did not verify its own synthesis remediation.',
                review:synthesisProvenanceReview,
                externalVerification:internalVerification,
              });
            }
            activeSynthesisRemediation=null;
          }
        }
        break;
      }catch(error){
        const recoverable=error?.code==='COGNITION_RESPONSE_REJECTED'||error?.code==='NVIDIA_TIMEOUT';
        if(!recoverable)throw error;
        if(attempt===2){
          if(error?.code==='COGNITION_RESPONSE_REJECTED'){
            return returnSynthesisFailureToAgent({
              failureType:'synthesis_response_contract_exhausted',
              reason:String(error?.message||error).slice(0,3000),
              review:synthesisProvenanceReview,
              externalVerification:{
                kind:'synthesis_response_contract',
                ok:false,
                status:'REJECTED',
                response_contract:text(error?.response_contract)||null,
                reason:String(error?.message||error).slice(0,3000),
              },
            });
          }
          throw error;
        }
      }
    }

    const outcome=text(final?.parsed?.outcome).toUpperCase();
    if(!['COMPLETE','BLOCKED'].includes(outcome))
      throw new Error('autonomous_decomposition_synthesis_outcome_invalid:'+node.node_path);
    const rawFinalArtifact=final?.parsed?.artifact;
    let artifact=(rawFinalArtifact&&typeof rawFinalArtifact==='object'&&!Array.isArray(rawFinalArtifact))
      ? rawFinalArtifact
      : artifactText(rawFinalArtifact);
    if(!artifactText(artifact))throw new Error('autonomous_decomposition_synthesis_empty:'+node.node_path);
    const qdaProblemMaterialization=outcome==='COMPLETE'
      ?await materializeQdaQuantitativeFromVerifiedDescendants(node,artifact)
      :{artifact,materialized:false,check_count:0};
    artifact=qdaProblemMaterialization.artifact;

    // Fail closed at split-parent synthesis too. Atomic descendants already
    // have their own deterministic gate, but a parent must never become
    // completed if verified-descendant materialization cannot establish an
    // executable Python-check set for the final quantitative artifact.
    const splitParentMathVerification=outcome==='COMPLETE'
      ?deterministicMathVerification(packet,node,artifact)
      :{required:false,ok:true,all_match:true};
    if(
      splitParentMathVerification.required===true
      &&(
        qdaProblemMaterialization.verification_blocked===true
        ||splitParentMathVerification.ok!==true
        ||splitParentMathVerification.all_match!==true
      )
    ){
      const nextPayload={...asObject(node.decision_payload)};
      for(const key of [
        'synthesis_complete','synthesis_outcome','synthesis_reason',
        'synthesis_provenance_review','synthesis_provenance_pending'
      ])delete nextPayload[key];
      node=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'split',
        decisionType:'SPLIT',
        decisionPayload:{
          ...nextPayload,
          synthesis_cursor:0,
          synthesis_accumulator:{},
          synthesis_rebuild_reason:'quantitative_parent_deterministic_verification_blocked',
          synthesis_rebuild_at:new Date().toISOString(),
          deterministic_math_verification:
            compactMathVerificationForPersistence(splitParentMathVerification),
          deterministic_math_gate:'split_parent_fail_closed_v0_1',
          reconsider_decomposition:false,
        },
        contextPayload:node.context_payload||{},
        resultArtifact:null,
      });
      node.parent_path=node.parent_path??parentPathOf(node.node_path);
      console.warn('AAU_QDA_SPLIT_PARENT_DETERMINISTIC_COMPLETION_BLOCKED',JSON.stringify({
        agent_id:agentId,
        intent_execution_id:intentExecutionId,
        node_path:node.node_path,
        error:splitParentMathVerification.error||null,
        check_count:Number(splitParentMathVerification.check_count||0),
        required_check_count:Number(splitParentMathVerification.required_check_count||0),
        policy:'split_parent_fail_closed_v0_1',
      }));
      return process(
        node.node_path,
        node.parent_path,
        pathDepth(node.node_path),
        0
      );
    }

    const resultArtifact=JSON.stringify({status:outcome,artifact,handoff:asObject(final?.parsed?.handoff)});
    const completedDecisionPayload={...(node.decision_payload||{})};
    // Completed split nodes retain durable identity/provenance hashes, but do
    // not duplicate large discovery, merge, retry, or verifier-detail payloads
    // that already live in immutable checkpoints/result artifacts.
    for(const key of [
      'synthesis_provenance_pending',
      'routing_discovery_checkpoint',
      'routing_discovery_checkpointed',
      'routing_discovery_checkpointed_at',
      'routing_discovery_reused',
      'routing_admission',
      'context_resource_state',
      'synthesis_accumulator',
      'provenance_review',
      'sibling_overlap_validation',
      'deterministic_math_reconciliation_required',
      'deterministic_math_retry_nonce',
      'deterministic_math_verification',
    ])delete completedDecisionPayload[key];
    completedDecisionPayload.completion_state_compaction=
      'durable_checkpoint_references_v0_1';
    const done=await saveNode({
      nodePath:node.node_path,parentPath:node.parent_path??parentPathOf(node.node_path),ordinal:node.ordinal||0,
      requirement:node.requirement_text,sourceKind:node.source_kind,sourceRef:node.source_ref,
      status:outcome==='BLOCKED'?'blocked':'completed',
      decisionType:outcome==='BLOCKED'?'BLOCKED':'SPLIT',
      decisionPayload:{
        ...completedDecisionPayload,
        synthesis_cursor:childRows.length,
        synthesis_child_result_hashes:currentChildResultHashes,
        synthesis_complete:true,
        synthesis_outcome:outcome,
        synthesis_reason:clip(final?.parsed?.reason,2200),
        decomposition_decision:'SPLIT',
        blocked_child_count:childStates.filter(v=>v.status==='blocked'||v.decision_type==='BLOCKED').length,
        synthesis_provenance_review:asObject(synthesisProvenanceReview),
        terminal_synthesis_ownership_version:TERMINAL_SYNTHESIS_OWNERSHIP_VERSION,
        terminal_stage_contract_name:terminalStageContract.applies?terminalStageContract.name:null,
        stage_contract_materialization_version:
          terminalStageContract.applies?STAGE_CONTRACT_MATERIALIZATION_VERSION:null,
        qda_verified_descendant_materialized:
          qdaProblemMaterialization.materialized===true
          ||qdaProblemMaterialization.already_materialized===true,
        qda_verified_descendant_check_count:Number(qdaProblemMaterialization.check_count||0),
        qda_verified_descendant_sources:asArray(qdaProblemMaterialization.sources),
        ...(qdaProblemMaterialization.verification?.required===true
          &&qdaProblemMaterialization.verification?.ok===true
          &&qdaProblemMaterialization.verification?.all_match===true?{
            deterministic_math_verified:true,
            deterministic_math_check_count:Number(qdaProblemMaterialization.check_count||0),
            deterministic_math_verification:
              compactMathVerificationForPersistence(qdaProblemMaterialization.verification),
            deterministic_math_gate:'split_parent_verified_descendants_v0_1',
          }:{}),
      },
      contextPayload:node.context_payload||{},resultArtifact,
    });
    done.parent_path=node.parent_path??parentPathOf(node.node_path);
    if(outcome==='COMPLETE')
      return ensureCanonicalStageCandidateSubmission(
        done,
        terminalStageContract.applies
          ? (
              final?.parsed?.artifact&&typeof final.parsed.artifact==='object'&&!Array.isArray(final.parsed.artifact)
                ? final.parsed.artifact
                : JSON.parse(artifactText(final?.parsed?.artifact))
            )
          : null
      );
    return done;
  }

  async function process(nodePath,parentPath=null,branchDepth=0,singleChildRefinements=0){
    // Depth is persisted for addressability only. It is not the normal convergence budget.
    branchDepth=pathDepth(nodePath);
    singleChildRefinements=0;
    let node=await getNode(nodePath);
    if(node?.status!=='ready')throw new Error('autonomous_decomposition_node_missing:'+nodePath);
    node.parent_path=parentPath;
    counters.nodes++;

    const rootExternalAuthRemediation=
      nodePath==='R'?qda601AuthenticatorRemediation(packet):{active:false};
    const lastHandledExternalReview=text(
      node?.decision_payload?.external_authenticator_remediation_review_id
    );
    if(
      node.node_status==='completed'
      &&rootExternalAuthRemediation.active
      &&lastHandledExternalReview!==rootExternalAuthRemediation.review_id
    ){
      const priorPayload={...asObject(node.decision_payload)};
      for(const key of [
        'synthesis_complete','synthesis_outcome','synthesis_reason',
        'synthesis_provenance_review','synthesis_provenance_pending',
        'self_remediation_in_progress','synthesis_remediation_nonce'
      ]) delete priorPayload[key];
      priorPayload.synthesis_failure={
        contract:'external_authenticator_synthesis_failure_v0_1',
        failure_type:'independent_authenticator_verified_fail',
        reason:clip(
          text(rootExternalAuthRemediation.report?.rationale)
          ||'Independent authenticator rejected the frozen QDA unit artifact.',
          4000
        ),
        review:compactSynthesisReviewState({
          status:'REVISE',
          reason:text(rootExternalAuthRemediation.report?.rationale),
          issues:[
            ...asArray(rootExternalAuthRemediation.report?.weaknesses),
            ...asArray(rootExternalAuthRemediation.report?.remediation),
          ],
          revision_guidance:
            asArray(rootExternalAuthRemediation.report?.remediation).map(text).filter(Boolean).join(' '),
          external_authenticator:true,
        }),
        authenticator_review_id:rootExternalAuthRemediation.review_id,
        authenticator_report_ref:{
          review_id:rootExternalAuthRemediation.review_id,
          rejected_file_id:rootExternalAuthRemediation.rejected_file_id,
          artifact_sha256:rootExternalAuthRemediation.artifact_sha256,
          report_sha256:Object.keys(rootExternalAuthRemediation.report).length
            ?sha256(rootExternalAuthRemediation.report):null,
        },
        rejected_file_id:rootExternalAuthRemediation.rejected_file_id,
        rejected_artifact_sha256:rootExternalAuthRemediation.artifact_sha256,
        authenticator_score:rootExternalAuthRemediation.score,
        prior_root_result_hash:node.result_hash||null,
        child_result_hashes:asArray(priorPayload.synthesis_child_result_hashes),
        accumulator_hash:Object.keys(asObject(priorPayload.synthesis_accumulator)).length
          ?sha256(priorPayload.synthesis_accumulator):null,
        preserved_children:true,
        preserved_accumulator:true,
        recovery_policy:'return_to_bound_agent_REMEDIATE_decision',
        failed_at:new Date().toISOString(),
      };
      priorPayload.external_authenticator_remediation_review_id=
        rootExternalAuthRemediation.review_id;
      priorPayload.external_authenticator_remediation_rejected_file_id=
        rootExternalAuthRemediation.rejected_file_id;
      priorPayload.reconsider_decomposition=true;
      priorPayload.synthesis_recovery_routing_required=true;
      priorPayload.synthesis_recovery_routing_at=new Date().toISOString();

      node=await saveNode({
        nodePath:node.node_path,
        parentPath:node.parent_path??parentPathOf(node.node_path),
        ordinal:node.ordinal||0,
        requirement:node.requirement_text,
        sourceKind:node.source_kind,
        sourceRef:node.source_ref,
        status:'pending',
        decisionType:null,
        decisionPayload:priorPayload,
        contextPayload:node.context_payload||{},
        resultArtifact:null,
      });
      node.parent_path=parentPath;
      console.log('AAU_QDA_AUTHENTICATOR_FAILURE_RETURNED_TO_SELF_REMEDIATION',JSON.stringify({
        agent_id:agentId,
        intent_execution_id:intentExecutionId,
        assignment_key:assignmentKey,
        node_path:node.node_path,
        review_id:rootExternalAuthRemediation.review_id,
        rejected_file_id:rootExternalAuthRemediation.rejected_file_id,
        prior_root_result_hash:text(priorPayload.synthesis_failure.prior_root_result_hash)||null,
      }));
    }

    if(
      nodePath==='R'
      &&node.node_status==='pending'
      &&rootExternalAuthRemediation.active
      &&lastHandledExternalReview===rootExternalAuthRemediation.review_id
      &&(
        node?.decision_payload?.deterministic_statistics_verified===true
        ||node?.decision_payload?.qda_verified_descendant_materialized===true
      )
    ){
      const refs=(await children('R'))
        .filter(child=>String(child?.status||child?.node_status||'')!=='cancelled')
        .sort((a,b)=>Number(a?.ordinal||0)-Number(b?.ordinal||0));
      const completedChildren=[];
      for(const ref of refs){
        const child=await getNode(ref.node_path);
        if(child?.status==='ready')completedChildren.push({...child,parent_path:'R'});
      }
      if(
        completedChildren.length
        &&completedChildren.every(child=>
          String(child?.node_status||child?.status||'').toLowerCase()==='completed'
        )
      ){
        const recoveredRoot=await completeQdaRootFromVerifiedChildren(node,completedChildren);
        if(recoveredRoot){
          console.log('AAU_QDA_HANDLED_REMEDIATION_ROOT_RECOVERED',JSON.stringify({
            agent_id:agentId,
            intent_execution_id:intentExecutionId,
            assignment_key:assignmentKey,
            review_id:rootExternalAuthRemediation.review_id,
            child_count:completedChildren.length,
            policy:'handled_auth_review_verified_children_recovery_v0_1',
          }));
          return ensureCanonicalStageCandidateSubmission(recoveredRoot);
        }
      }
    }

    if(
      nodePath==='R'
      &&['split','pending'].includes(String(node.node_status||'').toLowerCase())
      &&packet?.qda_601_context?.assigned===true
      &&packet?.qda_601_context?.status==='in_progress'
    ){
      const refs=(await children('R'))
        .filter(child=>String(child?.status||child?.node_status||'')!=='cancelled')
        .sort((a,b)=>Number(a?.ordinal||0)-Number(b?.ordinal||0));
      const durableChildren=[];
      for(const ref of refs){
        const child=await getNode(ref.node_path);
        if(child?.status==='ready')durableChildren.push({...child,parent_path:'R'});
      }
      const expectedProblemCount=asArray(
        packet?.qda_601_context?.next_unit?.exercise_pack?.problems
      ).length;
      if(
        expectedProblemCount>0
        &&durableChildren.length===expectedProblemCount
        &&durableChildren.every(child=>
          String(child?.node_status||child?.status||'').toLowerCase()==='completed'
        )
      ){
        const recoveredRoot=await completeQdaRootFromVerifiedChildren(node,durableChildren);
        if(recoveredRoot){
          console.log('AAU_QDA_ROOT_DB_COMPLETION_RECOVERY',JSON.stringify({
            agent_id:agentId,
            intent_execution_id:intentExecutionId,
            assignment_key:assignmentKey,
            unit_code:packet?.qda_601_context?.next_unit?.unit_code||null,
            child_count:durableChildren.length,
            child_paths:durableChildren.map(child=>child.node_path),
            policy:'durable_direct_children_root_convergence_v0_1',
          }));
          return ensureCanonicalStageCandidateSubmission(recoveredRoot);
        }
      }
    }

    if(node.node_status==='completed'){
      const atomicRevalidation=completedAtomicDeterministicRevalidation(packet,node);
      if(atomicRevalidation.required){
        await reopenCompletedRuntimeForDeterministicRevalidation(node.node_path);
        const revalidationDecisionPayload={...(node.decision_payload||{})};
        delete revalidationDecisionPayload.deterministic_math_verified;
        delete revalidationDecisionPayload.deterministic_math_check_count;
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'pending',
          decisionType:'ATOMIC',
          decisionPayload:{
            ...revalidationDecisionPayload,
            deterministic_math_reconciliation_required:true,
            deterministic_math_attempts:Math.max(0,Number(node?.decision_payload?.deterministic_math_attempts||0)),
            deterministic_math_verification:atomicRevalidation.verification,
            deterministic_math_gate:'legacy_completed_atomic_revalidation_v0_1',
            legacy_completed_atomic_reopened:true,
            legacy_completed_atomic_prior_result_hash:node.result_hash||null,
            reconsider_decomposition:false,
          },
          contextPayload:{
            ...(node.context_payload||{}),
            deterministic_math_feedback:{
              attempt:Math.max(0,Number(node?.decision_payload?.deterministic_math_attempts||0)),
              verifier:'python3_safe_math_v0_1',
              verification:atomicRevalidation.verification,
              instruction:'This completed quantitative node predates deterministic verification. Re-author the same requirement with explicit Python checks for every material result, preserving correct reasoning and correcting any disagreement.'
            },
          },
          resultArtifact:null,
        });
        node.parent_path=parentPath;
        console.log('AAU_AUTONOMOUS_LEGACY_ATOMIC_REOPENED',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          reason:atomicRevalidation.verification?.error||'deterministic_verification_not_satisfied',
        }));
      }else if(text(node.decision_type).toUpperCase()==='SPLIT'){
        const existingChildRefs=(await children(node.node_path))
          .filter(child=>String(child?.status||child?.node_status||'')!=='cancelled');
        const existingChildren=[];
        for(const childRef of existingChildRefs){
          const hydrated=await getNode(childRef.node_path);
          if(hydrated?.status==='ready'){
            existingChildren.push({
              ...hydrated,
              parent_path:node.node_path,
            });
          }
        }
        const legacyChild=existingChildren.find(child=>
          completedAtomicDeterministicRevalidation(packet,child).required
        );
        if(legacyChild){
          await reopenCompletedRuntimeForDeterministicRevalidation(legacyChild.node_path);
        }
        if(!legacyChild){
          const parts=resultParts(node.result_artifact);
          const qdaMaterialization=await materializeQdaQuantitativeFromVerifiedDescendants(
            node,parts.artifact
          );
          if(qdaMaterialization.materialized===true){
            const repaired=await saveNode({
              nodePath:node.node_path,
              parentPath:node.parent_path??parentPathOf(node.node_path),
              ordinal:node.ordinal||0,
              requirement:node.requirement_text,
              sourceKind:node.source_kind,
              sourceRef:node.source_ref,
              status:'completed',
              decisionType:'SPLIT',
              decisionPayload:{
                ...(node.decision_payload||{}),
                qda_verified_descendant_materialized:true,
                qda_verified_descendant_check_count:Number(qdaMaterialization.check_count||0),
                qda_verified_descendant_sources:asArray(qdaMaterialization.sources),
                qda_verified_descendant_materialized_at:new Date().toISOString(),
              },
              contextPayload:node.context_payload||{},
              resultArtifact:JSON.stringify({
                status:'COMPLETE',
                artifact:qdaMaterialization.artifact,
                handoff:parts.handoff,
              }),
            });
            repaired.parent_path=node.parent_path??parentPathOf(node.node_path);
            node=repaired;
            console.log('AAU_QDA_VERIFIED_DESCENDANTS_MATERIALIZED',JSON.stringify({
              agent_id:agentId,
              intent_execution_id:intentExecutionId,
              node_path:node.node_path,
              check_count:Number(qdaMaterialization.check_count||0),
              source_count:asArray(qdaMaterialization.sources).length,
              retroactive_completed_split:true,
            }));
          }
          return ensureCanonicalStageCandidateSubmission(node);
        }
        const nextPayload={...(node.decision_payload||{})};
        delete nextPayload.synthesis_complete;
        delete nextPayload.synthesis_outcome;
        delete nextPayload.synthesis_reason;
        delete nextPayload.synthesis_provenance_review;
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'split',
          decisionType:'SPLIT',
          decisionPayload:{
            ...nextPayload,
            synthesis_cursor:0,
            synthesis_accumulator:{},
            synthesis_rebuild_reason:'legacy_child_requires_deterministic_revalidation',
            synthesis_rebuild_at:new Date().toISOString(),
          },
          contextPayload:node.context_payload||{},
          resultArtifact:null,
        });
        node.parent_path=parentPath;
        console.log('AAU_AUTONOMOUS_PARENT_REOPENED_FOR_LEGACY_CHILD_VERIFICATION',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          child_path:legacyChild.node_path,
        }));
      }else{
        return ensureCanonicalStageCandidateSubmission(node);
      }
    }
    if(node.node_status==='blocked')return node;

    // QDA already supplies exact problem boundaries. Materialize those
    // boundaries deterministically instead of spending model calls discovering them.
    if(node.node_path==='R'&&node.node_status==='pending'){
      const fastSplit=await ensureQdaCurriculumRootSplit(node);
      if(fastSplit?.node){
        node=fastSplit.node;
        node.parent_path=parentPath;
      }
    }

    for(let transitions=0;transitions<8;transitions++){
      const pendingSynthesisFailure=asObject(node?.decision_payload?.synthesis_failure);
      const synthesisRemediationInProgress=asObject(
        node?.decision_payload?.self_remediation_in_progress
      );
      const synthesisRemediationNonce=text(
        node?.decision_payload?.synthesis_remediation_nonce
      );
      if(
        Object.keys(pendingSynthesisFailure).length
        &&!Object.keys(synthesisRemediationInProgress).length
        &&!synthesisRemediationNonce
        &&(node.node_status==='split'||node.decision_type==='SPLIT')
      ){
        node=await saveNode({
          nodePath:node.node_path,
          parentPath:node.parent_path??parentPathOf(node.node_path),
          ordinal:node.ordinal||0,
          requirement:node.requirement_text,
          sourceKind:node.source_kind,
          sourceRef:node.source_ref,
          status:'pending',
          decisionType:null,
          decisionPayload:{
            ...(node.decision_payload||{}),
            reconsider_decomposition:true,
            synthesis_recovery_routing_required:true,
            synthesis_recovery_routing_at:new Date().toISOString(),
          },
          contextPayload:node.context_payload||{},
          resultArtifact:null,
        });
        node.parent_path=parentPath;
        console.log('AAU_SYNTHESIS_FAILURE_ROUTING_PRECEDENCE',JSON.stringify({
          agent_id:agentId,
          intent_execution_id:intentExecutionId,
          node_path:node.node_path,
          failure_type:text(pendingSynthesisFailure.failure_type)||null,
          policy:'synthesis_failure_precedes_stored_split_v0_1',
        }));
      }

      if(node.node_status==='split'||node.decision_type==='SPLIT'){
        let kids=(await children(node.node_path))
          .filter((child)=>String(child?.status||'')!=='cancelled')
          .sort((a,b)=>Number(a?.ordinal||0)-Number(b?.ordinal||0));
        let childAuthoringFinalized=Boolean(node?.decision_payload?.children_authored);
        const budgetConstrainedChildAuthoringIncomplete=Boolean(
          node?.decision_payload?.conserved_branch_economics_constraint_applied
        )&&Number(node?.decision_payload?.semantic_child_capacity_at_stop??-1)<1;
        if(childAuthoringFinalized&&budgetConstrainedChildAuthoringIncomplete){
          childAuthoringFinalized=false;
          console.log('AAU_BUDGET_CONSTRAINED_CHILD_AUTHORING_CONTINUATION_REQUIRED',JSON.stringify({
            agent_id:agentId,
            intent_execution_id:intentExecutionId,
            node_path:node.node_path,
            existing_child_count:kids.length,
            policy:'budget_exhaustion_cannot_imply_semantic_coverage_v0_1',
          }));
        }
        if(!childAuthoringFinalized){
          const authoredResult=await authorChildren(node,{branchDepth,singleChildRefinements});
          if(authoredResult?.reconsider){
            node=authoredResult.node;
            node.parent_path=parentPath;
            continue;
          }
          kids=asArray(authoredResult?.children);
        }
        if(!kids.length)
          throw new Error('autonomous_decomposition_split_requires_child:'+node.node_path);
        const completed=[];
        const qdaExecution=qdaRootProblemExecutionPlan(node,kids);
        if(qdaExecution){
          const begun=Date.now();
          const resolvedByOrdinal=new Map();
          let waveCount=0;
          let peakParallelism=0;
          const remaining=new Map(
            qdaExecution.plan.children.map(spec=>[
              spec.ordinal,{spec,child:qdaExecution.byOrdinal.get(spec.ordinal)}
            ])
          );

          while(remaining.size){
            const ready=[...remaining.values()]
              .filter(({spec})=>spec.depends_on.every(dep=>resolvedByOrdinal.has(dep)))
              .sort((x,y)=>x.spec.ordinal-y.spec.ordinal);
            if(!ready.length)
              throw new Error('qda_curriculum_dependency_cycle:'+qdaExecution.plan.unit_code);
            const wave=ready.slice(0,qdaExecution.plan.max_parallelism);
            waveCount++;
            peakParallelism=Math.max(peakParallelism,wave.length);

            const settled=await Promise.allSettled(wave.map(async({spec,child})=>{
              child.parent_path=node.node_path;
              const dependencies=spec.depends_on
                .map(dep=>resolvedByOrdinal.get(dep))
                .filter(Boolean);
              const inherited=inheritedChildContext(node.context_payload);
              if(dependencies.length||Object.keys(inherited).length){
                const current=await getNode(child.node_path);
                if(current?.status!=='ready')
                  throw new Error('autonomous_decomposition_child_lookup_failed:'+child.node_path);
                const routed=await saveNode({
                  nodePath:current.node_path,
                  parentPath:node.node_path,
                  ordinal:current.ordinal||child.ordinal||0,
                  requirement:current.requirement_text,
                  sourceKind:current.source_kind||child.source_kind||'qda_curriculum_problem',
                  sourceRef:current.source_ref??child.source_ref??node.node_path,
                  status:current.node_status,
                  decisionType:current.decision_type??null,
                  decisionPayload:{
                    ...(current.decision_payload||{}),
                    qda_problem_dependencies:spec.depends_on,
                    qda_dependency_wave:waveCount,
                  },
                  contextPayload:boundContextPayload({
                    ...(current.context_payload||{}),
                    ...inherited,
                    ...(dependencies.length?{
                      completed_sibling_results:compactCompletedSiblingResults(dependencies),
                      dependency_context_contract:'qda_curriculum_explicit_problem_dependency_v0_1',
                    }:{}),
                  }),
                  resultArtifact:current.result_artifact||null,
                });
                routed.parent_path=node.node_path;
              }
              const done=await process(
                child.node_path,
                node.node_path,
                pathDepth(child.node_path),
                0
              );
              if(done.node_status!=='completed'&&done.node_status!=='blocked')
                throw new Error('autonomous_decomposition_child_not_resolved:'+child.node_path);
              return {ordinal:spec.ordinal,done};
            }));
            const failed=settled.find(row=>row.status==='rejected');
            if(failed)throw failed.reason;
            for(const row of settled){
              resolvedByOrdinal.set(row.value.ordinal,row.value.done);
              remaining.delete(row.value.ordinal);
            }
          }

          completed.push(...[...resolvedByOrdinal.entries()]
            .sort((x,y)=>x[0]-y[0])
            .map(([,done])=>done));
          console.log('AAU_QDA_CURRICULUM_PARALLEL_CHILDREN_RESOLVED',JSON.stringify({
            agent_id:agentId,
            intent_execution_id:intentExecutionId,
            unit_code:qdaExecution.plan.unit_code,
            child_count:completed.length,
            dependency_waves:waveCount,
            peak_parallelism:peakParallelism,
            elapsed_ms:Date.now()-begun,
            child_paths:completed.map(child=>child.node_path),
            policy:'qda_dependency_aware_parallel_v0_1',
          }));
        }else{
          for(const child of kids){
            child.parent_path=node.node_path;
            const inherited=inheritedChildContext(node.context_payload);
            if(completed.length||Object.keys(inherited).length){
              const current=await getNode(child.node_path);
              if(current?.status!=='ready')throw new Error('autonomous_decomposition_child_lookup_failed:'+child.node_path);
              const routed=await saveNode({
                nodePath:current.node_path,
                parentPath:node.node_path,
                ordinal:current.ordinal||child.ordinal||0,
                requirement:current.requirement_text,
                sourceKind:current.source_kind||child.source_kind||'agent_decomposition',
                sourceRef:current.source_ref??child.source_ref??node.node_path,
                status:current.node_status,
                decisionType:current.decision_type??null,
                decisionPayload:current.decision_payload||{},
                contextPayload:boundContextPayload({
                  ...(current.context_payload||{}),
                  ...inherited,
                  ...(completed.length?{completed_sibling_results:compactCompletedSiblingResults(completed)}:{}),
                }),
                resultArtifact:current.result_artifact||null,
              });
              routed.parent_path=node.node_path;
            }
            const done=await process(
              child.node_path,
              node.node_path,
              pathDepth(child.node_path),
              0
            );
            if(done.node_status!=='completed'&&done.node_status!=='blocked')
              throw new Error('autonomous_decomposition_child_not_resolved:'+child.node_path);
            completed.push(done);
          }
        }
        return synthesize(node,completed);
      }

      const forceReconsider=Boolean(node?.decision_payload?.reconsider_decomposition);
      if(qdaDirectProblemFastAtomic(node,parentPath)){
        const result=await executeAtomic(node);
        node=result.node;
        node.parent_path=parentPath;
        if(result.completed)return node;
        if(result.split||result.reconsider)continue;
      }
      const decision=await decide(node,{forceReconsider,branchDepth,singleChildRefinements});
      node=decision.node;
      node.parent_path=parentPath;

      if(decision.decision==='SPLIT')continue;
      if(decision.decision==='BLOCKED')return node;
      if(decision.decision==='ATOMIC'){
        const result=await executeAtomic(node);
        node=result.node;
        node.parent_path=parentPath;
        if(result.completed)return node;
        if(result.split||result.reconsider)continue;
      }
    }

    // The per-call transition cap bounds one worker invocation only. It must
    // never become a lifecycle-fatal cognition fault while the conserved
    // semantic epoch is still active. Durable state has already been saved;
    // re-arm the same intent and let the systemic wake fingerprint/cycle-lock
    // decide whether repeated continuation without material progress is truly
    // terminal.
    const continuationRuntime=await semanticRuntimeView();
    if(String(continuationRuntime?.runtime_status||continuationRuntime?.status||'')==='active'){
      const error=new Error('cognition_semantic_continuation_required:'+nodePath);
      error.code='COGNITION_SEMANTIC_CONTINUATION_REQUIRED';
      error.semanticRuntime=continuationRuntime;
      error.semanticContinuation={
        node_path:nodePath,
        remaining_budget_units:Number(continuationRuntime?.remaining_budget_units||0),
        transition_count:Number(continuationRuntime?.transition_count||0),
        material_transition_count:Number(continuationRuntime?.material_transition_count||0),
        policy:'local_transition_cap_yields_to_systemic_semantic_runtime_v0_1',
      };
      throw error;
    }
    throw new Error('autonomous_decomposition_transition_limit:'+nodePath);
  }

  let root=await getNode('R');
  if(root?.status==='not_found'){
    await chargeSemanticRuntime({
      eventKind:'semantic_node_created',
      materialKey:'R:'+sha256(rootReq.requirement),
      nodePath:'R',
      costUnits:semanticRuntime.node_create_units,
      eventFingerprint:sha256({node_path:'R',requirement:rootReq.requirement}),
      metadata:{root:true},
    });
    root=await saveNode({
      nodePath:'R',parentPath:null,ordinal:0,
      requirement:rootReq.requirement,sourceKind:rootReq.source_kind,sourceRef:rootReq.source_ref,
      status:'pending',decisionType:null,
      decisionPayload:{authored_decomposition_required:true},
      contextPayload:{},resultArtifact:null,
    });
  }else if(root?.status!=='ready'){
    throw new Error('autonomous_decomposition_root_lookup_failed');
  }else{
    const currentRequirementHash=sha256(rootReq.requirement);
    const rootSourceKind=text(root?.source_kind);
    const rootSourceRef=text(root?.source_ref);
    if(root.requirement_hash!==currentRequirementHash
       || rootSourceKind!==text(rootReq.source_kind)
       || rootSourceRef!==text(rootReq.source_ref)){
      const error=new Error('autonomous_decomposition_root_assignment_drift');
      error.code='COGNITION_ASSIGNMENT_DRIFT';
      error.assignmentDrift={
        assignment_key:assignmentKey,
        expected_requirement_hash:currentRequirementHash,
        observed_requirement_hash:root.requirement_hash||null,
        expected_source_kind:rootReq.source_kind||null,
        observed_source_kind:rootSourceKind||null,
        expected_source_ref:rootReq.source_ref||null,
        observed_source_ref:rootSourceRef||null,
      };
      throw error;
    }
  }

  if(String(semanticRuntimeSnapshot?.runtime_status||'')==='blocked'
     &&root.node_status!=='blocked'
     &&root.node_status!=='completed'){
    const error=new Error('semantic_runtime_terminal:cycle_lock:'+assignmentKey);
    error.code='SEMANTIC_RUNTIME_CYCLE_LOCK';
    error.semanticRuntime=semanticRuntimeSnapshot;
    throw error;
  }

  if(root.node_status!=='completed'&&root.node_status!=='blocked'){
    const wakeRuntimeView=await semanticRuntimeView();
    const wakeStateFingerprint=sha256({
      material_transition_count:Number(wakeRuntimeView?.material_transition_count||0),
      semantic_node_count:Number(wakeRuntimeView?.semantic_node_count||0),
      root_status:root.node_status||null,
      root_decision_type:root.decision_type||null,
      root_result_hash:root.result_hash||null,
      root_updated_at:root.updated_at||null,
      root_decision_payload:root.decision_payload||{},
      root_context_hash:sha256(root.context_payload||{}),
    });
    const wakeCharge=await chargeSemanticRuntime({
      eventKind:'wake_resume',
      materialKey:String(intentExecutionId),
      nodePath:'R',
      costUnits:1,
      eventFingerprint:wakeStateFingerprint,
      metadata:{root_status:root.node_status||null},
    });
    const cycleLocked=repeatedStructuralFailureLocked({
      repeatCount:Number(wakeCharge?.fingerprint_repeat_count||0),
      currentMaterialFingerprint:wakeStateFingerprint,
      lockedMaterialFingerprint:wakeStateFingerprint,
      limit:semanticRuntime.identical_structural_failure_limit+1,
    });
    if(cycleLocked){
      await closeSemanticRuntime('blocked',{
        block_reason:'repeated_wake_without_material_state_progress',
        repeated_state_fingerprint:wakeStateFingerprint,
        repeat_count:Number(wakeCharge?.fingerprint_repeat_count||0),
      });
      const error=new Error('semantic_runtime_cycle_lock:'+assignmentKey);
      error.code='SEMANTIC_RUNTIME_CYCLE_LOCK';
      error.semanticRuntime=semanticRuntimeSnapshot;
      throw error;
    }
  }

  let completedRoot;
  try{
    completedRoot=await process('R',null,0,0);
  }catch(error){
    if(error?.code==='SEMANTIC_BUDGET_EXHAUSTED'){
      semanticRuntimeSnapshot=await semanticRuntimeView().catch(()=>semanticRuntimeSnapshot);
    }
    throw error;
  }

  if(completedRoot.node_status==='completed'||completedRoot.node_status==='blocked'){
    semanticRuntimeSnapshot=await closeSemanticRuntime(
      completedRoot.node_status==='blocked'?'blocked':'complete',
      {
        root_node_id:completedRoot.node_id,
        root_status:completedRoot.node_status,
        root_result_hash:completedRoot.result_hash||null,
      }
    );
  }
  const parts=resultParts(completedRoot.result_artifact);
  if(!parts.artifact)throw new Error('autonomous_decomposition_root_artifact_empty');
  const authoritativeRootChildRefs=(await children('R'))
    .filter(child=>String(child?.status||child?.node_status||'')!=='cancelled')
    .sort((a,b)=>Number(a?.ordinal||0)-Number(b?.ordinal||0));
  const authoritativeRootChildren=[];
  for(const childRef of authoritativeRootChildRefs){
    const child=await getNode(childRef.node_path);
    if(child?.status!=='ready')continue;
    const decision=asObject(child.decision_payload);
    let resultArtifact=child.result_artifact||null;
    let statisticalVerified=decision.deterministic_statistics_verified===true;
    let statisticalCount=Number(decision.deterministic_statistics_analysis_count||0);
    let statisticalDescendantMaterialized=false;
    if(qdaStatisticalAtomicRequirement(packet,child)){
      const parts=resultParts(resultArtifact);
      const direct=pythonAnalysesFromArtifact(parts.artifact);
      if(!(direct?.type_ok===true&&asArray(direct.value).length)){
        const recovered=await verifiedStatAnalysesBelow(child.node_path);
        if(recovered.length){
          let parsed=null;
          try{parsed=JSON.parse(String(parts.artifact||''));}catch{}
          if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed)){
            parsed={...parsed,python_analyses:recovered};
            resultArtifact=JSON.stringify({status:'COMPLETE',artifact:parsed,handoff:parts.handoff});
            statisticalVerified=true;
            statisticalCount=recovered.length;
            statisticalDescendantMaterialized=true;
          }
        }
      }
    }
    authoritativeRootChildren.push({
      node_path:child.node_path,
      status:child.node_status||null,
      decision_type:child.decision_type||null,
      requirement_text:child.requirement_text||null,
      result_hash:child.result_hash||null,
      result_artifact:resultArtifact,
      deterministic_math_verified:decision.deterministic_math_verified===true
        ||String(decision.deterministic_math_verified||'').toLowerCase()==='true'
        ||decision.qda_verified_descendant_materialized===true
        ||String(decision.qda_verified_descendant_materialized||'').toLowerCase()==='true',
      deterministic_math_check_count:Math.max(
        Number(decision.deterministic_math_check_count||0),
        Number(decision.qda_verified_descendant_check_count||0)
      ),
      deterministic_statistics_verified:statisticalVerified,
      deterministic_statistics_analysis_count:statisticalCount,
      qda_verified_descendant_materialized:
        decision.qda_verified_descendant_materialized===true
        ||String(decision.qda_verified_descendant_materialized||'').toLowerCase()==='true'
        ||statisticalDescendantMaterialized,
      qda_verified_descendant_check_count:
        Number(decision.qda_verified_descendant_check_count||0),
    });
  }

  return {
    artifact:parts.artifact,
    authoritative_children:authoritativeRootChildren,
    meta:{
      contract:'autonomous_recursive_decomposition_v0_2',
      assignment_key:assignmentKey,
      root_node_id:completedRoot.node_id,
      root_requirement_hash:completedRoot.requirement_hash,
      root_source_kind:rootReq.source_kind,
      root_source_ref:rootReq.source_ref,
      nodes_touched:counters.nodes,
      model_calls:counters.model_calls,
      context_requests:counters.context_requests,
      convergence_policy:'conserved_work_budget_v0_2_with_emergency_storage_depth_only',
      cognitive_continuity_policy:'agent_discovery_restore_and_reconcile_v0_1',
      routing_protocol:'deep_discovery_then_commit_v0_1',
      decomposition_authored_by_bound_agent:true,
      runtime_role:'semantic_tree_persistence_plus_separate_execution_budget_ledger',
      cognition_mode:modeInfo?.mode||'deep',
      root_status:completedRoot.node_status||null,
      root_decision_type:completedRoot.decision_type||null,
      context_resource_policy:'agent_visible_progress_based_context_resource_v0_1',
      evidence_retention_policy:'pinned_research_evidence_v0_1_outside_context_eviction',
      sibling_evidence_handoff_policy:'authoritative_completed_sibling_evidence_v0_1_attention_accounted',
      self_remediation_policy:'agent_authored_cognitive_self_remediation_v0_1_bounded_verified',
      child_authoring_protocol:'deep_formulation_checkpoint_then_nonthinking_serialization_v0_1',
      child_authoring_failure_policy:'durable_rejected_attempt_then_agent_reconsideration_v0_1',
      atomic_execution_budget_policy:'dedicated_deep_budget_v0_1_7000',
      atomic_reconciliation_budget_policy:'dedicated_deep_budget_v0_1_5000',
      synthesis_merge_budget_policy:'dedicated_deep_budget_v0_1_6000_with_bounded_retry',
      synthesis_final_budget_policy:'dedicated_deep_budget_v0_1_7000_with_bounded_retry',
      model_context_policy:'model_profile_token_context_v0_2_in_memory_model_view_durable_catalog_rehydration',
      model_runtime_contract_version:'model_runtime_profiles_v0_2',
      model_runtime_variables:{
        context_window_tokens:agentRuntimeContract.context_window_tokens??null,
        operational_context_limit_tokens:agentRuntimeContract.operational_context_limit_tokens??null,
        max_output_tokens:agentRuntimeContract.max_output_tokens??null,
        operational_output_limit_tokens:agentRuntimeContract.operational_output_limit_tokens??null,
        request_timeout_ms:agentRuntimeContract.request_timeout_ms??null,
        max_request_timeout_ms:agentRuntimeContract.max_request_timeout_ms??null,
        reasoning_support:agentRuntimeContract.reasoning_support??null,
        supports_thinking:agentRuntimeContract.supports_thinking===true,
        reasoning_counts_against_output:agentRuntimeContract.reasoning_counts_against_output===true,
      },
      stage_output_budgets:stageBudgets,
      node_checkpoint_transport_policy:'envelope_aware_context_compaction_v0_1_220000_bytes',
      research_batch_handoff_policy:'requirement_linked_durable_receipts_v0_1',
      semantic_runtime_contract:SEMANTIC_RUNTIME_CONTRACT,
      semantic_runtime_epoch:semanticRuntime.epoch_no,
      semantic_runtime_budget_quantum_tokens:semanticRuntime.quantum_tokens,
      semantic_runtime_initial_budget_units:semanticRuntime.initial_budget_units,
      semantic_runtime_remaining_budget_units:Number(semanticRuntimeSnapshot?.remaining_budget_units||0),
      semantic_runtime_transition_count:Number(semanticRuntimeSnapshot?.transition_count||0),
      semantic_runtime_semantic_node_count:Number(semanticRuntimeSnapshot?.semantic_node_count||0),
      semantic_runtime_status:semanticRuntimeSnapshot?.runtime_status||null,
    },
  };
}
