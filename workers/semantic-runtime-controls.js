// AAU systemic semantic runtime controls v0.2
// Pure mechanical controls. These functions do not author or reinterpret agent cognition.

export const SEMANTIC_RUNTIME_CONTRACT='systemic_semantic_runtime_v0_2';
export const DEFAULT_BUDGET_QUANTUM_TOKENS=1000;
export const DEFAULT_CONTEXT_MULTIPLIER=8;
export const DEFAULT_MIN_EPOCH_BUDGET_TOKENS=300000;
export const DEFAULT_NODE_CREATE_TOKENS=4000;
export const DEFAULT_CONTEXT_ACQUIRE_TOKENS=2000;
export const DEFAULT_SAFETY_RESERVE_TOKENS=12000;
export const MAX_IDENTICAL_STRUCTURAL_FAILURES=2;
export const HARD_STORAGE_PATH_DEPTH=16;
export const MAX_CHILDREN_PER_SPLIT=16;

function positiveInt(value,fallback){
  const n=Math.floor(Number(value));
  return Number.isFinite(n)&&n>0?n:fallback;
}

export function semanticRuntimeConfig(contract={},env=process.env){
  const quantum=positiveInt(env.AAU_SEMANTIC_BUDGET_QUANTUM_TOKENS,DEFAULT_BUDGET_QUANTUM_TOKENS);
  const contextCeiling=positiveInt(
    contract.operational_context_limit_tokens
      ||contract.declared_context_window_tokens
      ||contract.max_context_tokens,
    131072
  );
  const configuredBudgetTokens=positiveInt(env.AAU_SEMANTIC_EPOCH_BUDGET_TOKENS,0);
  const initialBudgetTokens=configuredBudgetTokens>0
    ? configuredBudgetTokens
    : Math.max(DEFAULT_MIN_EPOCH_BUDGET_TOKENS,contextCeiling*DEFAULT_CONTEXT_MULTIPLIER);
  const nodeCreateTokens=positiveInt(env.AAU_SEMANTIC_NODE_CREATE_TOKENS,DEFAULT_NODE_CREATE_TOKENS);
  const contextAcquireTokens=positiveInt(env.AAU_SEMANTIC_CONTEXT_ACQUIRE_TOKENS,DEFAULT_CONTEXT_ACQUIRE_TOKENS);
  const safetyReserveTokens=positiveInt(env.AAU_SEMANTIC_SAFETY_RESERVE_TOKENS,DEFAULT_SAFETY_RESERVE_TOKENS);
  return Object.freeze({
    contract:SEMANTIC_RUNTIME_CONTRACT,
    epoch_no:1,
    quantum_tokens:quantum,
    initial_budget_tokens:initialBudgetTokens,
    initial_budget_units:Math.max(1,Math.ceil(initialBudgetTokens/quantum)),
    node_create_tokens:nodeCreateTokens,
    node_create_units:Math.max(1,Math.ceil(nodeCreateTokens/quantum)),
    context_acquire_tokens:contextAcquireTokens,
    context_acquire_units:Math.max(1,Math.ceil(contextAcquireTokens/quantum)),
    safety_reserve_tokens:safetyReserveTokens,
    safety_reserve_units:Math.max(1,Math.ceil(safetyReserveTokens/quantum)),
    hard_storage_path_depth:HARD_STORAGE_PATH_DEPTH,
    max_children_per_split:MAX_CHILDREN_PER_SPLIT,
    identical_structural_failure_limit:MAX_IDENTICAL_STRUCTURAL_FAILURES,
  });
}

export function modelCallCostUnits({estimatedInputTokens=0,requestedOutputTokens=0,quantumTokens=DEFAULT_BUDGET_QUANTUM_TOKENS}={}){
  const q=Math.max(1,positiveInt(quantumTokens,DEFAULT_BUDGET_QUANTUM_TOKENS));
  const input=Math.max(0,Math.floor(Number(estimatedInputTokens)||0));
  const output=Math.max(0,Math.floor(Number(requestedOutputTokens)||0));
  return Math.max(1,Math.ceil((input+output)/q));
}

export function semanticChildCapacity({
  remainingBudgetUnits=0,
  nodeCreateUnits=1,
  safetyReserveUnits=0,
  maxChildren=MAX_CHILDREN_PER_SPLIT,
}={}){
  const remaining=Math.max(0,Math.floor(Number(remainingBudgetUnits)||0));
  const nodeCost=Math.max(1,Math.floor(Number(nodeCreateUnits)||1));
  const reserve=Math.max(0,Math.floor(Number(safetyReserveUnits)||0));
  const hardMax=Math.max(0,Math.floor(Number(maxChildren)||0));
  return Math.max(0,Math.min(hardMax,Math.floor(Math.max(0,remaining-reserve)/nodeCost)));
}

export function repeatedStructuralFailureLocked({
  repeatCount=0,
  currentMaterialFingerprint='',
  lockedMaterialFingerprint='',
  limit=MAX_IDENTICAL_STRUCTURAL_FAILURES,
}={}){
  const same=Boolean(currentMaterialFingerprint)
    &&currentMaterialFingerprint===lockedMaterialFingerprint;
  return same&&Math.max(0,Number(repeatCount)||0)>=Math.max(1,Number(limit)||1);
}

export function pathDepth(nodePath){
  const path=String(nodePath||'');
  if(path==='R')return 0;
  if(!/^R(?:\.[0-9]{3})+$/.test(path))return Number.POSITIVE_INFINITY;
  return path.split('.').length-1;
}
