import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicProblem,hiddenProblems,exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {scheduleCandidate} from '../deterministic-scheduler-v7/kernel.mjs';
import {rootPartitions,solvePartition,digest} from './partition.mjs';
const script=fileURLToPath(new URL('./ledger.py',import.meta.url));
const all=[publicProblem,...hiddenProblems];
test('every seven-job benchmark is fully and disjointly partitioned by legal first action',()=>{
 for(const p of all){
  const roots=rootPartitions(p);
  assert.equal(roots.length,3);
  assert.equal(new Set(roots.map(x=>x.id)).size,roots.length);
  assert.ok(roots.every(x=>x.entry.id.startsWith('J')));
  const exact=exactOracle(p);
  const branches=roots.map(x=>solvePartition(p,x.entry));
  assert.equal(Math.min(...branches.map(x=>x.cost)),exact.cost);
  assert.ok(branches.every(x=>x.explored>0&&x.proof.length===64));
  for(const b of branches){
   const evaluated=evaluate(p,{schedule:b.schedule,cost:b.cost});
   assert.equal(evaluated.ok,true);
   assert.equal(evaluated.cost,b.cost);
   const scheduler=scheduleCandidate(p,b.proposal);
   assert.equal(scheduler.ok,true);
   assert.equal(scheduler.cost,b.cost);
  }
 }
});
test('fixed baseline and globally proven optimum differ, so missing roots cannot imply proof',()=>{
 const roots=rootPartitions(publicProblem);
 const partial=solvePartition(publicProblem,roots[0].entry);
 assert.ok(partial.cost>=exactOracle(publicProblem).cost);
 assert.equal(roots.length,3);
 const baseline={jobs:[{id:'J0',machine:'M0'},{id:'J1',machine:'M1'},{id:'J3',machine:'M0'},
  {id:'J2',machine:'M1'},{id:'J4',machine:'M0'},{id:'J6',machine:'M0'},{id:'J5',machine:'M1'}]};
 assert.equal(scheduleCandidate(publicProblem,baseline).cost,512);
});
test('root partition never accepts invalid root, omitted machine or silent leaf cap',()=>{
 assert.throws(()=>solvePartition(publicProblem,{id:'J2',machine:'M1'}),/INVALID_ROOT/);
 assert.throws(()=>solvePartition(publicProblem,{id:'J0',machine:'M1'}),/INVALID_ROOT/);
 assert.throws(()=>solvePartition(publicProblem,rootPartitions(publicProblem)[0].entry,{maxLeaves:1}),/PARTITION_BUDGET_EXHAUSTED_NO_PROOF/);
});
test('partition replay is byte-identical and does not write model-authored timestamps',()=>{
 const root=rootPartitions(publicProblem)[0].entry;
 const a=solvePartition(publicProblem,root),b=solvePartition(structuredClone(publicProblem),structuredClone(root));
 assert.deepEqual(a,b);
 assert.ok(a.proposal.jobs.every(x=>Object.keys(x).sort().join(',')==='id,machine'));
 assert.equal(digest(a.proposal).length,64);
});
function runLedger(db,req){
 const proc=spawnSync('python3',[script],{input:JSON.stringify({...req,db}),encoding:'utf8',timeout:5000});
 const out=JSON.parse(proc.stdout);
 return {status:proc.status,out};
}
test('SQL ledger commit is atomic, idempotent and rejects conflicting duplicated result',()=>{
 const dir=mkdtempSync(join(tmpdir(),'aau-v17-test-')),db=join(dir,'ledger.sqlite');
 try{
  const roots=rootPartitions(publicProblem);
  assert.equal(runLedger(db,{action:'init',roots}).status,0);
  let s=runLedger(db,{action:'summary',verifiedIncumbentCost:512});
  assert.equal(s.out.pending,3);assert.equal(s.out.lower,0);assert.equal(s.out.upper,512);
  assert.equal(s.out.optimal,false);
  const root=roots[0],solution=solvePartition(publicProblem,root.entry);
  assert.equal(runLedger(db,{action:'claim',id:root.id}).out.done,false);
  const payload={action:'complete',id:root.id,cost:solution.cost,
   explored:solution.explored,schedule:solution.schedule,hash:solution.proof};
  const first=runLedger(db,payload);
  assert.equal(first.status,0);assert.equal(first.out.committed,true);
  const duplicate=runLedger(db,payload);
  assert.equal(duplicate.status,0);assert.equal(duplicate.out.duplicate,true);
  const conflict=runLedger(db,{...payload,cost:solution.cost+1});
  assert.notEqual(conflict.status,0);
  s=runLedger(db,{action:'summary',verifiedIncumbentCost:512});
  assert.equal(s.out.completed,1);assert.equal(s.out.pending,2);assert.equal(s.out.optimal,false);
  for(const r of roots.slice(1)){
   const x=solvePartition(publicProblem,r.entry);
   assert.equal(runLedger(db,{action:'claim',id:r.id}).status,0);
   assert.equal(runLedger(db,{action:'complete',id:r.id,cost:x.cost,explored:x.explored,
     schedule:x.schedule,hash:x.proof}).status,0);
  }
  s=runLedger(db,{action:'summary',verifiedIncumbentCost:512});
  assert.equal(s.out.completed,3);assert.equal(s.out.pending,0);
  assert.equal(s.out.optimal,true);assert.equal(s.out.lower,415);assert.equal(s.out.upper,415);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
test('ledger unknown root cannot be claimed or marked done',()=>{
 const dir=mkdtempSync(join(tmpdir(),'aau-v17-test-')),db=join(dir,'ledger.sqlite');
 try{
  runLedger(db,{action:'init',roots:rootPartitions(publicProblem)});
  assert.notEqual(runLedger(db,{action:'claim',id:'not-a-root'}).status,0);
  assert.notEqual(runLedger(db,{action:'complete',id:'not-a-root',cost:0,explored:1,
   hash:'x',schedule:[]}).status,0);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
