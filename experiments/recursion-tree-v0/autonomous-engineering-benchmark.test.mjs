import test from 'node:test';import assert from 'node:assert/strict';
import {CASE,evaluate,enumerateExact,exactDp,acceptFormulation} from './autonomous-engineering-benchmark.mjs';
test('independent exhaustive solver recovers 3013 feasible engineering schedules and exact minimum 467',()=>{
 const e=enumerateExact();
 assert.equal(e.feasibleCount,3013);
 assert.equal(e.optimalCost,467);
 assert.deepEqual(e.optimalSchedules,[[3,4,4,3,4,4,3,4]]);
});
test('independent memoized DP matches exhaustive oracle and exact trace',()=>{
 const e=enumerateExact(),d=exactDp();
 assert.equal(d.cost,e.optimalCost);
 assert.deepEqual(d.path,e.optimalSchedules[0]);
 assert.ok(d.states>=20&&d.transitions>d.states);
 const verified=evaluate(d.path);
 assert.equal(verified.feasible,true);
 assert.equal(verified.totalCost,467);
 assert.equal(verified.totalGeneration,29);
 assert.equal(verified.soc.at(-1),3);
});
test('gen cost, startup, thermal peak, state of charge, ramp and emissions are all audited',()=>{
 const good=evaluate([3,4,4,3,4,4,3,4]);
 assert.equal(good.feasible,true);
 assert.equal(good.soc.length,9);
 assert.equal(good.hours.reduce((v,r)=>v+r.hourCost,0),good.totalCost);
 assert.equal(evaluate([5,4,4,3,4,4,3,4]).reason,'ramp');
 assert.equal(evaluate([0,4,4,3,4,4,3,4]).reason,'ramp');
 assert.equal(evaluate([1,4,4,3,4,4,3,4]).reason,'invalid_output_levels_or_length');
});
test('model must propose full DP state and recurrence before exact solver is exposed',()=>{
 assert.equal(acceptFormulation({stateVariables:['hour','battery SOC','previous generator output','cumulative emissions'],
 recurrence:'Minimize remaining cost over legal generation choices; update battery by energy balance and recurse using cost plus suffix optimum.'}).valid,true);
 assert.equal(acceptFormulation({stateVariables:['hour','battery'],recurrence:'min cost'}).valid,false);
});
