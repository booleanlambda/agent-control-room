import test from 'node:test';
import assert from 'node:assert/strict';
import {BASELINE,CASES,authenticate,scriptedLightweight,settings,
  createExperiment,step,run,invariant,report,silasFaultHistogram} from './engine.mjs';
const mock=(n,c)=>scriptedLightweight(n,c);
test('Silas measured 100-wake baseline is an exact partition, not a model error estimate',()=>{
  assert.equal(BASELINE.completed+BASELINE.failed,100);
  assert.equal(Object.values(BASELINE.errors).reduce((a,b)=>a+b,0),63);
  const hist=silasFaultHistogram();
  assert.equal(hist.length,100);
  assert.equal(hist.filter(x=>x==='provider').length,7);
  assert.equal(hist.filter(x=>x==='budget').length,29);
  assert.deepEqual(hist,silasFaultHistogram());
  assert.notDeepEqual(hist,silasFaultHistogram(79));
});

test('stage 1 model-authored recursion terminates in 1 parent and 2 accepted leaves',async()=>{
  const s=createExperiment(settings(1));
  const r=await run(s,mock);
  assert.equal(r.complete,true);
  assert.equal(r.nodes.length,3);
  assert.equal(r.nodes.filter(n=>n.status==='complete').length,2);
  assert.deepEqual(r.nodes.map(n=>n.path),['R','R.001','R.002']);
  assert.equal(r.calls,3);
  assert.ok(r.spent>0&&r.remaining>0);
  assert.ok(invariant(s));
});

test('only model-authored strict partitions count as semantic children',()=>{
  const s=createExperiment(settings(1));
  assert.equal(authenticate(s.nodes.R,{action:'SPLIT',children:[['E01','E02'],['E02','E04']]},s.config).reason,
    'missing_or_duplicate_coverage');
  assert.equal(authenticate(s.nodes.R,{action:'SPLIT',children:[['E01','E02','E03','E04'],['E04']]},s.config).reason,
    'non_shrinking_child');
  assert.equal(Object.keys(s.nodes).length,1);
});

test('deterministic authenticator blocks plausible but incorrect diagnosis',async()=>{
  const s=createExperiment(settings(1),['E01','E02']);
  const wrong=async()=>({action:'ATOMIC',results:[
    {id:'E01',classification:'provider'},{id:'E02',classification:'provider'},
  ]});
  await step(s,wrong);
  assert.equal(Object.keys(s.nodes).length,1);
  assert.equal(s.nodes.R.resultHash,null);
  assert.equal(s.queue.length,1);
  assert.equal(s.nodes.R.lastError,'deterministic_oracle_mismatch');
  await step(s,wrong);
  assert.equal(s.nodes.R.status,'blocked');
  assert.equal(s.queue.length,0);
  assert.equal(s.calls,2);
});

test('504 and timeout-like transport rejection consumes attempts, not semantic depth',async()=>{
  const s=createExperiment(settings(1),['E01','E02']);
  const fail=await step(s,mock,{injectedFailure:'model_provider_http_504'});
  assert.equal(fail.status,'retryable');
  assert.equal(Object.keys(s.nodes).length,1);
  assert.equal(s.nodes.R.attempts,1);
  const success=await step(s,mock);
  assert.equal(success.status,'complete');
  assert.equal(Object.keys(s.nodes).length,1);
  assert.equal(s.calls,2);
  assert.ok(s.spent<=s.config.budgetTokens);
});

test('duplicate/stale wake never charges budget or overwrites durable evidence',async()=>{
  const s=createExperiment(settings(1),['E01','E02']);
  const snapshot=JSON.stringify(s);
  assert.equal((await step(s,mock,{stale:true})).status,'stale');
  assert.equal(s.spent,0);
  assert.equal(s.nodes.R.status,'pending');
  assert.equal(s.queue[0],'R');
  assert.ok(snapshot.length);
  await step(s,mock);
  const digest=s.nodes.R.resultHash;
  assert.equal(await step(s,mock),null);
  assert.equal(s.nodes.R.resultHash,digest);
  assert.equal(s.spent,s.ledger.reduce((a,e)=>a+e.units,0));
});

test('hard sample budget fails closed and never creates replacement epoch',async()=>{
  const s=createExperiment(settings(1,{budgetTokens:600}));
  const verdict=await step(s,mock);
  assert.equal(verdict.status,'budget_denied');
  assert.equal(s.calls,0);
  assert.equal(s.spent,0);
  assert.equal(s.nodes.R.status,'blocked');
  assert.equal(s.nodes.R.children.length,0);
  assert.equal(s.config.budgetTokens,600);
});

test('stage 2 grows to seven nodes only when explicitly selected',async()=>{
  const s=createExperiment(settings(2));
  const r=await run(s,mock);
  assert.equal(r.complete,true);
  assert.equal(r.nodes.length,7);
  assert.ok(r.nodes.every(n=>n.depth<=2));
  assert.ok(r.spent<=r.budget);
});

test('stage 3 grows to fifteen nodes under its distinct sample budget',async()=>{
  const s=createExperiment(settings(3));
  const r=await run(s,mock);
  assert.equal(r.complete,true);
  assert.equal(r.nodes.length,15);
  assert.ok(r.nodes.every(n=>n.depth<=3));
  assert.ok(r.spent<=r.budget);
});

test('resumption retains the same ledger and budget (no wake-level token reset)',async()=>{
  const s=createExperiment(settings(1));
  await step(s,mock);
  const checkpoint=JSON.parse(JSON.stringify(s));
  const r=await run(checkpoint,mock);
  assert.equal(r.complete,true);
  assert.equal(r.calls,3);
  assert.equal(r.spent,r.events.reduce((a,e)=>a+e.units,0));
  assert.ok(invariant(checkpoint));
});

test('a rejected model split does not contaminate subsequent successful attempt',async()=>{
  const s=createExperiment(settings(1));
  const bad=async()=>({action:'SPLIT',children:[['E01'],['E02']]});
  await step(s,bad);
  assert.equal(Object.keys(s.nodes).length,1);
  await step(s,mock);
  assert.equal(Object.keys(s.nodes).length,3);
  assert.equal(s.nodes.R.attempts,2);
  assert.equal(s.ledger.filter(e=>e.kind==='auth_rejected').length,1);
});
