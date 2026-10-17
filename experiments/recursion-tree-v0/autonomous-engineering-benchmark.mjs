// Isolated engineering cognition benchmark with a hidden exact verifier.
// Kimi sees PROBLEM_TEXT and tool descriptions but NOT the answer, verifier,
// enumerated optimum, or the runtime's reference DP algorithm.
export const CASE={
 demand:[4,6,4,7,6,5,7,5],
 solar:[1,2,2,2,2,2,2,2],
 prices:[5,9,4,12,10,7,13,6],
 initialSoc:3,finalSocMin:3,batteryCapacity:6,chargeRate:2,
 generationLevels:[0,2,3,4,5],rampLimit:3,emissionsLimit:30,
 generatorStartup:11,quadraticFuel:2,batteryWear:1,
 peakHours:[3,6],peakG5Penalty:6,
};
export const PROBLEM_TEXT=`Design the minimum-cost dispatch for an isolated microgrid across 8 one-hour intervals.
Hourly demand in kWh = [4,6,4,7,6,5,7,5]. Free solar in kWh =
[1,2,2,2,2,2,2,2]. The controllable generator output g_t
(in kWh for each hour) must be one of {0,2,3,4,5}. It starts at
g_previous=0 and can change by at most 3 kWh between consecutive
hours (including the first). Battery charge b_0=3 kWh; capacity
is 6 kWh; charge and discharge are both limited to 2 kWh per hour.
No load shedding, energy dumping or solar curtailment is allowed.
The energy balance is b_(t+1)=b_t+g_t+solar_t-demand_t; the battery
must remain between 0 and 6 inclusive, with b_8 >= 3.
Total generator energy sum(g_t) must be <= 30 kWh (emissions proxy).
Per-hour economic cost is
price_t*g_t + 2*g_t^2 + abs(b_(t+1)-b_t),
where prices = [5,9,4,12,10,7,13,6].
Add a generator start penalty of 11 each hour g_(t-1)=0 and g_t>0.
Add 6 if g_t=5 at hour t=4 or t=7 (hours numbered 1..8).
Compute a globally optimal integer schedule g_1..g_8 and exact
minimum total cost. Show battery trajectory, total generation,
and a mathematically defensible argument why no feasible schedule
is cheaper. Explain your chosen approach and any limitations.
You may design your own subtasks and choose calculation tools.
Do not treat your estimate as proven optimal without evidence.`;
export function evaluate(schedule){
 if(!Array.isArray(schedule)||schedule.length!==8||
   schedule.some(g=>!Number.isInteger(g)||!CASE.generationLevels.includes(g)))
   return {feasible:false,reason:'invalid_output_levels_or_length'};
 let b=CASE.initialSoc,prev=0,total=0,cost=0;
 const soc=[b],items=[];
 for(let t=0;t<8;t++){
  const g=schedule[t],net=CASE.demand[t]-CASE.solar[t];
  const movement=g-net,nb=b+movement;
  if(Math.abs(g-prev)>CASE.rampLimit)return {feasible:false,reason:'ramp',hour:t+1,soc};
  if(Math.abs(movement)>CASE.chargeRate)return {feasible:false,reason:'battery_rate',hour:t+1,soc};
  if(nb<0||nb>CASE.batteryCapacity)return {feasible:false,reason:'soc_out_of_bounds',hour:t+1,soc};
  const start=prev===0&&g>0?CASE.generatorStartup:0;
  const peak=CASE.peakHours.includes(t)&&g===5?CASE.peakG5Penalty:0;
  const hourCost=CASE.prices[t]*g+CASE.quadraticFuel*g*g+
    CASE.batteryWear*Math.abs(movement)+start+peak;
  cost+=hourCost;total+=g;soc.push(nb);
  items.push({hour:t+1,generator:g,batteryEnd:nb,hourCost});
  prev=g;b=nb;
 }
 if(total>CASE.emissionsLimit)return {feasible:false,reason:'emissions_limit',total,soc};
 if(b<CASE.finalSocMin)return {feasible:false,reason:'final_soc_target',total,soc};
 return {feasible:true,totalCost:cost,totalGeneration:total,soc,hours:items};
}
export function enumerateExact(){
 const levels=CASE.generationLevels;
 let feasibleCount=0,best=Infinity,bestSchedules=[];
 let visited=0;
 function recurse(t,b,prev,e,cost,arr){
  if(t===8){
   visited++;
   if(e>CASE.emissionsLimit||b<CASE.finalSocMin)return;
   feasibleCount++;
   if(cost<best){best=cost;bestSchedules=[arr.slice()]}
   else if(cost===best)bestSchedules.push(arr.slice());
   return;
  }
  for(const g of levels){
   const nb=b+g+CASE.solar[t]-CASE.demand[t];
   if(Math.abs(g-prev)>CASE.rampLimit||
    Math.abs(nb-b)>CASE.chargeRate||
    nb<0||nb>CASE.batteryCapacity||e+g>CASE.emissionsLimit)continue;
   const c=CASE.prices[t]*g+CASE.quadraticFuel*g*g+
    CASE.batteryWear*Math.abs(nb-b)+
    (prev===0&&g>0?CASE.generatorStartup:0)+
    (CASE.peakHours.includes(t)&&g===5?CASE.peakG5Penalty:0);
   recurse(t+1,nb,g,e+g,cost+c,[...arr,g]);
  }
 }
 recurse(0,CASE.initialSoc,0,0,0,[]);
 return {optimalCost:best,feasibleCount,optimalSchedules:bestSchedules,visitedTerminalStates:visited};
}
export function exactDp(){
 const memo=new Map(),stats={states:0,transitions:0};
 const run=(t,b,prev,e)=>{
  const k=[t,b,prev,e].join(':');
  if(memo.has(k))return memo.get(k);
  stats.states++;
  if(t===8){
   const value=(b>=CASE.finalSocMin&&e<=CASE.emissionsLimit)?
    {cost:0,path:[]}:{cost:Infinity,path:null};
   memo.set(k,value);return value;
  }
  let best={cost:Infinity,path:null};
  for(const g of CASE.generationLevels){
   stats.transitions++;
   const nb=b+g+CASE.solar[t]-CASE.demand[t],energy=e+g;
   if(Math.abs(g-prev)>CASE.rampLimit||Math.abs(nb-b)>CASE.chargeRate||
      nb<0||nb>CASE.batteryCapacity||energy>CASE.emissionsLimit)continue;
   const suffix=run(t+1,nb,g,energy);
   if(!Number.isFinite(suffix.cost))continue;
   const hour=CASE.prices[t]*g+CASE.quadraticFuel*g*g+
    CASE.batteryWear*Math.abs(nb-b)+
    (prev===0&&g>0?CASE.generatorStartup:0)+
    (CASE.peakHours.includes(t)&&g===5?CASE.peakG5Penalty:0);
   if(hour+suffix.cost<best.cost)best={cost:hour+suffix.cost,path:[g,...suffix.path]};
  }
  memo.set(k,best);return best;
 };
 return {...run(0,CASE.initialSoc,0,0),...stats};
}
export function acceptFormulation(args){
 const fields=Array.isArray(args?.stateVariables)?args.stateVariables.join(' ').toLowerCase():'';
 const rule=String(args?.recurrence||'').toLowerCase();
 const conditions=[
  /hour|time|step|\bt\b/.test(fields),
  /battery|charge|soc|storage|\bb\b/.test(fields),
  /previous|prev|prior|last|ramp|\bg/.test(fields),
  /cumulative|total|emission|used|\be\b/.test(fields),
  rule.length>=65&&/min|cost|optimal/.test(rule)&&/balance|battery|soc|generation|generator/.test(rule),
 ];
 return {valid:conditions.every(Boolean),stateChecks:conditions};
}
