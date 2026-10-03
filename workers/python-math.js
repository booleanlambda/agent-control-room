import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PYTHON_RUNNER = fileURLToPath(new URL('./python-math-runner.py', import.meta.url));
export const PYTHON_MATH_MAX_CHECKS=64;
const MAX_CHECKS=PYTHON_MATH_MAX_CHECKS;
const MAX_EXPR_CHARS=600;

function plainObject(value){
  return Boolean(value && typeof value==='object' && !Array.isArray(value));
}
function finiteNumber(value){
  return typeof value==='number' && Number.isFinite(value);
}
export function validatePythonMathChecks(checks){
  const failures=[];
  if(!Array.isArray(checks)){
    return {ok:false,failures:[{path:'python_checks',code:'array_required',actual_type:typeof checks}]};
  }
  if(checks.length<1) failures.push({path:'python_checks',code:'nonempty_required'});
  if(checks.length>MAX_CHECKS) failures.push({path:'python_checks',code:'too_many_checks',max:MAX_CHECKS,received:checks.length});
  checks.forEach((check,index)=>{
    const base='python_checks['+index+']';
    if(!plainObject(check)){
      failures.push({path:base,code:'object_required',actual_type:Array.isArray(check)?'array':typeof check});
      return;
    }
    if(typeof check.label!=='string' || !check.label.trim()){
      failures.push({path:base+'.label',code:'nonempty_string_required',actual_type:typeof check.label});
    }else if(check.label.length>120){
      failures.push({path:base+'.label',code:'string_too_long',max:120,received:check.label.length});
    }
    if(typeof check.expression!=='string' || !check.expression.trim()){
      failures.push({path:base+'.expression',code:'nonempty_string_required',actual_type:typeof check.expression});
    }else if(check.expression.length>MAX_EXPR_CHARS){
      failures.push({path:base+'.expression',code:'string_too_long',max:MAX_EXPR_CHARS,received:check.expression.length});
    }
    if(!finiteNumber(check.claimed_result)){
      failures.push({
        path:base+'.claimed_result',
        code:'finite_json_number_required',
        actual_type:Array.isArray(check.claimed_result)?'array':typeof check.claimed_result
      });
    }
    if(check.problem!==undefined && typeof check.problem!=='string'){
      failures.push({path:base+'.problem',code:'string_required',actual_type:typeof check.problem});
    }
  });
  return {ok:failures.length===0,failures};
}

function tolerance(value,fallback,name){
  if(value===undefined)return {ok:true,value:fallback};
  if(!finiteNumber(value) || value<0){
    return {ok:false,error:name+'_must_be_nonnegative_finite_number'};
  }
  return {ok:true,value};
}

// Treat the configured absolute tolerance as a ceiling, not a blanket license.
// Currency rounded to 2 decimals can still use a half-cent tolerance, while a
// probability claimed to 7 decimals must agree at that precision.
function claimedDecimalPlaces(value){
  if(!finiteNumber(value))return 0;
  const raw=String(Math.abs(value)).toLowerCase();
  const parts=raw.split('e');
  const coefficient=parts[0];
  const exponent=parts.length>1?Number(parts[1]):0;
  const fraction=(coefficient.split('.')[1]||'').length;
  return Math.max(0,fraction-(Number.isFinite(exponent)?exponent:0));
}
function precisionAwareAbsoluteTolerance(value,cap){
  const places=claimedDecimalPlaces(value);
  if(places<=0)return Math.min(cap,1e-9);
  const halfUnit=0.5*Math.pow(10,-places);
  return Math.min(cap,Math.max(1e-12,halfUnit));
}

export function verifyPythonMathChecks(checks, options = {}) {
  const contract=validatePythonMathChecks(checks);
  if(!contract.ok){
    return {
      ok:false,
      failure_class:'input_contract',
      all_match:false,
      error:'python_check_contract_invalid',
      validation_failures:contract.failures,
      check_count:Array.isArray(checks)?checks.length:0,
      results:[],
    };
  }

  const abs=tolerance(options.absoluteTolerance,1e-8,'absolute_tolerance');
  const rel=tolerance(options.relativeTolerance,1e-8,'relative_tolerance');
  if(!abs.ok || !rel.ok){
    return {
      ok:false,
      failure_class:'input_contract',
      all_match:false,
      error:abs.error||rel.error,
      validation_failures:[],
      check_count:checks.length,
      results:[],
    };
  }

  const payload = {
    checks:checks.map(check=>({
      label:check.label,
      expression:check.expression,
      claimed_result:check.claimed_result,
      runtime_absolute_tolerance:precisionAwareAbsoluteTolerance(check.claimed_result,abs.value),
      ...(typeof check.problem==='string'?{problem:check.problem}:{}),
    })),
    absolute_tolerance:abs.value,
    relative_tolerance:rel.value,
  };

  const result = spawnSync('python3', [PYTHON_RUNNER], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) {
    return {ok:false,failure_class:'runtime',all_match:false,error:'python_runtime_error:'+String(result.error.message || result.error),check_count:0,results:[]};
  }

  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || '').trim());
  } catch {
    return {ok:false,failure_class:'runtime_contract',all_match:false,error:'python_runtime_invalid_json',check_count:0,results:[]};
  }

  if (result.status !== 0 || parsed?.ok !== true) {
    return {
      ok:false,
      failure_class:String(parsed?.failure_class||'runtime'),
      all_match:false,
      error:String(parsed?.error || result.stderr || 'python_runtime_failed').slice(0,300),
      check_count:Number.isInteger(parsed?.check_count) ? parsed.check_count : 0,
      results:Array.isArray(parsed?.results) ? parsed.results : [],
    };
  }

  const results=Array.isArray(parsed.results)?parsed.results:[];
  const structurallyValid=Number.isInteger(parsed.check_count)
    && parsed.check_count===checks.length
    && results.length===checks.length
    && results.every((row,index)=>plainObject(row)
      &&row.index===index
      &&typeof row.valid==='boolean'
      &&typeof row.matched==='boolean');

  if(!structurallyValid){
    return {
      ok:false,
      failure_class:'runtime_contract',
      all_match:false,
      error:'python_runtime_result_contract_invalid',
      check_count:Number.isInteger(parsed?.check_count)?parsed.check_count:0,
      results,
    };
  }

  return {
    ok:true,
    failure_class:null,
    all_match:parsed.all_match === true,
    all_valid:parsed.all_valid === true,
    validation_error_count:Number.isInteger(parsed.validation_error_count)?parsed.validation_error_count:0,
    check_count:parsed.check_count,
    results,
  };
}

export function verifyPythonMathChecksChunked(checks, options = {}) {
  if(!Array.isArray(checks) || checks.length<=MAX_CHECKS){
    const single=verifyPythonMathChecks(checks,options);
    return {
      ...single,
      chunked:false,
      batch_count:Array.isArray(checks)&&checks.length?1:0,
      batch_size_limit:MAX_CHECKS,
      batches:Array.isArray(checks)&&checks.length?[{
        batch_index:0,
        offset:0,
        check_count:single.check_count,
        ok:single.ok===true,
        all_match:single.all_match===true,
        all_valid:single.all_valid===true,
        error:single.error||null,
      }]:[],
    };
  }

  const results=[];
  const validationFailures=[];
  const batches=[];
  let allOk=true;
  let allMatch=true;
  let allValid=true;
  let validationErrorCount=0;
  let firstFailure=null;

  for(let offset=0,batchIndex=0;offset<checks.length;offset+=MAX_CHECKS,batchIndex+=1){
    const slice=checks.slice(offset,offset+MAX_CHECKS);
    const verified=verifyPythonMathChecks(slice,options);
    batches.push({
      batch_index:batchIndex,
      offset,
      requested_check_count:slice.length,
      check_count:verified.check_count,
      ok:verified.ok===true,
      all_match:verified.all_match===true,
      all_valid:verified.all_valid===true,
      failure_class:verified.failure_class||null,
      error:verified.error||null,
    });

    for(const row of Array.isArray(verified.results)?verified.results:[]){
      results.push({
        ...row,
        index:Number.isInteger(row?.index)?row.index+offset:row?.index,
        batch_index:batchIndex,
      });
    }
    for(const failure of Array.isArray(verified.validation_failures)?verified.validation_failures:[]){
      const originalPath=String(failure?.path||'');
      const path=originalPath.replace(
        /^python_checks\[(\d+)\]/,
        (_,index)=>'python_checks['+(Number(index)+offset)+']'
      );
      validationFailures.push({...failure,path,batch_index:batchIndex});
    }

    validationErrorCount+=Number(verified.validation_error_count||0);
    if(verified.ok!==true || verified.all_match!==true || verified.all_valid===false){
      allOk=false;
      allMatch=false;
      if(verified.all_valid===false)allValid=false;
      if(!firstFailure)firstFailure={batch_index:batchIndex,...verified};
    }
  }

  return {
    ok:allOk,
    failure_class:firstFailure?.failure_class||null,
    all_match:allMatch,
    all_valid:allValid,
    validation_error_count:validationErrorCount,
    check_count:checks.length,
    results,
    validation_failures:validationFailures,
    error:firstFailure
      ?'python_check_chunk_failed:batch='+firstFailure.batch_index+':'+String(firstFailure.error||'verification_failed')
      :null,
    chunked:true,
    batch_count:batches.length,
    batch_size_limit:MAX_CHECKS,
    batches,
  };
}

