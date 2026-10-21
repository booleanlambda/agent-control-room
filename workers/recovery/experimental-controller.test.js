import test from 'node:test';
import assert from 'node:assert/strict';
import {
  artifactHash, classifyFailure, gateModelResponse, reconcileChildren,
  assembleVerifiedProjection, planRecovery, recoveryFingerprint
} from './experimental-controller.js';

const PARENT='R.002.003.002';
const NET=PARENT+'.001';
const CASH=PARENT+'.002';
const OPENING=5_200_000;
function fixture({semanticRequirements=[]}={}) {
  const netBurn=Array.from({length:12},(_,i)=>Number((120_000-i*10_000).toFixed(2)));
  let bal=OPENING;
  const cash=netBurn.map((v,i)=>({month:i+1,ending_cash:Number((bal-=v).toFixed(2))}));
  const net=netBurn.map((v,i)=>({month:i+1,net_burn:v}));
  const mkChecks=(count,prefix)=>Array.from({length:count},(_,i)=>({
    label:prefix+'-'+(i+1), expression:'1 + 1',claimed_result:2,
  }));
  const children=[
    {node_path:NET,status:'completed',result_hash:'synthetic-net-result-hash',
      artifact:{calculation:net,python_checks:mkChecks(48,'net')}},
    {node_path:CASH,status:'completed',result_hash:'synthetic-cash-result-hash',
      artifact:{calculation:cash,python_checks:mkChecks(36,'cash')}}
  ];
  const trustedReceipts=Object.fromEntries(children.map(c=>[c.node_path,{
    source:'trusted_deterministic_verifier',verification_status:'VERIFIED',
    result_hash:c.result_hash,
    artifact_sha256:artifactHash(c.artifact),
    verified_check_count:c.artifact.python_checks.length,
    verified_check_sha256:artifactHash(c.artifact.python_checks)
  }]));
  const contract={
    requiredChildren:[
      {path:NET,field:'net_burn',expectedMonths:12,expectedCheckCount:48},
      {path:CASH,field:'ending_cash',expectedMonths:12,expectedCheckCount:36}
    ],
    openingCash:OPENING,cashBalanceField:'ending_cash',semanticRequirements
  };
  const runtime={
    lifecycle_status:'paused',assignment_budget_remaining:289,
    reasoning_bucket_remaining:0,rollovers_used:2,rollover_limit:2
  };
  return {parentPath:PARENT,contract,children,trustedReceipts,runtime,
    fault:{code:'SCHEMA_MISMATCH',message:'calculation.python_checks_must_be_array'}};
}
const good=(overrides={})=>({...fixture(),...overrides});

test('classifies NVIDIA HTTP 504 as transport, not cognitive error',()=>{
  assert.equal(classifyFailure({provider_status_code:504,code:'NVIDIA_HTTP_504'}),'PROVIDER_TRANSPORT');
});
test('distinguishes finish_reason length from successful JSON',()=>{
  assert.equal(classifyFailure({finish_reason:'length'}),'TRUNCATED_RESPONSE');
  assert.deepEqual(gateModelResponse({finish_reason:'length',content:'{"ok":true}'}),
    {accepted:false,reason:'TRUNCATED_RESPONSE'});
});
test('model output gate rejects invalid JSON, empty and non-STOP',()=>{
  assert.equal(gateModelResponse({finish_reason:'stop',content:'not json'}).reason,'INVALID_JSON');
  assert.equal(gateModelResponse({finish_reason:'stop',content:' '}).reason,'EMPTY_RESPONSE');
  assert.equal(gateModelResponse({finish_reason:'stop',content:'[]'}).reason,'JSON_NOT_OBJECT');
  assert.deepEqual(gateModelResponse({finish_reason:'stop',content:'{"a":1}'}),{accepted:true,value:{a:1}});
});
test('classifies verification schema conflict, provenance mismatch, budget and reconsideration',()=>{
  assert.equal(classifyFailure({message:'calculation.python_checks_must_be_array'}),'SCHEMA_MISMATCH');
  assert.equal(classifyFailure({message:'declared_verified_checks_unresolved:checks_source_cardinality_invalid'}),'PROVENANCE_CONFLICT');
  assert.equal(classifyFailure({message:'semantic_bucket_rollover_denied:semantic_budget_bucket_exhausted:reasoning:bucket_limit_exhausted'}),'BUDGET_EXHAUSTED');
  assert.equal(classifyFailure({message:'autonomous_decomposition_child_reconsideration_limit:R.002.003.002'}),'NO_PROGRESS');
});
test('purely mechanical valid projection reuses 12+12 values and all 84 checks',()=>{
  const f=fixture(),before=JSON.stringify(f.children);
  const plan=planRecovery(f);
  assert.equal(plan.action,'MECHANICAL_PROJECTION_READY');
  assert.equal(plan.projection.status,'PROJECTION_READY');
  assert.equal(plan.projection.artifact.calculation.length,12);
  assert.equal(plan.projection.artifact.python_checks.length,84);
  assert.equal(plan.projection.artifact.source_manifest.length,2);
  assert.equal(plan.projection.live_node_completed,false);
  assert.equal(plan.model_calls_executed,0);
  assert.equal(plan.live_execution_allowed,false);
  assert.equal(JSON.stringify(f.children),before,'input artifacts mutated');
});
test('semantic interpretation obligations remain unresolved, never marked complete',()=>{
  const f=fixture({semanticRequirements:['interpretation','sanity_check','self_audit']});
  const plan=planRecovery(f);
  assert.equal(plan.action,'PRESERVE_PROJECTION_AWAIT_SEMANTIC_WORK');
  assert.deepEqual(plan.projection.semantic_requirements_remaining,
    ['interpretation','sanity_check','self_audit']);
  assert.equal(plan.projection.live_node_completed,false);
});
test('exhausted reasoning bucket does not prevent offline deterministic projection',()=>{
  const plan=planRecovery(fixture());
  assert.equal(plan.work_budget_remaining,289);
  assert.equal(plan.reasoning_bucket_remaining,0);
  assert.equal(plan.rollovers_used,2);
  assert.equal(plan.action,'MECHANICAL_PROJECTION_READY');
});
test('schema mismatch admits lossless projection without another model',()=>{
  const p=planRecovery(fixture());
  assert.equal(p.failure_class,'SCHEMA_MISMATCH');
  assert.equal(p.projection.model_calls,0);
  assert.equal(p.action,'MECHANICAL_PROJECTION_READY');
});
test('HTTP 504 with unusable evidence and exhausted bucket must HOLD',()=>{
  const f=fixture(); f.children[0].status='pending';
  f.fault={code:'NVIDIA_HTTP_504',provider_status_code:504};
  assert.equal(planRecovery(f).action,'HOLD_BUDGET_GATE');
});
test('HTTP 504 with unavailable projection and resources only proposes retry; never executes',()=>{
  const f=fixture();f.children[0].status='pending';
  f.runtime={lifecycle_status:'paused',assignment_budget_remaining:500,
    reasoning_bucket_remaining:200,rollovers_used:0,rollover_limit:2};
  f.fault={provider_status_code:504};
  const p=planRecovery(f);
  assert.equal(p.action,'BOUNDED_TRANSPORT_RETRY_REQUIRES_SEPARATE_AUTHORIZATION');
  assert.equal(p.scope,'OFFLINE_ONLY');
  assert.equal(p.model_calls_executed,0);
});
test('truncated response without trusted projection only proposes narrower synthesis',()=>{
  const f=fixture();f.children[0].status='pending';
  f.runtime={lifecycle_status:'paused',assignment_budget_remaining:400,
    reasoning_bucket_remaining:100,rollovers_used:0,rollover_limit:2};
  f.fault={finish_reason:'length'};
  assert.equal(planRecovery(f).action,'NARROW_UNFINISHED_SYNTHESIS_REQUIRES_SEPARATE_AUTHORIZATION');
});
test('wrong child artifact checksum blocks without copying data',()=>{
  const f=fixture(); f.children[0].artifact.calculation[0].net_burn+=1;
  const p=planRecovery(f);
  assert.equal(p.action,'HOLD_SCHEMA_RECONCILIATION');
  assert(p.errors.some(e=>e.startsWith('HASH_OR_RECEIPT_MISMATCH')));
});
test('forged source result hash is rejected',()=>{
  const f=fixture();f.children[1].result_hash='forged';
  assert.equal(assembleVerifiedProjection(f).status,'BLOCKED');
});
test('self-attested or missing verifier receipt is not acceptable',()=>{
  const f=fixture();f.trustedReceipts[NET].source='model_self_assessment';
  assert.equal(reconcileChildren(f).ok,false);
  delete f.trustedReceipts[NET];
  assert.equal(reconcileChildren(f).ok,false);
});
test('malformed python_checks object is rejected; no invented array',()=>{
  const f=fixture();
  f.children[0].artifact.python_checks={checks:[{claimed_result:2}]};
  // Even when artifact digest is recalculated, pinned trusted receipt remains unchanged.
  assert.equal(assembleVerifiedProjection(f).status,'BLOCKED');
});
test('insufficient checks and invalid check labels fail even with matching receipts',()=>{
  const f=fixture(); f.children[1].artifact.python_checks.pop();
  f.trustedReceipts[CASH].artifact_sha256=artifactHash(f.children[1].artifact);
  f.trustedReceipts[CASH].verified_check_sha256=artifactHash(f.children[1].artifact.python_checks);
  f.trustedReceipts[CASH].verified_check_count=35;
  assert(reconcileChildren(f).errors.some(e=>e.startsWith('CHECK_CARDINALITY_OR_DIGEST_MISMATCH')));
  const g=fixture();g.children[0].artifact.python_checks[1].label='net-1';
  g.trustedReceipts[NET].artifact_sha256=artifactHash(g.children[0].artifact);
  g.trustedReceipts[NET].verified_check_sha256=artifactHash(g.children[0].artifact.python_checks);
  assert(reconcileChildren(g).errors.some(e=>e.startsWith('INVALID_OR_DUPLICATE_CHECK')));
});
test('cross-child cash reconciliation catches inconsistent arithmetic despite matching receipts',()=>{
  const f=fixture();f.children[1].artifact.calculation[4].ending_cash+=100;
  f.trustedReceipts[CASH].artifact_sha256=artifactHash(f.children[1].artifact);
  const p=assembleVerifiedProjection(f);
  assert.equal(p.reason,'CASH_RECONCILIATION_FAILED');
  assert.equal(p.month,5);
});
test('missing child/duplicate child/undeclared child prevents assembly',()=>{
  const f=fixture();f.children.pop();
  assert.equal(reconcileChildren(f).ok,false);
  const g=fixture();g.children.push({...g.children[0]});
  assert(reconcileChildren(g).errors.some(e=>e.startsWith('DUPLICATE_CHILD')));
  const h=fixture();h.children.push({...h.children[0],node_path:'R.fake'});
  assert(reconcileChildren(h).errors.some(e=>e.startsWith('UNDECLARED_CHILD')));
});
test('repeated unchanged failure produces hold with stable fingerprint',()=>{
  const f=fixture();f.children[0].status='pending';
  f.fault={code:'CYCLE_LOCK',message:'same unresolved node'};
  const key={parentPath:f.parentPath,fault:f.fault,hashes:['a','b']};
  assert.equal(recoveryFingerprint(key),recoveryFingerprint(key));
  assert.equal(planRecovery({...f,identicalFailureCount:2}).action,'HOLD_NO_PROGRESS');
});
test('unknown errors do not trigger uncontrolled retries',()=>{
  const f=fixture();f.children[0].status='pending';f.fault={message:'new problem'};
  assert.equal(planRecovery(f).action,'HOLD_UNCLASSIFIED');
});
test('a replay does not alter the paused economic state or create wake actions',()=>{
  const f=fixture();
  const before=JSON.stringify(f);
  const plan=planRecovery(f);
  assert.equal(plan.scope,'OFFLINE_ONLY');
  assert.equal(plan.runtime_state_observed,'paused');
  assert.equal(JSON.stringify(f),before);
  assert.equal('wake_id' in plan,false);
});

test('semantic mismatch has its own deterministic failure classification',()=>{
  assert.equal(classifyFailure({code:'SEMANTIC_MISMATCH'}),'SEMANTIC_MISMATCH');
  assert.equal(classifyFailure({message:'CLAIM_CONTRADICTS_VERIFIED_RESULT'}),
    'SEMANTIC_MISMATCH');
});
test('semantic mismatch blocks even when numeric parent projection is ready',()=>{
  const f=fixture();
  f.fault={code:'SEMANTIC_MISMATCH'};
  const p=planRecovery(f);
  assert.equal(p.action,'HOLD_SEMANTIC_MISMATCH');
  assert.equal(p.projection_status,'PROJECTION_READY');
  assert.equal(p.live_execution_allowed,false);
  assert.equal(p.model_calls_executed,0);
});
test('semantic mismatch does not retry when numeric child evidence is unavailable',()=>{
  const f=fixture();
  f.fault={message:'SEMANTIC_MISMATCH'};
  f.children[0].status='pending';
  assert.equal(planRecovery(f).action,'HOLD_SEMANTIC_MISMATCH');
});
