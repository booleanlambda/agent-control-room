// One process, one RabbitMQ consumer. Called in two separate OS processes:
// 1) kill itself AFTER verified Neon commit but BEFORE RabbitMQ ack;
// 2) recover all redelivered/pending messages and ACK only completed work.
import amqp from 'amqplib';
import {randomUUID,createHash} from 'node:crypto';
import {newStore} from './store.mjs';
import {publicProblem,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {rootPartitions,solvePartition} from '../rabbitmq-proof-frontier-v17/partition.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V20_RESEARCH!=='yes')
 throw Error('ISOLATED_RESEARCH_ONLY');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const {AAU_V20_RUN_ID:run,AAU_V20_QUEUE:queue,AAU_V20_PHASE:phase}=process.env;
if(!/^[a-f0-9-]{36}$/.test(run??'')||
   !/^aau\.research\.v20\.[a-f0-9]{32}$/.test(queue??'')||
   !['crash','recover'].includes(phase))throw Error('INVALID_RUN_SCOPED_WORKER');
const roots=rootPartitions(publicProblem);
let url=String(process.env.AMQP_URL||'').trim().replace(/^AMQP(?:_URL)?\\s*=\\s*/i,'').trim();
if ((url[0]==='"'&&url.at(-1)==='"')||(url[0]==="'"&&url.at(-1)==="'"))url=url.slice(1,-1).trim();
let scheme;
try{scheme=new URL(url).protocol}catch{throw Error('AMQP_URL_FORMAT_INVALID')}
if(scheme!=='amqps:')throw Error('AMQPS_REQUIRED');
const store=newStore(process.env.NEON_V19_DATABASE_URL);
let conn,ch;
const counters={consumed:0,redelivered:0,duplicates:0,acks:0,commits:0};
try{
 await store.verify();
 conn=await amqp.connect(url,{timeout:10000});
 ch=await conn.createChannel();
 await ch.prefetch(1);
 for(let k=0;k<12;k++){
  let msg=await ch.get(queue,{noAck:false});
  if(!msg){
   if(phase==='recover'&&k>=4)break;
   await new Promise(ok=>setTimeout(ok,180));continue;
  }
  counters.consumed++;
  if(msg.fields.redelivered)counters.redelivered++;
  const payload=JSON.parse(msg.content.toString('utf8'));
  if(payload.run!==run||!roots.some(r=>r.id===payload.id)||
   Object.keys(payload).sort().join(',')!=='id,run')
   throw Error('UNEXPECTED_BROKER_PAYLOAD');
  const branch=await store.row(run,payload.id);
  if(branch.status==='done'){
   counters.duplicates++;ch.ack(msg);counters.acks++;continue;
  }
  const worker=randomUUID(),claim=await store.claim(run,payload.id,worker,90);
  if(!claim.ok)throw Error('BRANCH_LEASE_LOCKED_UNEXPECTEDLY');
  const root=roots.find(x=>x.id===payload.id).entry;
  const solved=solvePartition(publicProblem,root,{maxLeaves:10000});
  const independently=evaluate(publicProblem,{schedule:solved.schedule,cost:solved.cost});
  if(!independently.ok||independently.cost!==solved.cost)
   throw Error('INDEPENDENT_VERIFIER_REJECTED');
  const receipt=sha({root:payload.id,cost:solved.cost,explored:solved.explored,schedule:solved.schedule});
  const done=await store.complete(run,payload.id,worker,claim.epoch,solved.cost,solved.explored,receipt);
  if(done!=='COMMITTED')throw Error('NEON_PROOF_COMMIT_FAILED');
  counters.commits++;
  if(phase==='crash'){
   // Explicit process death after committed Neon durable proof, before ACK.
   // No channel close or ack. RabbitMQ must requeue the unacknowledged delivery.
   process.kill(process.pid,'SIGKILL');
   throw Error('UNREACHABLE_AFTER_SIGKILL');
  }
  ch.ack(msg);counters.acks++;
 }
 if(phase==='crash')throw Error('CRASH_PHASE_DID_NOT_REACH_COMMIT');
 console.log('AAU_V20_RECOVERY='+JSON.stringify(counters));
}catch{
 // Do not log DB/AMQP errors: they can contain URI or hostname.
 process.stderr.write('AAU_V20_WORKER_SAFE_FAILURE\n');
 process.exitCode=2;
}finally{
 try{if(ch)await ch.close()}catch{}
 try{if(conn)await conn.close()}catch{}
 try{await store.close()}catch{}
}
