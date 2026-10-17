// Isolated Experiment 2: exact held-out logistics benchmark with dependent stops.
import {createHash} from 'node:crypto';
const base={
 depots:[{id:'D0',x:0,y:0},{id:'D1',x:12,y:0}],
 vehicles:[{id:'V0',depot:'D0',capacity:8,shiftEnd:96,fixedCost:7,distanceWeight:1},
           {id:'V1',depot:'D1',capacity:8,shiftEnd:96,fixedCost:6,distanceWeight:2}],
 customers:[
  {id:'C0',x:2,y:2,demand:2,earliest:0,latest:35,service:2,after:null},
  {id:'C1',x:4,y:4,demand:1,earliest:6,latest:42,service:2,after:'C0'},
  {id:'C2',x:10,y:2,demand:2,earliest:0,latest:35,service:2,after:null},
  {id:'C3',x:9,y:4,demand:1,earliest:7,latest:43,service:2,after:'C2'},
  {id:'C4',x:6,y:2,demand:2,earliest:10,latest:50,service:1,after:null},
  {id:'C5',x:5,y:6,demand:2,earliest:13,latest:52,service:1,after:null}
]};
const cp=x=>structuredClone(x);
export const publicProblem=cp(base);
const h1=cp(base);
h1.customers.push({id:'C6',x:7,y:6,demand:1,earliest:8,latest:58,service:2,after:'C4'});
h1.vehicles[0].capacity=9;h1.vehicles[1].capacity=9;h1.vehicles[0].shiftEnd=110;h1.vehicles[1].shiftEnd=110;
const h2=cp(base);
h2.customers=[
 {id:'C0',x:1,y:3,demand:2,earliest:1,latest:37,service:2,after:null},
 {id:'C1',x:4,y:6,demand:2,earliest:7,latest:46,service:2,after:'C0'},
 {id:'C2',x:11,y:3,demand:2,earliest:1,latest:39,service:2,after:null},
 {id:'C3',x:8,y:6,demand:2,earliest:9,latest:48,service:2,after:'C2'},
 {id:'C4',x:5,y:1,demand:1,earliest:5,latest:48,service:1,after:null},
 {id:'C5',x:7,y:2,demand:1,earliest:8,latest:58,service:1,after:'C4'},
 {id:'C6',x:5,y:5,demand:1,earliest:15,latest:63,service:1,after:null}
];h2.vehicles[0].capacity=9;h2.vehicles[1].capacity=9;
export const hiddenProblems=[h1,h2];
const travel=(a,b)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
export function evaluateVehicle(problem,vehicle,stops){
 const depot=problem.depots.find(d=>d.id===vehicle.depot);
 if(!depot)return {ok:false,reason:'unknown_depot'};
 if(stops.length===0)return {ok:true,cost:0,load:0,elapsed:0,distance:0};
 let clock=0,pos=depot,load=0,distance=0;
 const completed=new Set();
 for(const id of stops){
  const c=problem.customers.find(x=>x.id===id);
  if(!c)return {ok:false,reason:'unknown_customer'};
  if(completed.has(id))return {ok:false,reason:'duplicate_customer'};
  if(c.after&&!completed.has(c.after))return {ok:false,reason:'precedence_or_vehicle_violation'};
  load+=c.demand;if(load>vehicle.capacity)return {ok:false,reason:'capacity_exceeded'};
  const d=travel(pos,c);clock+=d;distance+=d;clock=Math.max(clock,c.earliest);
  if(clock>c.latest)return {ok:false,reason:'late_customer'};
  clock+=c.service;pos=c;completed.add(id);
 }
 const finalLeg=travel(pos,depot);clock+=finalLeg;distance+=finalLeg;
 if(clock>vehicle.shiftEnd)return {ok:false,reason:'shift_exceeded'};
 return {ok:true,cost:vehicle.fixedCost+clock+vehicle.distanceWeight*distance,load,elapsed:clock,distance};
}
export function exactOracle(p){
 if(p.vehicles.length!==2||p.customers.length>8)throw Error('oracle_scope_exceeded');
 const ids=p.customers.map(x=>x.id);let best=Infinity,routes=null,feasible=0;
 const traverse=(mask,order)=>{
  if(order.length===ids.length){
   for(let cut=0;cut<=order.length;cut++){
    const first=order.slice(0,cut),second=order.slice(cut);
    const a=evaluateVehicle(p,p.vehicles[0],first);if(!a.ok)continue;
    const b=evaluateVehicle(p,p.vehicles[1],second);if(!b.ok)continue;
    feasible++;
    const sum=a.cost+b.cost;
    if(sum<best){best=sum;routes=[first,second]}
   }return;
  }
  for(let i=0;i<ids.length;i++)if(!(mask&(1<<i)))traverse(mask|(1<<i),[...order,ids[i]]);
 };traverse(0,[]);
 if(!Number.isFinite(best))throw Error('infeasible_fixture');
 return {cost:best,feasibleRoutes:feasible,routes:routes.map((stops,i)=>({vehicle:p.vehicles[i].id,stops}))};
}
export function grade(p,answer){
 if(!answer||!Array.isArray(answer.routes)||answer.routes.length!==p.vehicles.length)return {passed:false,reason:'route_count'};
 const assigned=new Set();const seenVehicles=new Set();let cost=0;
 for(const route of answer.routes){
  const v=p.vehicles.find(x=>x.id===route?.vehicle);
  if(!v||seenVehicles.has(v.id)||!Array.isArray(route.stops))return {passed:false,reason:'route_shape'};
  seenVehicles.add(v.id);
  const res=evaluateVehicle(p,v,route.stops);
  if(!res.ok)return {passed:false,reason:res.reason};
  for(const id of route.stops){if(assigned.has(id))return {passed:false,reason:'duplicate_customer'};assigned.add(id);}
  cost+=res.cost;
 }
 if(assigned.size!==p.customers.length||p.customers.some(c=>!assigned.has(c.id)))return {passed:false,reason:'customer_omitted'};
 if(!Number.isSafeInteger(answer.cost)||answer.cost!==cost)return {passed:false,reason:'cost_disagreement',actualCost:cost};
 const oracle=exactOracle(p);
 return {passed:cost===oracle.cost,reason:cost===oracle.cost?'optimal':'suboptimal',actualCost:cost,optimalCost:oracle.cost};
}
export const specification={
 task:'Find a globally minimum cost two-vehicle delivery plan, with precedence, time windows, vehicle-specific distance costs.',
 contract:'Read one JSON object from stdin, write exactly one JSON object {"routes":[{"vehicle":"V0","stops":["C0"]},{"vehicle":"V1","stops":["C1"]}],"cost":integer} to stdout. Both vehicles appear, even if empty.',
 rules:[
 'Two vehicles begin at time zero at their respective depots and must return there before shiftEnd.',
 'Travel distance AND time are Manhattan abs(dx)+abs(dy); both coordinates are integer.',
 'A route may wait until a customer earliest time; service begins no later than latest, then service minutes pass.',
 'Each customer must be visited exactly once on one vehicle. Vehicle capacity is the sum of all customer demands on that route.',
 'Customer after ID X must appear strictly AFTER X on the SAME vehicle. after:null means no predecessor.',
 'For each NONEMPTY vehicle route, objective contribution = fixedCost + arrival-back-at-depot elapsed time (which includes waiting and service) + distanceWeight * total traveled Manhattan distance. Empty route contributes 0.',
 'The submitted cost is the exact sum of route costs. Find globally minimum cost, not any feasible result.',
 'Standard-library Python 3 only; solver must generalize to varying 6-7 customers, depots, vehicle capacities, windows and weights; no hardcoded instance answers.'
 ]};
export const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
