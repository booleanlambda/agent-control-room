import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PYTHON_RUNNER = fileURLToPath(new URL('./python-math-runner.py', import.meta.url));

export function verifyPythonMathChecks(checks, options = {}) {
  if (!Array.isArray(checks) || checks.length < 1) {
    return {ok:false,all_match:false,error:'python_checks_required',check_count:0,results:[]};
  }

  const payload = {
    checks,
    absolute_tolerance: Number.isFinite(options.absoluteTolerance) ? options.absoluteTolerance : 1e-8,
    relative_tolerance: Number.isFinite(options.relativeTolerance) ? options.relativeTolerance : 1e-8,
  };

  const result = spawnSync('python3', [PYTHON_RUNNER], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) {
    return {ok:false,all_match:false,error:'python_runtime_error:'+String(result.error.message || result.error),check_count:0,results:[]};
  }

  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || '').trim());
  } catch {
    return {ok:false,all_match:false,error:'python_runtime_invalid_json',check_count:0,results:[]};
  }

  if (result.status !== 0 || parsed?.ok !== true) {
    return {
      ok:false,
      all_match:false,
      error:String(parsed?.error || result.stderr || 'python_runtime_failed').slice(0,300),
      check_count:Number(parsed?.check_count || 0),
      results:Array.isArray(parsed?.results) ? parsed.results : [],
    };
  }

  return {
    ok:true,
    all_match:parsed.all_match === true,
    check_count:Number(parsed.check_count || 0),
    results:Array.isArray(parsed.results) ? parsed.results : [],
  };
}
