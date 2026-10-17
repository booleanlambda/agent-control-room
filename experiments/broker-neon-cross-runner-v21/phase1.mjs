// V21 Phase 1 - publisher and victim worker run on first GitHub Actions runner.
// The actual second job uses a fresh runner and receives only nonsecret run metadata.
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicProblem,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {rootPartitions,digest} from '../rabbitmq-proof-frontier-v17/partition.mjs';
import {newStore} from '../rabbitmq-neon-integrated-v20/store.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V21_RESEARCH!=='yes')
 throw Error('RESEARCH_ONLY');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const file=fileURLToPath(new URL('../rabbitmq-neon-integrated-v20/worker.mjs',import.meta.url));
const out='handoff',proof='cross-runner-v21-phase1.json';
mkdirSync(out,{recursive:true});
const report={experiment:'V21_NEON_RABBITMQ_ACTUAL_CROSS_RUNNER',
 stage:'publisher_and_sigkill',state:'running',modelCalls:0,productionChanged:false,
 projectBranch:'br-cold-rice-b4m3l9qu',queueScope:'run_scoped_only',commitConfirmed:false,
 workerKilled:false,boundsBefore:null,boundsAfter:null,queueReadyAfterKill:null};
const save=()=>writeFileSync(join(out,proof),JSON.stringify(report,null,2)+'\n');
const baseline={jobs:[{id:'J0',machine:'M0'},{id:'J1',machine:'M1'},
 {id:'J3',machine:'M0'},{id:'J2',machine:'M1'},
 {id:'J4',machine:'M0'},{id:'J6',machine:'M0'},{id:'J5',machine:'M1'}]};
const start=scheduleCandidate(publicProblem,baseline);
if(!start.ok||start.cost!==512||
 !evaluate(publicProblem,{schedule:start.schedule,cost:start.cost}).ok)
 throw Error('BASELINE_INVALID');
let store,connection,pub,queue;
try{
 if(!process.env.NEON_V19_DATABASE_URL||!process.env.AMQP_URL)
  throw Error('RESEARCH_CREDENTIAL_MISSING');
 const amqp=(await import('amqplib')).default;
 store=newStore(process.env.NEON_V19_DATABASE_URL);
 await store.verify();
 const roots=rootPartitions(publicProblem),id=randomUUID(),queueName='aau.research.v20.'+id.replaceAll('-','');
 report.run=id;report.queue=queueName;report.problemHash=digest(publicProblem);
 await store.init(id,digest(publicProblem),512,roots.map(x=>({id:x.id,rootHash:digest(x.entry)})));
 const before=await store.summary(id);
 if(before.completed!==0||before.pending!==3||before.lower!==0||before.upper!==512||before.optimal)
  throw Error('INVALID_INITIAL_PROOF_STATE');
 report.boundsBefore=before;
 let url=String(process.env.AMQP_URL||'').trim().replace(/^AMQP(?:_URL)?\s*=\s*/i,'');
 if((url.startsWith('"')&&url.endsWith('"'))||(url.startsWith("'")&&url.endsWith("'")))
  url=url.slice(1,-1).trim();
 if(new URL(url).protocol!=='amqps:')throw Error('TLS_REQUIRED');
 connection=await amqp.connect(url,{timeout:10000});
 pub=await connection.createConfirmChannel();
 queue=queueName;
 // Durable, nonexclusive and expiring only inside the unique research namespace.
 await pub.assertQueue(queue,{durable:true,exclusive:false,autoDelete:false,
  arguments:{'x-expires':1800000}});
 for(const root of [...roots,roots[0]])
  pub.sendToQueue(queue,Buffer.from(JSON.stringify({run:id,id:root.id})),{
   persistent:true,contentType:'application/json',messageId:randomUUID()});
 await pub.waitForConfirms();
 report.confirmedMessages=4;save();
 const victim=spawnSync(process.execPath,[file],{encoding:'utf8',maxBuffer:200000,
  timeout:40000,env:{...process.env,AAU_V20_RESEARCH:'yes',AAU_V20_RUN_ID:id,
   AAU_V20_QUEUE:queue,AAU_V20_PHASE:'crash'}});
 if(victim.signal!=='SIGKILL')throw Error('EXPECTED_WORKER_SIGKILL_NOT_OBSERVED');
 report.workerKilled=true;
 const after=await store.summary(id);
 if(after.completed!==1||after.pending!==2||after.lower!==0||
  after.upper!==415||after.optimal)throw Error('INVALID_INTERRUPT_PROOF_STATE');
 report.boundsAfter=after;
 const rows=await store.rows(id);
 if(rows.filter(x=>x.status==='done').length!==1||
  rows.find(x=>x.status==='done')?.exact_cost!==415)
  throw Error('NEON_COMMIT_BEFORE_KILL_NOT_PERSISTED');
 report.commitConfirmed=true;
 let ready=null;
 for(let n=0;n<60;n++){
  const q=await pub.checkQueue(queue);
  ready=q.messageCount;
  if(ready===4)break;
  await new Promise(r=>setTimeout(r,150));
 }
 if(ready!==4)throw Error('BROKER_UNACKED_MESSAGE_NOT_REQUEUED');
 report.queueReadyAfterKill=ready;
 report.runHash=sha(id);report.queueHash=sha(queue);
 report.workerIdentity='github_runner_job_phase1';
 report.state='passed';save();
}catch(e){
 report.state='failed';
 const msg=String(e?.message||e);
 report.error=/^[A-Z0-9_]+$/.test(msg)?msg:'REDACTED_FAILURE';
 save();process.exitCode=2;
 if(pub&&queue){try{await pub.deleteQueue(queue)}catch{}}
}finally{
 try{if(pub)await pub.close()}catch{}
 try{if(connection)await connection.close()}catch{}
 try{if(store)await store.close()}catch{}
 console.log('AAU_V21_PUBLISH='+JSON.stringify({status:report.state,
  killed:report.workerKilled,committed:report.commitConfirmed,
  ready:report.queueReadyAfterKill,pending:report.boundsAfter?.pending??null,
  error:report.error??null}));
}
