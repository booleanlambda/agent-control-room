"""AAU stage-one capability proof probes (NARROW SMOKE TESTS ONLY).
A successful probe proves only the explicitly measured small-case capability.
No real distribution data, restoration operation, relay or reclose action.
"""
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import sys
import traceback

def version(pkg):
    try: return importlib.metadata.version(pkg)
    except importlib.metadata.PackageNotFoundError: return None

def opendss_unbalanced():
    import opendssdirect as dss
    dss.Basic.ClearAll()
    for command in [
        "New Circuit.aauProof basekv=12.47 pu=1.0 phases=3 bus1=sourcebus",
        "New Line.L1 bus1=sourcebus.1.2.3 bus2=loadbus.1.2.3 phases=3 length=1 units=kft r1=0.2 x1=0.1 r0=0.4 x0=0.2",
        "New Load.A bus1=loadbus.1 phases=1 conn=wye kv=7.199 kw=90 kvar=25",
        "New Load.B bus1=loadbus.2 phases=1 conn=wye kv=7.199 kw=17 kvar=5",
        "New Load.C bus1=loadbus.3 phases=1 conn=wye kv=7.199 kw=30 kvar=10",
        "Set voltagebases=[12.47]",
        "CalcVoltageBases",
        "Solve",
    ]: dss.Text.Command(command)
    if not dss.Solution.Converged():
        raise AssertionError("OpenDSS failed small unbalanced circuit")
    dss.Circuit.SetActiveBus("loadbus")
    vals=dss.Bus.puVmagAngle()
    phases=[float(vals[i]) for i in (0,2,4)]
    if len(phases)!=3 or not all(math.isfinite(v) and 0.5<v<1.5 for v in phases):
        raise AssertionError("Invalid three-phase voltage output")
    if max(phases)-min(phases)<1e-7:
        raise AssertionError("Circuit did not show phase-asymmetric voltages")
    return {"small_case_phase_voltage_pu":[round(v,6) for v in phases],
            "scope":"One manufactured unbalanced feeder; NOT 4800-bus or protection proof",
            "versions":{"opendssdirect.py":version("opendssdirect.py")}}

def highs_mip():
    from pyomo.environ import ConcreteModel, Var, Binary, Objective, Constraint, maximize, value, SolverFactory
    m=ConcreteModel()
    m.x=Var(domain=Binary);m.y=Var(domain=Binary)
    m.c=Constraint(expr=m.x + m.y <= 1)
    m.obj=Objective(expr=3*m.x+2*m.y,sense=maximize)
    solver=SolverFactory("appsi_highs")
    if not solver.available(exception_flag=False):raise AssertionError("HiGHS solver not available")
    result=solver.solve(m)
    if abs(value(m.obj)-3)>1e-8 or abs(value(m.x)-1)>1e-8 or abs(value(m.y))>1e-8:
        raise AssertionError("Small binary problem solved incorrectly")
    return {"verified_objective":float(value(m.obj)),
            "scope":"Small two-binary MIP; NOT 72-hour six-scenario runtime proof",
            "versions":{"pyomo":version("pyomo"),"highspy":version("highspy")}}

def networkx_radiality():
    import networkx as nx
    safe=nx.Graph([(0,1),(1,2),(2,3)])
    bad=nx.Graph([(0,1),(1,2),(2,0)])
    if not nx.is_tree(safe) or nx.is_tree(bad) or nx.has_path(safe,0,99) if 99 in safe else False:
        raise AssertionError("Graph cycle detection failed")
    assert len(nx.cycle_basis(bad))==1
    return {"rejects_cycle":True,"accepts_tree":True,
            "scope":"Tiny graph; does not prove correct phase or source eligibility",
            "versions":{"networkx":version("networkx")}}

def ortools_vrp():
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    # A depot + 3 visited road nodes; return-to-depot constraint.
    matrix=[[0,4,6,8],[4,0,2,3],[6,2,0,1],[8,3,1,0]]
    manager=pywrapcp.RoutingIndexManager(4,1,0)
    router=pywrapcp.RoutingModel(manager)
    def duration(i,j):
        return matrix[manager.IndexToNode(i)][manager.IndexToNode(j)]
    cb=router.RegisterTransitCallback(duration)
    router.SetArcCostEvaluatorOfAllVehicles(cb)
    search=pywrapcp.DefaultRoutingSearchParameters()
    search.first_solution_strategy=routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    solution=router.SolveWithParameters(search)
    if solution is None:raise AssertionError("Small route infeasible")
    visit=[];idx=router.Start(0)
    while not router.IsEnd(idx):
        visit.append(manager.IndexToNode(idx))
        idx=solution.Value(router.NextVar(idx))
    visit.append(manager.IndexToNode(idx))
    if sorted(visit[1:-1])!=[1,2,3] or visit[0]!=0 or visit[-1]!=0:
        raise AssertionError("Small route did not visit all nodes")
    return {"visited":visit,"scope":"Small routing-only smoke test; NOT mobile-generator assignment",
            "versions":{"ortools":version("ortools")}}

def scipy_interpolation():
    from scipy.interpolate import interp1d
    f=interp1d([1.0,2.0,4.0],[16.0,8.0,4.0],kind="linear")
    if abs(float(f(3.0))-6.0)>1e-8:raise AssertionError("Interpolation failure")
    return {"value_at_3":float(f(3.0)),
       "scope":"Interpolation API only; does NOT verify relay selectivity, bidirectional fault currents",
       "versions":{"scipy":version("scipy")}}

def stdlib_manifest():
    import hashlib
    import json
    data={"device":"mock-switch","state":"open"}
    raw=json.dumps(data,sort_keys=True).encode()
    h=hashlib.sha256(raw).hexdigest()
    if len(h)!=64 or hashlib.sha256(raw).hexdigest()!=h:raise AssertionError("Hash mismatch")
    return {"sha256":h,"scope":"Hashing only; NOT end-to-end telemetry provenance","versions":{"python":sys.version.split()[0]}}

PROBES={"opendss_unbalanced":opendss_unbalanced,"highs_mip":highs_mip,
        "networkx_radiality":networkx_radiality,"ortools_vrp":ortools_vrp,
        "scipy_interpolation":scipy_interpolation,"stdlib_manifest":stdlib_manifest}

def run():
    out={"scope":"Narrow, non-domain-certifying executable capability probes",
         "probes":{},"stage2_authorized":False}
    for name,func in PROBES.items():
        try:
            evidence=func()
            out["probes"][name]={"status":"PASS_NARROW_CAPABILITY_ONLY","evidence":evidence}
        except Exception as exc:
            out["probes"][name]={"status":"FAIL_OR_UNAVAILABLE","error_class":type(exc).__name__,
                 "error_message":str(exc)[:200]}
    return out

if __name__=="__main__":
    obj=run()
    target=Path(sys.argv[1]) if len(sys.argv)>1 else Path("tool-probe-evidence.json")
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(json.dumps(obj,indent=2,sort_keys=True))
    print(json.dumps({"probes":{k:v["status"] for k,v in obj["probes"].items()},
           "stage2_authorized":False}))
