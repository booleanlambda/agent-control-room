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
export const MAX_MODEL_TRANSPORT_ATTEMPTS=2;
export const MAX_INHERITED_DEPENDENCY_RESULTS=24;
export const THRESHOLD_EVIDENCE_POLICY=Object.freeze({
  PASS:'Use PASS only when supplied evidence explicitly satisfies the stated threshold.',
  FAIL:'Use FAIL only when supplied evidence explicitly demonstrates the threshold is not satisfied.',
  UNKNOWN:'Use UNKNOWN when the required measurement is absent, incomplete, incomparable, proxy-only, or otherwise insufficient to determine the threshold.',
  RULE:'Absence of qualifying evidence is UNKNOWN, never FAIL. A single example does not prove an aggregate-count threshold unless the threshold itself is singular.',
});

export function classifyThresholdEvidence({hasComparableEvidence=false,thresholdSatisfied=null}={}){
  if(!hasComparableEvidence||typeof thresholdSatisfied!=='boolean')return 'UNKNOWN';
  return thresholdSatisfied?'PASS':'FAIL';
}

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

export const SEMANTIC_BRANCH_ECONOMICS_CONTRACT='semantic_branch_economics_v0_1';

export function semanticBranchBudget({
  nodeCreateUnits=1,
  childFormulationUnits=1,
  childProvenanceUnits=1,
  childSerializationUnits=1,
  childDiscoveryUnits=1,
  childResolutionUnits=1,
  childTransitionUnits=3,
  terminalReconciliationUnits=1,
  terminalSynthesisUnits=1,
  safetyReserveUnits=0,
}={}){
  const positive=(value,fallback=1)=>Math.max(
    fallback,
    Math.floor(Number(value)||0)
  );
  const nodeCreate=positive(nodeCreateUnits);
  const formulation=positive(childFormulationUnits);
  const provenance=positive(childProvenanceUnits);
  const serialization=positive(childSerializationUnits);
  const discovery=positive(childDiscoveryUnits);
  const resolution=positive(childResolutionUnits);
  const transitions=positive(childTransitionUnits);
  const terminalReconciliation=positive(terminalReconciliationUnits);
  const terminalSynthesis=positive(terminalSynthesisUnits);
  const safety=Math.max(0,Math.floor(Number(safetyReserveUnits)||0));
  const expectedChildLifecycleUnits=
    nodeCreate
    +formulation
    +provenance
    +serialization
    +discovery
    +resolution
    +transitions;
  const completionReserveUnits=Math.max(
    safety,
    terminalReconciliation+terminalSynthesis
  );
  return Object.freeze({
    contract:SEMANTIC_BRANCH_ECONOMICS_CONTRACT,
    expected_child_lifecycle_units:expectedChildLifecycleUnits,
    completion_reserve_units:completionReserveUnits,
    components:Object.freeze({
      node_create_units:nodeCreate,
      child_formulation_units:formulation,
      child_provenance_units:provenance,
      child_serialization_units:serialization,
      child_discovery_units:discovery,
      child_resolution_units:resolution,
      child_transition_units:transitions,
      terminal_reconciliation_units:terminalReconciliation,
      terminal_synthesis_units:terminalSynthesis,
      safety_reserve_units:safety,
    }),
  });
}

export function semanticChildCapacity({
  remainingBudgetUnits=0,
  nodeCreateUnits=1,
  safetyReserveUnits=0,
  expectedChildLifecycleUnits=null,
  completionReserveUnits=null,
  maxChildren=MAX_CHILDREN_PER_SPLIT,
}={}){
  const remaining=Math.max(0,Math.floor(Number(remainingBudgetUnits)||0));
  const nodeCost=Math.max(1,Math.floor(Number(nodeCreateUnits)||1));
  const expectedRaw=Math.floor(Number(expectedChildLifecycleUnits)||0);
  const branchCost=expectedRaw>0?Math.max(nodeCost,expectedRaw):nodeCost;
  const safety=Math.max(0,Math.floor(Number(safetyReserveUnits)||0));
  const completionRaw=Math.floor(Number(completionReserveUnits)||0);
  const reserve=Math.max(safety,completionRaw>0?completionRaw:0);
  const hardMax=Math.max(0,Math.floor(Number(maxChildren)||0));
  return Math.max(
    0,
    Math.min(hardMax,Math.floor(Math.max(0,remaining-reserve)/branchCost))
  );
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


export function durableSiblingInspection({
  siblingEvidence=[],
  candidateInspectedPaths=[],
  priorDiscovery={},
}={}){
  const evidence=Array.isArray(siblingEvidence)?siblingEvidence:[];
  const candidate=new Set(
    (Array.isArray(candidateInspectedPaths)?candidateInspectedPaths:[])
      .map(v=>String(v??'').trim())
      .filter(Boolean)
  );
  const priorInspected=new Set(
    (Array.isArray(priorDiscovery?.inspected_sibling_paths)?priorDiscovery.inspected_sibling_paths:[])
      .map(v=>String(v??'').trim())
      .filter(Boolean)
  );
  const priorUnconfirmed=new Set(
    (Array.isArray(priorDiscovery?.sibling_inspection_unconfirmed_paths)
      ?priorDiscovery.sibling_inspection_unconfirmed_paths:[])
      .map(v=>String(v??'').trim())
      .filter(Boolean)
  );
  const priorHashes=new Map(
    (Array.isArray(priorDiscovery?.authoritative_sibling_result_hashes)
      ?priorDiscovery.authoritative_sibling_result_hashes:[])
      .map(v=>[String(v?.path??'').trim(),String(v?.result_hash??'').trim()])
      .filter(([path,hash])=>path&&hash)
  );
  const required=[];
  const inherited=[];
  const inheritedUnconfirmed=[];
  const inspected=[];
  const newlyInspected=[];
  const invalidated=[];

  for(const raw of evidence){
    const path=String(raw?.path??'').trim();
    if(!path||required.includes(path))continue;
    required.push(path);
    const currentHash=String(raw?.result_hash??'').trim();
    const priorHash=priorHashes.get(path)||'';
    const candidateHas=candidate.has(path);
    const sameDurableHash=Boolean(currentHash)&&Boolean(priorHash)&&currentHash===priorHash;
    const canInheritInspection=!candidateHas&&priorInspected.has(path)&&sameDurableHash;
    const canInheritUnconfirmed=!candidateHas&&priorUnconfirmed.has(path)&&sameDurableHash;

    if(candidateHas){
      inspected.push(path);
      newlyInspected.push(path);
    }else if(canInheritInspection){
      inspected.push(path);
      inherited.push(path);
    }else if(canInheritUnconfirmed){
      inheritedUnconfirmed.push(path);
    }else if((priorInspected.has(path)||priorUnconfirmed.has(path))
      &&currentHash&&priorHash&&currentHash!==priorHash){
      invalidated.push(path);
    }
  }

  const mechanicallyAccounted=new Set([...inspected,...inheritedUnconfirmed]);
  return Object.freeze({
    required_paths:required,
    inspected_paths:inspected,
    newly_inspected_paths:newlyInspected,
    inherited_paths:inherited,
    inherited_unconfirmed_paths:inheritedUnconfirmed,
    invalidated_paths:invalidated,
    missing_paths:required.filter(path=>!mechanicallyAccounted.has(path)),
  });
}

export function mergeInheritedDependencyResults({
  inheritedCompletedSiblingResults=[],
  completedSiblingResults=[],
  maxItems=MAX_INHERITED_DEPENDENCY_RESULTS,
}={}){
  const limit=Math.max(1,Math.floor(Number(maxItems)||MAX_INHERITED_DEPENDENCY_RESULTS));
  const merged=[];
  const byKey=new Map();
  for(const raw of [
    ...(Array.isArray(inheritedCompletedSiblingResults)?inheritedCompletedSiblingResults:[]),
    ...(Array.isArray(completedSiblingResults)?completedSiblingResults:[]),
  ]){
    if(!raw||typeof raw!=='object')continue;
    const path=String(raw.path??'').trim();
    const hash=String(raw.result_hash??'').trim();
    const key=path||hash;
    if(!key)continue;
    const normalized={...raw,dependency_scope:'ancestor_dependency'};
    if(byKey.has(key)){
      merged[byKey.get(key)]={...merged[byKey.get(key)],...normalized};
      continue;
    }
    byKey.set(key,merged.length);
    merged.push(normalized);
  }
  if(merged.length<=limit)return merged;
  const headCount=Math.max(1,Math.floor(limit*0.4));
  const tailCount=Math.max(1,limit-headCount);
  const selected=[...merged.slice(0,headCount),...merged.slice(-tailCount)];
  const out=[];
  const seen=new Set();
  for(const row of selected){
    const key=String(row.path??'').trim()||String(row.result_hash??'').trim();
    if(!key||seen.has(key))continue;
    seen.add(key);
    out.push(row);
  }
  return out.slice(0,limit);
}

export function autonomousEvidenceWindowDecision({
  resourceReasons=[],
  remainingBudgetUnits=0,
  projectedRoundUnits=0,
  completionReserveUnits=0,
  renewalsUsed=0,
  maxRenewals=6,
  lastRoundProductive=true,
}={}){
  const reasons=(Array.isArray(resourceReasons)?resourceReasons:[])
    .map(v=>String(v??'').trim()).filter(Boolean);
  if(!reasons.length)return Object.freeze({
    action:'not_needed',granted:false,reason:'resource_available',
    renewable_reasons:[],hard_reasons:[],required_budget_units:0,
  });
  const renewableSet=new Set([
    'evidence_window_round_ceiling',
    'evidence_window_source_ceiling',
    'evidence_window_elapsed_ceiling',
  ]);
  const renewable=reasons.filter(v=>renewableSet.has(v));
  const hard=reasons.filter(v=>!renewableSet.has(v));
  const used=Math.max(0,Math.floor(Number(renewalsUsed)||0));
  const max=Math.max(0,Math.floor(Number(maxRenewals)||0));
  const remaining=Math.max(0,Math.floor(Number(remainingBudgetUnits)||0));
  const roundCost=Math.max(0,Math.floor(Number(projectedRoundUnits)||0));
  const completionReserve=Math.max(0,Math.floor(Number(completionReserveUnits)||0));
  const required=roundCost+completionReserve;

  if(hard.length)return Object.freeze({
    action:'deny',granted:false,reason:'hard_context_constraint',
    renewable_reasons:renewable,hard_reasons:hard,required_budget_units:required,
  });
  if(!renewable.length)return Object.freeze({
    action:'deny',granted:false,reason:'no_renewable_context_constraint',
    renewable_reasons:[],hard_reasons:[],required_budget_units:required,
  });
  if(used>=max)return Object.freeze({
    action:'deny',granted:false,reason:'evidence_window_renewal_limit',
    renewable_reasons:renewable,hard_reasons:[],required_budget_units:required,
  });
  if(!lastRoundProductive)return Object.freeze({
    action:'deny',granted:false,reason:'prior_evidence_round_unproductive',
    renewable_reasons:renewable,hard_reasons:[],required_budget_units:required,
  });
  if(remaining<required)return Object.freeze({
    action:'deny',granted:false,reason:'insufficient_semantic_budget',
    renewable_reasons:renewable,hard_reasons:[],required_budget_units:required,
  });
  return Object.freeze({
    action:'grant',granted:true,reason:'bounded_evidence_window_economically_admissible',
    renewable_reasons:renewable,hard_reasons:[],required_budget_units:required,
    projected_round_units:roundCost,completion_reserve_units:completionReserve,
    remaining_budget_units:remaining,next_renewal_no:used+1,
  });
}

export function retryableModelTransportError(error){
  const code=String(error?.code||error?.cause?.code||'').trim().toUpperCase();
  const name=String(error?.name||'').trim();
  const message=String(error?.message||'').trim().toLowerCase();
  const status=Number(error?.status||0);
  if(code==='NVIDIA_TIMEOUT'||name==='AbortError'||name==='TimeoutError')return false;
  if([429,500,502,503,504,529].includes(status))return true;
  if(['ECONNRESET','ECONNREFUSED','ENETUNREACH','EAI_AGAIN','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','UND_ERR_HEADERS_TIMEOUT'].includes(code))return true;
  return name==='TypeError'&&message.includes('fetch failed');
}

export function pathDepth(nodePath){
  const path=String(nodePath||'');
  if(path==='R')return 0;
  if(!/^R(?:\.[0-9]{3})+$/.test(path))return Number.POSITIVE_INFINITY;
  return path.split('.').length-1;
}
