// Never supply fault location or these hidden test data to the model.
// The seeds are independently authored *defective* programs, not Kimi output.
import {TASKS,grade,oracle} from './unseen-python-benchmarks.mjs';
export const ROUTING_SEED=String.raw`import json,sys,heapq
d=json.load(sys.stdin)
n=d["n"];cap=d["capacity"];initial=d["initial"]
q=[(0,0,initial,[0],[0])]
best={(0,initial):0}
while q:
    cost,node,battery,path,charges=heapq.heappop(q)
    if cost!=best.get((node,battery)):continue
    if node==n-1 and battery>=d["minFinal"]:
        print(json.dumps({"cost":cost,"path":path,"charges":charges}))
        break
    price=d["chargers"].get(str(node))
    if price is not None and battery<cap:
        newcost=cost+price+3
        key=(node,battery+1)
        if newcost<best.get(key,float("inf")):
            best[key]=newcost
            nextcharges=charges[:];nextcharges[-1]+=1
            heapq.heappush(q,(newcost,node,battery+1,path[:],nextcharges))
    for u,v,energy,toll in d["edges"]:
        if u!=node or battery<energy:continue
        newcost=cost+toll;key=(v,battery-energy)
        if newcost<best.get(key,float("inf")):
            best[key]=newcost
            heapq.heappush(q,(newcost,v,battery-energy,path+[v],charges+[0]))
else:
    print(json.dumps({"cost":None,"path":[],"charges":[]}))`;
export const NUMBER_SEED=String.raw`import json,sys
d=json.load(sys.stdin)
m=d["maxValue"];count=0
best=None;winner=None
for x in range(m+1):
    for y in range(m+1):
        remain=d["total"]-3*x-5*y
        if remain<0 or remain%7:continue
        z=remain//7
        if z>m or x+y+z>d["maxSum"]:continue
        if (x*x+3*y+2*z)%19 != d["modTarget"]:continue
        count+=1
        score=2*x*x+3*y*y+z*z+5*abs(x-z)
        if best is None or score<best or (score==best and [x,y,z]<winner):
            best=score;winner=[x,y,z]
print(json.dumps({"count":count,"score":best,"triple":winner}))`;
function variation(domain,publicInput){
 const p=structuredClone(publicInput);
 if(domain==='routing'){
  p.chargers['2']=Math.max(1,(p.chargers['2']||3)+1);
  p.chargers['4']=Math.max(1,(p.chargers['4']||3)-1);
 }else{
  p.maxValue+=2;
  p.maxSum+=2;
 }
 return p;
}
export const CASES=[
 {id:'routing',category:'engineering graph / energy and economic optimization',
  specification:TASKS.find(x=>x.id==='routing').specification,
  seed:ROUTING_SEED,
  public:TASKS.find(x=>x.id==='routing').public,
  hidden:[{label:'original-held-out',input:TASKS.find(x=>x.id==='routing').hidden},
    {label:'price-variation',input:variation('routing',TASKS.find(x=>x.id==='routing').public)}]},
 {id:'number-theory',category:'number theory / Diophantine modular arithmetic',
  specification:TASKS.find(x=>x.id==='number-theory').specification,
  seed:NUMBER_SEED,
  public:TASKS.find(x=>x.id==='number-theory').public,
  hidden:[{label:'original-held-out',input:TASKS.find(x=>x.id==='number-theory').hidden},
    {label:'bound-variation',input:variation('number-theory',TASKS.find(x=>x.id==='number-theory').public)}]},
];
export function gradeResult(id,input,result){return grade(id,input,result)}
export function expected(id,input){return oracle(id,input)}
