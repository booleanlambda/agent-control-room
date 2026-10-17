// Genuine in-flight AMQP broker-restart recovery campaign.
// A disposable GitHub Actions RabbitMQ node is restarted while 2 separate
// worker processes have delivered-but-unacknowledged persistent messages.
// PostgreSQL is the authoritative fenced work, journal and charge ledger.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import amqp from 'amqplib';
import {pool,setup,seed,claim,journal,commit,outbox,published,metrics,
  reconstructedTree,synthesize,RUN} from './pg-rabbit-contract.mjs';
import {recordedKimiDecision,SOURCE} from './kimi-k26-recorded-replay.mjs';
import {deepConfig} from './depth10-traversability.mjs';
import {auditCognitiveTree} from './cognitive-integrity.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const docker=promisify(execFile);
const rabbit=String(process.env.AAU_RABBIT_CONTAINER||'');
const QUEUE='aau-inflight-ci-'+randomUUID();
const events=[],processes=[];
let p=null,conn=null,ch=null;
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_DISPOSABLE_CI_DB!=='yes'||
   !/^[a-f0-9]{12,64}$/.test(rabbit))
  throw Error('DISPOSABLE_CI_BROKER_GUARD');
async function dockerCmd(...args){
  const {stdout}=await docker('docker',args,{timeout:40000,maxBuffer:1024*1024});
  return String(stdout||'');
}
async function waitFor(predicate,label,timeoutMs=14000){
  const until=Date.now()+timeoutMs;
  while(Date.now()<until){
    if(await predicate())return true;
    await sleep(65);
  }
  throw Error('WAIT_FOR_'+label);
}
function start(name,role){
  const child=spawn(process.execPath,
    [new URL('./pg-rabbit-worker.mjs',import.meta.url).pathname],
    {env:{...process.env,AAU_RABBIT_QUEUE:QUEUE,AAU_DURABLE_QUEUE:'yes',
      AAU_WORKER_NAME:name,AAU_WORKER_ROLE:role,AAU_INJECT_SQL_CRASH:'no',
      AAU_INJECT_COMMIT_CRASH:'no'},stdio:['ignore','pipe','pipe']});
  const rec={name,role,pid:child.pid,ready:false,held:null,exit:null,
    committed:[],redelivered:[],errors:[],output:[]};
  processes.push({child,rec});
  let unfinished='';
  function lines(data){
    unfinished+=String(data);
    let e;
    while((e=unfinished.indexOf('\n'))>=0){
      const line=unfinished.slice(0,e).trim();unfinished=unfinished.slice(e+1);
      if(!line)continue;
      rec.output.push(line.slice(0,260));
      if(line.includes('INTEGRATION_READY'))rec.ready=true;
      if(line.startsWith('INFLIGHT_UNACKED_JOURNALED ')){
        rec.held=JSON.parse(line.slice('INFLIGHT_UNACKED_JOURNALED '.length));
        events.push({kind:'held_unacked',worker:name,path:rec.held.path});
      }
      if(line.startsWith('INTEGRATION_COMMIT ')){
        const data=JSON.parse(line.slice('INTEGRATION_COMMIT '.length));
        rec.committed.push(data.path);
      }
      if(line.startsWith('INTEGRATION_REDELIVERED ')){
        const data=JSON.parse(line.slice('INTEGRATION_REDELIVERED '.length));
        rec.redelivered.push(data.path);
        events.push({kind:'rabbitmq_redelivery',worker:name,path:data.path});
      }
      if(line.includes('WORKER_HANDLER_ERROR'))rec.errors.push(line.slice(0,200));
    }
  }
  child.stdout.on('data',lines);child.stderr.on('data',lines);
  child.on('exit',(code,signal)=>{rec.exit={code,signal}});
  return rec;
}
async function connect(){
  let last;
  for(let i=0;i<120;i++){
    try{
      const c=await amqp.connect(process.env.TEST_RABBIT_URL);
      c.on('error',()=>{});c.on('close',()=>{});
      const channel=await c.createConfirmChannel();
      channel.on('error',()=>{});channel.on('close',()=>{});
      await channel.assertQueue(QUEUE,{durable:true,autoDelete:false});
      conn=c;ch=channel;return;
    }catch(error){last=error;await sleep(150)}
  }
  throw Error('BROKER_RECONNECT_FAILED:'+String(last?.message||last).slice(0,90));
}
async function publish(path,count=1){
  for(let i=0;i<count;i++)ch.sendToQueue(QUEUE,Buffer.from(JSON.stringify({run:RUN,path})),
    {persistent:true,deliveryMode:2,messageId:'inflight-ci:'+path+':'+i});
  await ch.waitForConfirms();
}
async function actualQueueMetrics(){
  const output=await dockerCmd('exec',rabbit,'rabbitmqctl','-q',
    'list_queues','name','messages_unacknowledged','messages_ready');
  const line=output.split(/\r?\n/).map(t=>t.trim()).find(t=>t.startsWith(QUEUE+'\t')||
    t.startsWith(QUEUE+' '));
  if(!line)throw Error('RABBIT_QUEUE_STATS_NOT_FOUND:'+output.slice(0,220));
  const [queue,unacked,ready]=line.split(/\s+/);
  const n=Number(unacked),r=Number(ready);
  if(queue!==QUEUE||!Number.isInteger(n)||!Number.isInteger(r))
    throw Error('RABBIT_QUEUE_STATS_INVALID:'+line);
  return {unacked:n,ready:r};
}
async function pump({timeMs=30000}={}){
  const publishedPaths=new Set(),end=Date.now()+timeMs;
  let lastRescue=0;
  while(Date.now()<end){
    for(const row of await outbox(p)){
      await publish(row.path,3);
      await published(p,RUN,row.path);
      publishedPaths.add(row.path);
    }
    if(Date.now()-lastRescue>=450){
      const pending=await p.query(`SELECT path FROM recursion_ci.nodes
        WHERE run_id=$1 AND status='pending' AND
        (leased_until IS NULL OR leased_until<now()) ORDER BY depth,path LIMIT 40`,[RUN]);
      for(const row of pending.rows)await publish(row.path);
      lastRescue=Date.now();
    }
    const m=await metrics(p);
    if(m.commits===21&&m.statuses.split===10&&m.statuses.complete===11)
      return {m,publishedPaths:[...publishedPaths]};
    await sleep(65);
  }
  throw Error('TREE_DID_NOT_FINISH_AFTER_INFLIGHT_RESTART');
}
async function execute(){
  const image=(await dockerCmd('inspect','--format','{{.Config.Image}}',rabbit)).trim();
  if(image!=='rabbitmq:3.13-alpine')throw Error('FOREIGN_BROKER_CONTAINER_DENIED');
  p=pool();p.on('error',()=>{});
  await setup(p);await seed(p);
  // Make both child tasks ready without any externally obtained model reply.
  const root=await claim(p,RUN,'R','trusted-ci-bootstrap',{leaseMs:20000});
  assert.equal(root.status,'claimed');
  const modelAnswer=await recordedKimiDecision(root.node,deepConfig('spine',55000));
  assert.equal((await journal(p,root,modelAnswer)).status,'journaled');
  assert.equal((await commit(p,root)).status,'split');
  // Root has already been committed, so it should not need broker publish.
  await published(p,RUN,'R');
  await connect();
  const holders=[start('unacked-worker-A','hold_unacked'),start('unacked-worker-B','hold_unacked')];
  await waitFor(()=>holders.every(x=>x.ready),'TWO_WORKERS_READY');
  await publish('R.001');await publish('R.002');
  await waitFor(()=>holders.every(x=>x.held),'TWO_JOURNALED_INFLIGHT_DELIVERIES');
  const heldPaths=holders.map(x=>x.held.path).sort();
  assert.deepEqual(heldPaths,['R.001','R.002']);
  const prior=await metrics(p);
  assert.equal(prior.commits,1,'both child messages must be uncommitted');
  assert.equal(prior.journaled,3,'root plus two in-flight answers journaled');
  assert.equal(prior.providerCalls,3);
  const brokerBefore=await actualQueueMetrics();
  assert.ok(brokerBefore.unacked>=2,'Rabbit broker had fewer than 2 unacknowledged deliveries');
  assert.equal(brokerBefore.ready,0,'both child messages must be in-flight, not queued');
  events.push({kind:'pre_restart_queue',...brokerBefore});
  // Real broker process restarts with BOTH messages unacknowledged at once.
  // Disconnect the publisher first to avoid dangling channels in the harness.
  await conn.close().catch(()=>{});conn=null;ch=null;
  await dockerCmd('restart',rabbit);
  events.push({kind:'rabbitmq_container_restart',inFlightAtFailure:brokerBefore.unacked});
  for(const rec of holders){
    const item=processes.find(x=>x.rec===rec);
    if(!rec.exit)item.child.kill('SIGKILL');
  }
  await waitFor(()=>holders.every(x=>Boolean(x.exit)),'ABANDONED_WORKERS_TERMINATED');
  await connect();
  const after=await actualQueueMetrics();
  assert.ok(after.ready>=2,'Unacked persistent messages were lost at broker restart');
  events.push({kind:'post_restart_queue',...after});
  const persisted=await metrics(p);
  assert.equal(persisted.commits,1);
  assert.equal(persisted.journaled,3);
  assert.equal(persisted.providerCalls,3);
  // Lease expiry is a real time boundary; no sleep beyond the lease TTL.
  await waitFor(async()=>{
    const q=await p.query(`SELECT count(*)::int n FROM recursion_ci.nodes
      WHERE run_id=$1 AND path IN ('R.001','R.002')
        AND leased_until<now() AND status='pending'`,[RUN]);
    return q.rows[0].n===2;
  },'BOTH_LEASES_EXPIRED',5000);
  const recovering=[start('recovery-worker-A','normal'),start('recovery-worker-B','normal')];
  await waitFor(()=>recovering.every(x=>x.ready),'RECOVERED_WORKERS_READY');
  const {m,publishedPaths}=await pump();
  assert.equal(m.commits,21);
  assert.equal(m.chargeCount,21);
  assert.equal(m.providerCalls,21);
  assert.equal(m.journaled,21);
  assert.equal(m.spent,12600);
  assert.equal(m.chargeSum,m.spent);
  assert.equal(publishedPaths.length,20,'20 child events expected, root already committed');
  assert.ok(m.distinctCommitWorkers>=3,'both replacement workers and bootstrap must commit');
  for(const path of heldPaths){
    const rows=await p.query(`SELECT count(*)::int n FROM recursion_ci.commits
      WHERE run_id=$1 AND path=$2`,[RUN,path]);
    assert.equal(rows.rows[0].n,1,'duplicate accepted child:'+path);
    const charges=await p.query(`SELECT count(*)::int n FROM recursion_ci.charges
      WHERE run_id=$1 AND path=$2`,[RUN,path]);
    assert.equal(charges.rows[0].n,1,'charged same in-flight model work twice:'+path);
  }
  const redelivered=recovering.flatMap(w=>w.redelivered);
  assert.ok(heldPaths.every(path=>redelivered.includes(path)),
    'both pre-restart unacknowledged deliveries must return broker redelivered=true');
  assert.ok(recovering.every(w=>w.committed.length>0),'both recovery workers must commit');
  const tree=await reconstructedTree(p);
  const audited=auditCognitiveTree(tree);
  assert.equal(audited.complete,true);
  assert.equal(audited.acceptedLeaves,11);
  assert.equal(audited.acceptedParents,10);
  const synth=await synthesize(p);
  assert.equal(synth.parents,10);
  assert.equal(synth.rootDigest,SOURCE.rootDigest);
  assert.equal((await metrics(p)).syntheses,10);
  return {
    outcome:'passed',realBrokerRestartWithActiveUnacked:true,
    inFlightAtRestart:brokerBefore.unacked,queueReadyBefore:brokerBefore.ready,
    readyAfterRestart:after.ready,unackedNodesRecovered:heldPaths,
    genuineBrokerRedelivered:redelivered,
    recoveringWorkerCommits:recovering.map(x=>({worker:x.name,accepted:x.committed.length})),
    persistedNodeCommits:m.commits,persistedAnswers:m.journaled,
    uniqueCharges:m.chargeCount,syntheticSpent:m.spent,syntheticBudget:m.budget,
    acceptedLeaves:11,acceptedParents:10,
    rootDigest:synth.rootDigest,originalLiveKimiRootMatched:true,
    actualNewModelCalls:0,originalLiveKimiRun:SOURCE.run,
    events,
  };
}
try{
  const result=await execute();
  writeFileSync('pg-rabbit-inflight-report.json',JSON.stringify(result,null,2)+'\n');
  console.log('INFLIGHT_BROKER_RESTART_RESULT='+JSON.stringify(result));
}catch(error){
  const failure={outcome:'failed',error:String(error?.message||error).slice(0,220),
    events,workers:processes.map(x=>({worker:x.rec.name,role:x.rec.role,
      held:x.rec.held,redelivered:x.rec.redelivered,
      committed:x.rec.committed,exit:x.rec.exit,errors:x.rec.errors,
      tail:x.rec.output.slice(-5)}))};
  writeFileSync('pg-rabbit-inflight-report.json',JSON.stringify(failure,null,2)+'\n');
  console.error('INFLIGHT_BROKER_RESTART_FAILED='+JSON.stringify(failure).slice(0,4300));
  process.exitCode=1;
}finally{
  for(const {child,rec} of processes)if(!rec.exit)child.kill('SIGKILL');
  if(ch)await ch.close().catch(()=>{});
  if(conn)await conn.close().catch(()=>{});
  if(p)await p.end().catch(()=>{});
}
