// Three disjoint problem families; model sees only public instance and
// specification, NEVER the hidden instance or verified reference solution.
export const TASKS=[
{
 id:'assignment',
 title:'Factory jobs with activation and switching penalties',
 specification:'Write a GENERAL Python 3 solver, reading one JSON object from stdin and printing exactly one JSON object to stdout. Assign every job in listed order to machine index 0,1,2. Each job i has integer load sizes[i], assignment price costs[i][machine], and allowed[i][machine] boolean. Sum of loads assigned to a machine must not exceed capacities[machine]. A machine used at least once incurs activation[machine] once. Adjacent jobs assigned to different machines incur switchPenalty each time. Minimize total cost: sum assignment prices + activation charges + switch penalties. Output {"cost":integer,"assignment":[one machine index per job]}. Return a globally optimal result, not a heuristic. The same Python file will be run on an unrevealed second instance with different job count and data. It must work from stdin and not hardcode solutions.',
 public:{sizes:[4,3,5,2,4,3,2],capacities:[9,10,9],
  costs:[[9,12,8],[8,7,12],[13,10,9],[7,6,9],[12,10,8],[6,11,7],[9,7,10]],
  allowed:[[1,1,1],[1,1,1],[0,1,1],[1,1,1],[1,1,1],[1,0,1],[1,1,1]],
  activation:[8,11,6],switchPenalty:4},
 hidden:{sizes:[3,4,3,2,4,3,2,3],capacities:[11,10,10],
  costs:[[8,9,13],[11,8,7],[6,10,9],[13,6,7],[10,8,12],[9,11,6],[7,9,11],[12,7,8]],
  allowed:[[1,1,1],[1,0,1],[1,1,1],[1,1,1],[0,1,1],[1,1,1],[1,1,1],[1,1,1]],
  activation:[10,7,12],switchPenalty:3},
},
{
 id:'routing',
 title:'Energy-constrained delivery route with charging',
 specification:'Write a GENERAL Python 3 algorithm that reads one JSON object from stdin and prints exactly one JSON object. Nodes are 0 to n-1. Each directed edge [u,v,energy,toll] consumes energy (must have enough before traversing) and adds integer toll to the objective. The vehicle starts at node 0 with initial battery units and must reach node n-1 with at least minFinal units. It can charge by integer units at node k ONLY when a charger price is given in chargers mapping (keys are JSON strings), paying unit_price per unit, never exceeding capacity. All tolls/prices are positive. Minimize total tolls+charging costs, including any charge at the start. Output {"cost":integer,"path":[visited node indexes including 0 and n-1],"charges":[integer units bought at each node in path]} (last charge should be 0). Use graph search or another provably exact approach; never hardcode a particular path. Program must also solve a held-out unseen graph.',
 public:{n:7,edges:[[0,1,4,5],[0,2,5,4],[0,3,6,15],[1,2,2,4],[1,3,3,6],[1,4,5,7],[2,3,2,7],[2,4,4,5],[2,5,6,10],[3,4,2,6],[3,5,4,5],[4,5,2,4],[4,6,5,9],[5,6,3,5]],
  capacity:9,initial:6,minFinal:2,chargers:{'0':6,'2':2,'3':4,'4':3,'5':7}},
 hidden:{n:8,edges:[[0,1,3,6],[0,2,5,3],[0,3,7,13],[1,2,2,6],[1,4,4,4],[1,3,3,7],[2,3,2,4],[2,4,4,8],[2,5,5,6],[3,4,2,3],[3,6,5,9],[4,5,3,4],[4,6,4,6],[5,6,2,5],[5,7,5,9],[6,7,3,5]],
  capacity:10,initial:7,minFinal:2,chargers:{'0':6,'1':5,'2':4,'4':2,'5':6,'6':3}},
},
{
 id:'number-theory',
 title:'Integer Diophantine optimization under quadratic congruence',
 specification:'Write a GENERAL Python 3 exact solver reading a JSON object from stdin and printing a single JSON object. Find all nonnegative integer triples (x,y,z) with each <= maxValue, satisfying 3*x+5*y+7*z=total, (x*x+3*y+2*z)%17=modTarget, and x+y+z<=maxSum. Among all feasible triples minimize score=2*x*x+3*y*y+z*z+5*abs(x-z). Break equal-minimum ties by choosing lexicographically smallest [x,y,z]. Output {"count":number of feasible triples,"score":minimum score,"triple":[x,y,z]}. Must be derived using exact enumeration, algebraic reduction, or another reliable method; do not hardcode the instance. The same solver will be tested on an unseen second set of parameter values.',
 public:{maxValue:35,total:104,modTarget:7,maxSum:42},
 hidden:{maxValue:38,total:127,modTarget:11,maxSum:48},
},
];
function checkAssignment(input,result){
 const a=result?.assignment;
 if(!Array.isArray(a)||a.length!==input.sizes.length||
  a.some(v=>!Number.isInteger(v)||v<0||v>=3))return {ok:false,reason:'bad_assignments'};
 let cost=0,loads=[0,0,0],used=new Set();
 for(let i=0;i<a.length;i++){
  if(!input.allowed[i][a[i]])return {ok:false,reason:'incompatible_machine'};
  loads[a[i]]+=input.sizes[i];used.add(a[i]);
  cost+=input.costs[i][a[i]]+(i&&a[i]!==a[i-1]?input.switchPenalty:0);
 }
 for(let m=0;m<3;m++)if(loads[m]>input.capacities[m])
  return {ok:false,reason:'machine_capacity'};
 for(const m of used)cost+=input.activation[m];
 return {ok:true,cost,loads};
}
function oracleAssignment(input){
 let cost=Infinity,optimal=null,count=0;
 const n=input.sizes.length;
 const visit=(i,arr)=>{
  if(i===n){
   const score=checkAssignment(input,{assignment:arr});
   if(!score.ok)return;
   count++;
   if(score.cost<cost){cost=score.cost;optimal=[...arr];}
   return;
  }
  for(let m=0;m<3;m++)visit(i+1,[...arr,m]);
 };
 visit(0,[]);
 return {cost,optimal,count};
}
function checkRouting(input,result){
 const path=result?.path,charges=result?.charges;
 if(!Array.isArray(path)||!Array.isArray(charges)||path.length!==charges.length||
 path[0]!==0||path.at(-1)!==input.n-1||path.length<2||path.length>input.n+3)
  return {ok:false,reason:'invalid_route_shape'};
 let battery=input.initial,cost=0;
 for(let i=0;i<path.length;i++){
  const k=path[i],units=charges[i],charger=input.chargers[String(k)];
  if(!Number.isInteger(k)||k<0||k>=input.n||!Number.isInteger(units)||units<0||
   (units>0&&charger===undefined)||(i===path.length-1&&units!==0))
   return {ok:false,reason:'bad_charge_or_node'};
  battery+=units;
  if(battery>input.capacity)return {ok:false,reason:'battery_over_capacity'};
  cost+=units*(charger||0);
  if(i<path.length-1){
   const edge=input.edges.find(([u,v])=>u===k&&v===path[i+1]);
   if(!edge)return {ok:false,reason:'nonexistent_edge'};
   if(battery<edge[2])return {ok:false,reason:'energy_exhausted'};
   battery-=edge[2];cost+=edge[3];
  }
 }
 return battery>=input.minFinal?{ok:true,cost,remainingBattery:battery}:
  {ok:false,reason:'terminal_battery'};
}
function oracleRouting(input){
 const map=new Map(),q=[],start='0:'+input.initial;
 map.set(start,{cost:0,path:[0],charges:[0]});
 q.push({node:0,battery:input.initial,cost:0,path:[0],charges:[0]});
 let best=null,transitions=0;
 while(q.length){
  q.sort((a,b)=>a.cost-b.cost);
  const s=q.shift();
  const k=s.node+':'+s.battery;
  if(s.cost!==map.get(k)?.cost)continue;
  if(s.node===input.n-1&&s.battery>=input.minFinal){best=s;break;}
  const charger=input.chargers[String(s.node)];
  if(charger!==undefined&&s.battery<input.capacity){
   const c=s.cost+charger,key=s.node+':'+(s.battery+1),prev=map.get(key);
   if(c<(prev?.cost??Infinity)){
    const charges=s.charges.slice();charges[charges.length-1]++;
    const v={node:s.node,battery:s.battery+1,cost:c,path:s.path.slice(),charges};
    map.set(key,v);q.push(v);
   }
  }
  for(const [u,v,energy,toll] of input.edges){
   if(u!==s.node||s.battery<energy)continue;
   transitions++;
   const nb=s.battery-energy,c=s.cost+toll,key=v+':'+nb;
   if(c<(map.get(key)?.cost??Infinity)){
    const next={node:v,battery:nb,cost:c,path:[...s.path,v],
      charges:[...s.charges,0]};
    map.set(key,next);q.push(next);
   }
  }
 }
 return {cost:best?.cost??null,path:best?.path??null,
  charges:best?.charges??null,transitions};
}
function checkNumber(input,result){
 const a=result?.triple;
 if(!Array.isArray(a)||a.length!==3||a.some(x=>!Number.isInteger(x)||x<0||x>input.maxValue))
  return {ok:false,reason:'invalid_triple'};
 const [x,y,z]=a;
 if(3*x+5*y+7*z!==input.total||
   (x*x+3*y+2*z)%17!==input.modTarget||x+y+z>input.maxSum)
  return {ok:false,reason:'constraint_violation'};
 return {ok:true,score:2*x*x+3*y*y+z*z+5*Math.abs(x-z)};
}
function oracleNumber(input){
 let count=0,best=Infinity,triple=null;
 for(let x=0;x<=input.maxValue;x++)for(let y=0;y<=input.maxValue;y++){
  const rem=input.total-3*x-5*y;
  if(rem<0||rem%7)continue;
  const z=rem/7;
  if(z>input.maxValue||x+y+z>input.maxSum||
    (x*x+3*y+2*z)%17!==input.modTarget)continue;
  count++;
  const score=2*x*x+3*y*y+z*z+5*Math.abs(x-z);
  if(score<best){best=score;triple=[x,y,z]}
 }
 return {count,score:best,triple};
}
export function oracle(task,input){
 if(task==='assignment')return oracleAssignment(input);
 if(task==='routing')return oracleRouting(input);
 if(task==='number-theory')return oracleNumber(input);
 throw Error('unknown_task');
}
export function check(task,input,result){
 if(task==='assignment')return checkAssignment(input,result);
 if(task==='routing')return checkRouting(input,result);
 if(task==='number-theory')return checkNumber(input,result);
 throw Error('unknown_task');
}
export function grade(task,input,result){
 const expected=oracle(task,input),observed=check(task,input,result);
 let passed=false;
 if(task==='assignment'||task==='routing')passed=observed.ok&&
  observed.cost===expected.cost&&result.cost===observed.cost;
 if(task==='number-theory')passed=observed.ok&&
  observed.score===expected.score&&result.score===expected.score&&
  result.count===expected.count&&
  JSON.stringify(result.triple)===JSON.stringify(expected.triple);
 return {passed,observed,expected};
}
