import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newExecutionLab,checkpoint,restore,advance,claim,deliver,commit,providerError,
  recover,drain,finishSynthesis,journalSynthesis,commitSynthesis,assertExecution
} from './execution-integrity.mjs';
import {lightModelDouble} from './depth10-traversability.mjs';
import {auditCognitiveTree,scriptedSynthesis} from './cognitive-integrity.mjs';

const target=depth=>'R'+'.002'.repeat(depth);
const spine=()=>newExecutionLab({shape:'spine',budget:55000});
async function fullSpine(faultFor){
  const s=spine();const out=await drain(s,{faultFor});return {s,out};
}
test('clean ten-deep 21-node chain closes with all leaves, no duplicate charges',async()=>{
  const {s,out}=await fullSpine();
  assert.equal(out.complete,true);
  assert.equal(out.nodes,21);
  assert.equal(out.depth,10);
  assert.equal(out.splits,10);
  assert.equal(out.leaves,11);
  assert.equal(out.calls,21);
  assert.equal(s.tree.spent,s.tree.ledger.reduce((n,e)=>n+e.units,0));
  assert.equal(auditCognitiveTree(s.tree).complete,true);
  assert.ok(assertExecution(s));
});
test('depth-seven abandoned provider wake recovers once without creating phantom children',async()=>{
  const path=target(7);
  const {s,out}=await fullSpine(({path:p,attempt})=>p===path&&attempt===1?'TIMEOUT_ORPHAN':null);
  assert.equal(out.complete,true);
  assert.equal(out.nodes,21);
  assert.equal(out.calls,22);
  assert.equal(s.attempts[path],2);
  assert.equal(s.tree.nodes[path].attempts,1);
  assert.equal(out.trace.filter(t=>t.fault==='TIMEOUT_ORPHAN').length,1);
  assert.equal(s.tree.ledger.filter(e=>e.path===path&&e.kind==='semantic_split_accepted').length,1);
  assert.equal(s.transportErrors.filter(e=>e.path===path).length,1);
});
test('model answers before a crash at depth ten: journal replay commits once with no reprompt',async()=>{
  const path=target(10);
  const {s,out}=await fullSpine(({path:p,attempt})=>p===path&&attempt===1?'CRASH_AFTER_RESPONSE':null);
  assert.equal(out.complete,true);
  assert.equal(out.calls,21,'durable inbox recovery must avoid an extra provider call');
  assert.equal(s.attempts[path],1);
  assert.equal(s.tree.nodes[path].attempts,1);
  assert.equal(s.tree.ledger.filter(e=>e.path===path&&e.kind==='provider_answer_journaled').length,1);
  assert.equal(s.tree.ledger.filter(e=>e.path===path&&e.kind==='atomic_accepted').length,1);
  const recovered=out.trace.find(t=>t.fault==='CRASH_AFTER_RESPONSE').recovered;
  assert.equal(recovered[0].kind,'journal_recovered');
  const snapshot=checkpoint(s);assert.deepEqual(restore(snapshot),s);
});
test('three provider timeouts then 60-minute cooldown then recovery, without semantic cycle lock',async()=>{
  const {s,out}=await fullSpine(({path,attempt})=>path==='R'&&attempt<=3?'TIMEOUT_ORPHAN':null);
  assert.equal(out.complete,true);
  assert.equal(out.calls,24);
  assert.equal(out.nodes,21);
  assert.equal(s.attempts.R,4);
  assert.equal(s.tree.nodes.R.attempts,1);
  assert.ok(s.clock>=3600000);
  assert.equal(s.tree.ledger.filter(e=>e.kind==='provider_cooldown_60m').length,1);
  assert.equal(s.tree.ledger.filter(e=>e.kind==='semantic_split_accepted'&&e.path==='R').length,1);
});
test('six terminal timeouts stop without epoch reset, depth change or infinite queue',async()=>{
  const {s,out}=await fullSpine(({path})=>path==='R'?'TIMEOUT_ORPHAN':null);
  assert.equal(out.complete,false);
  assert.equal(out.nodes,1);
  assert.equal(out.calls,6);
  assert.equal(s.tree.nodes.R.status,'blocked');
  assert.equal(s.tree.nodes.R.attempts,0);
  assert.equal(s.tree.queue.length,0);
  assert.equal(Object.keys(s.leases).length,0);
  assert.equal(s.tree.ledger.filter(e=>e.kind==='provider_exhausted_after_six').length,1);
  assert.ok(assertExecution(s));
});
test('duplicate broker claim, duplicate response and duplicate commit are idempotent',async()=>{
  const s=spine(),first=claim(s,'R');
  assert.equal(first.status,'claimed');
  assert.equal(claim(s,'R').status,'already_claimed');
  const response=await lightModelDouble(s.tree.nodes.R,s.tree.config);
  assert.equal(deliver(s,first,response).status,'journaled');
  assert.equal(deliver(s,first,response).status,'duplicate_delivery');
  assert.equal(commit(s,first).status,'split');
  const spent=s.tree.spent, count=s.tree.calls,paths=Object.keys(s.tree.nodes);
  assert.equal(commit(s,first).status,'stale_commit');
  assert.equal(deliver(s,first,response).status,'stale_delivery');
  assert.deepEqual(Object.keys(s.tree.nodes),paths);
  assert.equal(s.tree.spent,spent);
  assert.equal(s.tree.calls,count);
});
test('expired lease fencing rejects late reply, but fresh replacement can be authenticated',async()=>{
  const s=spine();const first=claim(s,'R',{leaseMs:1000});
  advance(s,1000);const recovered=recover(s);
  assert.equal(recovered[0].kind,'lease_timeout');
  assert.equal(deliver(s,first,{action:'SPLIT',splitAt:1}).status,'stale_delivery');
  const next=claim(s,'R');
  assert.notEqual(next.token,first.token);
  assert.notEqual(next.dispatch,first.dispatch);
  const reply=await lightModelDouble(s.tree.nodes.R,s.tree.config);
  assert.equal(deliver(s,next,reply).status,'journaled');
  assert.equal(commit(s,first).status,'stale_commit');
  assert.equal(commit(s,next).status,'split');
  assert.equal(s.tree.nodes.R.children.length,2);
});
test('after-response journal survives checkpoint reload and seals exactly once',async()=>{
  const s=spine(),r=claim(s,'R',{leaseMs:1000});
  deliver(s,r,{action:'SPLIT',splitAt:1});
  const restarted=restore(checkpoint(s));
  advance(restarted,1000);
  const recovered=recover(restarted);
  assert.equal(recovered[0].kind,'journal_recovered');
  assert.equal(restarted.tree.calls,1);
  assert.equal(restarted.tree.nodes.R.status,'split');
  assert.equal(restarted.tree.nodes.R.children.length,2);
  assert.equal(recover(restarted).length,0);
  assert.equal(commit(restarted,r).status,'stale_commit');
});
test('429 rate throttling defers provider only, preserves logical work and recharge',async()=>{
  const {s,out}=await fullSpine(({path,attempt})=>
    path===target(3)&&attempt===1?'HTTP_429':null);
  assert.equal(out.complete,true);
  assert.equal(out.calls,22);
  assert.ok(s.clock>=23000);
  assert.equal(s.tree.nodes[target(3)].attempts,1);
  assert.equal(out.nodes,21);
  assert.equal(s.transportErrors.filter(e=>e.message==='HTTP_429').length,1);
});
test('permanent 404 fails once and never becomes a cognitive error or new branch',async()=>{
  const s=spine(),r=claim(s,'R');
  assert.equal(providerError(s,r,'MOONSHOT_HTTP_404').status,'permanent_provider_failure');
  assert.equal(s.tree.nodes.R.status,'blocked');
  assert.equal(s.tree.nodes.R.attempts,0);
  assert.equal(s.tree.calls,1);
  assert.equal(s.tree.queue.length,0);
  assert.equal(s.tree.nodes.R.children.length,0);
});
test('wrong child decision blocks root attestation but does not erase accepted sibling leaf',async()=>{
  const path='R.001';
  const s=spine();
  const bad=async (node,c)=>node.path===path
    ?{action:'ATOMIC',id:'CASE-0001',classification:'provider'}:
      lightModelDouble(node,c);
  const out=await drain(s,{model:bad});
  assert.equal(out.complete,false);
  assert.equal(s.tree.nodes[path].status,'blocked');
  assert.equal(s.tree.nodes['R.002'].status,'split');
  assert.equal(auditCognitiveTree(s.tree).complete,false);
  assert.equal(s.tree.nodes[path].attempts,2);
  assert.equal(s.tree.ledger.filter(e=>e.kind==='cognitive_rejected').length,2);
});
test('queue corruption and bogus lease entries cannot pass checkpoint validation',()=>{
  const s=spine(),r=claim(s,'R');
  const broken=structuredClone(s);
  broken.tree.queue.push('R');
  assert.throws(()=>restore(JSON.stringify(broken)),/invalid_lease_state/);
  const duplicate=spine();
  duplicate.tree.queue.push('R');
  assert.throws(()=>restore(JSON.stringify(duplicate)),/duplicate_queue_delivery/);
  assert.ok(r.dispatch);
});
test('insufficient budget cannot trigger provider call or speculative child',()=>{
  const s=newExecutionLab({shape:'spine',budget:100});
  const r=claim(s,'R');
  assert.equal(r.status,'budget_denied');
  assert.equal(s.tree.calls,0);assert.equal(s.tree.spent,0);
  assert.equal(s.tree.nodes.R.status,'blocked');
  assert.equal(Object.keys(s.tree.nodes).length,1);
});
test('10 parent syntheses survive checkpoint after interruption and duplicate response',async()=>{
  const {s,out}=await fullSpine();
  assert.equal(out.complete,true);
  const trusted=auditCognitiveTree(s.tree);
  const parents=Object.values(s.tree.nodes).filter(n=>n.status==='split').sort((a,b)=>b.depth-a.depth);
  function answerFor(current,node){
    const children=node.children.map(p=>current.syntheses[p]||trusted.proofs[p]);
    const expected=scriptedSynthesis(node,children);
    return {summary:expected.summary,slots:[0,1],counts:expected.counts,covered:expected.covered};
  }
  for(const node of parents.slice(0,4)){
    assert.equal(journalSynthesis(s,node.path,answerFor(s,node)).status,'journaled');
    assert.equal(commitSynthesis(s,node.path).status,'accepted');
  }
  assert.equal(finishSynthesis(s).complete,false);
  const restart=restore(checkpoint(s));
  for(const node of parents.slice(4)){
    assert.equal(journalSynthesis(restart,node.path,answerFor(restart,node)).status,'journaled');
    if(node.depth===4){
      const saved=restore(checkpoint(restart));
      assert.equal(commitSynthesis(saved,node.path).status,'accepted');
      assert.equal(commitSynthesis(saved,node.path).status,'already_accepted');
      Object.assign(restart,saved);
    }else assert.equal(commitSynthesis(restart,node.path).status,'accepted');
  }
  const proven=finishSynthesis(restart);
  assert.equal(proven.complete,true);
  assert.equal(proven.acceptedParents,10);
  assert.equal(proven.acceptedLeaves,11);
  assert.match(proven.rootDigest,/^[a-f0-9]{64}$/);
  assert.equal(restart.tree.calls,21,'no provider calls charged during synthesis replay');
});
test('2047-node balanced tree remains traversable with depth-0/3/7/10 transport faults',async()=>{
  const s=newExecutionLab({shape:'balanced',budget:1800000});
  const marked=new Set(['R','R.002.002.002','R'+'.002'.repeat(7),'R'+'.002'.repeat(10)]);
  const out=await drain(s,{limit:10000,faultFor:({path,attempt})=>
    marked.has(path)&&attempt===1?'HTTP_504':null});
  assert.equal(out.complete,true);
  assert.equal(out.depth,10);
  assert.equal(out.nodes,2047);
  assert.equal(out.calls,2051);
  assert.equal(out.orphans,0);
  assert.equal(new Set(Object.keys(s.tree.nodes)).size,2047);
  assert.equal(Object.keys(s.leases).length,0);
  assert.ok(assertExecution(s));
});
