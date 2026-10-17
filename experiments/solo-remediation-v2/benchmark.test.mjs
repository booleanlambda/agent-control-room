import test from 'node:test';
import assert from 'node:assert/strict';
import {publicProblem,hiddenProblems,exactOracle,grade,evaluateVehicle,hash} from './benchmark.mjs';
test('independent oracle finds exact feasible optimum for three distinct scenarios',()=>{
 for(const p of [publicProblem,...hiddenProblems]){
  const best=exactOracle(p);assert.ok(best.feasibleRoutes>0);
  assert.equal(grade(p,{routes:best.routes,cost:best.cost}).passed,true);
 }
});
test('rejects cost forgery',()=>{const p=publicProblem,b=exactOracle(p);assert.equal(grade(p,{routes:b.routes,cost:b.cost+1}).passed,false)});
test('rejects missing customer',()=>{const p=publicProblem,b=exactOracle(p),r=structuredClone(b.routes);r.find(x=>x.stops.length).stops.pop();assert.equal(grade(p,{routes:r,cost:b.cost}).passed,false)});
test('rejects duplicate customer',()=>{const p=publicProblem,b=exactOracle(p),r=structuredClone(b.routes);const v=r.find(x=>x.stops.length);v.stops.push(v.stops[0]);assert.equal(grade(p,{routes:r,cost:b.cost}).passed,false)});
test('precedence violation is rejected',()=>{const p=publicProblem,v=p.vehicles[0];assert.equal(evaluateVehicle(p,v,['C1','C0']).reason,'precedence_or_vehicle_violation')});
test('test material differs across public and held-out cases',()=>{assert.equal(new Set([publicProblem,...hiddenProblems].map(hash)).size,3)});
