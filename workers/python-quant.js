import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const QUANT_RUNNER = fileURLToPath(new URL('./python-quant-runner.py', import.meta.url));
export const PYTHON_STATISTICAL_MAX_ANALYSES=32;
const MAX_ANALYSES=PYTHON_STATISTICAL_MAX_ANALYSES;

export const PYTHON_STATISTICAL_ANALYSES = Object.freeze([
  'describe',
  'pearson_correlation',
  'simple_linear_regression',
  'proportion_ci',
  'difference_proportions_ci',
  'mean_ci',
  'one_sample_t',
  'welch_t',
  'coefficient_t',
  'bootstrap_ci',
  'monte_carlo_expression',
]);

function plainObject(value){
  return Boolean(value && typeof value==='object' && !Array.isArray(value));
}
function finiteNumber(value){
  return typeof value==='number' && Number.isFinite(value);
}
export function validatePythonStatisticalAnalyses(analyses){
  const failures=[];
  if(!Array.isArray(analyses)){
    return {ok:false,failures:[{path:'python_analyses',code:'array_required',actual_type:typeof analyses}]};
  }
  if(analyses.length<1)failures.push({path:'python_analyses',code:'nonempty_required'});
  if(analyses.length>MAX_ANALYSES)failures.push({path:'python_analyses',code:'too_many_analyses',max:MAX_ANALYSES,received:analyses.length});
  analyses.forEach((row,index)=>{
    const base='python_analyses['+index+']';
    if(!plainObject(row)){
      failures.push({path:base,code:'object_required',actual_type:Array.isArray(row)?'array':typeof row});
      return;
    }
    if(typeof row.id!=='string'||!row.id.trim())failures.push({path:base+'.id',code:'nonempty_string_required',actual_type:typeof row.id});
    if(typeof row.analysis!=='string'||!row.analysis.trim())failures.push({path:base+'.analysis',code:'nonempty_string_required',actual_type:typeof row.analysis});
    else if(!PYTHON_STATISTICAL_ANALYSES.includes(row.analysis.trim()))failures.push({path:base+'.analysis',code:'analysis_not_allowed',value:row.analysis});
    if(!plainObject(row.spec))failures.push({path:base+'.spec',code:'object_required',actual_type:Array.isArray(row.spec)?'array':typeof row.spec});
    if(!plainObject(row.claims)||Object.keys(row.claims).length<1)failures.push({path:base+'.claims',code:'nonempty_object_required',actual_type:Array.isArray(row.claims)?'array':typeof row.claims});
  });
  return {ok:failures.length===0,failures};
}
function optionNumber(value,fallback,name,{integer=false,positive=false}={}){
  if(value===undefined)return {ok:true,value:fallback};
  if(!finiteNumber(value))return {ok:false,error:name+'_must_be_finite_number'};
  if(integer&&!Number.isInteger(value))return {ok:false,error:name+'_must_be_integer'};
  if(positive&&value<=0)return {ok:false,error:name+'_must_be_positive'};
  if(!positive&&value<0)return {ok:false,error:name+'_must_be_nonnegative'};
  return {ok:true,value};
}

export function runPythonStatisticalAnalyses(analyses, options = {}) {
  const contract=validatePythonStatisticalAnalyses(analyses);
  if(!contract.ok){
    return {
      ok:false,
      failure_class:'input_contract',
      engine:'aau_quantitative_python_v0_1',
      all_claims_match:false,
      error:'python_statistical_contract_invalid',
      validation_failures:contract.failures,
      analysis_count:Array.isArray(analyses)?analyses.length:0,
      analyses:[],
    };
  }
  const abs=optionNumber(options.absoluteTolerance,1e-8,'absolute_tolerance');
  const rel=optionNumber(options.relativeTolerance,1e-8,'relative_tolerance');
  const timeout=optionNumber(options.timeoutMs,12000,'timeout_ms',{integer:true,positive:true});
  if(!abs.ok||!rel.ok||!timeout.ok){
    return {
      ok:false,failure_class:'input_contract',engine:'aau_quantitative_python_v0_1',
      all_claims_match:false,error:abs.error||rel.error||timeout.error,
      analysis_count:analyses.length,analyses:[]
    };
  }

  const payload = {
    analyses,
    absolute_tolerance:abs.value,
    relative_tolerance:rel.value,
  };

  const result = spawnSync('python3', [QUANT_RUNNER], {
    input:JSON.stringify(payload),
    encoding:'utf8',
    timeout:timeout.value,
    maxBuffer:2 * 1024 * 1024,
    windowsHide:true,
  });

  if (result.error) {
    return {
      ok:false,failure_class:'runtime',engine:'aau_quantitative_python_v0_1',
      all_claims_match:false,error:'python_quant_runtime_error:'+String(result.error.message || result.error),
      analysis_count:0,analyses:[],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || '').trim());
  } catch {
    return {
      ok:false,failure_class:'runtime_contract',engine:'aau_quantitative_python_v0_1',
      all_claims_match:false,error:'python_quant_runtime_invalid_json',
      analysis_count:0,analyses:[],
    };
  }

  if (result.status !== 0 || parsed?.ok !== true) {
    return {
      ok:false,
      failure_class:String(parsed?.failure_class||'runtime'),
      engine:String(parsed?.engine || 'aau_quantitative_python_v0_1'),
      all_claims_match:false,
      error:String(parsed?.error || result.stderr || 'python_quant_runtime_failed').slice(0,500),
      analysis_count:Number.isInteger(parsed?.analysis_count) ? parsed.analysis_count : 0,
      analyses:Array.isArray(parsed?.analyses) ? parsed.analyses : [],
    };
  }

  const rows=Array.isArray(parsed.analyses)?parsed.analyses:[];
  if(!Number.isInteger(parsed.analysis_count)
     ||parsed.analysis_count!==analyses.length
     ||rows.length!==analyses.length){
    return {
      ok:false,failure_class:'runtime_contract',engine:'aau_quantitative_python_v0_1',
      all_claims_match:false,error:'python_quant_result_contract_invalid',
      analysis_count:Number.isInteger(parsed?.analysis_count)?parsed.analysis_count:0,
      analyses:rows,
    };
  }

  return {
    ok:true,
    failure_class:null,
    engine:String(parsed.engine || 'aau_quantitative_python_v0_1'),
    all_claims_match:parsed.all_claims_match === true,
    analysis_count:parsed.analysis_count,
    analyses:rows,
  };
}


export function runPythonStatisticalAnalysesChunked(analyses, options = {}) {
  if(!Array.isArray(analyses) || analyses.length<=MAX_ANALYSES){
    const single=runPythonStatisticalAnalyses(analyses,options);
    return {
      ...single,
      chunked:false,
      batch_count:Array.isArray(analyses)&&analyses.length?1:0,
      batch_size_limit:MAX_ANALYSES,
      batches:Array.isArray(analyses)&&analyses.length?[{
        batch_index:0,
        offset:0,
        requested_analysis_count:analyses.length,
        analysis_count:single.analysis_count,
        ok:single.ok===true,
        all_claims_match:single.all_claims_match===true,
        failure_class:single.failure_class||null,
        error:single.error||null,
      }]:[],
    };
  }

  const rows=[];
  const validationFailures=[];
  const batches=[];
  let allOk=true;
  let allClaimsMatch=true;
  let firstFailure=null;

  for(let offset=0,batchIndex=0;offset<analyses.length;offset+=MAX_ANALYSES,batchIndex+=1){
    const slice=analyses.slice(offset,offset+MAX_ANALYSES);
    const verified=runPythonStatisticalAnalyses(slice,options);
    batches.push({
      batch_index:batchIndex,
      offset,
      requested_analysis_count:slice.length,
      analysis_count:verified.analysis_count,
      ok:verified.ok===true,
      all_claims_match:verified.all_claims_match===true,
      failure_class:verified.failure_class||null,
      error:verified.error||null,
    });
    for(const row of Array.isArray(verified.analyses)?verified.analyses:[]){
      rows.push({
        ...row,
        index:Number.isInteger(row?.index)?row.index+offset:row?.index,
        batch_index:batchIndex,
      });
    }
    for(const failure of Array.isArray(verified.validation_failures)?verified.validation_failures:[]){
      const originalPath=String(failure?.path||'');
      const path=originalPath.replace(
        /^python_analyses\[(\d+)\]/,
        (_,index)=>'python_analyses['+(Number(index)+offset)+']'
      );
      validationFailures.push({...failure,path,batch_index:batchIndex});
    }
    if(verified.ok!==true || verified.all_claims_match!==true){
      if(verified.ok!==true)allOk=false;
      allClaimsMatch=false;
      if(!firstFailure)firstFailure={batch_index:batchIndex,...verified};
    }
  }

  return {
    ok:allOk,
    failure_class:firstFailure?.failure_class||null,
    engine:'aau_quantitative_python_v0_1',
    all_claims_match:allClaimsMatch,
    analysis_count:analyses.length,
    analyses:rows,
    validation_failures:validationFailures,
    error:firstFailure
      ?'python_statistics_chunk_failed:batch='+firstFailure.batch_index+':'+String(firstFailure.error||'claim_disagreement')
      :null,
    chunked:true,
    batch_count:batches.length,
    batch_size_limit:MAX_ANALYSES,
    batches,
  };
}
