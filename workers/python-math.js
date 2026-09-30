import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PYTHON_RUNNER = fileURLToPath(new URL('./python-math-runner.py', import.meta.url));
const MAX_CHECKS=64;
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
