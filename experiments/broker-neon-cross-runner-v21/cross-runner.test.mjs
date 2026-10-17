import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {publicProblem,exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {rootPartitions,solvePartition} from '../rabbitmq-proof-frontier-v17/partition.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('phase 1 commits Neon state and verifies SIGKILL before exporting handoff',()=>{
 const s=read('./phase1.mjs');
 assert.match(s,/await store.init\(/);
 assert.match(s,/await pub.waitForConfirms\(\)/);
 assert.match(s,/AAU_V20_PHASE:'crash'/);
 assert.match(s,/victim.signal!=='SIGKILL'/);
 assert.match(s,/after.completed!==1/);
 assert.match(s,/after.pending!==2/);
 assert.match(s,/ready!==4/);
 assert.ok(s.indexOf('await store.init(')<s.indexOf('spawnSync('));
});
test('phase 2 never creates a missing queue, validates historic proof and cleans only run queue',()=>{
 const s=read('./phase2.mjs');
 assert.match(s,/await channel.checkQueue\(queue\)/);
 assert.doesNotMatch(s,/assertQueue\(/);
 assert.match(s,/UNTRUSTED_PHASE1_CHECKPOINT/);
 assert.match(s,/NEON_CROSS_JOB_CHECKPOINT_NOT_PERSISTED/);
 assert.match(s,/parsed.redelivered!==1/);
 assert.match(s,/parsed.duplicates!==2/);
 assert.match(s,/parsed.acks!==4/);
 assert.match(s,/await channel.deleteQueue\(queue\)/);
 assert.ok(s.indexOf('await store.verify()')<s.indexOf('spawnSync('));
});
test('independent V6 exact oracle and three partition witnesses cover 448 cases',()=>{
 const roots=rootPartitions(publicProblem);
 assert.equal(roots.length,3);
 const results=roots.map(root=>solvePartition(publicProblem,root.entry));
 for(const s of results){
  const checked=evaluate(publicProblem,{schedule:s.schedule,cost:s.cost});
  assert.equal(checked.ok,true);assert.equal(checked.cost,s.cost);
 }
 assert.deepEqual(results.map(x=>x.explored),[240,104,104]);
 assert.equal(Math.min(...results.map(x=>x.cost)),415);
 assert.equal(exactOracle(publicProblem).cost,415);
});
test('workflow stage boundary uses separate jobs and handles nonsecret artifact only',()=>{
 const wf=read('../../.github/workflows/broker-neon-cross-runner-v21.yml');
 assert.match(wf,/\n  phase1_publisher_crash:/);
 assert.match(wf,/\n  phase2_independent_recovery:/);
 assert.match(wf,/needs: phase1_publisher_crash/);
 assert.match(wf,/actions\/download-artifact@v4/);
 assert.match(wf,/actions\/upload-artifact@v4/);
 assert.match(wf,/NEON_V19_DATABASE_URL: \$\{\{ secrets.NEON_V19_DATABASE_URL \}\}/);
 assert.match(wf,/AMQP_URL: \$\{\{ secrets.AMQP \}\}/);
 assert.match(wf,/timeout-minutes: 7/);
 assert.doesNotMatch(wf,/workflow_dispatch/);
});
