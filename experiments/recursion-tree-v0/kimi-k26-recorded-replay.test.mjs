import test from 'node:test';
import assert from 'node:assert/strict';
import {newExecutionLab,drain,checkpoint,restore,
  journalSynthesis,commitSynthesis,finishSynthesis} from './execution-integrity.mjs';
import {auditCognitiveTree} from './cognitive-integrity.mjs';
import {SOURCE,recordedKimiDecision,recordedKimiSynthesis}
  from './kimi-k26-recorded-replay.mjs';

async function replayTree(faultFor){
  const state=newExecutionLab({shape:'spine',budget:55000});
  const run=await drain(state,{model:recordedKimiDecision,faultFor});
  assert.equal(run.complete,true);
  assert.equal(run.nodes,21);
  return state;
}
function synthesize(s){
  const baseline=auditCognitiveTree(s.tree);
  assert.equal(baseline.complete,true);
  const parents=Object.values(s.tree.nodes).filter(n=>n.status==='split')
    .sort((a,b)=>b.depth-a.depth);
  for(const node of parents){
    const childProofs=node.children.map(p=>s.syntheses[p]||baseline.proofs[p]);
    assert.ok(childProofs.every(Boolean));
    const recorded=recordedKimiSynthesis(node,childProofs);
    assert.equal(journalSynthesis(s,node.path,recorded).status,'journaled');
    assert.equal(commitSynthesis(s,node.path).status,'accepted');
  }
  return finishSynthesis(s);
}

test('31 recorded live Kimi decisions reconstruct the original SHA-256 root, without calling a model',async()=>{
  const s=await replayTree();
  const result=synthesize(s);
  assert.equal(result.complete,true);
  assert.equal(result.acceptedLeaves,11);
  assert.equal(result.acceptedParents,10);
  assert.equal(result.rootDigest,SOURCE.rootDigest);
  assert.equal(s.tree.calls,21);
});

test('same original Kimi root survives 504, 429, orphaned lease and post-response crash',async()=>{
  const path=n=>'R'+'.002'.repeat(n);
  const faults=new Map([[path(2),'HTTP_504'],[path(4),'HTTP_429'],
    [path(6),'TIMEOUT_ORPHAN'],[path(10),'CRASH_AFTER_RESPONSE']]);
  const s=await replayTree(({path:p,attempt})=>attempt===1?(faults.get(p)||null):null);
  const resumed=restore(checkpoint(s));
  const proof=synthesize(resumed);
  assert.equal(proof.complete,true);
  assert.equal(proof.rootDigest,SOURCE.rootDigest);
  assert.equal(resumed.tree.calls,24);
  assert.equal(Object.keys(resumed.tree.nodes).length,21);
  assert.equal(resumed.transportErrors.length,3);
  assert.equal(resumed.tree.ledger.filter(e=>e.kind==='semantic_split_accepted').length,10);
  assert.equal(resumed.tree.ledger.filter(e=>e.kind==='atomic_accepted').length,11);
  assert.equal(resumed.tree.ledger.reduce((a,e)=>a+e.units,0),resumed.tree.spent);
});

test('recorded real Kimi synthesis can resume after interruption at depth five',async()=>{
  const s=await replayTree();
  const baseline=auditCognitiveTree(s.tree);
  const parents=Object.values(s.tree.nodes).filter(n=>n.status==='split')
    .sort((a,b)=>b.depth-a.depth);
  for(const node of parents.slice(0,5)){
    const c=node.children.map(p=>s.syntheses[p]||baseline.proofs[p]);
    journalSynthesis(s,node.path,recordedKimiSynthesis(node,c));
    assert.equal(commitSynthesis(s,node.path).status,'accepted');
  }
  assert.equal(finishSynthesis(s).complete,false,'cannot certify partial synthesis');
  const recovered=restore(checkpoint(s));
  for(const node of parents.slice(5)){
    const children=node.children.map(p=>recovered.syntheses[p]||baseline.proofs[p]);
    journalSynthesis(recovered,node.path,recordedKimiSynthesis(node,children));
    assert.equal(commitSynthesis(recovered,node.path).status,'accepted');
    assert.equal(commitSynthesis(recovered,node.path).status,'already_accepted');
  }
  assert.equal(finishSynthesis(recovered).rootDigest,SOURCE.rootDigest);
  assert.equal(recovered.tree.calls,21,'replayed synthesis did not rerun inference');
});
