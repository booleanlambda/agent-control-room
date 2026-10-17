// OS worker calls the real local HTTP provider, then waits for deliberate
// database shutdown before it can journal the successful response.
// No production URLs/credentials accepted; bounded one-shot test only.
import amqp from 'amqplib';
import {pool,claim,journal} from './pg-rabbit-contract.mjs';

if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_DISPOSABLE_CI_DB!=='yes')
  throw Error('DISPOSABLE_CI_ONLY');
const run=process.env.AAU_UNCERTAIN_RUN;
if(!['recoverable','opaque'].includes(run))throw Error('UNEXPECTED_TEST_RUN');
const url=String(process.env.AAU_TEST_PROVIDER_URL||'');
if(new URL(url).hostname!=='127.0.0.1')throw Error('EXTERNAL_PROVIDER_FORBIDDEN');
const queue=process.env.AAU_UNCERTAIN_QUEUE;
const pg=pool();pg.on('error',()=>{});
const conn=await amqp.connect(process.env.TEST_RABBIT_URL);
conn.on('error',()=>{});
const ch=await conn.createChannel();ch.on('error',()=>{});
await ch.assertQueue(queue,{durable:true});await ch.prefetch(1);
await ch.consume(queue,async msg=>{
  if(!msg)return;
  try{
    const data=JSON.parse(String(msg.content));
    if(data.run!==run||data.path!=='R')throw Error('BAD_BROKER_PAYLOAD');
    const receipt=await claim(pg,run,'R','pre-journal-worker',{leaseMs:1500});
    if(receipt.status!=='claimed')throw Error('CLAIM_FAILED:'+receipt.status);
    const requestId='aau-ci-'+run+'-R';
    await pg.query(`INSERT INTO recursion_ci.provider_requests
      (run_id,path,request_id,state) VALUES($1,$2,$3,'sent')`,
      [run,'R',requestId]);
    const r=await fetch(url+'/v1/complete',{
      method:'POST',headers:{'content-type':'application/json','idempotency-key':requestId},
      body:JSON.stringify({run,path:'R'})});
    if(!r.ok)throw Error('PROVIDER_HTTP_'+r.status);
    const response=await r.json();
    if(response.request_id!==requestId||!response.response)
      throw Error('PROVIDER_RESULT_INVALID');
    console.log('PROVIDER_RETURNED_VALID_ANSWER '+JSON.stringify({run,requestId,chargedNew:response.chargedNew}));
    // Output stays in RAM, not in Postgres or durable local storage.
    process.on('message',async m=>{
      if(m!=='db_is_down')return;
      try{
        await journal(pg,receipt,response.response);
        console.log('DANGEROUS_UNEXPECTED_JOURNAL_SUCCEEDED');
        process.exit(91);
      }catch(err){
        console.log('JOURNAL_FAILED_AFTER_PROVIDER_SUCCESS '+JSON.stringify({
          run,errorCode:String(err.code||err.name||'connection_failure').slice(0,55)}));
        process.exit(86);
      }
    });
  }catch(e){
    console.error('UNEXPECTED_PROVIDER_WORKER_ERROR '+String(e.message||e).slice(0,150));
    process.exit(1);
  }
},{noAck:false});
console.log('PROVIDER_WORKER_READY '+JSON.stringify({run}));
