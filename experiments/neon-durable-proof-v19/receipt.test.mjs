import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {publicProblem,exactOracle,evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
import {rootPartitions,solvePartition,digest} from '../rabbitmq-proof-frontier-v17/partition.mjs';

const previous=[
 {id:'J0@M0',root:'b283ae937728148288a603eafa86ded972b5a889bedac53035665cff3c9168de',
  cost:415,leaves:240,receipt:'e908e96559bbf10e4d8c9e9d680e9508a55c5d55851cf01eba44105e06ceebe9'},
 {id:'J1@M0',root:'f12ffbea278fcd8878c19b6ff4e99e89f35218537b7dd677cffce03ae5e4a11e',
  cost:469,leaves:104,receipt:'025a20ed39262ee4f7d2a8bf15afaf0101227884c6bf4162ef8271d73a5a0513'},
 {id:'J1@M1',root:'310f5f06c4bf0856a4d8f35870017291516a4a3c64520269bdec890e8a075af9',
  cost:452,leaves:104,receipt:'d8d6473ff35001d185ce8cff8f82d530f0562db9c83828e2f62bb09de01fe748'}
];
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
test('Neon persisted proof receipts reproduce trusted kernel and external exact oracle',()=>{
 assert.equal(digest(publicProblem),'544ebed3a3624eb4ef422454e8c6d064b4171b20282ef242de8dd8933685884f');
 const roots=rootPartitions(publicProblem);
 assert.equal(roots.length,previous.length);
 let explored=0,minimum=Infinity;
 for(const p of previous){
  const root=roots.find(x=>x.id===p.id);
  assert.ok(root);
  assert.equal(digest(root.entry),p.root);
  const a=solvePartition(publicProblem,root.entry);
  assert.equal(a.cost,p.cost);assert.equal(a.explored,p.leaves);
  const receipt=hash({root:p.id,cost:a.cost,explored:a.explored,schedule:a.schedule});
  assert.equal(receipt,p.receipt);
  const validated=evaluate(publicProblem,{schedule:a.schedule,cost:a.cost});
  assert.equal(validated.ok,true);assert.equal(validated.cost,a.cost);
  minimum=Math.min(minimum,a.cost);explored+=a.explored;
 }
 assert.equal(explored,448);
 assert.equal(minimum,415);
 assert.equal(exactOracle(publicProblem).cost,415);
});
test('new private-schema migration requires fencing, no public grants and RLS',()=>{
 const s=readFileSync(new URL('./schema.sql',import.meta.url),'utf8');
 assert.match(s,/create schema if not exists aau_research_v19/i);
 assert.match(s,/revoke all on schema aau_research_v19 from public/i);
 assert.match(s,/alter table aau_research_v19\.runs enable row level security/i);
 assert.match(s,/alter table aau_research_v19\.branches enable row level security/i);
 assert.match(s,/alter table aau_research_v19\.events enable row level security/i);
 assert.match(s,/lease_until/i);
 assert.match(s,/fence=fence\+1/i);
 assert.match(s,/r\.fence is distinct from p_epoch/i);
 assert.match(s,/return 'STALE'/i);
 assert.match(s,/return 'DUPLICATE'/i);
 assert.match(s,/return 'CONFLICT'/i);
 assert.match(s,/unfinished>0 then 0/i);
});
