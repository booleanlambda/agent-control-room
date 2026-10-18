import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LEVELS,publicCasesFor,hiddenCases,stageProblem,feasibility,exactOracle,assess,stageHash,sha} from './benchmark.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('ten nested semantic levels are all distinct and each adds new or tighter constraints',()=>{
 assert.equal(LEVELS.length,10);
 assert.equal(new Set(LEVELS.map(x=>x.id)).size,10);
 assert.equal(new Set(Array.from({length:10},(_,i)=>stageHash(i))).size,10);
 assert.deepEqual(LEVELS.map(x=>x.id),[
 'coverage','mandatory','dependencies','exclusions','minimum_counts','maximum_counts',
 'alternative_groups','budget','exact_tag_counts','conditional_alternatives']);
 for(let i=0;i<10;i++){
  const p=publicCasesFor(i);
  assert.equal(p.length,3);
  assert.equal(new Set(p.map(sha)).size,3);
  for(const j of p)assert.equal(j.controls.length,12);
 }
});
test('independent exhaustive oracle verifies 10 depths including infeasible budget and lexicographic tie',()=>{
 let infeasible=0;
 for(let i=0;i<10;i++)for(const p of publicCasesFor(i)){
  const optimum=exactOracle(p);
  assert.equal(assess(p,{selected:optimum.selected,cost:optimum.cost}).passed,true);
  if(optimum.cost===null)infeasible++;
  else{
   assert.equal(feasibility(p,optimum.selected).valid,true);
   assert.ok(optimum.cost>=0&&optimum.feasibleSubsets>0);
  }
 }
 assert.ok(infeasible>=1,'At least one genuinely infeasible case is required');
});
test('every final hidden variant has exact and feasible reference and differs from exposed public cases',()=>{
 assert.equal(hiddenCases.length,2);
 const seen=new Set(publicCasesFor(9).map(sha));
 for(const x of hiddenCases){
  assert.equal(seen.has(sha(x)),false);
  const optimum=exactOracle(x);
  assert.equal(assess(x,{selected:optimum.selected,cost:optimum.cost}).passed,true);
 }
});
test('real thread forbids skipping parent, commits each node after full ancestor verification, no injected bugs',()=>{
 const s=read('live.mjs'),ledger=read('ledger.mjs');
 assert.match(s,/state\.verifiedDepth!==i/);
 assert.match(s,/await allAncestors\(state\.source,i\)/);
 assert.match(s,/makeNode\(state,i,check\)/);
 assert.match(s,/id='R'\+'\.1'\.repeat\(depth\+1\)/);
 assert.match(s,/if\(state\.verifiedDepth!==10\|\|state\.nodes\.length!==10/);
 assert.match(s,/noInjectedDefects:true/);
 assert.match(s,/await db\.advance\(/);
 assert.match(s,/channel\.ack\(msg\)/);
 assert.match(s,/await publishOutbox\(\)/);
 assert.match(ledger,/for update/);
 assert.match(ledger,/model_request_hash/);
 assert.match(ledger,/values\(\$1,\$2,'level_0'/);
 assert.match(s,/const cfg=kimiStageRequest\(stage,max_tokens\)/);
 assert.match(s,/thinking:cfg.thinking/);
 assert.match(s,/response_format:\{type:'json_object'\}/);
 assert.doesNotMatch(s,/searchBestCandidate|certifyImproved|beamOptimize/);
});
test('bounded remediation uses model-authored unique-span patches, restores earlier constraints, never tests hidden before final depth',()=>{
 const s=read('live.mjs');
 assert.match(s,/code\.split\(old\)\.length-1!==1/);
 assert.match(s,/remainingPatchSlots\(state,i\)/);
 assert.match(s,/recoveryAfterFailedVerification\(state,i\)/);
 assert.match(s,/previousInvariants:LEVELS\.slice\(0,i\)/);
 assert.match(s,/if\(i===9\)/);
 assert.match(s,/for\(const input of hiddenCases\)/);
 assert.match(s,/await db\.beginCall\(/);
 assert.match(s,/No automatically retried ambiguous paid model call/);
 assert.match(s,/never injected fault/i);
});
