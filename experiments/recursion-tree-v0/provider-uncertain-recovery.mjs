// Disposable PostgreSQL + real RabbitMQ + local real HTTP request failure lab.
// Proves that a successful external response which could not be committed to
// Postgres is either recovered with provider-side lookup or is held as
// billing-uncertain. NEVER blindly resends an unjournaled request.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import amqp from 'amqplib';
import {pool,setup,seed,tx,claim,journal,commit,outbox,published,
  metrics,reconstructedTree,synthesize} from './pg-rabbit-contract.mjs';
import {startProvider} from './provider-uncertain-http.mjs';
import {recordedKimiDecision,SOURCE} from './kimi-k26-recorded-replay.mjs';
import {deepConfig} from './depth10-traversability.mjs';
import {auditCognitiveTree} from './cognitive-integrity.mjs';

const docker=promisify(execFile);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const postgres=String(process.env.AAU_POSTGRES_CONTAINER||'');
if(process.env.GITHUB_ACTIONS!=='true'||
   process.env.AAU_DISPOSABLE_CI_DB!=='yes'||
   !/^[a-f0-9]{12,64}$/.test(postgres))throw Error('DISPOSABLE_POSTGRES_ONLY');
let p=null,provider=null,conn=null,ch=null;
const events=[];
const appWorkers=[];
async function dockerCmd(...args){
  const {stdout}=await docker('docker',args,{timeout:38000});
  return String(stdout||'').trim();
}
async function retry(op,label,count=80){
  let last;
  for(let i=0;i<count;i++){
    try{return await op()}catch(e){last=e;await sleep(180);}
  }
  throw Error(label+':'+String(last?.message||last).slice(0,100));
}
async function waitFor(check,label,ms=14000){
  const until=Date.now()+ms;
  while(Date.now()<until){
    if(await check())return;
    await sleep(50);
  }
  throw Error('WAIT_FOR_'+label);
}
async function channel(){
  conn=await retry(()=>amqp.connect(process.env.TEST_RABBIT_URL),'rabbitmq_reconnect');
  conn.on('error',()=>{});ch=await conn.createConfirmChannel();ch.on('error',()=>{});
}
async function queueFor(run){
  const name='aau-uncertain-'+run+'-'+randomUUID();
  await ch.assertQueue(name,{durable:true});
  return name;
}
async function publish(queue,run,path='R'){
  ch.sendToQueue(queue,Buffer.from(JSON.stringify({run,path})),
    {persistent:true,deliveryMode:2,messageId:'uncertain:'+run+':'+path});
  await ch.waitForConfirms();
}
async function spawnInitial(run,queue){
  const child=spawn(process.execPath,[new URL('./provider-uncertain-worker.mjs',import.meta.url).pathname],{
    stdio:['ignore','pipe','pipe','ipc'],
    env:{...process.env,AAU_UNCERTAIN_RUN:run,AAU_UNCERTAIN_QUEUE:queue,
      AAU_TEST_PROVIDER_URL:provider.endpoint},
  });
  const rec={run,child,ready:false,answered:false,failedJournal:false,exit:null,lines:[]};
  appWorkers.push(rec);let remainder='';
  function append(data){
    remainder+=String(data);
    let i;
    while((i=remainder.indexOf('\n'))>=0){
      const line=remainder.slice(0,i).trim();remainder=remainder.slice(i+1);
      if(!line)continue;
      rec.lines.push(line.slice(0,240));
      if(line.startsWith('PROVIDER_WORKER_READY'))rec.ready=true;
      if(line.startsWith('PROVIDER_RETURNED_VALID_ANSWER'))rec.answered=true;
      if(line.startsWith('JOURNAL_FAILED_AFTER_PROVIDER_SUCCESS'))rec.failedJournal=true;
    }
  }
  child.stdout.on('data',append);child.stderr.on('data',append);
  child.on('exit',(code,signal)=>{rec.exit={code,signal}});
  await waitFor(()=>rec.ready||rec.exit,'provider_worker_ready');
  assert.equal(rec.exit,null,'initial worker exited before readiness');
  return rec;
}
async function stopPostgresAndLoseResponse(run,queue){
  const rec=await spawnInitial(run,queue);
  await publish(queue,run);
  await waitFor(()=>rec.answered||rec.exit,'provider_answer_in_memory');
  assert.equal(rec.exit,null,'initial worker never received provider response');
  const req=await p.query(`SELECT * FROM recursion_ci.provider_requests WHERE run_id=$1`,[run]);
  assert.equal(req.rows.length,1);
  assert.equal(req.rows[0].state,'sent','intent must be durably marked sent');
  assert.equal((await metrics(p,run)).journaled,0);
  await dockerCmd('stop','--time','1',postgres);
  let unavailable=false;
  try{await p.query('SELECT 1')}catch{unavailable=true;}
  assert.equal(unavailable,true,'Postgres stop did not interrupt client');
  rec.child.send('db_is_down');
  await waitFor(()=>Boolean(rec.exit),'initial_worker_exit');
  assert.equal(rec.exit.code,86,JSON.stringify(rec.lines.slice(-4)));
  assert.equal(rec.failedJournal,true,'successful provider answer unexpectedly journaled');
  const previous=p;
  await dockerCmd('start',postgres);
  p=pool();p.on('error',()=>{});
  previous.end().catch(()=>{});
  await retry(()=>p.query('SELECT 1'),'postgres_reconnect');
  const after=await metrics(p,run);
  assert.equal(after.journaled,0);
  assert.equal(after.providerCalls,1);
  assert.equal(after.spent,600);
  const current=await p.query('SELECT * FROM recursion_ci.provider_requests WHERE run_id=$1',[run]);
  assert.equal(current.rows[0].state,'sent');
  events.push({kind:'successful_http_response_unjournaled',
    run,providerResponseOnlyInDeadWorkerMemory:true,dbUnavailable:true,
    durableIntent:'sent',initialModelEquivalentCharges:after.chargeCount});
}
async function reClaimWithoutDebit(run,path,worker){
  return tx(p,async c=>{
    const q=await c.query(`SELECT * FROM recursion_ci.nodes WHERE run_id=$1
      AND path=$2 FOR UPDATE`,[run,path]);
    if(!q.rowCount)return {status:'missing'};
    const node=q.rows[0];
    const request=await c.query(`SELECT * FROM recursion_ci.provider_requests
      WHERE run_id=$1 AND path=$2 FOR UPDATE`,[run,path]);
    if(!request.rowCount||request.rows[0].state!=='sent')
      return {status:'not_reconcilable'};
    if(node.status!=='pending')return {status:'already_accepted'};
    if(node.leased_until&&new Date(node.leased_until).getTime()>Date.now())
      return {status:'lease_not_expired'};
    const generation=node.generation+1;
    await c.query(`UPDATE recursion_ci.nodes SET generation=$3,
      leased_until=now()+interval '20 seconds',worker_id=$4
      WHERE run_id=$1 AND path=$2`,[run,path,generation,worker]);
    return {status:'claimed',path,run,worker,generation,cached:false};
  });
}
async function consumeOnce(queue,handler){
  let resolve,reject;
  const finished=new Promise((a,b)=>{resolve=a;reject=b});
  const tag=await ch.consume(queue,async msg=>{
    if(!msg)return;
    try{
      const data=JSON.parse(String(msg.content));
      const x=await handler(data,msg);
      ch.ack(msg);
      resolve({redelivered:msg.fields.redelivered,...x});
    }catch(e){
      ch.nack(msg,false,true);
      reject(e);
    }
  },{noAck:false});
  const result=await Promise.race([finished,
    sleep(12500).then(()=>{throw Error('RABBIT_REDELIVERY_TIMEOUT')})]);
  await ch.cancel(tag.consumerTag);
  return result;
}
async function recoverOrHold(run,queue){
  // The broker requeues the original message when the first OS worker dies.
  await waitFor(async()=>{
    const q=await p.query(`SELECT leased_until<now() AS expired
      FROM recursion_ci.nodes WHERE run_id=$1 AND path='R'`,[run]);
    return q.rows[0]?.expired;
  },'initial_lease_expiry',5000);
  const result=await consumeOnce(queue,async (msg,delivery)=>{
    assert.equal(msg.run,run);assert.equal(msg.path,'R');
    const q=await p.query(`SELECT * FROM recursion_ci.provider_requests
      WHERE run_id=$1 AND path='R'`,[run]);
    assert.equal(q.rowCount,1);
    const requestId=q.rows[0].request_id;
    assert.equal(q.rows[0].state,'sent');
    const naive=await claim(p,run,'R','unguarded-broker-redelivery',{leaseMs:1000});
    assert.equal(naive.status,'external_request_reconciliation_required');
    assert.equal(naive.providerState,'sent');
    const response=await fetch(provider.endpoint+'/v1/responses/'+encodeURIComponent(requestId));
    if(run==='recoverable'){
      assert.equal(response.status,200,'provider request-ID lookup should succeed');
      const body=await response.json();
      assert.equal(body.request_id,requestId);
      assert.equal(body.chargedNew,false);
      const receipt=await reClaimWithoutDebit(run,'R','reconciliation-worker');
      assert.equal(receipt.status,'claimed');
      assert.equal((await journal(p,receipt,body.response)).status,'journaled');
      assert.equal((await commit(p,receipt)).status,'split');
      await p.query(`UPDATE recursion_ci.provider_requests SET state='reconciled',
        recovery_method='provider_lookup' WHERE run_id=$1 AND path='R'`,[run]);
      return {status:'reconciled',providerLookup:true};
    }
    assert.equal(response.status,404,'opaque provider must not provide retrieval');
    const body=await response.json();
    assert.equal(body.error,'lookup_not_supported');
    await p.query(`UPDATE recursion_ci.provider_requests SET state='manual_hold',
      recovery_method='not_retrievable_no_automatic_retry'
      WHERE run_id=$1 AND path='R' AND state='sent'`,[run]);
    return {status:'manual_hold',providerLookup:false};
  });
  assert.equal(result.redelivered,true,'RabbitMQ did not redeliver crashed wake');
  events.push({kind:'broker_recovers_unjournaled_request',run,
    brokerRedelivered:true,result:result.status,lookup:result.providerLookup});
  return result;
}
async function finishRecoveredTree(){
  const run='recoverable';
  const done=new Set(['R']);
  await published(p,run,'R');
  for(let n=0;n<50;n++){
    const candidates=await outbox(p,run);
    for(const item of candidates){
      if(done.has(item.path))continue;
      const r=await claim(p,run,item.path,'recovery-fixture',{leaseMs:20000});
      if(r.status!=='claimed')throw Error('UNEXPECTED_DESCENDANT_CLAIM:'+r.status);
      const answer=await recordedKimiDecision(r.node,deepConfig('spine',55000));
      assert.equal((await journal(p,r,answer)).status,'journaled');
      const result=await commit(p,r);
      assert.ok(['split','complete'].includes(result.status));
      await published(p,run,item.path);
      done.add(item.path);
    }
    if(done.size===21)break;
    await sleep(10);
  }
  assert.equal(done.size,21,'ten-level tree not completed after reconciled root');
  const m=await metrics(p,run);
  assert.equal(m.commits,21);
  assert.equal(m.chargeCount,21);
  assert.equal(m.providerCalls,21);
  assert.equal(m.journaled,21);
  assert.equal(m.spent,12600);
  assert.equal(m.chargeSum,m.spent);
  const tree=await reconstructedTree(p,run);
  const root=auditCognitiveTree(tree);
  assert.equal(root.complete,true);assert.equal(root.acceptedLeaves,11);
  const synthesis=await synthesize(p,run);
  assert.equal(synthesis.rootDigest,SOURCE.rootDigest);
  assert.equal((await metrics(p,run)).syntheses,10);
  return {rootDigest:synthesis.rootDigest,...m};
}
async function run(){
  const image=await dockerCmd('inspect','--format','{{.Config.Image}}',postgres);
  assert.equal(image,'postgres:16-alpine','foreign postgres container forbidden');
  provider=await startProvider();
  p=pool();p.on('error',()=>{});
  await setup(p);
  await p.query(`CREATE TABLE recursion_ci.provider_requests(
    run_id text NOT NULL,path text NOT NULL,request_id text NOT NULL UNIQUE,
    state text NOT NULL CHECK(state IN ('sent','reconciled','manual_hold')),
    recovery_method text,PRIMARY KEY(run_id,path),
    FOREIGN KEY(run_id,path) REFERENCES recursion_ci.nodes(run_id,path))`);
  await seed(p,'recoverable');
  await seed(p,'opaque');
  await channel();
  const recoverQueue=await queueFor('recoverable');
  const opaqueQueue=await queueFor('opaque');
  await stopPostgresAndLoseResponse('recoverable',recoverQueue);
  const first=await recoverOrHold('recoverable',recoverQueue);
  assert.equal(first.status,'reconciled');
  const complete=await finishRecoveredTree();
  await stopPostgresAndLoseResponse('opaque',opaqueQueue);
  const second=await recoverOrHold('opaque',opaqueQueue);
  assert.equal(second.status,'manual_hold');
  const blocked=await metrics(p,'opaque');
  assert.equal(blocked.commits,0);
  assert.equal(blocked.journaled,0);
  assert.equal(blocked.providerCalls,1);
  assert.equal(blocked.spent,600);
  const held=await p.query(`SELECT state,recovery_method FROM recursion_ci.provider_requests
    WHERE run_id='opaque'`);
  assert.equal(held.rows[0].state,'manual_hold');
  // The ordinary generic claim routine MUST refuse the held request; no
  // accidental reissue by another worker following broker redelivery.
  const unsafe=await claim(p,'opaque','R','second-ordinary-worker',{leaseMs:1000});
  assert.equal(unsafe.status,'external_request_reconciliation_required');
  assert.equal(unsafe.providerState,'manual_hold');
  assert.equal((await metrics(p,'opaque')).providerCalls,1);
  const stats=provider.stats();
  assert.equal(stats.newChargedExecutions,2,'each provider-side run billed exactly once');
  assert.equal(stats.postRequests,2,'no duplicate HTTP calls were sent');
  assert.equal(stats.lookups,2);
  assert.equal(stats.accountCharges['aau-ci-recoverable-R'],1);
  assert.equal(stats.accountCharges['aau-ci-opaque-R'],1);
  return {
    outcome:'passed',realHttpProviderSimulator:true,
    postgresPhysicallyStoppedTwice:true,actualProviderHttpResponses:2,
    providerRequestLookupRecovered:1,opaqueProviderManualHold:1,
    blindlyReissuedRequests:0,uniqueProviderSimulatedCharges:2,
    providerStats:stats,
    recoverable:{rootDigest:complete.rootDigest,nodesCommitted:complete.commits,
      persistedAnswers:complete.journaled,modelEquivalentCharges:complete.chargeCount,
      syntheticBudgetSpent:complete.spent,syntheticBudgetTotal:complete.budget,
      originalKimiRootMatched:complete.rootDigest===SOURCE.rootDigest},
    opaque:{rootNotCertified:true,modelEquivalentCharges:blocked.chargeCount,
      committedNodes:blocked.commits,unresolvedBillingStatus:held.rows[0].state},
    replayedKimiDataset:true,actualNewRemoteLLMCalls:0,events,
  };
}
try{
  const result=await run();
  writeFileSync('provider-uncertain-recovery-report.json',JSON.stringify(result,null,2)+'\n');
  console.log('PROVIDER_UNCERTAIN_JOURNAL_RESULT='+JSON.stringify(result));
}catch(error){
  const failure={outcome:'failed',error:String(error?.stack||error).slice(0,900),
    events,workerExitStates:appWorkers.map(w=>({run:w.run,exit:w.exit,lines:w.lines.slice(-5)})),
    providerStats:provider?.stats()||null};
  writeFileSync('provider-uncertain-recovery-report.json',JSON.stringify(failure,null,2)+'\n');
  console.error('PROVIDER_UNCERTAIN_JOURNAL_FAILED='+JSON.stringify(failure).slice(0,3200));
  process.exitCode=1;
}finally{
  for(const rec of appWorkers)if(rec.exit===null)rec.child.kill('SIGKILL');
  if(ch)await ch.close().catch(()=>{});
  if(conn)await conn.close().catch(()=>{});
  if(p)await p.end().catch(()=>{});
  if(provider)await provider.close().catch(()=>{});
}
