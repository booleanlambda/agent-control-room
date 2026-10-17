import {createHash} from 'node:crypto';
const copy=x=>structuredClone(x);
export const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const sb={machines:[{id:'M0',types:['a','b'],initialType:'a',setup:2},{id:'M1',types:['b','c'],initialType:'c',setup:3}],jobs:[
{id:'J0',type:'a',duration:4,release:0,due:8,penalty:3,parents:[]},
{id:'J1',type:'b',duration:3,release:1,due:10,penalty:5,parents:[]},
{id:'J2',type:'c',duration:4,release:0,due:15,penalty:4,parents:['J1']},
{id:'J3',type:'a',duration:3,release:2,due:17,penalty:2,parents:['J0']},
{id:'J4',type:'b',duration:5,release:0,due:17,penalty:4,parents:['J0','J1']},
{id:'J5',type:'c',duration:2,release:8,due:22,penalty:6,parents:['J2','J4']}]};
const s1=copy(sb);s1.jobs[1].due=9;s1.jobs[4].duration=4;s1.jobs[5].due=19;
const s2=copy(sb);s2.jobs.push({id:'J6',type:'b',duration:2,release:3,due:20,penalty:7,parents:['J3']});s2.machines[1].setup=4;
const ss={task:'Find the exact globally minimum weighted tardiness of dependent jobs on two machines, with sequence-dependent setup times and machine eligibility.',input:'JSON {machines:[{id,types,initialType,setup}],jobs:[{id,type,duration,release,due,penalty,parents}]}',output:'JSON {schedule:[{id,machine,start},...],cost:INTEGER}. One item for each job in dependency-respecting order.',rules:[
'Each job must be on one machine whose types includes its type. Each machine works on only one job at a time.',
'At time zero, each machine has previous type initialType. When the next job type differs from the previous type, setup takes machine.setup time before the job can start; this preparation can take place while waiting for job release or dependencies.',
'For a machine whose last task ended at T, the earliest next job start is max(T + (type changed ? setup : 0), job.release, completion time of ALL parent jobs).',
'Finish = start + duration. Job penalty = penalty*max(0,finish-due). Objective cost is sum of job penalties; there is no direct fee for machine setup.',
'Output actual feasible schedule with exact starts and numeric cost; find global minimum. The entire input and machine setup values can change.',
'Python stdlib only, read exactly one JSON object stdin, write exactly one JSON object stdout. Never hardcode example output.']};
function evaluateSchedule(p,x){
 if(!Array.isArray(x?.schedule)||x.schedule.length!==p.jobs.length)return {ok:false,reason:'schedule_count'};
 const ms=new Map(p.machines.map(m=>[m.id,{...m,clock:0,prev:m.initialType}]));
 const js=new Map(p.jobs.map(j=>[j.id,j])),done=new Map();let cost=0;
 for(const item of x.schedule){
  const j=js.get(item?.id),m=ms.get(item?.machine);
  if(!j||!m||done.has(j.id)||!Number.isSafeInteger(item.start)||item.start<0)return {ok:false,reason:'bad_job_or_start'};
  if(!m.types.includes(j.type))return {ok:false,reason:'wrong_machine_type'};
  if(!j.parents.every(id=>done.has(id)))return {ok:false,reason:'missing_predecessor'};
  const ready=Math.max(m.clock+(m.prev===j.type?0:m.setup),j.release,...j.parents.map(id=>done.get(id)));
  if(item.start<ready)return {ok:false,reason:'machine_setup_or_dependency_violation'};
  const end=item.start+j.duration;done.set(j.id,end);cost+=Math.max(0,end-j.due)*j.penalty;
  m.clock=end;m.prev=j.type;
 }return {ok:true,cost};
}
function exactSchedule(p){
 if(p.jobs.length>8||p.machines.length!==2)throw Error('oracle_schedule_scope');
 const states=p.machines.map(m=>({clock:0,prev:m.initialType}));let best=Infinity,bestOrder=null,count=0;
 function dfs(done,order,total){
  if(total>=best)return;
  if(order.length===p.jobs.length){best=total;bestOrder=order.slice();count++;return;}
  for(const j of p.jobs){
   if(done.has(j.id)||j.parents.some(x=>!done.has(x)))continue;
   for(let i=0;i<states.length;i++){
    const m=p.machines[i],st=states[i];if(!m.types.includes(j.type))continue;
    const start=Math.max(st.clock+(st.prev===j.type?0:m.setup),j.release,...j.parents.map(x=>done.get(x)));
    const end=start+j.duration,penalty=Math.max(0,end-j.due)*j.penalty,old={...st};
    st.clock=end;st.prev=j.type;done.set(j.id,end);order.push({id:j.id,machine:m.id,start});
    dfs(done,order,total+penalty);
    order.pop();done.delete(j.id);st.clock=old.clock;st.prev=old.prev;
   }
  }
 }dfs(new Map(),[],0);
 if(!Number.isFinite(best))throw Error('schedule_infeasible');return {cost:best,schedule:bestOrder,count};
}
function gradeSchedule(p,x){
 const observed=evaluateSchedule(p,x);if(!observed.ok)return {passed:false,reason:observed.reason};
 if(x.cost!==observed.cost)return {passed:false,reason:'cost_disagreement',actual:observed.cost};
 const optimum=exactSchedule(p);
 return {passed:observed.cost===optimum.cost,reason:observed.cost===optimum.cost?'optimal':'suboptimal',actual:observed.cost,optimum:optimum.cost};
}
const gb={capacity:8,initialBattery:8,maximumRecharges:2,freePasses:1,source:'S',destination:'T',required:['C','D'],
 nodes:[{id:'S',charger:false},{id:'A',charger:true},{id:'B',charger:false},{id:'C',charger:true},{id:'D',charger:true},{id:'E',charger:false},{id:'T',charger:false}],
 edges:[
 {from:'S',to:'A',travelTime:3,batteryCost:4,toll:3},{from:'S',to:'B',travelTime:4,batteryCost:3,toll:0},
 {from:'A',to:'C',travelTime:3,batteryCost:4,toll:3},{from:'B',to:'C',travelTime:4,batteryCost:5,toll:1},
 {from:'B',to:'A',travelTime:1,batteryCost:2,toll:2},{from:'C',to:'D',travelTime:4,batteryCost:5,toll:4},
 {from:'C',to:'A',travelTime:2,batteryCost:1,toll:0},{from:'A',to:'D',travelTime:5,batteryCost:4,toll:2},
 {from:'D',to:'E',travelTime:3,batteryCost:4,toll:5},{from:'E',to:'T',travelTime:2,batteryCost:2,toll:1},
 {from:'D',to:'T',travelTime:6,batteryCost:6,toll:6},{from:'D',to:'A',travelTime:3,batteryCost:3,toll:0},
 {from:'A',to:'B',travelTime:2,batteryCost:2,toll:0},{from:'E',to:'D',travelTime:3,batteryCost:3,toll:0}
 ],rechargeTime:3,tollWeight:2};
const g1=copy(gb);g1.edges.find(x=>x.from==='D'&&x.to==='T').toll=4;g1.edges.find(x=>x.from==='C'&&x.to==='D').travelTime=3;g1.rechargeTime=5;
const g2=copy(gb);g2.capacity=9;g2.initialBattery=9;g2.maximumRecharges=3;g2.edges.push({from:'E',to:'C',travelTime:2,batteryCost:3,toll:0});g2.edges.find(x=>x.from==='A'&&x.to==='C').toll=8;
const gs={task:'Find globally cheapest path on directed graph with ordered checkpoints, finite battery, limited recharges and single-use toll waiver.',input:'JSON {capacity,initialBattery,maximumRecharges,freePasses,source,destination,required,nodes,edges,rechargeTime,tollWeight}',output:'JSON {actions:[{type:"move",from:"S",to:"A",usePass:false},{type:"charge",at:"A"},...],cost:INTEGER}',rules:[
'All movement must follow a directed edge, starts at source with initialBattery. Moving drains batteryCost, never below zero, and adds travelTime.',
'charge action is legal only at a charger:true node with remaining charge count; it resets battery to capacity and costs rechargeTime.',
'Each move can use a free toll pass if any remain: usePass:true waives toll for that edge and spends 1 pass; false pays the toll. There may be zero-toll edges.',
'required is an ordered list. A required checkpoint counts only when it is the NEXT required node; visiting one early does not count until a later revisit.',
'Finish at destination AFTER visiting all required nodes in order. Objective = sum travelTime + chargeTime + tollWeight*sum unwaived tolls.',
'Graph has cycles; exact solver must track node, battery, charges used, passes used and checkpoint progress. Input varies in hidden tests. Python stdlib one JSON stdin, one JSON stdout.']};
function evaluateGraph(p,x){
 if(!Array.isArray(x?.actions)||x.actions.length>150)return {ok:false,reason:'actions_invalid'};
 let at=p.source,battery=p.initialBattery,charges=0,passes=0,cost=0,progress=0;
 for(const a of x.actions){
  if(a?.type==='charge'){
   if(a.at!==at||!p.nodes.find(n=>n.id===at)?.charger||charges>=p.maximumRecharges)return {ok:false,reason:'charge_invalid'};
   battery=p.capacity;charges++;cost+=p.rechargeTime;continue;
  }
  if(a?.type!=='move'||a.from!==at||typeof a.usePass!=='boolean')return {ok:false,reason:'action_or_position_invalid'};
  const e=p.edges.find(e=>e.from===at&&e.to===a.to);if(!e)return {ok:false,reason:'edge_nonexistent'};
  if(battery<e.batteryCost)return {ok:false,reason:'battery_exhausted'};
  if(a.usePass){passes++;if(passes>p.freePasses)return {ok:false,reason:'too_many_passes'};}
  battery-=e.batteryCost;cost+=e.travelTime+p.tollWeight*(a.usePass?0:e.toll);
  at=e.to;if(p.required[progress]===at)progress++;
 }
 if(at!==p.destination||progress!==p.required.length)return {ok:false,reason:'missing_destination_or_checkpoint'};
 return {ok:true,cost};
}
function exactGraph(p){
 const key=s=>s.join('|'),start=[p.source,p.initialBattery,0,0,0],dist=new Map([[key(start),0]]),prev=new Map();
 const q=[{s:start,c:0}];let goal=null;
 while(q.length){
  q.sort((a,b)=>b.c-a.c);const {s,c}=q.pop(),k=key(s);if(c!==dist.get(k))continue;
  const [at,battery,charges,passes,progress]=s;
  if(at===p.destination&&progress===p.required.length){goal=s;break;}
  const neighbors=[];
  if(p.nodes.find(n=>n.id===at)?.charger&&charges<p.maximumRecharges&&battery<p.capacity)
   neighbors.push({s:[at,p.capacity,charges+1,passes,progress],cost:p.rechargeTime,action:{type:'charge',at}});
  for(const e of p.edges){
   if(e.from!==at||e.batteryCost>battery)continue;
   const next=progress+(p.required[progress]===e.to?1:0);
   for(const usePass of passes<p.freePasses?[false,true]:[false])
    neighbors.push({s:[e.to,battery-e.batteryCost,charges,passes+Number(usePass),next],cost:e.travelTime+p.tollWeight*(usePass?0:e.toll),
     action:{type:'move',from:at,to:e.to,usePass}});
  }
  for(const n of neighbors){const kk=key(n.s),cc=c+n.cost;if(cc<(dist.get(kk)??Infinity)){dist.set(kk,cc);prev.set(kk,{from:k,action:n.action});q.push({s:n.s,c:cc});}}
 }
 if(!goal)throw Error('graph_fixture_infeasible');
 const actions=[];let current=key(goal);
 while(prev.has(current)){const r=prev.get(current);actions.push(r.action);current=r.from;}
 actions.reverse();return {cost:dist.get(key(goal)),actions,visitedStates:dist.size};
}
function gradeGraph(p,x){
 const observed=evaluateGraph(p,x);if(!observed.ok)return {passed:false,reason:observed.reason};
 if(x.cost!==observed.cost)return {passed:false,reason:'cost_disagreement',actual:observed.cost};
 const opt=exactGraph(p);
 return {passed:observed.cost===opt.cost,reason:observed.cost===opt.cost?'optimal':'suboptimal',actual:observed.cost,optimum:opt.cost};
}
export const TASKS=[
{id:'precedence_machine_scheduling_v1',name:'Precedence-constrained machine scheduling',specification:ss,publicInput:sb,hiddenInputs:[s1,s2],oracle:exactSchedule,grade:gradeSchedule},
{id:'battery_toll_checkpoint_v1',name:'Battery/toll/checkpoint directed graph',specification:gs,publicInput:gb,hiddenInputs:[g1,g2],oracle:exactGraph,grade:gradeGraph}
];
