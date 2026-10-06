import test from 'node:test';
import assert from 'node:assert/strict';
import {
  semanticRuntimeConfig,
  modelCallCostUnits,
  semanticBranchBudget,
  semanticChildCapacity,
  repeatedStructuralFailureLocked,
  durableSiblingInspection,
  classifyModelTransportFailure,
  retryableModelTransportError,
  autonomousEvidenceWindowDecision,
  evidenceCeilingRequiresAgentResolution,
  mergeInheritedDependencyResults,
  classifyThresholdEvidence,
  runtimeOwnedTerminalSynthesisChild,
  pathDepth,
} from './semantic-runtime-controls.js';

test('epoch budget derives from model ceiling and remains finite',()=>{
  const c=semanticRuntimeConfig({operational_context_limit_tokens:114688},{});
  assert.equal(c.initial_budget_tokens,917504);
  assert.equal(c.initial_budget_units,918);
  assert.ok(Number.isFinite(c.initial_budget_units));
});

test('explicit epoch token budget overrides derived budget',()=>{
  const c=semanticRuntimeConfig(
    {operational_context_limit_tokens:114688},
    {AAU_SEMANTIC_EPOCH_BUDGET_TOKENS:'500000'}
  );
  assert.equal(c.initial_budget_units,500);
});

test('model calls consume positive cost proportional to bounded token exposure',()=>{
  assert.equal(modelCallCostUnits({estimatedInputTokens:9000,requestedOutputTokens:7000,quantumTokens:1000}),16);
  assert.equal(modelCallCostUnits({estimatedInputTokens:0,requestedOutputTokens:1,quantumTokens:1000}),1);
});

test('legacy child capacity falls back to node creation cost when no lifecycle estimate is supplied',()=>{
  assert.equal(semanticChildCapacity({
    remainingBudgetUnits:30,nodeCreateUnits:4,safetyReserveUnits:10,maxChildren:16
  }),5);
  assert.equal(semanticChildCapacity({
    remainingBudgetUnits:13,nodeCreateUnits:4,safetyReserveUnits:10,maxChildren:16
  }),0);
});

test('branch budget prices a child by first-pass lifecycle and reserves terminal work',()=>{
  const budget=semanticBranchBudget({
    nodeCreateUnits:4,
    childFormulationUnits:70,
    childProvenanceUnits:72,
    childSerializationUnits:2,
    childDiscoveryUnits:69,
    childResolutionUnits:76,
    childTransitionUnits:3,
    terminalReconciliationUnits:76,
    terminalSynthesisUnits:18,
    safetyReserveUnits:12,
  });
  assert.equal(budget.expected_child_lifecycle_units,296);
  assert.equal(budget.completion_reserve_units,94);
});

test('child capacity uses branch lifecycle cost instead of cheap node creation cost',()=>{
  assert.equal(semanticChildCapacity({
    remainingBudgetUnits:918,
    nodeCreateUnits:4,
    expectedChildLifecycleUnits:296,
    completionReserveUnits:94,
    safetyReserveUnits:12,
    maxChildren:16,
  }),2);
  assert.equal(semanticChildCapacity({
    remainingBudgetUnits:442,
    nodeCreateUnits:4,
    expectedChildLifecycleUnits:296,
    completionReserveUnits:94,
    safetyReserveUnits:12,
    maxChildren:16,
  }),1);
  assert.equal(semanticChildCapacity({
    remainingBudgetUnits:300,
    nodeCreateUnits:4,
    expectedChildLifecycleUnits:296,
    completionReserveUnits:94,
    safetyReserveUnits:12,
    maxChildren:16,
  }),0);
});

test('repeated structural failure locks only unchanged material state',()=>{
  assert.equal(repeatedStructuralFailureLocked({
    repeatCount:2,currentMaterialFingerprint:'a',lockedMaterialFingerprint:'a'
  }),true);
  assert.equal(repeatedStructuralFailureLocked({
    repeatCount:2,currentMaterialFingerprint:'b',lockedMaterialFingerprint:'a'
  }),false);
  assert.equal(repeatedStructuralFailureLocked({
    repeatCount:1,currentMaterialFingerprint:'a',lockedMaterialFingerprint:'a'
  }),false);
});

test('terminal synthesis classifier preserves substantive reconciliation work',()=>{
  assert.equal(runtimeOwnedTerminalSynthesisChild({
    requirement:'Reconcile conflicting source values for CAC and select the canonical ledger value.'
  }),false);
  assert.equal(runtimeOwnedTerminalSynthesisChild({
    requirement:'Reconcile variable definitions, units, periods, and evidence states across supplied reports.'
  }),false);
});

test('terminal synthesis classifier owns only final reconciliation of resolved outputs',()=>{
  assert.equal(runtimeOwnedTerminalSynthesisChild({
    requirement:'Reconcile completed child artifacts into the final submission.'
  }),true);
  assert.equal(runtimeOwnedTerminalSynthesisChild({
    requirement:'Reconcile verified sibling results into the final artifact.'
  }),true);
  assert.equal(runtimeOwnedTerminalSynthesisChild({
    requirement:'Format the final submission for delivery.'
  }),true);
});

test('path depth is only an emergency storage geometry check',()=>{
  assert.equal(pathDepth('R'),0);
  assert.equal(pathDepth('R.001.002'),2);
  assert.equal(pathDepth('bad'),Infinity);
});


test('durable sibling inspection is inherited only while result hash is unchanged',()=>{
  const prior={
    inspected_sibling_paths:['R.001'],
    authoritative_sibling_result_hashes:[{path:'R.001',result_hash:'hash-a'}],
  };
  const stable=durableSiblingInspection({
    siblingEvidence:[{path:'R.001',result_hash:'hash-a'}],
    candidateInspectedPaths:[],
    priorDiscovery:prior,
  });
  assert.deepEqual(stable.inspected_paths,['R.001']);
  assert.deepEqual(stable.inherited_paths,['R.001']);
  assert.deepEqual(stable.missing_paths,[]);

  const changed=durableSiblingInspection({
    siblingEvidence:[{path:'R.001',result_hash:'hash-b'}],
    candidateInspectedPaths:[],
    priorDiscovery:prior,
  });
  assert.deepEqual(changed.inspected_paths,[]);
  assert.deepEqual(changed.invalidated_paths,['R.001']);
  assert.deepEqual(changed.missing_paths,['R.001']);
});

test('current inspection satisfies a changed sibling and becomes durable',()=>{
  const result=durableSiblingInspection({
    siblingEvidence:[{path:'R.001',result_hash:'hash-b'}],
    candidateInspectedPaths:['R.001'],
    priorDiscovery:{
      inspected_sibling_paths:['R.001'],
      authoritative_sibling_result_hashes:[{path:'R.001',result_hash:'hash-a'}],
    },
  });
  assert.deepEqual(result.newly_inspected_paths,['R.001']);
  assert.deepEqual(result.missing_paths,[]);
});


test('transport retry classification is bounded to transient transport failures',()=>{
  const fetchError=new TypeError('fetch failed');
  assert.equal(retryableModelTransportError(fetchError),true);
  assert.equal(retryableModelTransportError({cause:{code:'ECONNRESET'}}),true);
  assert.equal(retryableModelTransportError({status:503}),true);
  assert.equal(retryableModelTransportError({status:529}),true);
  assert.equal(retryableModelTransportError({status:400}),false);
  assert.equal(retryableModelTransportError({code:'MODEL_TIMEOUT',name:'Error'}),false);
  assert.equal(retryableModelTransportError({name:'AbortError',message:'aborted'}),false);
  assert.deepEqual(classifyModelTransportFailure({code:'MODEL_TIMEOUT'}),{
    failure_class:'model_transport_transient',transport_kind:'timeout',transport_status:null,
    transport_code:'MODEL_TIMEOUT',immediate_retryable:false,cognition_fault:false,
  });
  assert.equal(classifyModelTransportFailure({status:504}).failure_class,'model_transport_transient');
  assert.equal(classifyModelTransportFailure({cause:{code:'ECONNRESET'}}).transport_kind,'network');
  assert.equal(classifyModelTransportFailure(new Error('decision payload invalid')).failure_class,'unknown');
});


test('unconfirmed sibling accounting is inherited only while result hash is unchanged',()=>{
  const prior={
    inspected_sibling_paths:[],
    sibling_inspection_unconfirmed_paths:['R.001'],
    authoritative_sibling_result_hashes:[{path:'R.001',result_hash:'hash-a'}],
  };
  const stable=durableSiblingInspection({
    siblingEvidence:[{path:'R.001',result_hash:'hash-a'}],
    candidateInspectedPaths:[],
    priorDiscovery:prior,
  });
  assert.deepEqual(stable.inspected_paths,[]);
  assert.deepEqual(stable.inherited_unconfirmed_paths,['R.001']);
  assert.deepEqual(stable.missing_paths,[]);

  const changed=durableSiblingInspection({
    siblingEvidence:[{path:'R.001',result_hash:'hash-b'}],
    candidateInspectedPaths:[],
    priorDiscovery:prior,
  });
  assert.deepEqual(changed.inherited_unconfirmed_paths,[]);
  assert.deepEqual(changed.invalidated_paths,['R.001']);
  assert.deepEqual(changed.missing_paths,['R.001']);
});

test('explicit inspection upgrades an inherited unconfirmed sibling',()=>{
  const result=durableSiblingInspection({
    siblingEvidence:[{path:'R.001',result_hash:'hash-a'}],
    candidateInspectedPaths:['R.001'],
    priorDiscovery:{
      sibling_inspection_unconfirmed_paths:['R.001'],
      authoritative_sibling_result_hashes:[{path:'R.001',result_hash:'hash-a'}],
    },
  });
  assert.deepEqual(result.inspected_paths,['R.001']);
  assert.deepEqual(result.newly_inspected_paths,['R.001']);
  assert.deepEqual(result.inherited_unconfirmed_paths,[]);
  assert.deepEqual(result.missing_paths,[]);
});


test('ancestor dependency promotion preserves earlier prerequisites when direct siblings change',()=>{
  const framework={path:'R.001.002',result_hash:'framework-hash',artifact:'framework'};
  const earlier={path:'R.001.001',result_hash:'earlier-hash',artifact:'earlier'};
  const direct={path:'R.001.003.001',result_hash:'direct-hash',artifact:'direct'};
  const promoted=mergeInheritedDependencyResults({
    inheritedCompletedSiblingResults:[earlier,framework],
    completedSiblingResults:[direct],
  });
  assert.deepEqual(promoted.map(v=>v.path),['R.001.001','R.001.002','R.001.003.001']);
  assert.equal(promoted[1].artifact,'framework');
  assert.ok(promoted.every(v=>v.dependency_scope==='ancestor_dependency'));
});

test('ancestor dependency promotion updates same path by latest hash without duplicating it',()=>{
  const promoted=mergeInheritedDependencyResults({
    inheritedCompletedSiblingResults:[{path:'R.001.002',result_hash:'old',artifact:'old'}],
    completedSiblingResults:[{path:'R.001.002',result_hash:'new',artifact:'new'}],
  });
  assert.equal(promoted.length,1);
  assert.equal(promoted[0].result_hash,'new');
  assert.equal(promoted[0].artifact,'new');
});

test('bounded ancestor dependency promotion retains both old prerequisites and recent dependencies',()=>{
  const rows=Array.from({length:30},(_,i)=>({
    path:'R.'+String(i+1).padStart(3,'0'),
    result_hash:'h'+i,
  }));
  const promoted=mergeInheritedDependencyResults({
    inheritedCompletedSiblingResults:rows,
    maxItems:10,
  });
  assert.equal(promoted.length,10);
  assert.ok(promoted.some(v=>v.path==='R.001'));
  assert.ok(promoted.some(v=>v.path==='R.030'));
});


test('hard evidence ceilings return semantic control to the agent instead of pausing lifecycle',()=>{
  assert.equal(evidenceCeilingRequiresAgentResolution({
    granted:false,reason:'hard_context_constraint'
  }),true);
  assert.equal(evidenceCeilingRequiresAgentResolution({
    granted:false,reason:'prior_evidence_round_unproductive'
  }),true);
  assert.equal(evidenceCeilingRequiresAgentResolution({
    granted:false,reason:'evidence_window_renewal_limit'
  }),true);
  assert.equal(evidenceCeilingRequiresAgentResolution({
    granted:false,reason:'insufficient_semantic_budget'
  }),false);
  assert.equal(evidenceCeilingRequiresAgentResolution({
    granted:true,reason:'bounded_evidence_window_economically_admissible'
  }),false);
});

test('threshold evidence distinguishes unknown from fail',()=>{
  assert.equal(classifyThresholdEvidence({hasComparableEvidence:false,thresholdSatisfied:false}),'UNKNOWN');
  assert.equal(classifyThresholdEvidence({hasComparableEvidence:true,thresholdSatisfied:null}),'UNKNOWN');
  assert.equal(classifyThresholdEvidence({hasComparableEvidence:true,thresholdSatisfied:true}),'PASS');
  assert.equal(classifyThresholdEvidence({hasComparableEvidence:true,thresholdSatisfied:false}),'FAIL');
});


test('closed evidence ceilings return semantic control to the agent instead of pausing lifecycle',()=>{
  assert.equal(evidenceCeilingRequiresAgentResolution({
    granted:false,reason:'hard_context_constraint'
  }),true);
  assert.equal(evidenceCeilingRequiresAgentResolution({
    granted:false,reason:'prior_evidence_round_unproductive'
  }),true);
  assert.equal(evidenceCeilingRequiresAgentResolution({
    granted:false,reason:'evidence_window_renewal_limit'
  }),true);
  assert.equal(evidenceCeilingRequiresAgentResolution({
    granted:false,reason:'insufficient_semantic_budget'
  }),false);
  assert.equal(evidenceCeilingRequiresAgentResolution({
    granted:true,reason:'bounded_evidence_window_economically_admissible'
  }),false);
});

test('autonomous evidence renewal grants only renewable productive windows with protected completion reserve',()=>{
  const granted=autonomousEvidenceWindowDecision({
    resourceReasons:['evidence_window_source_ceiling','evidence_window_round_ceiling'],
    remainingBudgetUnits:328,
    projectedRoundUnits:84,
    completionReserveUnits:150,
    renewalsUsed:0,
    maxRenewals:6,
    lastRoundProductive:true,
  });
  assert.equal(granted.granted,true);
  assert.equal(granted.required_budget_units,234);

  const hard=autonomousEvidenceWindowDecision({
    resourceReasons:['research_request_repeating'],
    remainingBudgetUnits:900,
    projectedRoundUnits:80,
    completionReserveUnits:150,
    lastRoundProductive:true,
  });
  assert.equal(hard.granted,false);
  assert.equal(hard.reason,'hard_context_constraint');

  const poor=autonomousEvidenceWindowDecision({
    resourceReasons:['evidence_window_source_ceiling'],
    remainingBudgetUnits:200,
    projectedRoundUnits:84,
    completionReserveUnits:150,
    lastRoundProductive:true,
  });
  assert.equal(poor.granted,false);
  assert.equal(poor.reason,'insufficient_semantic_budget');

  const unproductive=autonomousEvidenceWindowDecision({
    resourceReasons:['evidence_window_round_ceiling'],
    remainingBudgetUnits:900,
    projectedRoundUnits:84,
    completionReserveUnits:150,
    lastRoundProductive:false,
  });
  assert.equal(unproductive.granted,false);
  assert.equal(unproductive.reason,'prior_evidence_round_unproductive');
});
