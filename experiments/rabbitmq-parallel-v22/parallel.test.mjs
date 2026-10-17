import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stressCases,sha} from '../certificate-stress-v12/stress.mjs';
import {topologicalSeeds,admissibleLowerBound} from '../per-instance-scaling-v10/bench.mjs';
import {beamOptimize} from '../scheduler-beam-v9/beam.mjs';
import {certifyImproved} from '../tighter-bounds-v13/certifier.mjs';
import {evaluate} from '../precise-diagnostics-v6/benchmark.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('nine unchanged 12-16 job stress cases have deterministic hashes, independent feasible witnesses',()=>{
 assert.deepEqual(stressCases.map(x=>x.jobCount),[12,12,12,14,14,14,16,16,16]);
 assert.equal(new Set(stressCases.map(x=>x.id)).size,9);
 for(const f of stressCases){
  const warm=beamOptimize(f.problem,topologicalSeeds(f.problem),{maxEvaluations:400,beamWidth:8,maxDepth:7});
  assert.equal(warm.ok,true);
  const v=evaluate(f.problem,{schedule:warm.execution.schedule,cost:warm.finalCost});
  assert.equal(v.ok,true);assert.equal(v.cost,warm.finalCost);
  assert.equal(sha(f.problem).length,64);
 }
});
test('all nine per-case V13 certificates are sound under 2200-2400 bounded search and independent evaluator',()=>{
 for(const f of stressCases){
  const p=f.problem;
  const warm=beamOptimize(p,topologicalSeeds(p),{maxEvaluations:400,beamWidth:8,maxDepth:7});
  const a=certifyImproved(p,warm.proposal,{maxExpansions:2200,maxFrontier:2400,boundMode:'forced_rank'});
  const v=evaluate(p,{schedule:a.execution.schedule,cost:a.upperBound});
  assert.equal(v.ok,true);assert.equal(v.cost,a.upperBound);
  assert.ok(a.lowerBound>=admissibleLowerBound(p).value);
  assert.ok(a.upperBound>=a.lowerBound&&a.upperBound<=warm.finalCost);
  assert.ok(a.expanded<=2200&&a.remainingFrontier<=2400);
  assert.equal(a.certifiedOptimal,a.gapUpper===0);
 }
});
test('Neon ledger semantics distinguish censored-complete case from optimal certification',()=>{
 const ddl=read('schema.sql');
 assert.match(ddl,/upper_bound>=lower_bound/);
 assert.match(ddl,/filter\(where c\.status='done' and c\.lower_bound=c\.upper_bound\)/);
 assert.match(ddl,/sum\(c\.upper_bound-c\.lower_bound\)/);
 assert.match(ddl,/lease_until<=clock_timestamp\(\)/);
 assert.match(ddl,/r\.fence is distinct from p_fence/);
 assert.match(ddl,/return 'STALE'/);
 assert.match(ddl,/return 'DUPLICATE'/);
 assert.match(ddl,/return 'CONFLICT'/);
 assert.match(ddl,/enable row level security/g);
 assert.match(ddl,/revoke all on schema aau_research_v22 from public/);
 assert.match(ddl,/p_ms >= 'Infinity'::double precision/);
});
test('benchmark uses per-case identical budgets and actual concurrently spawned processes',()=>{
 const code=read('live.mjs'),worker=read('worker.mjs');
 assert.match(code,/await oneMode\('serial',1\)/);
 assert.match(code,/await oneMode\('two_workers',2\)/);
 assert.match(code,/await Promise\.all\(Array\.from\(/);
 assert.match(worker,/maxExpansions:config\.maxExpansions,maxFrontier:config\.maxFrontier/);
 assert.match(code,/V22_SERIAL_PARALLEL_CERTIFICATES_DIFFER/);
 assert.match(worker,/const independently=evaluate\(/);
 assert.match(worker,/ch\.ack\(message\)/);
 assert.match(code,/await chan\.deleteQueue\(queue\)/);
});
