import test from 'node:test';
import assert from 'node:assert/strict';
import {publicProblem,hiddenProblems,exactOracle,grade,evaluateVehicle,hash} from './benchmark.mjs';
test('all deterministic exact cases have feasible optimal witnesses',()=>{
 for(const p of [publicProblem,...hiddenProblems]){
  const truth=exactOracle(p);
  assert.ok(truth.feasibleRoutes>0);assert.equal(grade(p,{routes:truth.routes,cost:truth.cost}).passed,true);
 }
});
test('cost tampering is rejected',()=>{const p=publicProblem,o=exactOracle(p);assert.equal(grade(p,{routes:o.routes,cost:o.cost-1}).passed,false)});
test('omission is rejected',()=>{const p=publicProblem,o=exactOracle(p);let a=structuredClone(o.routes);let ix=a.findIndex(x=>x.stops.length);a[ix].stops.pop();assert.equal(grade(p,{routes:a,cost:o.cost}).passed,false)});
test('duplicate stops are rejected',()=>{const p=publicProblem,o=exactOracle(p);let a=structuredClone(o.routes);let ix=a.findIndex(x=>x.stops.length);a[ix].stops.push(a[ix].stops[0]);assert.equal(grade(p,{routes:a,cost:o.cost}).passed,false)});
test('overload fails direct check',()=>{const p=publicProblem;const rt=publicProblem.customers.map(x=>x.id);assert.equal(evaluateVehicle(p,p.vehicles[0],rt).ok,false)});
test('hidden inputs differ from public and each other',()=>{assert.equal(new Set([publicProblem,...hiddenProblems].map(hash)).size,3)});
