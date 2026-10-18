import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicProblem,hiddenProblems,grade,exactOracle,assessPublic,sha} from './benchmark.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('one truly new non-scheduling benchmark; feasible distinct public and held-out exact solutions',()=>{
 const cases=[publicProblem,...hiddenProblems];
 assert.equal(cases.length,3);
 assert.equal(new Set(cases.map(sha)).size,3);
 for(const p of cases){
  assert.equal(p.controls.length,12);
  const opt=exactOracle(p);
  assert.equal(opt.examined,4096);
  assert.ok(opt.feasible>0&&opt.cost>0);
  assert.equal(grade(p,opt).passed,true);
  assert.equal(assessPublic(p,opt).passed,true);
  assert.equal(assessPublic(p,{selected:['A'],cost:8}).passed,false);
 }
});
test('reference grader blocks missing dependencies, constraints, exclusions, nonoptimal and incorrect cost',()=>{
 const r=grade(publicProblem,{selected:['A'],cost:8});
 assert.equal(r.kind,'dependency_missing');
 assert.equal(grade(publicProblem,{selected:['B','F'],cost:14}).kind,'exclusion_violated');
 assert.equal(grade(publicProblem,{selected:['A','D'],cost:10}).kind,'group_unsatisfied');
 const opt=exactOracle(publicProblem);
 assert.equal(grade(publicProblem,{selected:opt.selected,cost:opt.cost+1}).kind,'cost_mismatch');
});
test('RabbitMQ dispatch is serial one-worker phase state machine with separately durable Neon outbox',()=>{
 const src=read('./live.mjs'),ledger=read('./ledger.mjs'),sql=read('./schema.sql');
 assert.match(src,/await ch\.prefetch\(1\)/);
 assert.match(src,/await publishPending\(\)/);
 assert.match(src,/await db\.advance\(/);
 assert.match(src,/ch\.ack\(msg\)/);
 assert.match(src,/thinking:\{type:'disabled'\}/);
 assert.match(src,/temperature:0\.6/);
 assert.match(src,/await db\.beginCall\(/);
 assert.match(ledger,/for update/);
 assert.match(ledger,/insert into aau_research_v23\.outbox/);
 assert.match(ledger,/insert into aau_research_v23\.calls/);
 assert.match(sql,/alter table aau_research_v23\.calls enable row level security/);
 assert.match(src,/ch\.deleteQueue\(queue\)/);
});
test('remediation patches unique source span, never supplies an embedded task-specific solver',()=>{
 const src=read('./live.mjs');
 assert.match(src,/state\.source\.split\(old\)\.length-1/);
 assert.match(src,/occurrences===1/);
 assert.match(src,/state\.repairAttempts>=2/);
 assert.match(src,/publicFailure:state\.lastCheck\.publicFeedback/);
 assert.match(src,/await runIsolatedPython\(code,publicProblem/);
 assert.match(src,/for\(const input of hiddenProblems\)/);
 assert.match(src,/holdouts\.every\(x=>x\.passed\)/);
 assert.match(src,/report\.architecture\?\.passed/);
 assert.doesNotMatch(src,/searchBestCandidate|certifyImproved|beamOptimize/);
});
