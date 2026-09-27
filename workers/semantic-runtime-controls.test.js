import test from 'node:test';
import assert from 'node:assert/strict';
import {
  semanticRuntimeConfig,
  modelCallCostUnits,
  semanticChildCapacity,
  repeatedStructuralFailureLocked,
  durableSiblingInspection,
  retryableModelTransportError,
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
