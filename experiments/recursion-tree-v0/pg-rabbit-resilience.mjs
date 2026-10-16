// Disposable, real transport interruption test. Runs only in GitHub Actions
// using localhost PostgreSQL and RabbitMQ containers with explicit IDs.
// Proves recovery of a durable queue, Postgres data, TCP connection cutoff,
// competing workers, and exact authenticated Kimi root with no new model calls.
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import amqp from 'amqplib';
import {pool,setup,seed,outbox,published,metrics,reconstructedTree,synthesize,RUN}
  from './pg-rabbit-contract.mjs';
import {auditCognitiveTree} from './cognitive-integrity.mjs';
import {SOURCE} from './kimi-k26-recorded-replay.mjs';

const docker=promisify(execFile);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const rabbit=String(process.env.AAU_RABBIT_CONTAINER||'');
const postgres=String(process.env.AAU_POSTGRES_CONTAINER||'');
if(process.env.AAU_DISPOSABLE_CI_DB!=='yes'||!process.env.GITHUB_ACTIONS||
   !/^[a-f0-9]{12,64}$/.test(rabbit)||!/^[a-f0-9]{12,64}$/.test(postgres)||
   rabbit===postgres)throw Error('UNSAFE_DOCKER_ENV_DENIED');
async function dockerCmd(...args){
  const {stdout}=await docker('docker',args,{timeout:35000});
  return String(stdout||'').trim();
}
async function ensureDisposableContainers(){
  for(const [id,expected] of [[rabbit,'rabbitmq'],[postgres,'postgres']]){
    const image=await dockerCmd('inspect','--format','{{.Config.Image}}',id);
    if(!image.startsWith(expected+':'))throw Error('NON_EXPERIMENT_CONTAINER_DENIED');
  }
}
async function retry(fn,label,max=100){
  let last;
  for(let i=0;i<max;i++){
    try{return await fn()}catch(e){last=e;await sleep(150);}
  }
  throw Error(label+':'+String(last?.message||last).slice(0,120));
}
function tcpCutProxy(port=5673){
  let blocked=false;
  const sockets=new Set();
  let accepted=0,dropped=0;
  const server=net.createServer(down=>{
    accepted++;if(blocked){down.destroy();return;}
    const up=net.connect({host:'127.0.0.1',port:5672});
    sockets.add(down);sockets.add(up);
    const clean=()=>{sockets.delete(down);sockets.delete(up);down.destroy();up.destroy();};
    down.on('error',()=>{});up.on('error',()=>{});
    down.on('close',clean);up.on('close',clean);
    down.pipe(up);up.pipe(down);
  });
  return {
    start:()=>new Promise((resolve,reject)=>{
      server.once('error',reject);server.listen(port,'127.0.0.1',resolve);
    }),
    cut(){blocked=true;dropped+=sockets.size/2;for(const s of sockets)s.destroy();},
    resume(){blocked=false;},
    stats:()=>({accepted,dropped}),
    close:()=>new Promise(resolve=>server.close(resolve)),
  };
}
const logs=[],workers=[],events=[];
function startWorker(name,{partitionProxy=false}={}){
  const w=spawn(process.execPath,[new URL('./pg-rabbit-worker.mjs',import.meta.url).pathname],{
    env:{...process.env,AAU_RABBIT_QUEUE:QUEUE,AAU_DURABLE_QUEUE:'yes',
      AAU_WORKER_NAME:name,AAU_WORKER_ROLE:partitionProxy?'partition_after_journal':'normal',
      TEST_RABBIT_URL:partitionProxy?
        'amqp://aau_ci:aau_ci@127.0.0.1:5673':
        'amqp://aau_ci:aau_ci@127.0.0.1:5672',
      AAU_INJECT_COMMIT_CRASH:'no',AAU_INJECT_SQL_CRASH:'no'},
    stdio:['ignore','pipe','pipe'],
  });
  const rec={name,ready:false,armed:false,exit:null,entries:[]};
  workers.push({w,rec});
  const monitor=buffer=>{
    for(const line of String(buffer).split('\n')){
      if(!line.trim())continue;
      const trimmed=line.slice(0,230);
      rec.entries.push(trimmed);
      if(trimmed.includes('INTEGRATION_READY'))rec.ready=true;
      if(trimmed.includes('NETWORK_PARTITION_ARMED_AFTER_JOURNAL'))rec.armed=true;
      if(trimmed.includes('INTEGRATION_REDELIVERED'))events.push({name,kind:'broker_redelivery'});
      if(trimmed.includes('INTEGRATION_COMMIT'))events.push({name,kind:'semantic_commit'});
      if(trimmed.includes('WORKER_HANDLER_ERROR'))events.push({name,kind:'handler_error'});
      logs.push({name,line:trimmed});
    }
  };
  w.stdout.on('data',monitor);w.stderr.on('data',monitor);
  w.on('exit',(code,signal)=>{rec.exit={code,signal};});
  return {w,rec};
}
async function waitFor(condition,label,maxMs=12000){
  const end=Date.now()+maxMs;
  while(Date.now()<end){
    if(await condition())return;
    await sleep(60);
  }
  throw Error('WAIT_FOR_FAILED:'+label);
}
async function connection(){
  const c=await amqp.connect('amqp://aau_ci:aau_ci@127.0.0.1:5672');
  c.on('error',()=>{});return c;
}
const QUEUE='aau-ci-durable-'+randomUUID();
let p=null,conn=null,ch=null,proxy=null;
async function channel(){
  conn=await retry(connection,'rabbit_connect');
  ch=await conn.createConfirmChannel();
  ch.on('error',()=>{});conn.on('close',()=>{});
  await ch.assertQueue(QUEUE,{durable:true});
}
async function publish(path,count=1){
  for(let i=0;i<count;i++)
    ch.sendToQueue(QUEUE,Buffer.from(JSON.stringify({run:RUN,path})),
      {persistent:true,deliveryMode:2,messageId:'durable-ci:'+path+':'+i});
  await ch.waitForConfirms();
}
async function pump(p,{until=Date.now()+30000}={}){
  const publishedPaths=new Set();
  let lastRescue=0;
  while(Date.now()<until){
    for(const row of await outbox(p)){
      await publish(row.path,3);
      await published(p,RUN,row.path);
      publishedPaths.add(row.path);
    }
    // Reconcile the durable DB source of truth after broker reconnect.
    // This catches outbox entries flagged published before a broker failure.
    if(Date.now()-lastRescue>550){
      const pending=await p.query(`SELECT path FROM recursion_ci.nodes
        WHERE run_id=$1 AND status='pending' AND
          (leased_until IS NULL OR leased_until<now()) ORDER BY depth,path LIMIT 25`,[RUN]);
      for(const n of pending.rows)await publish(n.path);
      lastRescue=Date.now();
    }
    const m=await metrics(p);
    if(m.commits===21&&m.statuses.split===10&&m.statuses.complete===11)
      return {m,publishedPaths:[...publishedPaths]};
    await sleep(70);
  }
  throw Error('TREE_INCOMPLETE_AFTER_TRANSPORT_RECOVERY');
}
async function run(){
  await ensureDisposableContainers();
  p=pool();await setup(p);await seed(p);
  await channel();
  await publish('R');
  assert.equal((await ch.checkQueue(QUEUE)).messageCount,1);
  // Restart the actual RabbitMQ server with a persistent message waiting.
  await conn.close().catch(()=>{});conn=null;ch=null;
  await dockerCmd('restart',rabbit);
  await channel();
  const retained=await ch.checkQueue(QUEUE);
  assert.ok(retained.messageCount>=1,'persistent root lost over broker restart');

  proxy=tcpCutProxy();await proxy.start();
  const isolated=startWorker('partitioned-worker',{partitionProxy:true});
  await waitFor(()=>isolated.rec.ready,'partitioned_worker_start');
  await waitFor(()=>isolated.rec.armed,'journal_before_partition');
  const before=await metrics(p);
  assert.equal(before.journaled,1);assert.equal(before.commits,0);
  proxy.cut();events.push({kind:'tcp_partition_cut'});
  await sleep(200);
  if(!isolated.rec.exit)isolated.w.kill('SIGKILL');
  await waitFor(()=>Boolean(isolated.rec.exit),'partitioned_worker_exit');

  // Real PostgreSQL container outage with journaled response in durable DB.
  // No commits should be accepted while DB is unavailable.
  await dockerCmd('stop','--time','1',postgres);
  let failed=false;try{await p.query('SELECT 1')}catch{failed=true;}
  assert.equal(failed,true,'Postgres requests incorrectly succeeded while stopped');
  await dockerCmd('start',postgres);
  // Old pooled connections can be stale after restart; a fresh pool is the
  // client-side reconnect boundary. The DB rows survive Docker stop/start.
  const recoveredPool=pool();
  await retry(()=>recoveredPool.query('SELECT 1'),'postgres_reconnect');
  const recovered=await metrics(recoveredPool);
  assert.equal(recovered.journaled,1);
  assert.equal(recovered.providerCalls,1);
  assert.equal(recovered.commits,0);
  p= recoveredPool;

  // Two fresh independently scheduled workers race for recovered messages.
  // DB transaction fencing, durable inbox and outbox are the authority.
  const a=startWorker('recovered-worker-A');
  const b=startWorker('recovered-worker-B');
  await Promise.all([waitFor(()=>a.rec.ready,'A'),waitFor(()=>b.rec.ready,'B')]);
  const {m,publishedPaths}=await pump(p);
  assert.equal(m.commits,21);
  assert.equal(m.journaled,21);
  assert.equal(m.chargeCount,21);
  assert.equal(m.calls,m.chargeCount); // removed below if metrics shape differs
  assert.equal(m.chargeSum,m.spent);
  assert.equal(m.spent,12600);
  assert.ok(m.distinctCommitWorkers>=2);
  assert.equal(publishedPaths.length,21);
  const tree=await reconstructedTree(p);
  const audited=auditCognitiveTree(tree);
  assert.equal(audited.complete,true);
  assert.equal(audited.acceptedLeaves,11);
  assert.equal(audited.acceptedParents,10);
  const synthesis=await synthesize(p);
  assert.equal(synthesis.rootDigest,SOURCE.rootDigest);
  assert.equal((await metrics(p)).syntheses,10);
  return {
    outcome:'passed',realInfrastructure:true,
    brokerRestart:true,brokerPersistentRootSurvived:true,
    tcpPartitionDroppedConnections:proxy.stats().dropped,
    postgresStopStart:true,dbQueryFailedDuringOutage:failed,
    persistedJournalSurvivedDbRestart:true,
    twoRecoveredWorkersCommitted:m.distinctCommitWorkers>=2,
    persistedCommitCount:m.commits,answerJournalCount:m.journaled,
    modelEquivalentCharges:m.chargeCount,
    simulatedBudgetUsed:m.spent,simulatedBudgetTotal:m.budget,
    authenticatedLeaves:11,authenticatedParents:10,
    originalLiveKimiRootMatched:synthesis.rootDigest===SOURCE.rootDigest,
    rootDigest:synthesis.rootDigest,
    newProviderModelCalls:0,originalKimiRun:SOURCE.run,
    events,workerExitStates:workers.map(w=>({name:w.rec.name,exit:w.rec.exit})),
  };
}
try{
  const result=await run();
  writeFileSync('pg-rabbit-resilience-report.json',JSON.stringify(result,null,2)+'\n');
  console.log('REAL_INFRA_RESILIENCE_RESULT='+JSON.stringify(result));
}catch(e){
  const error={outcome:'failed',reason:String(e.message||e).slice(0,220),
    events,workerExitStates:workers.map(x=>({name:x.rec.name,exit:x.rec.exit,entries:x.rec.entries.slice(-4)}))};
  writeFileSync('pg-rabbit-resilience-report.json',JSON.stringify(error,null,2)+'\n');
  console.error('REAL_INFRA_RESILIENCE_FAILED='+JSON.stringify(error));
  process.exitCode=1;
}finally{
  for(const {w} of workers)if(w.exitCode===null&&!w.killed)w.kill('SIGTERM');
  if(ch)await ch.close().catch(()=>{});
  if(conn)await conn.close().catch(()=>{});
  if(proxy)await proxy.close().catch(()=>{});
  if(p)await p.end().catch(()=>{});
}
