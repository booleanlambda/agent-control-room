// Research-only small exact logistics benchmark, no model or production state.
import {createHash} from 'node:crypto';
const base={
 depots:[{id:'D0',x:0,y:0},{id:'D1',x:10,y:0}],
 vehicles:[{id:'V0',depot:'D0',capacity:6,shiftEnd:52,fixedCost:6},{id:'V1',depot:'D1',capacity:6,shiftEnd:52,fixedCost:5}],
 customers:[
  {id:'C0',x:2,y:2,demand:2,earliest:0,latest:19,service:2},
  {id:'C1',x:3,y:5,demand:1,earliest:6,latest:27,service:1},
  {id:'C2',x:8,y:2,demand:3,earliest:0,latest:26,service:2},
  {id:'C3',x:7,y:5,demand:2,earliest:7,latest:32,service:2},
  {id:'C4',x:5,y:1,demand:2,earliest:4,latest:34,service:1}]
};
const cp=x=>structuredClone(x);
export const publicProblem=cp(base);
const h1=cp(base);h1.customers.push({id:'C5',x:4,y:3,demand:1,earliest:12,latest:35,service:1});
h1.vehicles[0].capacity=7;h1.vehicles[1].capacity=7;h1.vehicles[0].shiftEnd=60;h1.vehicles[1].shiftEnd=60;
const h2=cp(base);
h2.customers=[
 {id:'C0',x:1,y:4,demand:2,earliest:2,latest:22,service:2},
 {id:'C1',x:4,y:6,demand:2,earliest:8,latest:33,service:2},
 {id:'C2',x:9,y:3,demand:2,earliest:0,latest:26,service:1},
 {id:'C3',x:6,y:5,demand:1,earliest:7,latest:30,service:2},
 {id:'C4',x:3,y:2,demand:2,earliest:5,latest:30,service:1},
 {id:'C5',x:8,y:6,demand:2,earliest:9,latest:37,service:2},
 {id:'C6',x:6,y:1,demand:1,earliest:2,latest:34,service:1}
];
h2.vehicles[0].capacity=7;h2.vehicles[1].capacity=7;h2.vehicles[0].shiftEnd=65;h2.vehicles[1].shiftEnd=65;
export const hiddenProblems=[h1,h2];
const D=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
export function evaluateVehicle(problem,vehicle,stopIds){
 const depot=problem.depots.find(d=>d.id===vehicle.depot);
 if(!depot)return {ok:false,reason:'unknown_depot'};
 if(!stopIds.length)return {ok:true,cost:0,time:0,load:0};
 let clock=0,pos=depot,load=0;
 for(const id of stopIds){
  const c=problem.customers.find(x=>x.id===id);if(!c)return {ok:false,reason:'unknown_customer'};
  load+=c.demand;if(load>vehicle.capacity)return {ok:false,reason:'capacity_exceeded'};
  clock+=D(pos,c);clock=Math.max(clock,c.earliest);
  if(clock>c.latest)return {ok:false,reason:'late_customer'};
  clock+=c.service;pos=c;
 }
 clock+=D(pos,depot);
 if(clock>vehicle.shiftEnd)return {ok:false,reason:'shift_exceeded'};
 return {ok:true,cost:clock+vehicle.fixedCost,time:clock,load};
}
export function grade(problem,submission){
 if(!submission || !Array.isArray(submission.routes) || submission.routes.length!==problem.vehicles.length) return {passed:false,reason:'wrong_route_count'};
 const ids=new Set(),routes=new Map();let cost=0;
 for(const rt of submission.routes){
  if(!rt || typeof rt.vehicle!=='string'||!Array.isArray(rt.stops)||routes.has(rt.vehicle))return {passed:false,reason:'bad_route_shape'};
  const v=problem.vehicles.find(x=>x.id===rt.vehicle);if(!v)return {passed:false,reason:'unknown_vehicle'};
  const s=evaluateVehicle(problem,v,rt.stops);if(!s.ok)return {passed:false,reason:s.reason};
  for(const id of rt.stops){if(ids.has(id))return {passed:false,reason:'duplicate_customer'};ids.add(id);}
  routes.set(rt.vehicle,rt.stops);cost+=s.cost;
 }
 if(ids.size!==problem.customers.length||problem.customers.some(c=>!ids.has(c.id)))return {passed:false,reason:'customer_omission'};
 if(!Number.isInteger(submission.cost)||submission.cost!==cost)return {passed:false,reason:'cost_disagreement',actualCost:cost};
 const opt=exactOracle(problem);
 return {passed:cost===opt.cost,reason:cost===opt.cost?'optimal':'suboptimal',actualCost:cost,optimalCost:opt.cost};
}
export function exactOracle(problem){
 if(problem.vehicles.length!==2||problem.customers.length>8)throw Error('oracle_scope_exceeded');
 const ids=problem.customers.map(c=>c.id);let best=Infinity,bestRoutes=null,enumerated=0;
 const permute=(taken,order)=>{
  if(order.length===ids.length){
   for(let cut=0;cut<=ids.length;cut++){
    const p=order.slice(0,cut),q=order.slice(cut);
    const a=evaluateVehicle(problem,problem.vehicles[0],p);if(!a.ok)continue;
    const b=evaluateVehicle(problem,problem.vehicles[1],q);if(!b.ok)continue;
    enumerated++;
    if(a.cost+b.cost<best){best=a.cost+b.cost;bestRoutes=[p,q]}
   }return;
  }
  for(let i=0;i<ids.length;i++)if(!(taken&(1<<i)))permute(taken|(1<<i),[...order,ids[i]]);
 };
 permute(0,[]);
 if(!Number.isFinite(best))throw Error('infeasible_benchmark');
 return {cost:best,routes:bestRoutes.map((stops,i)=>({vehicle:problem.vehicles[i].id,stops})),feasibleRoutes:enumerated};
}
export const specification={
 task:'Find the exact minimum-cost routing plan for all customers using two fixed-depot vehicles.',
 input:'One JSON object with depots, vehicles and customers; each vehicle has id, depot, capacity, shiftEnd, fixedCost; each customer has id, x, y, demand, earliest, latest, service.',
 output:'Exactly one JSON object with routes (one object {vehicle,stops} per vehicle, including empty routes), and integer cost.',
 assumptions:[
  'Travel time is Manhattan distance abs(dx)+abs(dy); vehicles start at their own depot at time 0.',
  'Each customer served exactly once by exactly one vehicle.',
  'Vehicle cargo demand total must be <= capacity.',
  'On arrival before earliest, wait until earliest. Service must BEGIN <= latest, then add service minutes.',
  'Each active route must return to its own depot no later than shiftEnd.',
  'Cost of an active vehicle is its return clock time (including waiting and service) + fixedCost. Empty routes cost 0.',
  'Optimize the total sum of vehicle costs exactly; output actual feasible witness, not just objective.',
  'Python standard library only. Read the input JSON from stdin, write exactly one JSON object to stdout.'
 ]
};
export const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
