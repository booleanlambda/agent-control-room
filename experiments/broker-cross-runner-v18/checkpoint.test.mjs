import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {publicProblem,exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {rootPartitions,solvePartition} from '../rabbitmq-proof-frontier-v17/partition.mjs';

const ledgerFile=fileURLToPath(new URL('../rabbitmq-proof-frontier-v17/ledger.py',import.meta.url));
function invoke(db,op){
 const child=spawnSync('python3',[ledgerFile],{input:JSON.stringify({...op,db}),encoding:'utf8',timeout:8000});
 return {ok:child.status===0,result:JSON.parse(child.stdout)};
}
test('independent-process checkpoint snapshots preserve the exact partial and final interval',()=>{
 const root=mkdtempSync(join(tmpdir(),'aau-v18-unit-'));
 try{
  const roots=rootPartitions(publicProblem);
  const stage=(n)=>{
   const folder=join(root,'runner'+n);
   mkdirSync(folder);
   return join(folder,'ledger.sqlite');
  };
  let db=stage(0);
  assert.equal(invoke(db,{action:'init',roots}).ok,true);
  const baseline=512;
  let previous=invoke(db,{action:'summary',verifiedIncumbentCost:baseline}).result;
  assert.deepEqual([previous.lower,previous.upper,previous.pending,previous.optimal],[0,512,3,false]);
  let totalExplored=0;
  for(let i=0;i<3;i++){
   const fresh=stage(i+1);
   copyFileSync(db,fresh);db=fresh;
   const root=roots[i],ready=invoke(db,{action:'claim',id:root.id});
   assert.equal(ready.ok,true);assert.equal(ready.result.done,false);
   const complete=solvePartition(publicProblem,root.entry);
   const validated=evaluate(publicProblem,{schedule:complete.schedule,cost:complete.cost});
   assert.equal(validated.ok,true);assert.equal(validated.cost,complete.cost);
   const op={action:'complete',id:root.id,cost:complete.cost,
    explored:complete.explored,schedule:complete.schedule,hash:complete.proof};
   assert.equal(invoke(db,op).result.committed,true);
   const repeat=invoke(db,op);
   assert.equal(repeat.ok,true);assert.equal(repeat.result.duplicate,true);
   assert.equal(invoke(db,{...op,cost:complete.cost+1}).ok,false);
   previous=invoke(db,{action:'summary',verifiedIncumbentCost:baseline}).result;
   totalExplored+=complete.explored;
   assert.equal(previous.completed,i+1);
   assert.equal(previous.pending,2-i);
   assert.equal(previous.optimal,i===2);
   if(i<2){
    assert.equal(previous.lower,0);
    assert.ok(previous.upper>=exactOracle(publicProblem).cost);
   }
  }
  assert.equal(totalExplored,448);
  assert.equal(previous.upper,415);
  assert.equal(previous.lower,415);
  assert.equal(previous.gap,0);
  assert.equal(exactOracle(publicProblem).cost,415);
 }finally{rmSync(root,{recursive:true,force:true})}
});
test('stage execution refuses offline runs and never opens broker without isolated workflow gate',()=>{
 const path=fileURLToPath(new URL('./stages.mjs',import.meta.url));
 const p=spawnSync(process.execPath,[path,'publish'],{
  env:{PATH:process.env.PATH,HOME:process.env.HOME},encoding:'utf8',timeout:3000});
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/RESEARCH_CI_ONLY/);
});
