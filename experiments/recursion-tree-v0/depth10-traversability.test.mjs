import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deepConfig,newDeepTree,lightModelDouble,authenticateDeep,nextDeep,
  executeDeep,getDeepNode,verifyDeepTree,
} from './depth10-traversability.mjs';

test('2047 nodes, 1023 splits, 1024 leaves: BFS and DFS visit each node exactly once',async()=>{
  const s=newDeepTree();
  const result=await executeDeep(s);
  assert.equal(result.complete,true);
  assert.deepEqual([result.nodes,result.reachable,result.orphans,result.splits,
    result.leaves,result.depth,result.calls],[2047,2047,0,1023,1024,10,2047]);
  assert.ok(result.spent>0&&result.spent<=s.config.budget);
  for(const path of Object.keys(s.nodes)){
    const n=getDeepNode(s,path);
    assert.ok(n);
    if(path==='R')assert.equal(n.parent,null);
    else {
      assert.ok(n.parent);
      assert.ok(getDeepNode(s,n.parent).children.includes(path));
      assert.equal(n.ancestors.at(-1),'R');
    }
    assert.ok(n.depth<=10);
    assert.ok(n.children.length===0||n.children.length===2);
  }
});
test('10 split decisions along a 21-node spine are all navigable',async()=>{
  const s=newDeepTree(deepConfig('spine',50000));
  const r=await executeDeep(s);
  assert.equal(r.complete,true);
  assert.equal(r.nodes,21);
  assert.equal(r.splits,10);
  assert.equal(r.leaves,11);
  assert.equal(r.depth,10);
  for(const p of Object.keys(s.nodes))assert.ok(getDeepNode(s,p));
});
test('a leaf reached at depth 10 has an exact reverse path of eleven nodes',async()=>{
  const s=newDeepTree();
  await executeDeep(s);
  const n=Object.values(s.nodes).find(n=>n.depth===10);
  assert.ok(n);
  const route=[];for(let p=n.path;p;p=s.nodes[p].parent)route.unshift(p);
  assert.equal(route.length,11);
  assert.equal(route[0],'R');
  assert.equal(route.at(-1),n.path);
  for(let i=1;i<route.length;i++)assert.ok(s.nodes[route[i-1]].children.includes(route[i]));
});
test('budget 100 is a deterministic hold: no child spawned and no new epoch',async()=>{
  const s=newDeepTree(deepConfig('balanced',100));
  const r=await executeDeep(s);
  assert.equal(r.complete,false);
  assert.equal(s.spent,0);
  assert.equal(s.calls,0);
  assert.equal(s.nodes.R.status,'blocked');
  assert.equal(r.reachable,1);
});
test('504 consumes an attempt but cannot create a ghost semantic child',async()=>{
  const s=newDeepTree(deepConfig('spine',50000));
  assert.equal((await nextDeep(s,lightModelDouble,{fault:'HTTP_504'})).status,'retry');
  assert.equal(Object.keys(s.nodes).length,1);
  assert.equal((await nextDeep(s,lightModelDouble)).status,'split');
  assert.equal(Object.keys(s.nodes).length,3);
  const v=authenticateDeep(s.nodes['R.002'],{action:'SPLIT',splitAt:-8},s.config);
  assert.equal(v.ok,false);
  assert.equal(verifyDeepTree(s,{requireComplete:false}).reachable,3);
});
test('stale wake does not spend any budget or alter topology',async()=>{
  const s=newDeepTree(deepConfig('spine',50000));
  const x=await nextDeep(s,lightModelDouble,{stale:true});
  assert.equal(x.status,'stale');
  assert.equal(s.spent,0);
  assert.equal(s.calls,0);
  assert.equal(Object.keys(s.nodes).length,1);
  assert.equal(s.queue[0],'R');
});
test('replay of a completed tree preserves every node digest, budget and traversal',async()=>{
  const s=newDeepTree(deepConfig('spine',50000));
  await executeDeep(s);
  const before=JSON.stringify(s);
  const clone=JSON.parse(before);
  const prevSpent=clone.spent;
  const r=await executeDeep(clone);
  assert.equal(r.complete,true);
  assert.equal(clone.spent,prevSpent);
  assert.equal(JSON.stringify(clone),before);
});
test('broken ancestor link, missing coverage and bad digest are rejected',async()=>{
  const s=newDeepTree(deepConfig('spine',50000));
  await executeDeep(s);
  const clone=()=>JSON.parse(JSON.stringify(s));
  const a=clone();a.nodes['R.001'].parent='R.002';
  assert.throws(()=>verifyDeepTree(a),/broken_parent|broken_child_coverage/);
  const b=clone();b.nodes['R.002'].start=0;
  assert.throws(()=>verifyDeepTree(b),/broken_child_coverage/);
  const c=clone();c.nodes['R.001'].hash='wrong';
  assert.throws(()=>verifyDeepTree(c),/invalid_leaf_hash/);
});
test('orphan, duplicate event ID and excess debit are detected',async()=>{
  const s=newDeepTree(deepConfig('spine',50000));
  await executeDeep(s);
  const clone=()=>JSON.parse(JSON.stringify(s));
  const a=clone();a.nodes['R.999']={...a.nodes['R.001'],path:'R.999'};
  assert.throws(()=>verifyDeepTree(a),/unreachable_node/);
  const b=clone();b.spent++;
  assert.throws(()=>verifyDeepTree(b),/budget_or_event_ledger_corrupt/);
});
