import amqp from 'amqplib';
import {randomUUID,createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {store,config} from './store.mjs';
import {stressCases,sha} from '../certificate-stress-v12/stress.mjs';
import {topologicalSeeds,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {beamOptimize} from '../scheduler-beam-v9/beam.mjs';
import {certifyImproved} from '../tighter-bounds-v13/certifier.mjs';
import {evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_V22_RESEARCH!=='yes')
 throw Error('V22_CI_ONLY');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const {AAU_V22_RUN:run,AAU_V22_QUEUE:queue,AAU_V22_WORKER:label}=process.env;
if(!/^[0-9a-f-]{36}$/.test(run??'')||!/^aau\.research\.v22\.[a-f0-9]{32}$/.test(queue??'')||
   !/^(serial|parallel)-(1|2)$/.test(label??''))throw Error('V22_WORKER_SCOPE_REJECTED');
let raw=String(process.env.AMQP_URL||'').trim().replace(/^AMQP(?:_URL)?\s*=\s*/i,'');
if((raw.startsWith('"')&&raw.endsWith('"'))||(raw.startsWith("'")&&raw.endsWith("'")))raw=raw.slice(1,-1).trim();
if(new URL(raw).protocol!=='amqps:')throw Error('REQUIRE_AMQPS');
const conn=store(process.env.NEON_V19_DATABASE_URL);
let broker,ch;
const counts={worker:label,claimed:0,committed:0,acked:0,redelivered:0,
 duplicates:0,expansions:0,solverMs:0,peakRssKiB:0,caseIds:[]};
let failed=false;
try{
 await conn.verify();
 broker=await amqp.connect(raw,{timeout:10000});
 ch=await broker.createChannel();
 await ch.prefetch(1);
 let empty=0;
 for(let i=0;i<38;i++){
  const message=await ch.get(queue,{noAck:false});
  if(!message){
   empty++;
   if(empty>=6)break;
   await new Promise(resolve=>setTimeout(resolve,140));
   continue;
  }
  empty=0;
  if(message.fields.redelivered)counts.redelivered++;
  const body=JSON.parse(message.content.toString('utf8'));
  if(body.run!==run||typeof body.id!=='string'||
      Object.keys(body).sort().join(',')!=='id,run')
   throw Error('V22_UNEXPECTED_BROKER_PAYLOAD');
  const f=stressCases.find(x=>x.id===body.id);
  if(!f)throw Error('V22_UNKNOWN_CASE');
  const current=await conn.row(run,body.id);
  if(current.status==='done'){
   counts.duplicates++;ch.ack(message);counts.acked++;continue;
  }
  const worker=label+'-'+randomUUID().slice(0,12);
  const claimed=await conn.claim(run,body.id,worker);
  if(!claimed.ok)throw Error('V22_UNEXPECTED_LEASE_CONTENTION');
  counts.claimed++;
  const p=f.problem,originalLower=admissibleLowerBound(p).value;
  const seeds=topologicalSeeds(p);
  const t=performance.now();
  const warm=beamOptimize(p,seeds,{maxEvaluations:config.warmEvaluations,beamWidth:8,maxDepth:7});
  if(!warm.ok)throw Error('V22_WARMUP_FAILED');
  const certified=certifyImproved(p,warm.proposal,{
   maxExpansions:config.maxExpansions,maxFrontier:config.maxFrontier,
   maxWallMs:60000,boundMode:'forced_rank'});
  const ms=performance.now()-t;
  const independently=evaluate(p,{schedule:certified.execution.schedule,cost:certified.upperBound});
  if(!independently.ok||independently.cost!==certified.upperBound||
     certified.lowerBound>certified.upperBound||
     certified.lowerBound<originalLower||
     certified.upperBound>warm.finalCost||
     certified.expanded>config.maxExpansions||
     certified.remainingFrontier>config.maxFrontier||
     certified.gapUpper!==certified.upperBound-certified.lowerBound||
     certified.certifiedOptimal!==(certified.gapUpper===0))
   throw Error('V22_INDEPENDENT_V13_CERTIFICATE_INVALID');
  const receipt={
   lowerBound:certified.lowerBound,upperBound:certified.upperBound,expanded:certified.expanded,
   certificateDigest:certified.evidence.certificateHash,
   witnessDigest:hash(certified.incumbent),
   solverElapsedMs:ms
  };
  const status=await conn.complete(run,body.id,worker,claimed.epoch,receipt);
  if(status!=='COMMITTED')throw Error('V22_NEON_COMMIT_REJECTED');
  counts.committed++;
  counts.expansions+=certified.expanded;
  counts.solverMs+=ms;
  counts.caseIds.push(body.id);
  ch.ack(message);counts.acked++;
 }
 counts.peakRssKiB=process.resourceUsage().maxRSS;
 console.log('AAU_V22_WORKER='+JSON.stringify(counts));
}catch(e){
 failed=true;
 const msg=String(e?.message||e);
 console.log('AAU_V22_WORKER_SAFE_FAILURE='+(/^[A-Z0-9_]+$/.test(msg)?msg:'UNKNOWN_REDACTED'));
}finally{
 try{if(ch)await ch.close()}catch{}
 try{if(broker)await broker.close()}catch{}
 try{await conn.close()}catch{}
 if(failed)process.exitCode=2;
}
