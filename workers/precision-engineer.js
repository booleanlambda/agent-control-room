import { createHash } from 'node:crypto';
import { verifyPythonMathChecks } from './python-math.js';
import { runPythonStatisticalAnalyses, PYTHON_STATISTICAL_ANALYSES } from './python-quant.js';

export const PRECISION_ENGINEER_VERSION='aau_precision_engineer_v0_1';
export const PRECISION_SPEC_SCHEMA='aau.precision_spec.v0_1';
export const PRECISION_RESULT_SCHEMA='aau.precision_result.v0_1';


export function getPrecisionCapabilities(){
  return {
    engine:PRECISION_ENGINEER_VERSION,
    architecture:'deterministic_precision_substrate',
    spec_author:'originating_agent',
    secondary_model_required:false,
    offline_capable:true,
    arithmetic:{
      engine:'python3_safe_math_v0_1',
      operators:['+','-','*','/','%','**'],
      functions:['abs','round','sqrt','log','log10','exp'],
    },
    statistical:{
      engine:'aau_quantitative_python_v0_1',
      analyses:[...PYTHON_STATISTICAL_ANALYSES],
    },
    result_states:['VERIFIED','RECONCILE','NEED_CONTEXT','ESCALATE'],
  };
}

const text=value=>String(value??'').trim();
const asArray=value=>Array.isArray(value)?value:[];
const asObject=value=>(value && typeof value==='object' && !Array.isArray(value))?value:{};

function sha256(value){
  return createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
}

export function validatePrecisionSpec(spec){
  const failures=[];
  if(!spec || typeof spec!=='object' || Array.isArray(spec)) return {ok:false,failures:['precision_spec_object_required']};
  if(text(spec.schema)!==PRECISION_SPEC_SCHEMA) failures.push('precision_schema_invalid');
  if(!text(spec.job_id)) failures.push('precision_job_id_required');
  if(!text(spec.intent)) failures.push('precision_intent_required');

  const missing=asArray(spec.missing_information).map(text).filter(Boolean);
  const assumptions=asArray(spec.assumptions);
  if(!Array.isArray(spec.assumptions)) failures.push('precision_assumptions_array_required');
  if(!Array.isArray(spec.missing_information)) failures.push('precision_missing_information_array_required');

  const arithmetic=asArray(spec.arithmetic_checks);
  const analyses=asArray(spec.statistical_analyses);
  if(!arithmetic.length && !analyses.length && !missing.length) failures.push('precision_tool_work_required');

  arithmetic.forEach((check,index)=>{
    if(!text(check?.id||check?.label)) failures.push(`precision_arithmetic_${index+1}_id_required`);
    if(!text(check?.expression)) failures.push(`precision_arithmetic_${index+1}_expression_required`);
    if(check?.claimed_result===null || check?.claimed_result===undefined || text(check.claimed_result)==='' || !Number.isFinite(Number(check.claimed_result))) failures.push(`precision_arithmetic_${index+1}_numeric_claim_required`);
    if(!text(check?.unit)) failures.push(`precision_arithmetic_${index+1}_unit_required`);
  });

  const supported=new Set(PYTHON_STATISTICAL_ANALYSES);
  analyses.forEach((analysis,index)=>{
    if(!text(analysis?.id)) failures.push(`precision_statistical_${index+1}_id_required`);
    if(!supported.has(text(analysis?.analysis))) failures.push(`precision_statistical_${index+1}_analysis_unsupported`);
    if(!analysis?.spec || typeof analysis.spec!=='object' || Array.isArray(analysis.spec)) failures.push(`precision_statistical_${index+1}_spec_required`);
    if(!analysis?.claims || typeof analysis.claims!=='object' || Array.isArray(analysis.claims)) failures.push(`precision_statistical_${index+1}_claims_required`);
  });

  assumptions.forEach((assumption,index)=>{
    if(!assumption || typeof assumption!=='object' || Array.isArray(assumption)) failures.push(`precision_assumption_${index+1}_object_required`);
    else if(!text(assumption.statement)) failures.push(`precision_assumption_${index+1}_statement_required`);
  });

  return {ok:failures.length===0,failures};
}

export function buildPrecisionEscalation(spec,reason,details={}){
  return {
    schema:PRECISION_RESULT_SCHEMA,
    engine:PRECISION_ENGINEER_VERSION,
    job_id:text(spec?.job_id)||null,
    status:'ESCALATE',
    verified:false,
    reason:text(reason)||'precision_escalation_required',
    details:asObject(details),
    required_context:asArray(spec?.missing_information).map(text).filter(Boolean),
    source_spec_hash:sha256(spec||{}),
  };
}

export function executePrecisionSpec(spec,options={}){
  const validation=validatePrecisionSpec(spec);
  if(!validation.ok){
    return buildPrecisionEscalation(spec,'invalid_precision_spec',{validation_failures:validation.failures});
  }

  const missing=asArray(spec.missing_information).map(text).filter(Boolean);
  if(missing.length){
    return {
      schema:PRECISION_RESULT_SCHEMA,
      engine:PRECISION_ENGINEER_VERSION,
      job_id:text(spec.job_id),
      status:'NEED_CONTEXT',
      verified:false,
      reason:'underspecified_problem',
      required_context:missing,
      source_spec_hash:sha256(spec),
    };
  }

  const arithmeticChecks=asArray(spec.arithmetic_checks).map(check=>({
    label:text(check.id||check.label),
    expression:text(check.expression),
    claimed_result:Number(check.claimed_result),
  }));

  const arithmetic=arithmeticChecks.length
    ? verifyPythonMathChecks(arithmeticChecks,{
        absoluteTolerance:Number.isFinite(options.absoluteTolerance)?options.absoluteTolerance:1e-8,
        relativeTolerance:Number.isFinite(options.relativeTolerance)?options.relativeTolerance:1e-8,
      })
    : {ok:true,all_match:true,check_count:0,results:[]};

  if(!arithmetic.ok){
    return buildPrecisionEscalation(spec,'deterministic_arithmetic_runtime_unavailable',{
      arithmetic_error:arithmetic.error||null,
    });
  }

  const analyses=asArray(spec.statistical_analyses);
  const statistical=analyses.length
    ? runPythonStatisticalAnalyses(analyses,{
        absoluteTolerance:Number.isFinite(options.absoluteTolerance)?options.absoluteTolerance:1e-8,
        relativeTolerance:Number.isFinite(options.relativeTolerance)?options.relativeTolerance:1e-8,
        timeoutMs:Number.isFinite(options.statisticalTimeoutMs)?options.statisticalTimeoutMs:12000,
      })
    : {ok:true,all_claims_match:true,analysis_count:0,analyses:[],engine:'not_invoked'};

  if(!statistical.ok){
    return buildPrecisionEscalation(spec,'deterministic_statistical_runtime_unavailable',{
      statistical_error:statistical.error||null,
    });
  }

  const arithmeticById=new Map(asArray(spec.arithmetic_checks).map(check=>[text(check.id||check.label),check]));
  const arithmeticResults=asArray(arithmetic.results).map(result=>({
    id:text(result.label),
    matched:result.matched===true,
    claimed_result:result.claimed_result,
    deterministic_result:result.actual,
    unit:text(arithmeticById.get(text(result.label))?.unit)||null,
  }));

  const allMatch=arithmetic.all_match===true && statistical.all_claims_match===true;
  const mismatches=[
    ...arithmeticResults.filter(result=>!result.matched).map(result=>({
      type:'arithmetic',
      id:result.id,
      claimed_result:result.claimed_result,
      deterministic_result:result.deterministic_result,
      unit:result.unit,
    })),
    ...asArray(statistical.analyses).filter(result=>result?.claim_verification?.all_match===false).map(result=>({
      type:'statistical',
      id:result?.id||null,
      analysis:result?.analysis||null,
      result,
    })),
  ];

  return {
    schema:PRECISION_RESULT_SCHEMA,
    engine:PRECISION_ENGINEER_VERSION,
    job_id:text(spec.job_id),
    status:allMatch?'VERIFIED':'RECONCILE',
    verified:allMatch,
    intent:text(spec.intent),
    assumptions:asArray(spec.assumptions),
    arithmetic:{
      engine:'python3_safe_math_v0_1',
      all_match:arithmetic.all_match===true,
      check_count:arithmetic.check_count,
      results:arithmeticResults,
    },
    statistical:{
      engine:statistical.engine||'aau_quantitative_python_v0_1',
      all_claims_match:statistical.all_claims_match===true,
      analysis_count:statistical.analysis_count||0,
      analyses:asArray(statistical.analyses),
    },
    mismatches,
    reconciliation_instruction:allMatch
      ?null
      :'The originating agent must reconcile each mismatch. Do not silently replace its claim with the deterministic result.',
    source_spec_hash:sha256(spec),
    result_hash:sha256({arithmetic:arithmeticResults,statistical:statistical.analyses}),
  };
}
