// V21 Phase 2 runs on an independent GitHub Actions VM. It restores only a
// nonsecret manifest, reconnects to shared Neon and scoped RabbitMQ, recovers
// the unacknowledged phase-1 delivery, verifies and cleans up its own queue.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicProblem,exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {rootPartitions,solvePartition,digest} from '../rabbitmq-proof-frontier-v17/partition.mjs';
import {newStore} from '../rabbitmq-neon-integrated-v20/store.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V21_RESEARCH!=='yes')
 throw Error('RESEARCH_ONLY');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const file=fileURLToPath(new URL('../rabbitmq-neon-integrated-v20/worker.mjs',import.meta.url));
const dir='handoff';mkdirSync(dir,{recursive:true});
const prior=JSON.parse(readFileSync(join(dir,'cross-runner-v21-phase1.json'),'utf8'));
const report={experiment:'V21_NEON_RABBITMQ_ACTUAL_CROSS_RUNNER',stage:'independent_recovery_job',
 state:'running',modelCalls:0,productionChanged:false,
 queueDeleted:false,priorWorkerKilled:false,verifiedNeonMarker:false,
 redeliveries:0,duplicatesSuppressed:0,acknowledged:0,completed:0,
 proof:null,error:null,independentRunner:true};
const save=()=>writeFileSync(join(dir,'cross-runner-v21-final.json'),JSON.stringify(report,null,2)+'\n');
let store,connection,channel,queue;
try{
 if(prior.state!=='passed'||!prior.workerKilled||!prior.commitConfirmed||
  prior.boundsAfter?.pending!==2||prior.boundsAfter?.upper!==415||
  prior.queueReadyAfterKill!==4||
  !/^[a-f0-9-]{36}$/.test(prior.run??'')||
  !/^aau\.research\.v20\.[a-f0-9]{32}$/.test(prior.queue??'')||
  sha(prior.queue)!==prior.queueHash||sha(prior.run)!==prior.runHash||
  prior.problemHash!==digest(publicProblem))throw Error('UNTRUSTED_PHASE1_CHECKPOINT');
 if(!process.env.NEON_V19_DATABASE_URL||!process.env.AMQP_URL)
  throw Error('RESEARCH_CREDENTIAL_MISSING');
 report.priorWorkerKilled=true;
 const amqp=(await import('amqplib')).default;
 store=newStore(process.env.NEON_V19_DATABASE_URL);await store.verify();
 report.verifiedNeonMarker=true;
 const run=prior.run;queue=prior.queue;
 const initial=await store.summary(run);
 if(initial.completed!==1||initial.pending!==2||initial.lower!==0||
   initial.upper!==415||initial.optimal)throw Error('NEON_CROSS_JOB_CHECKPOINT_NOT_PERSISTED');
 let url=String(process.env.AMQP_URL||'').trim().replace(/^AMQP(?:_URL)?\s*=\s*/i,'');
 if((url.startsWith('"')&&url.endsWith('"'))||(url.startsWith("'")&&url.endsWith("'")))
  url=url.slice(1,-1).trim();
 if(new URL(url).protocol!=='amqps:')throw Error('TLS_REQUIRED');
 connection=await amqp.connect(url,{timeout:10000});
 channel=await connection.createConfirmChannel();
 // Check only: asserting the same queue could resurrect a missing queue.
 const before=await channel.checkQueue(queue);
 if(before.messageCount!==4)throw Error('UNACKED_BROKER_QUEUE_DID_NOT_SURVIVE_RUNNER_BOUNDARY');
 report.brokerReadyAtRecovery=before.messageCount;
 const child=spawnSync(process.execPath,[file],{encoding:'utf8',
   maxBuffer:200000,timeout:40000,env:{...process.env,AAU_V20_RESEARCH:'yes',
   AAU_V20_RUN_ID:run,AAU_V20_QUEUE:queue,AAU_V20_PHASE:'recover'}});
 if(child.status!==0)throw Error('REPLACEMENT_WORKER_FAILED');
 const row=child.stdout.split('\n').find(s=>s.startsWith('AAU_V20_RECOVERY='));
 if(!row)throw Error('NO_RECOVERY_COUNTERS');
 const parsed=JSON.parse(row.slice('AAU_V20_RECOVERY='.length));
 report.redeliveries=parsed.redelivered;
 report.duplicatesSuppressed=parsed.duplicates;
 report.acknowledged=parsed.acks;
 if(parsed.redelivered!==1||parsed.duplicates!==2||parsed.acks!==4||parsed.commits!==2)
  throw Error('BROKER_RECOVERY_COUNTS_INVALID');
 const final=await store.summary(run),rows=await store.rows(run);
 const oracle=exactOracle(publicProblem);
 if(final.total!==3||final.completed!==3||final.pending!==0||
  final.lower!==415||final.upper!==415||final.gap!==0||!final.optimal||oracle.cost!==415)
  throw Error('NEON_GLOBAL_CERTIFICATE_NOT_COMPLETE');
 const roots=rootPartitions(publicProblem);let leaves=0;
 for(const row of rows){
  const root=roots.find(x=>x.id===row.id);
  if(!root)throw Error('UNKNOWN_FINAL_ROOT');
  const answer=solvePartition(publicProblem,root.entry);
  const validated=evaluate(publicProblem,{schedule:answer.schedule,cost:answer.cost});
  const receipt=sha({root:row.id,cost:answer.cost,explored:answer.explored,schedule:answer.schedule});
  if(!validated.ok||validated.cost!==row.exact_cost||
    answer.explored!==row.leaves||receipt!==row.receipt)
   throw Error('INDEPENDENT_ROOT_WITNESS_MISMATCH');
  leaves+=row.leaves;
 }
 if(leaves!==448)throw Error('INCOMPLETE_EXHAUSTIVE_PARTITIONS');
 const after=await channel.checkQueue(queue);
 if(after.messageCount!==0||after.consumerCount!==0)
  throw Error('PENDING_OR_LIVE_BROKER_WORK_LEFT');
 report.completed=final.completed;
 report.proof={lower:final.lower,upper:final.upper,gap:final.gap,
  independentExactOracle:oracle.cost,leaves,
  runHash:sha(run),queueHash:sha(queue),
  roots:rows.map(r=>({id:r.id,cost:r.exact_cost,leaves:r.leaves,epoch:r.fence}))};
 report.proofDigest=sha({phase1:prior.runHash,phase2:report.proof,
  redeliveries:report.redeliveries,acknowledged:report.acknowledged});
 await channel.deleteQueue(queue);report.queueDeleted=true;
 report.state='passed';
}catch(e){
 report.state='failed';
 const msg=String(e?.message||e);
 report.error=/^[A-Z0-9_]+$/.test(msg)?msg:'REDACTED_FAILURE';
}finally{
 try{if(channel)await channel.close()}catch{}
 try{if(connection)await connection.close()}catch{}
 try{if(store)await store.close()}catch{}
 save();
 console.log('AAU_V21_CROSS_RUNNER='+JSON.stringify({status:report.state,
  priorKilled:report.priorWorkerKilled,marker:report.verifiedNeonMarker,
  redeliveries:report.redeliveries,duplicates:report.duplicatesSuppressed,
  acknowledged:report.acknowledged,complete:report.completed,
  optimum:report.proof?.upper??null,cleaned:report.queueDeleted,error:report.error}));
 if(report.state!=='passed')process.exitCode=2;
}
