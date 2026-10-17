// AAU V15: a completely disk-backed priority frontier in its own Python process.
// Every emitted schedule is independently checked by the separate V6 evaluator.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const source=fileURLToPath(new URL('./spill.py',import.meta.url));
export function certifyDisk(problem,proposal,{
 maxExpansions=2200,maxQueueEntries=35000,maxWallMs=60000,maxDatabaseBytes=60000000,
 boundMode='forced_rank'}={}){
 if(!Number.isSafeInteger(maxExpansions)||maxExpansions<0||maxExpansions>200000||
 !Number.isSafeInteger(maxQueueEntries)||maxQueueEntries<1||maxQueueEntries>300000||
 !Number.isSafeInteger(maxWallMs)||maxWallMs<0||maxWallMs>300000||
 !Number.isSafeInteger(maxDatabaseBytes)||maxDatabaseBytes<100000||maxDatabaseBytes>2000000000||
 !['forced_rank','v12'].includes(boundMode))throw Error('BAD_DISK_PROOF_BUDGET');
 const initial=scheduleCandidate(problem,proposal);
 if(!initial.ok)throw Error('INVALID_TRUSTED_SEED:'+initial.reason);
 const dir=mkdtempSync(join(tmpdir(),'aau-v15-'));
 try{
  const req={problem,incumbent:proposal,incumbentCost:initial.cost,
   dbPath:join(dir,'frontier.sqlite'),
   caps:{maxExpansions,maxQueueEntries,maxWallMs,maxDatabaseBytes,boundMode}};
  const child=spawnSync('python3',[source],{
   input:JSON.stringify(req),encoding:'utf8',maxBuffer:2000000,
   timeout:Math.max(10000,maxWallMs+18000)});
  if(child.error)throw Error('DISK_CHILD_FAILURE:'+String(child.error.message).slice(0,150));
  let data;
  try{data=JSON.parse(child.stdout.trim())}
  catch{throw Error('DISK_RESPONSE_INVALID:'+String(child.stderr).slice(0,350))}
  if(child.status!==0||data.error)throw Error('DISK_CERTIFIER_ERROR:'+String(data.error||child.stderr).slice(0,350));
  const checked=scheduleCandidate(problem,data.incumbent);
  const external=evaluate(problem,{schedule:checked.schedule,cost:checked.cost});
  if(!checked.ok||!external.ok||checked.cost!==data.upperBound||external.cost!==data.upperBound||
     data.lowerBound>data.upperBound||data.certifiedOptimal!==(data.gapUpper===0)||
     data.upperBound>initial.cost||data.stats.expanded>maxExpansions||
     data.stats.remainingQueue>maxQueueEntries||
     !Number.isFinite(data.stats.dbBytesAtStop))
   throw Error('DISK_INDEPENDENT_CERTIFICATE_REJECTED');
  return {...data,execution:checked,limits:req.caps,
   inputHash:hash(problem),incumbentHash:hash(data.incumbent),
   independentFeasible:true,
   certificateHash:hash({p:hash(problem),lb:data.lowerBound,ub:data.upperBound,
    expanded:data.stats.expanded,remaining:data.stats.remainingQueue,
    method:'sqlite_atomic_frontier'})};
 }finally{rmSync(dir,{recursive:true,force:true})}
}
