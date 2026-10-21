import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {replayPersistedSilasParent,unwrapStoredArtifact} from './silas-persisted-parent-replay.js';
import {makeCanonicalSemanticCandidate} from './semantic-consistency-gate.js';
const P='R.002.003.002';
const E='curriculum/qda601-exercise-packs-v0.1.json#QDA601-M10-U2';
const digest=s=>createHash('sha256').update(s).digest('hex');
function input(){
  const burn=Array.from({length:12},(_,i)=>Math.round((120000-i*10000)*100)/100);
  let balance=5200000;
  const net=burn.map((v,i)=>({month:i+1,net_burn:v}));
  const cash=burn.map((v,i)=>({month:i+1,ending_cash_balance:(balance=Math.round((balance-v)*100)/100)}));
  const build=(suffix,calculation,count)=>{
    const artifact={
      exercise_pack_ref:E,
      calculation,
      // Synthetic tests: each check is independently executed by the
      // production safe-Python runner; it does not prove coverage of numeric rows.
      python_checks:Array.from({length:count},(_,i)=>{
        const field=suffix==='.001'?'net_burn':'ending_cash_balance';
        const cell=calculation[i%12];
        return i<12
          ?{label:'calculation['+i+'].'+field,
            expression:String(cell[field]),claimed_result:cell[field]}
          :{label:suffix+'_extra_check_'+i,expression:'2 + 2',claimed_result:4};
      }),
      interpretation:'Synthetic example only',sanity_check:'Synthetic example'
    };
    return {node_path:P+suffix,status:'completed',
      result_hash:suffix==='.001'?'c54084bf57a7c49c939ce33240cd8e0345a753b41260a60a1561f0f86cae5067'
        :'3ce809d48e6ee19edc95cdce80f298b9999de5d82a4fab3dac584195487b2f01',
      decision_payload:{deterministic_math_verified:true,
        deterministic_math_verification:{ok:true,all_match:true}},
      result_artifact:JSON.stringify({artifact:JSON.stringify(artifact),handoff:{facts:[]}})
    };
  };
  const records=[build('.001',net,48),build('.002',cash,36)];
  const sourceManifest=Object.fromEntries(records.map(x=>[x.node_path,{
    result_hash:x.result_hash,envelope_sha256:digest(x.result_artifact)
  }]));
  const contract={parentPath:P,exercise_pack_ref:E,openingCash:5200000};
  return {records,sourceManifest,contract};
}
const run=x=>replayPersistedSilasParent(x);
test('real JSON-as-string envelope can be decoded without changes',()=>{
  const f=input(),b=f.records[0].result_artifact;
  const p=unwrapStoredArtifact(f.records[0]);
  assert.equal(p.ok,true);assert.equal(p.artifact.calculation.length,12);
  assert.equal(f.records[0].result_artifact,b);
});
test('sandboxed independent Python re-executes all 84 checks in 2 child batches',()=>{
  const f=input(),before=JSON.stringify(f);
  const outcome=run(f);
  assert.equal(outcome.status,'VERIFIED_NUMERIC_PROJECTION_ONLY',JSON.stringify(outcome));
  assert.equal(outcome.artifact.python_checks.length,84);
  assert.equal(outcome.artifact.calculation.length,12);
  assert.deepEqual(outcome.audited.map(x=>x.check_count),[48,36]);
  assert(outcome.audited.every(x=>x.all_match===true&&x.all_valid===true));
  assert.equal(outcome.model_calls,0);
  assert.equal(outcome.live_node_completed,false);
  assert(outcome.semantic_requirements_remaining.length>=5);
  assert.equal(JSON.stringify(f),before,'snapshot must be immutable');
});
test('incorrect Python claimed result fails despite matching source pin',()=>{
  const f=input(),o=JSON.parse(f.records[0].result_artifact);
  const a=JSON.parse(o.artifact);a.python_checks[4].claimed_result=7;
  o.artifact=JSON.stringify(a);
  f.records[0].result_artifact=JSON.stringify(o);
  f.sourceManifest[f.records[0].node_path].envelope_sha256=digest(f.records[0].result_artifact);
  const r=run(f);
  assert.equal(r.status,'BLOCKED');
  assert(r.errors.includes('INDEPENDENT_PYTHON_CHECK_FAILURE:'+P+'.001'));
});
test('mutated database envelope fails SHA integrity pin',()=>{
  const f=input();
  f.records[1].result_artifact+=' ';
  const r=run(f);
  assert.equal(r.status,'BLOCKED');
  assert(r.errors.includes('ENVELOPE_DIGEST_NOT_PINN:'+P+'.002'));
});
test('wrong source result hash fails binding',()=>{
  const f=input();
  f.records[0].result_hash='deadbeef';
  assert.equal(run(f).status,'BLOCKED');
});
test('completed child with no durable verifier evidence cannot pass',()=>{
  const f=input();
  f.records[0].decision_payload={};
  const r=run(f);
  assert.equal(r.status,'BLOCKED');
  assert(r.errors.includes('MISSING_DURABLE_MATH_ATTESTATION:'+P+'.001'));
});
test('bad nested artifact JSON rejects even with repinned envelope',()=>{
  const f=input();f.records[0].result_artifact='{"artifact":"{broken"}';
  f.sourceManifest[f.records[0].node_path].envelope_sha256=digest(f.records[0].result_artifact);
  assert.equal(run(f).status,'BLOCKED');
});
test('source with correct checks but changed cash value rejects by cross-child equation',()=>{
  const f=input(),outer=JSON.parse(f.records[1].result_artifact);
  const inner=JSON.parse(outer.artifact);
  inner.calculation[10].ending_cash_balance+=250;
  // Repair the bound check so that this test reaches the cross-child
  // reconciliation gate rather than failing the check-to-row binding gate.
  inner.python_checks[10].claimed_result=inner.calculation[10].ending_cash_balance;
  inner.python_checks[10].expression=String(inner.calculation[10].ending_cash_balance);
  outer.artifact=JSON.stringify(inner);
  f.records[1].result_artifact=JSON.stringify(outer);
  f.sourceManifest[f.records[1].node_path].envelope_sha256=digest(f.records[1].result_artifact);
  const r=run(f);
  assert.equal(r.status,'BLOCKED');
  assert.equal(r.reason,'CASH_RECONCILIATION_FAILED');
});
test('one missing month or malformed calculation array cannot be projected',()=>{
  const f=input(),outer=JSON.parse(f.records[0].result_artifact);
  const inner=JSON.parse(outer.artifact);
  inner.calculation.pop();
  outer.artifact=JSON.stringify(inner);
  f.records[0].result_artifact=JSON.stringify(outer);
  f.sourceManifest[f.records[0].node_path].envelope_sha256=digest(f.records[0].result_artifact);
  assert.equal(run(f).status,'BLOCKED');
});
test('wrong exercise pack or parent identity blocks',()=>{
  const f=input();
  f.contract.exercise_pack_ref='other';
  assert.equal(run(f).reason,'CONTRACT_NOT_AUTHORITATIVE');
});
test('unsupported receipt and missing source manifest block',()=>{
  const f=input();
  delete f.sourceManifest[P+'.002'];
  assert.equal(run(f).status,'BLOCKED');
});
test('zero model calls do not claim the live parent is finished',()=>{
  const x=run(input());
  assert.equal(x.model_calls,0);
  assert.equal(x.mandatory_next_action,'COMPLETE_SEMANTIC_AND_PROVENANCE_OBLIGATIONS');
  assert.equal(x.live_node_completed,false);
});

test('changing a calculated number while retaining the old passing check is caught',()=>{
  const f=input(),outer=JSON.parse(f.records[1].result_artifact);
  const body=JSON.parse(outer.artifact);
  body.calculation[5].ending_cash_balance+=1;
  outer.artifact=JSON.stringify(body);
  f.records[1].result_artifact=JSON.stringify(outer);
  f.sourceManifest[f.records[1].node_path].envelope_sha256=digest(f.records[1].result_artifact);
  const r=run(f);
  assert.equal(r.status,'BLOCKED');
  assert(r.errors.includes('CHECK_TO_CALC_BINDING_UNRESOLVED:'+P+'.002'));
});

test('absent semantic candidate returns unresolved gate and no live completion',()=>{
  const result=run(input());
  assert.equal(result.semantic_gate.status,'UNRESOLVED');
  assert.equal(result.live_node_completed,false);
});
test('parent semantic gate accepts only a canonical numeric candidate, not live completion',()=>{
  const f=input(),baseline=run(f);
  assert.equal(baseline.status,'VERIFIED_NUMERIC_PROJECTION_ONLY');
  const c=makeCanonicalSemanticCandidate({
    projection:{...baseline,status:'PROJECTION_READY'},openingCash:f.contract.openingCash
  });
  const result=run({...f,parentCandidate:c});
  assert.equal(result.status,'VERIFIED_NUMERIC_PROJECTION_ONLY');
  assert.equal(result.semantic_gate.status,'PASS');
  assert.equal(result.live_node_completed,false);
  assert.equal(result.model_calls,0);
});
test('contradictory parent interpretation produces explicit mismatch',()=>{
  const f=input(),baseline=run(f);
  const c=makeCanonicalSemanticCandidate({
    projection:{...baseline,status:'PROJECTION_READY'},openingCash:f.contract.openingCash
  });
  c.interpretation='Ending cash balance declined by month 12.';
  const result=run({...f,parentCandidate:c});
  assert.equal(result.status,'SEMANTIC_MISMATCH');
  assert.equal(result.semantic_gate.status,'SEMANTIC_MISMATCH');
  assert.equal(result.mandatory_next_action,'REMEDIATE_SEMANTIC_MISMATCH');
  assert.equal(result.live_node_completed,false);
});
