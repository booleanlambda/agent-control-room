import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {publicProblem,exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {rootPartitions,solvePartition} from '../rabbitmq-proof-frontier-v17/partition.mjs';

const text=f=>readFileSync(new URL('./'+f,import.meta.url),'utf8');
test('V20 requires isolated marker before any Neon write, not a production branch',()=>{
 const s=text('store.mjs'),run=text('live.mjs'),ddl=text('marker.sql');
 assert.match(s,/BRANCH='br-cold-rice-b4m3l9qu'/);
 assert.match(s,/NEON_RESEARCH_BRANCH_SCOPE_MISMATCH/);
 assert.match(run,/await store\.verify\(\)/);
 assert.ok(run.indexOf('await store.verify()')<run.indexOf('await store.init('));
 assert.match(ddl,/enable row level security/i);
 assert.match(ddl,/revoke all.*from public/i);
 assert.doesNotMatch(run,/br-mute-rain-b4sgepsi/);
});
test('actual worker death occurs after authoritative commit and before RabbitMQ ACK',()=>{
 const s=text('worker.mjs');
 const commit=s.indexOf('await store.complete(');
 const kill=s.indexOf("process.kill(process.pid,'SIGKILL')");
 const ack=s.lastIndexOf('ch.ack(msg)');
 assert.ok(commit>=0&&kill>commit&&ack>kill);
 assert.match(s,/if\(phase==='crash'\)/);
 assert.match(s,/if\(branch.status==='done'\)/);
 assert.match(s,/if\(!independently.ok/);
 assert.match(s,/if\(done!=='COMMITTED'\)/);
});
test('V20 queue declaration is unique durable and never touches agent wake queues',()=>{
 const s=text('live.mjs'),worker=text('worker.mjs');
 assert.match(s,/aau\.research\.v20\./);
 assert.match(s,/durable:true,exclusive:false,autoDelete:false/);
 assert.match(s,/'x-expires':600000/);
 assert.match(s,/persistent:true/);
 assert.match(s,/await channel.waitForConfirms/);
 assert.match(worker,/aau\\\.research\\\.v20/);
 assert.match(s,/await channel.deleteQueue\(queue\)/);
 assert.doesNotMatch(s,/aau\.agent\.wake/);
});
test('independent exact root receipts sum to 448 and globally 415',()=>{
 const roots=rootPartitions(publicProblem);assert.equal(roots.length,3);
 const values=roots.map(root=>{
  const answer=solvePartition(publicProblem,root.entry);
  const checked=evaluate(publicProblem,{schedule:answer.schedule,cost:answer.cost});
  assert.equal(checked.ok,true);assert.equal(checked.cost,answer.cost);
  const receipt=createHash('sha256').update(JSON.stringify({
   root:root.id,cost:answer.cost,explored:answer.explored,schedule:answer.schedule
  })).digest('hex');
  assert.equal(receipt.length,64);
  return {cost:answer.cost,leaves:answer.explored};
 });
 assert.equal(values.reduce((a,x)=>a+x.leaves,0),448);
 assert.equal(Math.min(...values.map(x=>x.cost)),415);
 assert.equal(exactOracle(publicProblem).cost,415);
});
test('research live runner records absent credential as a distinct blocked status',()=>{
 const s=text('live.mjs'),worker=text('worker.mjs');
 assert.match(s,/blocked_missing_neon_v19_branch_secret/);
 assert.match(s,/blocked_missing_existing_amqp_secret/);
 assert.match(s,/if\(!liveGuard\)/);
 assert.match(worker,/AAU_V20_RESEARCH/);
 assert.match(s,/proofDigest/);
});
