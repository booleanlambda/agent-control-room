// End-to-end *actual* PostgreSQL/RabbitMQ integration; never accepts remote
// database addresses or production credentials. Three intentionally killed
// worker OS processes and two independently competing healthy worker processes.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import amqp from 'amqplib';
import {pool,setup,seed,claim,journal,commit,outbox,published,metrics,
 reconstructedTree,synthesize,RUN} from './pg-rabbit-contract.mjs';
import {auditCognitiveTree} from './cognitive-integrity.mjs';
import {SOURCE} from './kimi-k26-recorded-replay.mjs';

const p=pool(); // Guard requires disposable CI-only loopback PostgreSQL.
const conn=await amqp.connect(process.env.TEST_RABBIT_URL||'amqp://guest:guest@127.0.0.1:5672');
const ch=await conn.createConfirmChannel();
const queue='ci-aau-'+randomUUID();
await ch.assertQueue(queue,{durable:false,autoDelete:false});
const events=[],proc=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function worker(role,name,{commitCrash=false}={}){
  const child=spawn(process.execPath,
    [new URL('./pg-rabbit-worker.mjs',import.meta.url).pathname],
    {env:{...process.env,AAU_RABBIT_QUEUE:queue,
      AAU_WORKER_NAME:name,AAU_WORKER_ROLE:role,
      AAU_INJECT_SQL_CRASH:role==='tx_crasher'?'yes':'no',
      AAU_INJECT_COMMIT_CRASH:commitCrash?'yes':'no'},
      stdio:['ignore','pipe','pipe']});
  const rec={role,name,pid:child.pid,exitCode:null,logs:[],ready:false};
  proc.push({child,rec});
  function handle(data){
    for(const line of String(data).split('\n')){
      if(!line.trim())continue;
      rec.logs.push(line.slice(0,300));
      if(line.includes('INTEGRATION_READY'))rec.ready=true;
      if(line.includes('INJECTED_'))events.push({worker:name,record:line.slice(0,120)});
    }
  }
  child.stdout.on('data',handle);child.stderr.on('data',handle);
  child.on('exit',code=>{rec.exitCode=code;});
  return {child,rec};
}
async function ready(w){
  for(let i=0;i<100;i++){
    if(w.rec.ready)return;
    if(w.rec.exitCode!==null)throw Error('WORKER_EXITED_EARLY:'+w.rec.name+':'+w.rec.exitCode);
    await sleep(35);
  }
  throw Error('WORKER_READY_TIMEOUT:'+w.rec.name);
}
async function ended(w,code){
  for(let i=0;i<200;i++){
    if(w.rec.exitCode!==null){
      assert.equal(w.rec.exitCode,code,JSON.stringify(w.rec.logs.slice(-5)));
      return;
    }
    await sleep(30);
  }
  throw Error('EXPECTED_PROCESS_CRASH_DID_NOT_HAPPEN:'+w.rec.name);
}
async function publish(path,run=RUN,times=1){
  for(let i=0;i<times;i++)ch.sendToQueue(queue,Buffer.from(JSON.stringify({run,path})),
    {persistent:false,messageId:run+':'+path+':'+i});
  await ch.waitForConfirms();
}
async function work(){
  await setup(p);
  await seed(p);
  // (A) Real process crashes after durable inbox journal, BEFORE semantic commit.
  const crashJournal=worker('journal_crasher','crash-after-journal');
  await ready(crashJournal);await publish('R');await ended(crashJournal,86);
  let m=await metrics(p);
  assert.equal(m.journaled,1);assert.equal(m.commits,0);assert.equal(m.providerCalls,1);
  await sleep(1200); // The only actual lease waiting in the campaign.

  // (B) Process dies inside PostgreSQL transaction after writing parent,
  // two children, two outbox events and commit row, but BEFORE COMMIT.
  const crashSql=worker('tx_crasher','crash-mid-postgres-transaction');
  await ready(crashSql);await publish('R');await ended(crashSql,89);
  m=await metrics(p);
  assert.equal(m.commits,0,'uncommitted root commit rolled back');
  assert.equal(m.providerCalls,1,'durable journal means no second model call');
  const treeBefore=await reconstructedTree(p);
  assert.deepEqual(Object.keys(treeBefore.nodes),['R'],
    'uncommitted child nodes and outbox never become visible');
  await sleep(1200);

  // (C) Two live independent worker processes consume genuine RabbitMQ
  // duplicates. One crashes after DB COMMIT but BEFORE RabbitMQ ACK at R.001.
  const workerA=worker('normal','concurrent-worker-A',{commitCrash:true});
  const workerB=worker('normal','concurrent-worker-B',{commitCrash:true});
  await Promise.all([ready(workerA),ready(workerB)]);
  const endAt=Date.now()+25000;
  let state;
  const publishCounter=new Map();
  while(Date.now()<endAt){
    for(const row of await outbox(p)){
      await publish(row.path,RUN,3);await published(p,RUN,row.path);
      publishCounter.set(row.path,3);
    }
    // Explicit at-least-once republish for pending nodes whose lease expired.
    // Permanent state, not a queue ACK, determines whether work is done.
    if(Date.now()%11===0){
      const rows=await p.query(`SELECT path FROM recursion_ci.nodes
        WHERE run_id=$1 AND status='pending' AND
        (leased_until IS NULL OR leased_until<now()) LIMIT 10`,[RUN]);
      for(const row of rows.rows)await publish(row.path);
    }
    state=await metrics(p);
    if(state.commits===21&&state.statuses.complete===11&&state.statuses.split===10)break;
    if(workerA.rec.exitCode!==null&&workerB.rec.exitCode!==null)
      throw Error('BOTH_CONCURRENT_WORKERS_EXITED');
    await sleep(45);
  }
  assert.equal(state?.commits,21,'not all 21 nodes committed');
  assert.equal(state?.statuses?.split,10);assert.equal(state?.statuses?.complete,11);
  assert.equal(state.providerCalls,21,'journaled root replay must not repeat inference');
  assert.equal(state.chargeCount,21);
  assert.equal(state.chargeSum,state.spent);
  assert.equal(state.spent,12600);
  assert.ok(state.distinctCommitWorkers>=2,'both concurrent consumers must commit work');
  assert.equal(publishCounter.size,21,'transactional outbox covered all nodes');
  assert.ok(events.some(e=>e.record.includes('INJECTED_CRASH_AFTER_DURABLE_JOURNAL')));
  assert.ok(events.some(e=>e.record.includes('INJECTED_SQL_TRANSACTION_CRASH_BEFORE_COMMIT')));
  assert.ok(events.some(e=>e.record.includes('INJECTED_CRASH_AFTER_DATABASE_COMMIT_BEFORE_RABBIT_ACK')),
    'must actually lose ACK after committed DB transaction');

  const t=await reconstructedTree(p);
  const audit=auditCognitiveTree(t);
  assert.equal(audit.complete,true);assert.equal(audit.acceptedLeaves,11);
  assert.equal(audit.acceptedParents,10);
  // The default audit uses a scripted parent summary. Its digest is
  // intentionally different from Kimi's model-authored parent summaries.
  // Only the persisted recorded Kimi syntheses may be compared to Kimi's root.
  const synth=await synthesize(p);
  assert.equal(synth.parents,10);assert.equal(synth.rootDigest,SOURCE.rootDigest);
  assert.equal((await metrics(p)).syntheses,10);

  // (D) Prove two *independent* SQL connections cannot both acquire root.
  await seed(p,'race-two-clients');
  const [r1,r2]=await Promise.all([
    claim(p,'race-two-clients','R','race-alpha',{leaseMs:15000}),
    claim(p,'race-two-clients','R','race-beta',{leaseMs:15000})]);
  assert.deepEqual([r1.status,r2.status].sort(),['busy','claimed']);
  const winner=r1.status==='claimed'?r1:r2;
  assert.equal((await metrics(p,'race-two-clients')).providerCalls,1);
  await journal(p,winner,{action:'SPLIT',splitAt:1});
  assert.equal((await commit(p,winner)).status,'split');

  // (E) Late stale worker cannot journal or commit after lease fencing.
  await seed(p,'fence-after-expiry');
  const old=await claim(p,'fence-after-expiry','R','old-worker',{leaseMs:2000});
  await p.query(`UPDATE recursion_ci.nodes SET leased_until=now()-interval '1 second'
    WHERE run_id=$1 AND path=$2`,['fence-after-expiry','R']);
  const replacement=await claim(p,'fence-after-expiry','R','replacement-worker',{leaseMs:15000});
  assert.equal(old.status,'claimed');assert.equal(replacement.status,'claimed');
  assert.equal((await journal(p,old,{action:'SPLIT',splitAt:1})).status,'stale');
  assert.equal((await commit(p,old)).status,'stale_fence');
  assert.equal((await journal(p,replacement,{action:'SPLIT',splitAt:1})).status,'journaled');
  assert.equal((await commit(p,replacement)).status,'split');
  assert.equal((await metrics(p,'fence-after-expiry')).commits,1);

  return {status:'success',transport:'real_RabbitMQ_and_PostgreSQL',
    workerProcesses:proc.length,concurrentHealthyWorkers:2,
    redispatchesFromQueue:true,crashEvents:events,
    ...state,rootDigest:synth.rootDigest,
    authenticatedParents:10,authenticatedLeaves:11,
    rootMatchesRealKimi:true,
    claimsRace:[r1.status,r2.status],
    staleFenceDenied:true,atomicRollbackVerified:true,
    journalReplayWithoutAnotherInference:true,
    exactOnceAcceptedDbCommits:true,
    syntheticBudgetUnits:state.spent,actualModelRequests:0,
    originalKimiRun:SOURCE.run,originalKimiProviderTokens:SOURCE.providerReportedTokens,
  };
}
try{
  const result=await work();
  writeFileSync('pg-rabbit-transaction-report.json',JSON.stringify(result,null,2)+'\n');
  console.log('REAL_POSTGRES_RABBIT_RESULT='+JSON.stringify(result));
}catch(error){
  const failure={status:'failure',reason:String(error.message||error).slice(0,220),
    events,workers:proc.map(({rec})=>rec)};
  writeFileSync('pg-rabbit-transaction-report.json',JSON.stringify(failure,null,2)+'\n');
  console.error('REAL_POSTGRES_RABBIT_FAILED='+JSON.stringify(failure).slice(0,3500));
  process.exitCode=1;
}finally{
  for(const {child} of proc)if(!child.killed&&child.exitCode===null)child.kill('SIGTERM');
  await ch.close().catch(()=>{});
  await conn.close().catch(()=>{});
  await p.end().catch(()=>{});
}
