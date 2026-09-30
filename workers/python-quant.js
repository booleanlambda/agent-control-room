import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const QUANT_RUNNER = fileURLToPath(new URL('./python-quant-runner.py', import.meta.url));

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

export function runPythonStatisticalAnalyses(analyses, options = {}) {
  if (!Array.isArray(analyses) || analyses.length < 1) {
    return {
      ok:false,
      engine:'aau_quantitative_python_v0_1',
      all_claims_match:false,
      error:'python_statistical_analyses_required',
      analysis_count:0,
      analyses:[],
    };
  }

  const payload = {
    analyses,
    absolute_tolerance:Number.isFinite(options.absoluteTolerance)
      ? options.absoluteTolerance : 1e-8,
    relative_tolerance:Number.isFinite(options.relativeTolerance)
      ? options.relativeTolerance : 1e-8,
  };

  const result = spawnSync('python3', [QUANT_RUNNER], {
    input:JSON.stringify(payload),
    encoding:'utf8',
    timeout:Number.isFinite(options.timeoutMs) ? options.timeoutMs : 12000,
    maxBuffer:2 * 1024 * 1024,
    windowsHide:true,
  });

  if (result.error) {
    return {
      ok:false,
      engine:'aau_quantitative_python_v0_1',
      all_claims_match:false,
      error:'python_quant_runtime_error:'+String(result.error.message || result.error),
      analysis_count:0,
      analyses:[],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || '').trim());
  } catch {
    return {
      ok:false,
      engine:'aau_quantitative_python_v0_1',
      all_claims_match:false,
      error:'python_quant_runtime_invalid_json',
      analysis_count:0,
      analyses:[],
    };
  }

  if (result.status !== 0 || parsed?.ok !== true) {
    return {
      ok:false,
      engine:String(parsed?.engine || 'aau_quantitative_python_v0_1'),
      all_claims_match:false,
      error:String(parsed?.error || result.stderr || 'python_quant_runtime_failed').slice(0,500),
      analysis_count:Number(parsed?.analysis_count || 0),
      analyses:Array.isArray(parsed?.analyses) ? parsed.analyses : [],
    };
  }

  return {
    ok:true,
    engine:String(parsed.engine || 'aau_quantitative_python_v0_1'),
    all_claims_match:parsed.all_claims_match === true,
    analysis_count:Number(parsed.analysis_count || 0),
    analyses:Array.isArray(parsed.analyses) ? parsed.analyses : [],
  };
}
