// Experimental AAU Recovery Controller v0.1 — OFFLINE ONLY.
// No database/network access, model API calls, mutable global state, or live wake actions.
// Verified evidence is admissible ONLY when a trusted receipt has been supplied
// independently of the child artifact being evaluated.
import {createHash} from 'node:crypto';

export const EXPERIMENTAL_RECOVERY_CONTRACT = 'aau.experimental.recovery.v0.1';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const own = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);
const asText = x => String(x ?? '').trim();
export const artifactHash = artifact => hash(artifact);
export const recoveryFingerprint = ({parentPath, fault, hashes}) => hash({
  parentPath, failure: classifyFailure(fault), hashes
});

export function classifyFailure(fault = {}) {
  const text = [fault.code, fault.message, fault.rejection_reason].map(asText).join(':');
  const finish = asText(fault.finish_reason);
  if (/NVIDIA_HTTP_504|(?:HTTP[_ ]?504)|MODEL_PROVIDER_HTTP_504/.test(text) ||
      Number(fault.provider_status_code) === 504)
    return 'PROVIDER_TRANSPORT';
  if (finish === 'length' || /TRUNCATED_RESPONSE|INCOMPLETE_RESPONSE/.test(text))
    return 'TRUNCATED_RESPONSE';
  if (/python_checks_must_be_array|MATERIALIZATION_INVALID|SCHEMA_MISMATCH/.test(text))
    return 'SCHEMA_MISMATCH';
  if (/cardinality|provenance|wrong_hash|missing_source|evidence_conflict/i.test(text))
    return 'PROVENANCE_CONFLICT';
  if (/semantic_bucket_rollover_denied|bucket_limit_exhausted|BUDGET_EXHAUSTED/.test(text))
    return 'BUDGET_EXHAUSTED';
  if (/CYCLE_LOCK|RECONSIDERATION_LIMIT|no_material_progress/i.test(text))
    return 'NO_PROGRESS';
  return 'UNKNOWN';
}

export function gateModelResponse(response) {
  if (!isRecord(response)) return {accepted:false,reason:'RESPONSE_NOT_OBJECT'};
  if (response.finish_reason !== 'stop') return {
    accepted:false,
    reason:response.finish_reason === 'length' ? 'TRUNCATED_RESPONSE' : 'FINISH_NOT_STOP'
  };
  if (typeof response.content !== 'string' || !response.content.trim())
    return {accepted:false,reason:'EMPTY_RESPONSE'};
  try {
    const parsed = JSON.parse(response.content);
    if (!isRecord(parsed)) return {accepted:false,reason:'JSON_NOT_OBJECT'};
    return {accepted:true,value:parsed};
  } catch {
    return {accepted:false,reason:'INVALID_JSON'};
  }
}

export function reconcileChildren({parentPath, contract, children, trustedReceipts}) {
  const errors = [];
  if (!isRecord(contract) || !Array.isArray(contract.requiredChildren) ||
      contract.requiredChildren.length === 0) {
    return {ok:false,errors:['INVALID_PARENT_CONTRACT']};
  }
  if (!isRecord(trustedReceipts) || !Array.isArray(children))
    return {ok:false,errors:['MISSING_EVIDENCE_OR_CHILDREN']};
  const expected = contract.requiredChildren;
  if (new Set(expected.map(x => x.path)).size !== expected.length)
    return {ok:false,errors:['DUPLICATE_CONTRACT_CHILD']};
  const byPath = new Map();
  for (const child of children) {
    if (!isRecord(child) || !asText(child.node_path)) {errors.push('INVALID_CHILD');continue;}
    if (byPath.has(child.node_path)) errors.push('DUPLICATE_CHILD:' + child.node_path);
    byPath.set(child.node_path, child);
  }
  for (const path of byPath.keys()) {
    if (!expected.some(e => e.path === path)) errors.push('UNDECLARED_CHILD:' + path);
  }
  const validated = [];
  for (const requirement of expected) {
    const path = requirement.path, child = byPath.get(path), receipt = trustedReceipts[path];
    if (!asText(path).startsWith(asText(parentPath) + '.')) errors.push('INVALID_CHILD_PATH:' + path);
    if (!child || child.status !== 'completed' || !isRecord(child.artifact)) {
      errors.push('CHILD_NOT_COMPLETED:' + path); continue;
    }
    if (!receipt || receipt.verification_status !== 'VERIFIED' ||
        receipt.source !== 'trusted_deterministic_verifier') {
      errors.push('MISSING_TRUSTED_RECEIPT:' + path); continue;
    }
    const digest = artifactHash(child.artifact);
    if (digest !== receipt.artifact_sha256 ||
        child.result_hash !== receipt.result_hash) {
      errors.push('HASH_OR_RECEIPT_MISMATCH:' + path); continue;
    }
    if (!Array.isArray(child.artifact.python_checks)) {
      errors.push('CHILD_CHECKS_NOT_ARRAY:' + path); continue;
    }
    const checks = child.artifact.python_checks;
    if (checks.length !== requirement.expectedCheckCount ||
        receipt.verified_check_count !== checks.length ||
        receipt.verified_check_sha256 !== artifactHash(checks)) {
      errors.push('CHECK_CARDINALITY_OR_DIGEST_MISMATCH:' + path); continue;
    }
    const labels = new Set();
    for (const check of checks) {
      if (!isRecord(check) || typeof check.label !== 'string' ||
          !check.label.trim() || typeof check.expression !== 'string' ||
          !check.expression.trim() || !Number.isFinite(check.claimed_result) ||
          labels.has(check.label)) {
        errors.push('INVALID_OR_DUPLICATE_CHECK:' + path); break;
      }
      labels.add(check.label);
    }
    const calculation = child.artifact.calculation;
    if (!Array.isArray(calculation) || calculation.length !== requirement.expectedMonths ||
        !Number.isInteger(requirement.expectedMonths) || requirement.expectedMonths < 1) {
      errors.push('CALCULATION_CARDINALITY_INVALID:' + path); continue;
    }
    const amounts = [];
    for (let index=0;index<calculation.length;index++) {
      const item=calculation[index];
      if (!isRecord(item) || item.month !== index+1 ||
          !Number.isFinite(item[requirement.field])) {
        errors.push('CALCULATION_MONTH_OR_VALUE_INVALID:' + path); break;
      }
      amounts.push(item[requirement.field]);
    }
    if (amounts.length !== requirement.expectedMonths) continue;
    if (errors.some(e=>e.endsWith(':' + path))) continue;
    validated.push({path,field:requirement.field,resultHash:child.result_hash,values:amounts,checks});
  }
  return errors.length ? {ok:false,errors:[...new Set(errors)]} :
    {ok:true,children:validated};
}

// This creates an evidence-backed mechanical projection, not an agent-authored
// interpretation, provenance verdict, or a completed live parent node.
export function assembleVerifiedProjection({parentPath, contract, children, trustedReceipts}) {
  const r = reconcileChildren({parentPath,contract,children,trustedReceipts});
  if (!r.ok) return {status:'BLOCKED',reason:'UNVERIFIED_CHILD_EVIDENCE',errors:r.errors};
  const projected = Array.from({length:contract.requiredChildren[0].expectedMonths},
    (_,i)=>({month:i+1}));
  const pythonChecks=[];
  for (const child of r.children) {
    if (child.values.length !== projected.length)
      return {status:'BLOCKED',reason:'PERIOD_ALIGNMENT_CONFLICT'};
    for(let i=0;i<projected.length;i++) projected[i][child.field]=child.values[i];
    for(const check of child.checks) pythonChecks.push({
      ...check,
      label:child.path + ':' + check.label,
      source_node_path:child.path,
      source_result_hash:child.resultHash
    });
  }
  if (Number.isFinite(contract.openingCash)) {
    // Never silently skip cash verification when the schema/field changed.
    const cashField=contract.cashBalanceField;
    if (!['ending_cash','ending_cash_balance'].includes(cashField) ||
        !projected.every(p=>Number.isFinite(p.net_burn)&&Number.isFinite(p[cashField]))) {
      return {status:'BLOCKED',reason:'DECLARED_CASH_FIELD_MISSING'};
    }
    let balance=contract.openingCash;
    for(const item of projected) {
      balance-=item.net_burn;
      if (Math.abs(balance-item[cashField])>0.011)
        return {status:'BLOCKED',reason:'CASH_RECONCILIATION_FAILED',month:item.month};
    }
  }
  const manifest=r.children.map(c=>({
    path:c.path,result_hash:c.resultHash,check_count:c.checks.length,
  }));
  const output={
    parent_path:parentPath,
    calculation:projected,
    python_checks:pythonChecks,
    source_manifest:manifest,
    contract:EXPERIMENTAL_RECOVERY_CONTRACT
  };
  return {
    status:'PROJECTION_READY',
    artifact:output,
    artifact_sha256:artifactHash(output),
    semantic_requirements_remaining:Array.isArray(contract.semanticRequirements)
      ? [...contract.semanticRequirements] : ['UNSPECIFIED_SEMANTIC_CONTRACT'],
    live_node_completed:false,
    model_calls:0,
  };
}

// Planner makes a plan, NEVER executes a retry, database write, wake or model call.
export function planRecovery({
  parentPath, contract, children, trustedReceipts, fault, runtime,
  identicalFailureCount=0
}) {
  const failureClass=classifyFailure(fault);
  const projection=assembleVerifiedProjection({
    parentPath,contract,children,trustedReceipts
  });
  const base={
    contract:EXPERIMENTAL_RECOVERY_CONTRACT,
    failure_class:failureClass, scope:'OFFLINE_ONLY',
    live_execution_allowed:false, model_calls_executed:0,
    parent_path:parentPath,
    existing_verified_work_reused:projection.status==='PROJECTION_READY',
    runtime_state_observed:runtime?.lifecycle_status??'UNKNOWN',
    work_budget_remaining:runtime?.assignment_budget_remaining??null,
    reasoning_bucket_remaining:runtime?.reasoning_bucket_remaining??null,
    rollovers_used:runtime?.rollovers_used??null,
    rollover_limit:runtime?.rollover_limit??null,
  };
  if (projection.status==='PROJECTION_READY') {
    if (identicalFailureCount >= 2 && failureClass==='NO_PROGRESS')
      return {...base,action:'HOLD_NO_PROGRESS',reason:'REPEATED_IDENTICAL_FAILURE',projection};
    return {...base,action:projection.semantic_requirements_remaining.length
      ? 'PRESERVE_PROJECTION_AWAIT_SEMANTIC_WORK'
      : 'MECHANICAL_PROJECTION_READY',
      projection};
  }
  if (identicalFailureCount >= 2)
    return {...base,action:'HOLD_NO_PROGRESS',reason:'REPEATED_IDENTICAL_FAILURE',errors:projection.errors};
  const actionByFailure={
    PROVIDER_TRANSPORT:'BOUNDED_TRANSPORT_RETRY_REQUIRES_SEPARATE_AUTHORIZATION',
    TRUNCATED_RESPONSE:'NARROW_UNFINISHED_SYNTHESIS_REQUIRES_SEPARATE_AUTHORIZATION',
    SCHEMA_MISMATCH:'HOLD_SCHEMA_RECONCILIATION',
    PROVENANCE_CONFLICT:'HOLD_EVIDENCE_CONFLICT',
    BUDGET_EXHAUSTED:'HOLD_BUDGET_GATE',
    NO_PROGRESS:'HOLD_NO_PROGRESS',
    UNKNOWN:'HOLD_UNCLASSIFIED',
  };
  const budgetExhausted=runtime?.reasoning_bucket_remaining===0 ||
    (Number.isFinite(runtime?.rollover_limit) &&
      (runtime?.rollovers_used??0)>=runtime.rollover_limit);
  let action=actionByFailure[failureClass]||'HOLD_UNCLASSIFIED';
  if (budgetExhausted && (failureClass==='TRUNCATED_RESPONSE' ||
      failureClass==='PROVIDER_TRANSPORT')) action='HOLD_BUDGET_GATE';
  return {...base,action,reason:projection.reason,errors:projection.errors??[]};
}
