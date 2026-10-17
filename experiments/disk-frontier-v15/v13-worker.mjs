import {readFileSync} from 'node:fs';
import {certifyImproved} from '../tighter-bounds-v13/certifier.mjs';
import {evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
try{
 const args=JSON.parse(readFileSync(0,'utf8'));
 const result=certifyImproved(args.problem,args.incumbent,{
  maxExpansions:args.maxExpansions,maxFrontier:args.maxFrontier,maxWallMs:60000,boundMode:'forced_rank'});
 const v=evaluate(args.problem,{schedule:result.execution.schedule,cost:result.upperBound});
 if(!v.ok||v.cost!==result.upperBound)throw Error('INDEPENDENT_V13_FEASIBILITY_FAILURE');
 const mem=process.resourceUsage();
 process.stdout.write(JSON.stringify({
  lowerBound:result.lowerBound,upperBound:result.upperBound,gapUpper:result.gapUpper,
  certifiedOptimal:result.certifiedOptimal,expanded:result.expanded,generated:result.generated,
  frontier:result.remainingFrontier,peakFrontier:result.maxHeap,exitReason:result.exitReason,
  elapsedNs:result.elapsedNs,observedMaxRssKiB:mem.maxRSS,
  observedHeapBytes:process.memoryUsage().heapUsed,
  certificateHash:result.evidence.certificateHash,verified:true})+'\n');
}catch(e){process.stderr.write(String(e?.stack??e));process.exitCode=2}
