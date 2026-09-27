import test from 'node:test';
import assert from 'node:assert/strict';
import {
  semanticRuntimeConfig,
  modelCallCostUnits,
  semanticChildCapacity,
  repeatedStructuralFailureLocked,
  durableSiblingInspection,
  retryableModelTransportError,
  mergeInheritedDependencyResults,
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

test('child capacity is bounded by conserved remaining budget',()=>{
  assert.equal(semanticChildCapacity({
    remainingBudgetUnits:30,nodeCreateUnits:4,safetyReserveUnits:10,maxChildren:16
  }),5);
  assert.equal(semanticChildCapacity({
    remainingBudgetUnits:13,nodeCreateUnits:4,safetyReserveUnits:10,maxChildren:16
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
  assert.equal(retryableModelTransportError({status:400}),false);
  assert.equal(retryableModelTransportError({code:'NVIDIA_TIMEOUT',name:'Error'}),false);
  assert.equal(retryableModelTransportError({name:'AbortError',message:'aborted'}),false);
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
