// AAU V17 real RabbitMQ isolated proof frontier. Broker only delivers IDs.
// SQL ledger owns branch state and global proof. Single worker, no production
// namespace and no production agent wakes or model calls.
import amqp from 'amqplib';
import {spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {publicProblem,exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {rootPartitions,solvePartition,digest} from './partition.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V17_RESEARCH!=='yes')throw Error('RESEARCH_WORKFLOW_ONLY');
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const ledgerFile=fileURLToPath(new URL('./ledger.py',import.meta.url));
const temp=mkdtempSync(join(tmpdir(),'aau-v17-ledger-'));
const database=join(temp,'branches.sqlite');
const output='broker-frontier-v17-evidence.json';
const report={experiment:'AAU_RABBITMQ_PROOF_FRONTIER_V17',status:'running',providerCalls:0,
  oneWorker:true,queueScope:'unique_per_action_run_exclusive_auto_delete',
  usesProductionQueue:false,queueNameNotDisclosed:true,
  broker:{secretPresent:false,tls:false,connected:false,queueAsserted:false,
    confirmedPublishes:0,consumed:0,acknowledged:0,duplicateSkipped:0,
    redeliveries:0,simulatedUnackedDisconnect:false},
  ledger:{storage:'runner_local_sqlite_fsync_full',claims:0,completed:0,
    notDurableAcrossRunnerLoss:true},
  roots:[],proofAtInterruption:null,proofFinal:null,oracle:null,rootDigest:null,
  limitations:[
   'The queue is run-scoped exclusive autoDelete and not broker-restart durable',
   'SQLite resides on one ephemeral GitHub Actions runner and cannot recover if the runner is destroyed',
   'This is a one-worker, three-root seven-job controlled proof, not a scalable multi-worker search',
   'RabbitMQ is only at-least-once transport: SQL state determines proof completion and idempotency'
  ]};
const persist=()=>writeFileSync(output,JSON.stringify(report,null,2)+'\n');
function ledger(req){
 const child=spawnSync('python3',[ledgerFile],{input:JSON.stringify({...req,db:database}),
   encoding:'utf8',timeout:10000,maxBuffer:1000000});
 if(child.status!==0)throw Error('SQL_LEDGER_OPERATION_FAILED:'+req.action);
 let data;try{data=JSON.parse(child.stdout)}catch{throw Error('SQL_LEDGER_BAD_RESPONSE')}
 if(data.error)throw Error('SQL_LEDGER_REJECTED_OPERATION:'+req.action);
 return data;
}
function normalizeSecret(raw){
 let s=String(raw??'').trim().replace(/^AMQP(?:_URL)?\s*=\s*/i,'').trim();
 if((s[0]==='"'&&s.at(-1)==='"')||(s[0]==="'"&&s.at(-1)==="'"))s=s.slice(1,-1).trim();
 const parsed=new URL(s);
 if(!['amqp:','amqps:'].includes(parsed.protocol))throw Error('BROKER_PROTOCOL_REJECTED');
 return {value:s,tls:parsed.protocol==='amqps:'};
}
const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,rej)=>setTimeout(()=>rej(Error('BROKER_TIMEOUT')),ms))]);
const sleep=ms=>new Promise(ok=>setTimeout(ok,ms));
let connection=null,publisher=null,consumer=null,queue=null;
try{
 const url=normalizeSecret(process.env.AMQP_URL);
 report.broker.secretPresent=true;report.broker.tls=url.tls;persist();
 if(!url.tls)throw Error('AMQPS_TLS_REQUIRED');
 const roots=rootPartitions(publicProblem);
 const previous={jobs:[{id:'J0',machine:'M0'},{id:'J1',machine:'M1'},{id:'J3',machine:'M0'},
 {id:'J2',machine:'M1'},{id:'J4',machine:'M0'},{id:'J6',machine:'M0'},{id:'J5',machine:'M1'}]};
 const starting=scheduleCandidate(publicProblem,previous);
 if(!starting.ok||starting.cost!==512)throw Error('BASELINE_WITNESS_INCONSISTENT');
 if(!evaluate(publicProblem,{schedule:starting.schedule,cost:starting.cost}).ok)throw Error('BASELINE_INDEPENDENT_REJECT');
 ledger({action:'init',roots});
 report.roots=roots.map(x=>({id:x.id,rootHash:digest(x.entry)}));
 const atStart=ledger({action:'summary',verifiedIncumbentCost:starting.cost});
 if(atStart.optimal||atStart.pending!==roots.length||atStart.lower!==0)throw Error('ROOT_LEDGER_BAD_START');
 connection=await withTimeout(amqp.connect(url.value,{timeout:10000}),15000);
 report.broker.connected=true;
 publisher=await connection.createConfirmChannel();
 // Private run-scoped ephemeral queue: cannot route any production messages.
 const runId=String(process.env.GITHUB_RUN_ID||'local').replace(/[^0-9]/g,'');
 queue='aau.research.frontier.v17.'+runId+'.'+randomUUID().replaceAll('-','');
 await publisher.assertQueue(queue,{durable:false,exclusive:true,autoDelete:true});
 report.broker.queueAsserted=true;persist();
 for(const r of roots){
  publisher.sendToQueue(queue,Buffer.from(JSON.stringify({id:r.id,runId})),{
   persistent:false,messageId:randomUUID(),contentType:'application/json'});
  report.broker.confirmedPublishes++;
 }
 // Intentional at-least-once duplicate in addition to the broker redelivery.
 publisher.sendToQueue(queue,Buffer.from(JSON.stringify({id:roots[0].id,runId})),{
  persistent:false,messageId:randomUUID(),contentType:'application/json'});
 report.broker.confirmedPublishes++;
 await withTimeout(publisher.waitForConfirms(),10000);
 // No worker concurrency and no model calls.
 consumer=await connection.createChannel();
 await consumer.prefetch(1);
 let waitingSince=Date.now(),iterations=0;
 const seen=new Set(roots.map(x=>x.id));
 while(iterations++<20){
  let msg=await withTimeout(consumer.get(queue,{noAck:false}),8000);
  if(!msg){
   if(Date.now()-waitingSince>6000)break;
   await sleep(120);continue;
  }
  waitingSince=Date.now();report.broker.consumed++;
  if(msg.fields.redelivered)report.broker.redeliveries++;
  let id;
  try{
   const payload=JSON.parse(msg.content.toString('utf8'));
   if(payload.runId!==runId||!seen.has(payload.id)||
     Object.keys(payload).sort().join(',')!=='id,runId')throw Error('UNEXPECTED_MESSAGE');
   id=payload.id;
  }catch{consumer.nack(msg,false,false);throw Error('INVALID_BROKER_PAYLOAD')}
  const status=ledger({action:'claim',id});
  report.ledger.claims++;
  if(status.done){
   report.broker.duplicateSkipped++;consumer.ack(msg);report.broker.acknowledged++;persist();continue;
  }
  const root=roots.find(x=>x.id===id);
  const solved=solvePartition(publicProblem,root.entry,{maxLeaves:10000});
  const verified=evaluate(publicProblem,{schedule:solved.schedule,cost:solved.cost});
  if(!verified.ok||verified.cost!==solved.cost)throw Error('INDEPENDENT_PARTITION_VERIFICATION_FAILED');
  const receipt=sha({root:id,cost:solved.cost,explored:solved.explored,schedule:solved.schedule});
  const done=ledger({action:'complete',id,cost:solved.cost,explored:solved.explored,
    hash:receipt,schedule:solved.schedule});
  if(!done.committed)throw Error('DID_NOT_COMMIT_PARTITION');
  report.ledger.completed++;
  if(!report.broker.simulatedUnackedDisconnect){
   // The ledger commit is durable, but the RabbitMQ ack has not been sent.
   // Closing ONLY the consumer channel simulates worker channel failure,
   // forcing broker redelivery. The connection and run-specific queue persist.
   const intermediate=ledger({action:'summary',verifiedIncumbentCost:starting.cost});
   if(intermediate.pending!==roots.length-1||intermediate.optimal||intermediate.gap<=0)
     throw Error('FALSE_OPTIMALITY_WHEN_BRANCHES_PENDING');
   report.proofAtInterruption={lower:intermediate.lower,upper:intermediate.upper,
     gap:intermediate.gap,pending:intermediate.pending,claimedOptimal:intermediate.optimal};
   report.broker.simulatedUnackedDisconnect=true;
   await consumer.close();consumer=await connection.createChannel();await consumer.prefetch(1);
   persist();
   continue;
  }
  consumer.ack(msg);report.broker.acknowledged++;persist();
 }
 const results=ledger({action:'summary',verifiedIncumbentCost:starting.cost});
 if(results.total!==roots.length||results.completed!==roots.length||
  !results.optimal||results.pending!==0||results.lower!==results.upper||
  report.broker.redeliveries<1||report.broker.duplicateSkipped<2||
  !report.broker.simulatedUnackedDisconnect||
  report.broker.acknowledged<roots.length+2)
  throw Error('INCOMPLETE_BROKER_OR_SQL_RECOVERY_PROOF');
 const oracle=exactOracle(publicProblem);
 if(results.upper!==oracle.cost||oracle.cost!==415)throw Error('INDEPENDENT_EXACT_ORACLE_DISAGREEMENT');
 for(const row of results.branches){
  const root=roots.find(x=>x.id===row.id);
  const replay=solvePartition(publicProblem,root.entry,{maxLeaves:10000});
  const match=evaluate(publicProblem,{schedule:row.schedule,cost:row.cost});
  if(!match.ok||match.cost!==row.cost||replay.cost!==row.cost||replay.explored!==row.explored)
   throw Error('FINAL_ROOT_EVIDENCE_DISAGREEMENT');
 }
 report.proofFinal={lower:results.lower,upper:results.upper,gap:results.gap,
   optimal:results.optimal,rootCount:results.total,pending:results.pending,
   complete:results.completed,totalEnumeratedSchedules:results.explored,
   rows:results.branches.map(x=>({id:x.id,cost:x.cost,explored:x.explored,
     attempts:x.attempts,hash:x.hash}))};
 report.oracle={exact:oracle.cost,agree:true};
 report.rootDigest=sha({publicProblemHash:digest(publicProblem),roots:report.proofFinal.rows,
  interrupt:report.proofAtInterruption,final:report.proofFinal,
  broker:{redeliveries:report.broker.redeliveries,duplicateSkipped:report.broker.duplicateSkipped}});
 report.status='passed';persist();
}catch(e){
 report.status='failed';
 const msg=String(e?.message||e);
 // No AMQP URLs, hosts, usernames, passwords or raw transport errors in evidence.
 report.errorCategory=/^(BROKER_|SQL_|ROOT_|INCOMPLETE_|INVALID_|FALSE_|PARTITION_|BASELINE_|INDEPENDENT_|FINAL_)/.test(msg)?
   msg.slice(0,90):'UNCLASSIFIED_SAFE_FAILURE';
}finally{
 try{if(consumer)await consumer.close()}catch{}
 try{if(publisher&&queue)await publisher.deleteQueue(queue)}catch{}
 try{if(publisher)await publisher.close()}catch{}
 try{if(connection)await connection.close()}catch{}
 rmSync(temp,{recursive:true,force:true});
 report.finishedAt=new Date().toISOString();persist();
 console.log('AAU_V17_BROKER_FRONTIER_RESULT='+JSON.stringify({
  status:report.status,amqpsConnected:report.broker.connected,
  queueDeclared:report.broker.queueAsserted,
  published:report.broker.confirmedPublishes,consumed:report.broker.consumed,
  acknowledged:report.broker.acknowledged,redeliveries:report.broker.redeliveries,
  duplicateSkipped:report.broker.duplicateSkipped,
  simulatedDisconnect:report.broker.simulatedUnackedDisconnect,
  interruptedGap:report.proofAtInterruption?.gap??null,
  completedRoots:report.proofFinal?.complete??null,
  finalCost:report.proofFinal?.upper??null,
  oracleCost:report.oracle?.exact??null,
  proof:!!report.rootDigest,error:report.errorCategory??null}));
 if(report.status!=='passed')process.exitCode=2;
}
