// Synthetic responses, NOT Kimi model output. No provider/network access.
// These deliberately test the unchanged live response -> checkpoint -> Python
// execution -> independent hidden-grading path.
export const EXACT_SOLVER = String.raw\`import json,sys
d=json.load(sys.stdin)
n=len(d["sizes"])
best=None
best_route=None
def visit(i,a,loads,used,cost):
    global best,best_route
    if i==n:
        if best is None or cost<best:
            best=cost
            best_route=a[:]
        return
    for m in range(3):
        if not d["allowed"][i][m]: continue
        size=d["sizes"][i]
        if loads[m]+size>d["capacities"][m]: continue
        extra=d["costs"][i][m]
        if m not in used: extra+=d["activation"][m]
        if i and a[-1]!=m: extra+=d["switchPenalty"]
        if best is not None and cost+extra>=best: continue
        loads[m]+=size
        a.append(m)
        added=m not in used
        if added: used.add(m)
        visit(i+1,a,loads,used,cost+extra)
        if added: used.remove(m)
        a.pop()
        loads[m]-=size
visit(0,[],[0,0,0],set(),0)
if best is None:
    print(json.dumps({"cost":None,"assignment":[]}))
else:
    print(json.dumps({"cost":best,"assignment":best_route}))\`;
export const PROPERTY_TESTS = String.raw\`import json,sys
v=json.load(sys.stdin)
d=v["input"]; out=v["output"]
good=isinstance(out,dict)
a=out.get("assignment") if good else None
good=good and isinstance(a,list) and len(a)==len(d["sizes"])
cost=0; loads=[0,0,0]; used=set()
if good:
    for i,m in enumerate(a):
        if not isinstance(m,int) or isinstance(m,bool) or m<0 or m>=3:
            good=False; break
        if not d["allowed"][i][m]:
            good=False; break
        loads[m]+=d["sizes"][i]
        cost+=d["costs"][i][m]
        if i>0 and a[i-1]!=m: cost+=d["switchPenalty"]
        used.add(m)
if good:
    if any(loads[m]>d["capacities"][m] for m in range(3)): good=False
    cost+=sum(d["activation"][m] for m in used)
    if not isinstance(out.get("cost"),int) or isinstance(out.get("cost"),bool) or out["cost"]!=cost:
        good=False
print(json.dumps({"passed":bool(good)}))\`;
export const BAD_TESTS = 'import json,sys\nv=json.load(sys.stdin)\nprint(json.dumps({"passed": True}))\n';
export function scriptedResponse(phase,scenario='success'){
 if(phase==='diagnose')return {action:'diagnose',
  diagnosis:'The source overwrites or loses DP parent pointers between job layers, so the numeric minimum is correct but traceback yields an impossible machine assignment.',
  hypothesis:'Store a complete feasible assignment path with each state or store separate predecessor maps by job index and validate capacity after reconstructing.'};
 if(phase==='repair')return {action:'repair',
  explanation:'For this synthetic test fixture only: branch-and-bound exact enumeration preserves the complete assignment witness on every search leaf.',
  python:scenario==='bad_witness'?null:EXACT_SOLVER};
 if(phase==='tests')return {action:'tests',
  explanation:'For this synthetic test fixture only: recalculate every constraint and the exact objective from the returned assignment.',
  python:scenario==='weak_tests'?BAD_TESTS:PROPERTY_TESTS};
 throw Error('INVALID_FIXTURE_PHASE');
}
export function simulateResponse(phase,scenario='success'){
 if(scenario==='truncated')throw Object.assign(new Error('model_incomplete_length'),
   {telemetry:{http:200,usage:2288,finish:'length',elapsedMs:20,received:false}});
 if(scenario==='transport_unknown')throw Object.assign(new Error('simulated_transport_ambiguous'),
   {telemetry:{http:null,usage:null,finish:null,elapsedMs:40,received:false}});
 return {answer:scriptedResponse(phase,scenario),usage:phase==='diagnose'?110:
  phase==='repair'?420:160,http:200,finish:'stop',elapsedMs:1};
}
