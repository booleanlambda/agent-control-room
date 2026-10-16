import test from 'node:test';
import assert from 'node:assert/strict';
import {deepConfig,newDeepTree,lightModelDouble,executeDeep,authenticateDeep}
  from './depth10-traversability.mjs';
import {auditCognitiveTree,scriptedSynthesis,authenticateParentSynthesis}
  from './cognitive-integrity.mjs';

const atDepth=n=>'R'+'.002'.repeat(n);
const clone=s=>structuredClone(s);
const cleanTree=async()=>{
  const s=newDeepTree(deepConfig('balanced',1800000));
  assert.equal((await executeDeep(s)).complete,true);
  return s;
};
const injectDecision=async(depth,badAnswer)=>{
  const s=newDeepTree(deepConfig('balanced',1800000));
  const target=atDepth(depth);
  const bad=async(node,config)=>node.path===target
    ?badAnswer(node,config):lightModelDouble(node,config);
  const outcome=await executeDeep(s,bad);
  const audit=auditCognitiveTree(s);
  assert.equal(outcome.complete,false);
  assert.equal(audit.complete,false);
  assert.equal(s.nodes[target].status,'blocked');
  assert.equal(s.nodes[target].attempts,2);
  assert.equal(s.nodes[target].children.length,0);
  assert.equal(s.ledger.filter(e=>e.kind==='rejected'&&e.path===target).length,2);
  assert.equal(audit.rootDigest,null);
  assert.ok(audit.rejectedNodes.some(x=>x.path===target));
  assert.ok(audit.acceptedLeaves>=0);
  return {s,audit,target};
};

test('2,047-node clean tree cannot be accepted without 1,024 verified leaves and 1,023 parent attestations',async()=>{
  const s=await cleanTree();
  const before=JSON.stringify(s);
  const audit=auditCognitiveTree(s);
  assert.equal(audit.complete,true);
  assert.equal(audit.traversed,2047);
  assert.equal(audit.accepted,2047);
  assert.equal(audit.acceptedLeaves,1024);
  assert.equal(audit.acceptedParents,1023);
  assert.equal(audit.rejected,0);
  assert.match(audit.rootDigest,/^[0-9a-f]{64}$/);
  assert.equal(audit.proofs.R.childEvidence.length,2);
  assert.equal(audit.proofs.R.covered,1024);
  assert.equal(Object.values(audit.proofs.R.counts).reduce((a,b)=>a+b),1024);
  assert.equal(JSON.stringify(s),before,'read-only attestation must not alter execution tree');
});

test('invalid cognitive decisions at depths 0,3,7,9 are rejected without ghost children or ancestor acceptance',async()=>{
  for(const depth of [0,3,7,9]){
    const {s,audit}=await injectDecision(depth,()=>({action:'UNSUPPORTED_ACTION'}));
    assert.ok(audit.rejected>=1, 'blocked node must have a rejected chain');
    assert.equal(s.spent,s.ledger.reduce((sum,e)=>sum+e.units,0));
    if(depth>0)assert.ok(audit.accepted>0,'independent siblings should survive');
    assert.ok(audit.rejectedNodes.some(x=>x.path==='R'));
  }
});

test('model-provided incomplete child manifest at depths 0,3,7,9 is rejected instead of ignored',async()=>{
  for(const depth of [0,3,7,9]){
    const {s,target}=await injectDecision(depth,node=>({
      action:'SPLIT',splitAt:Math.floor((node.start+node.end)/2),
      children:[{path:node.path+'.001'}],
    }));
    const rejects=s.ledger.filter(e=>e.kind==='rejected'&&e.path===target);
    assert.ok(rejects.every(e=>e.reason==='unexpected_children_payload'));
  }
});

test('invalid split boundary and missing split boundary fail without child creation',()=>{
  const n={path:'R',depth:0,start:0,end:1024,children:[]};
  const config=deepConfig();
  for(const response of [
    {action:'SPLIT'},
    {action:'SPLIT',splitAt:0},
    {action:'SPLIT',splitAt:1024},
    {action:'SPLIT',splitAt:4.5},
    {action:'SPLIT',splitAt:512,children:[]},
  ])assert.equal(authenticateDeep(n,response,config).ok,false);
});

test('missing persisted child at depths 1,5,10 poisons its exact parent and prevents root certification',async()=>{
  const baseline=await cleanTree();
  for(const depth of [1,5,10]){
    const s=clone(baseline),target=atDepth(depth),parent=atDepth(depth-1);
    delete s.nodes[target];
    const audit=auditCognitiveTree(s);
    assert.equal(audit.complete,false);
    assert.equal(audit.rootDigest,null);
    assert.ok(audit.preflightErrors.some(e=>e.reason==='missing_child_node'));
    assert.ok(audit.rejectedNodes.some(e=>e.path===parent&&e.reason==='missing_child_node'));
    assert.ok(audit.accepted>0);
  }
});

test('incorrect terminal cognitive answer at depth 10 never certifies ancestor synthesis',async()=>{
  const s=await cleanTree(),target=atDepth(10);
  const actual=s.nodes[target].result.classification;
  s.nodes[target].result.classification=actual==='provider'?'budget':'provider';
  const audit=auditCognitiveTree(s);
  assert.equal(audit.complete,false);
  assert.equal(audit.rootDigest,null);
  assert.ok(audit.rejectedNodes.some(e=>e.path===target&&e.reason==='leaf_result_mismatch'));
  assert.ok(audit.rejectedNodes.some(e=>e.path==='R'&&e.reason==='child_unverified'));
  assert.ok(audit.acceptedLeaves>=1023);
});

test('empty or whitespace-only synthesis at depths 0,3,7,9 blocks exact node and all ancestors',async()=>{
  const base=await cleanTree();
  for(const depth of [0,3,7,9]){
    const path=atDepth(depth);
    const audit=auditCognitiveTree(base,{proposeSynthesis:(node,children)=>
      node.path===path?{...scriptedSynthesis(node,children),summary:'   '}
        :scriptedSynthesis(node,children)});
    assert.equal(audit.complete,false);
    assert.equal(audit.rootDigest,null);
    assert.ok(audit.rejectedNodes.some(e=>e.path===path&&e.reason==='empty_synthesis'));
    assert.ok(audit.rejectedNodes.some(e=>e.path==='R'));
    assert.equal(audit.acceptedLeaves,1024);
    assert.equal(audit.acceptedParents,1023-(depth+1));
  }
});

test('stale or forged child hashes never satisfy parent provenance',async()=>{
  const s=await cleanTree(),target=atDepth(7);
  const audit=auditCognitiveTree(s,{proposeSynthesis:(n,c)=>{
    const claim=scriptedSynthesis(n,c);
    if(n.path===target)claim.children[0].digest='0'.repeat(64);
    return claim;
  }});
  assert.equal(audit.complete,false);
  assert.ok(audit.rejectedNodes.some(e=>e.path===target&&e.reason==='child_digest_mismatch'));
  assert.equal(audit.rootDigest,null);
});

test('duplicate child provenance and inflated result counts are independently rejected',async()=>{
  const s=await cleanTree(),target=atDepth(9);
  for(const makeBad of [
    (claim)=>{claim.children[1]={...claim.children[0]};},
    (claim)=>{claim.counts.budget++;},
    (claim)=>{claim.covered++;},
    (claim)=>{claim.children.pop();},
  ]){
    const audit=auditCognitiveTree(s,{proposeSynthesis:(n,c)=>{
      const claim=scriptedSynthesis(n,c);
      if(n.path===target)makeBad(claim);
      return claim;
    }});
    assert.equal(audit.complete,false);
    assert.equal(audit.rootDigest,null);
    assert.ok(audit.rejectedNodes.some(e=>e.path===target));
  }
});

test('read-only audit is deterministic through JSON checkpoint reload',async()=>{
  const s=await cleanTree();
  const a=auditCognitiveTree(s),b=auditCognitiveTree(JSON.parse(JSON.stringify(s)));
  assert.equal(a.rootDigest,b.rootDigest);
  assert.deepEqual(a.results,b.results);
  assert.equal(a.complete,true);
});

test('invalid execution ledger prevents root acceptance even if every semantic node is correct',async()=>{
  const s=await cleanTree();
  s.spent+=1;
  const audit=auditCognitiveTree(s);
  assert.equal(audit.rootDigest,null);
  assert.equal(audit.complete,false);
  assert.ok(audit.preflightErrors.some(e=>e.reason==='execution_ledger_invalid'));
});
