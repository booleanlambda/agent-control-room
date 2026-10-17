// AAU V18 cross-runner RabbitMQ durability experiment.
// Each GitHub Actions job is a fresh process with a fresh runner filesystem.
// SQLite is checkpointed to immutable Actions artifact BEFORE a message ack.
// Never reuse this artifact handoff as a concurrent mutable SQL database.
import amqp from 'amqplib';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {publicProblem,exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {rootPartitions,solvePartition,digest} from '../rabbitmq-proof-frontier-v17/partition.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V18_RESEARCH!=='yes')throw Error('RESEARCH_CI_ONLY');
const stage=process.argv[2];
if(!['publish','handoff1','handoff2','handoff3','finalize'].includes(stage))throw Error('INVALID_STAGE');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const dir=resolve('./state'),db=join(dir,'ledger.sqlite'),manifest=join(dir,'evidence.json');
const ledgerCode=fileURLToPath(new URL('../rabbitmq-proof-frontier-v17/ledger.py',import.meta.url));
mkdirSync(dir,{recursive:true});
const expectedRoots=rootPartitions(publicProblem);
const runId=String(process.env.GITHUB_RUN_ID||'');
const retry=async (cb,max=80)=>{
 for(let i=0;i<max;i++){const msg=await cb();if(msg)return msg;await new Promise(r=>setTimeout(r,120));}
 throw Error('QUEUE_DELIVERY_NOT_RECEIVED');
};
function ledger(args){
 const x=spawnSync('python3',[ledgerCode],{input:JSON.stringify({...args,db}),encoding:'utf8',timeout:15000,maxBuffer:1000000});
 if(x.status!==0)throw Error('LEDGER_ACTION_FAILED_'+args.action);
 let parsed;try{parsed=JSON.parse(x.stdout.trim())}catch{throw Error('LEDGER_BAD_JSON')}
 if(parsed.error)throw Error('LEDGER_TRANSACTION_REJECTED_'+args.action);
 return parsed;
}
function amqpUrl(){
 let s=String(process.env.AMQP_URL||'').trim().replace(/^AMQP(?:_URL)?\s*=\s*/i,'').trim();
 if((s[0]==='"'&&s.at(-1)==='"')||(s[0]==="'"&&s.at(-1)==="'"))s=s.slice(1,-1).trim();
 let u;
 try{u=new URL(s)}catch{throw Error('BROKER_CREDENTIAL_UNAVAILABLE')}
 if(u.protocol!=='amqps:')throw Error('AMQPS_REQUIRED');
 return s;
}
const caps={durable:true,exclusive:false,autoDelete:false,arguments:{'x-expires':900000}};
let data=existsSync(manifest)?JSON.parse(readFileSync(manifest,'utf8')):{
  experiment:'AAU_V18_CROSS_RUNNER_DURABLE_RABBITMQ_CHECKPOINT',
  status:'running',modelCalls:0,queueNameRestricted:true,
  rootHashes:expectedRoots.map(x=>({id:x.id,rootHash:digest(x.entry)})),
  runIdHash:hash(runId),queue:'',
  broker:{confirmedPublished:0,consumed:0,acknowledged:0,redelivered:0,duplicateSkipped:0,
    unackedHandoffs:0},
  stages:[],snapshots:[],finalProof:null,
  limitations:[
   'Durability across fresh GitHub Action jobs relies on immutable SQLite artifact checkpoints, not shared live Postgres.',
   'Only serialized one-worker stages; concurrent writers are unsupported.',
   'RabbitMQ persistent queue and messages tested across producer/consumer process boundaries, NOT broker server restart.',
   'A failed CI artifact upload leaves the message unacknowledged; the job may be retried or inspected before expiry.',
   'Research durable queue has 15-minute x-expires for leak containment; not intended for production.']};
function persist(){writeFileSync(manifest,JSON.stringify(data,null,2)+'\n')}
let conn,ch,success=false;
try{
 if(!runId||!process.env.AMQP_URL)throw Error('GITHUB_RUN_OR_BROKER_CREDENTIAL_MISSING');
 if(stage==='publish'){
  if(existsSync(db))throw Error('PUBLISH_DB_ALREADY_EXISTS');
  ledger({action:'init',roots:expectedRoots});
  const baseline={jobs:[
   {id:'J0',machine:'M0'},{id:'J1',machine:'M1'},{id:'J3',machine:'M0'},
   {id:'J2',machine:'M1'},{id:'J4',machine:'M0'},{id:'J6',machine:'M0'},
   {id:'J5',machine:'M1'}]};
  const b=scheduleCandidate(publicProblem,baseline);
  if(!b.ok||b.cost!==512||!evaluate(publicProblem,{schedule:b.schedule,cost:b.cost}).ok)
   throw Error('INVALID_INITIAL_CERTIFIED_WITNESS');
  data.baseline=512;
  data.queue='aau.v18.proof.research.'+runId+'.'+randomUUID().replace(/-/g,'');
  conn=await amqp.connect(amqpUrl(),{timeout:10000});
  ch=await conn.createConfirmChannel();
  await ch.assertQueue(data.queue,caps);
  for(const root of [...expectedRoots,expectedRoots[0]]){
   ch.sendToQueue(data.queue,Buffer.from(JSON.stringify({runId,id:root.id})),{
    persistent:true,contentType:'application/json',messageId:randomUUID()});
   data.broker.confirmedPublished++;
  }
  await ch.waitForConfirms();
  const s=ledger({action:'summary',verifiedIncumbentCost:512});
  if(s.pending!==3||s.optimal||s.lower!==0)throw Error('PUBLISH_INCOMPLETE_PROOF_INVALID');
  data.stages.push({stage,proof:{lower:s.lower,upper:s.upper,pending:s.pending,optimal:s.optimal}});
  success=true;
 }else{
  if(!existsSync(db)||!data.queue||data.runIdHash!==hash(runId))
   throw Error('MISSING_DURABLE_RUN_CHECKPOINT');
  conn=await amqp.connect(amqpUrl(),{timeout:10000});
  ch=await conn.createChannel();
  await ch.assertQueue(data.queue,caps);
  await ch.prefetch(1);
  let consumedInStage=0,ackedInStage=0,redeliveredInStage=0,duplicateInStage=0;
  let computedRoot=null;
  const consumeOne=async ()=>{
   const msg=await retry(()=>ch.get(data.queue,{noAck:false}));
   const payload=JSON.parse(msg.content.toString('utf8'));
   if(payload.runId!==runId||!expectedRoots.some(r=>r.id===payload.id)||
      Object.keys(payload).sort().join(',')!=='id,runId')
    throw Error('RUN_SCOPED_PAYLOAD_REJECTED');
   data.broker.consumed++;consumedInStage++;
   if(msg.fields.redelivered){data.broker.redelivered++;redeliveredInStage++;}
   const status=ledger({action:'claim',id:payload.id});
   if(status.done){
    data.broker.duplicateSkipped++;duplicateInStage++;
    ch.ack(msg);data.broker.acknowledged++;ackedInStage++;
    return {done:true,id:payload.id};
   }
   if(stage==='finalize')throw Error('FINALIZER_FOUND_UNFINISHED_BRANCH');
   const root=expectedRoots.find(r=>r.id===payload.id);
   const result=solvePartition(publicProblem,root.entry,{maxLeaves:10000});
   const independent=evaluate(publicProblem,{schedule:result.schedule,cost:result.cost});
   if(!independent.ok||independent.cost!==result.cost)throw Error('INDEPENDENT_PARTITION_INVALID');
   const receipt=hash({root:payload.id,cost:result.cost,explored:result.explored,schedule:result.schedule});
   const completed=ledger({action:'complete',id:payload.id,cost:result.cost,
    explored:result.explored,hash:receipt,schedule:result.schedule});
   if(!completed.committed)throw Error('LEDGER_ROOT_COMMIT_NOT_UNIQUE');
   computedRoot={id:payload.id,cost:result.cost,explored:result.explored,receipt};
   return {done:false,id:payload.id};
  };
  if(stage!=='finalize'){
   for(let n=0;n<8;n++){
    const message=await consumeOne();
    if(!message.done)break;
   }
   if(!computedRoot)throw Error('NO_UNFINISHED_ROOT_FOUND');
   const s=ledger({action:'summary',verifiedIncumbentCost:data.baseline});
   const shouldBeExact=stage==='handoff3';
   if(s.completed!==Number(stage.slice(-1))||s.optimal!==shouldBeExact||
      (shouldBeExact?s.gap!==0:s.gap<=0))
    throw Error('CENSOR_PROOF_MISCLASSIFIED');
   data.broker.unackedHandoffs++;
   data.stages.push({stage,root:computedRoot,consumedInStage,ackedInStage,
     duplicateInStage,redeliveredInStage,
     proof:{lower:s.lower,upper:s.upper,pending:s.pending,optimal:s.optimal}});
   // Intentionally close channel with last root UNACKNOWLEDGED. SQLite
   // checkpoint will be uploaded by the next GitHub Actions step to GitHub's
   // persistent artifact store; the next independent runner will redeliver.
   await ch.close();ch=null;
   success=true;
  }else{
   const s=ledger({action:'summary',verifiedIncumbentCost:data.baseline});
   if(!s.optimal||s.completed!==expectedRoots.length||s.pending!==0)throw Error('PREMATURE_FINALIZER');
   // Drain 1 redelivery plus exactly one intentionally duplicated published
   // message; no other research queue should be reachable here.
   let empty=0;
   for(let n=0;n<14&&empty<4;n++){
    const msg=await ch.get(data.queue,{noAck:false});
    if(!msg){empty++;await new Promise(r=>setTimeout(r,150));continue}
    empty=0;
    const payload=JSON.parse(msg.content.toString('utf8'));
    if(payload.runId!==runId||!expectedRoots.some(r=>r.id===payload.id))throw Error('FINALIZER_PAYLOAD_INVALID');
    data.broker.consumed++;consumedInStage++;
    if(msg.fields.redelivered){data.broker.redelivered++;redeliveredInStage++;}
    const claim=ledger({action:'claim',id:payload.id});
    if(!claim.done)throw Error('FINALIZER_INCOMPLETE_DELIVERY');
    data.broker.duplicateSkipped++;duplicateInStage++;
    ch.ack(msg);data.broker.acknowledged++;ackedInStage++;
   }
   const oracle=exactOracle(publicProblem);
   if(s.lower!==415||s.upper!==415||oracle.cost!==415||s.explored!==448||
     data.broker.confirmedPublished!==4||
     data.broker.acknowledged!==4||data.broker.redelivered<3||
     data.broker.duplicateSkipped!==4||data.broker.unackedHandoffs!==3)
    throw Error('CROSS_RUNNER_PROOF_OR_REDELIVERY_FAILED');
   for(const b of s.branches){
    const root=expectedRoots.find(r=>r.id===b.id);
    const replay=solvePartition(publicProblem,root.entry,{maxLeaves:10000});
    const independent=evaluate(publicProblem,{schedule:b.schedule,cost:b.cost});
    if(!independent.ok||independent.cost!==b.cost||replay.cost!==b.cost||
       replay.explored!==b.explored)throw Error('REPLAY_PARTITION_FAILED');
   }
   data.finalProof={lower:s.lower,upper:s.upper,gap:s.gap,optimal:true,
     explored:s.explored,independentExactOracle:oracle.cost,allRoots:s.completed};
   data.stages.push({stage,consumedInStage,ackedInStage,duplicateInStage,redeliveredInStage,
    proof:{lower:s.lower,upper:s.upper,pending:0,optimal:true}});
   data.rootDigest=hash({problem:digest(publicProblem),roots:s.branches.map(x=>({
    id:x.id,cost:x.cost,explored:x.explored,hash:x.hash})),
    stages:data.stages,broker:data.broker,proof:data.finalProof});
   data.status='passed';
   await ch.deleteQueue(data.queue);ch=null;
   success=true;
  }
 }
}catch(e){
 data.status='failed';
 // Explicitly avoid logging raw network, AMQP URI, server host or SQL values.
 const m=String(e?.message||e);
 data.errorCode=/^[A-Z0-9_]+$/.test(m)?m.slice(0,100):'UNKNOWN_SAFE_FAILURE';
}finally{
 try{if(ch)await ch.close()}catch{}
 try{if(conn)await conn.close()}catch{}
 persist();
 console.log('AAU_V18_CHECKPOINT='+JSON.stringify({
  stage,status:data.status,success,connected:!!conn,
  messagesPublished:data.broker.confirmedPublished,delivered:data.broker.consumed,
  acknowledged:data.broker.acknowledged,redelivered:data.broker.redelivered,
  dupSkipped:data.broker.duplicateSkipped,
  pending:data.stages.at(-1)?.proof?.pending??null,
  exact:data.finalProof?.upper??null,rootProof:!!data.rootDigest,
  error:data.errorCode??null}));
 if(!success)process.exitCode=2;
}
