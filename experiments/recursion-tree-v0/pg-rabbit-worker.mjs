// Separate OS process, genuine RabbitMQ consumer + PostgreSQL writer.
// No external LLM; replays the verified Kimi decision fixture.
import amqp from 'amqplib';
import {pool,claim,journal,commit,RUN} from './pg-rabbit-contract.mjs';
import {recordedKimiDecision} from './kimi-k26-recorded-replay.mjs';
import {deepConfig} from './depth10-traversability.mjs';

const name=process.env.AAU_WORKER_NAME||'worker';
const queue=process.env.AAU_RABBIT_QUEUE;
const role=process.env.AAU_WORKER_ROLE||'normal';
if(!queue||!process.env.AAU_DISPOSABLE_CI_DB)throw Error('INTEGRATION_ENV_MISSING');
const pg=pool();
const conn=await amqp.connect(process.env.TEST_RABBIT_URL||'amqp://guest:guest@127.0.0.1:5672');
const channel=await conn.createChannel();
await channel.assertQueue(queue,{durable:false});
await channel.prefetch(1);
let events=0;
await channel.consume(queue,async msg=>{
  if(!msg)return;
  try{
    const {path,run}=JSON.parse(msg.content.toString());
    if(run!==RUN){channel.ack(msg);return;}
    const receipt=await claim(pg,run,path,name,{leaseMs:role==='journal_crasher'?1000:5000});
    if(receipt.status==='busy'||receipt.status==='already_accepted'||receipt.status==='blocked'){
      channel.ack(msg);return;
    }
    if(receipt.status!=='claimed'){
      throw Error('CLAIM_UNEXPECTED:'+receipt.status);
    }
    const reply=receipt.cached?receipt.answer:await recordedKimiDecision(receipt.node,deepConfig('spine',55000));
    if(!receipt.cached){
      const saved=await journal(pg,receipt,reply);
      if(!['journaled','already_journaled'].includes(saved.status))
        throw Error('JOURNAL_REJECTED:'+saved.status);
    }
    if(role==='journal_crasher'&&path==='R'){
      console.log('INJECTED_CRASH_AFTER_DURABLE_JOURNAL');
      process.exit(86); // Rabbit requeues unacked root.
    }
    const result=await commit(pg,receipt);
    if(!['split','complete','already_accepted'].includes(result.status))
      throw Error('COMMIT_REJECTED:'+result.status);
    events++;console.log('INTEGRATION_COMMIT '+JSON.stringify({worker:name,path,status:result.status,cached:receipt.cached}));
    if(role==='normal'&&path==='R.001'&&process.env.AAU_INJECT_COMMIT_CRASH==='yes'){
      console.log('INJECTED_CRASH_AFTER_DATABASE_COMMIT_BEFORE_RABBIT_ACK');
      process.exit(87); // Database commit is permanent; Rabbit redelivers.
    }
    channel.ack(msg);
  }catch(e){
    console.error('WORKER_HANDLER_ERROR '+String(e.message||e).slice(0,160));
    channel.nack(msg,false,true);
  }
},{noAck:false});
console.log('INTEGRATION_READY '+JSON.stringify({worker:name,role}));
process.on('SIGTERM',async()=>{
  await channel.close().catch(()=>{});
  await conn.close().catch(()=>{});
  await pg.end().catch(()=>{});
  process.exit(0);
});
