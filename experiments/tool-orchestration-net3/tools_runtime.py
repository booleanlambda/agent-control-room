"""Bounded, read-only computational tools for Kimi on an EPA Net3 benchmark.
Only fixed interfaces are exposed; no model-authored arbitrary code or credentials.
"""
from __future__ import annotations
import itertools
import json
from pathlib import Path
import numpy as np
from scipy.optimize import nnls
from prepare import OUT, EMITTER, simulate, make_network

INPUT=json.loads((OUT/"observations.json").read_text())
SENSORS=INPUT["sensors"]
JUNCTIONS=INPUT["junctions"]
Y=np.array([INPUT["observations"][s]["delta_m"] for s in SENSORS])
BASE=np.array([INPUT["observations"][s]["baseline_m"] for s in SENSORS])
SIG={}
SINGLE=[]
PAIRS=[]
SIMCOUNT=0
TOOLS=[
    {"name":"inspect_network","description":"Inspect genuine EPANET Net3 topology size, sensor locations, pressure units and available model fields. No inference."},
    {"name":"inspect_observations","description":"Read the independently generated synthetic measurements and baseline residuals for 14 sensors."},
    {"name":"scan_single_leaks","description":"Computationally run EPA hydraulic simulations with an emitter at each junction, rank single-leak residual signatures and cache them. Can misrank when TWO leaks exist. May be expensive."},
    {"name":"fit_two_leaks","description":"Use actual hydraulic single-leak signature library from scan_single_leaks and nonnegative least squares over candidate pairs. Does not run full nonlinear two-leak verification."},
    {"name":"simulate_pair","description":"Execute a full EPA hydraulic simulation for the named two candidate junctions with supplied nonnegative emitter coefficients, compare to all sensor measurements."},
    {"name":"hospital_safety_review","description":"Inspect what hospital isolation decision would require, without taking a physical valve action; no hospital node or pressure threshold has been supplied."}
]
def clean(x):
    return json.loads(json.dumps(x,default=lambda y:float(y) if isinstance(y,np.floating) else str(y)))
def inspect_network(args):
    net=make_network()
    return {"benchmark":"EPA Net3","junction_count":len(JUNCTIONS),"pipe_count":len(net.pipe_name_list),
            "sensors":SENSORS,"sensor_count":len(SENSORS),
            "pressure_unit":"meters head","emitter_coefficient_unit":"m^3/s/m^0.5",
            "time":"single snapshot, synthetic observations, no field telemetry",
            "hospital_node_known":False,"physical_valve_test_authorized":False}
def inspect_observations(args):
    return {"pressure_observations":INPUT["observations"],"number_of_sensors":len(SENSORS),
            "noise":"none injected; true leak nodes hidden","two_leak_hypothesis":"may be false in general; benchmark contains two"}
def scan_single_leaks(args):
    global SIMCOUNT,SINGLE
    if not SIG:
        for junction in JUNCTIONS:
            try:
                data=simulate([(junction,EMITTER)])
                SIG[junction]=np.array([data[n]-BASE[i] for i,n in enumerate(SENSORS)])
                SIMCOUNT+=1
            except Exception:
                SIG[junction]=np.zeros(len(SENSORS))
        for n,v in SIG.items():
            scale=max(0.,float(np.dot(v,Y)/(np.dot(v,v)+1e-20)))
            norm=float(np.linalg.norm(Y-v*scale))
            SINGLE.append({"node":n,"residual_rmse_m":round(norm/np.sqrt(len(SENSORS)),6),
                           "approx_strength_ratio":round(scale,5)})
        SINGLE.sort(key=lambda x:x["residual_rmse_m"])
    return {"simulations_executed":SIMCOUNT,"algorithm":"EPANET hydraulics + 1-leak LS approximation",
            "top_candidates":SINGLE[:25],"two_leak_caution":"single-leak rankings are not two-leak proof"}
def fit_two_leaks(args):
    global PAIRS
    if not SINGLE:
        return {"error":"SCAN_REQUIRED_FIRST","hint":"run scan_single_leaks"}
    ids=[x["node"] for x in SINGLE[:25]]
    if not PAIRS:
        for n1,n2 in itertools.combinations(ids,2):
            A=np.column_stack((SIG[n1],SIG[n2]))
            coef,res=nnls(A,Y)
            rmse=float(np.linalg.norm(Y-A@coef)/np.sqrt(len(Y)))
            PAIRS.append({"nodes":[n1,n2],"coefficients":[round(float(c*EMITTER),7) for c in coef],
                          "linearized_rmse_m":round(rmse,7)})
        PAIRS.sort(key=lambda x:x["linearized_rmse_m"])
    return {"algorithm":"nonnegative least squares on EPANET-derived single-leak signatures",
           "hypotheses_examined":len(PAIRS),"top_pairs":PAIRS[:12],
           "warning":"Must verify with full nonlinear EPANET simulator"}
def simulate_pair(args):
    global SIMCOUNT
    nodes=args.get("nodes",[])
    coeff=args.get("coefficients",[])
    if not isinstance(nodes,list) or len(nodes)!=2 or len(set(nodes))!=2 or any(n not in JUNCTIONS for n in nodes):
        return {"error":"INVALID_NODE_PAIR"}
    if not isinstance(coeff,list) or len(coeff)!=2 or any(not isinstance(c,(float,int)) or not 0<=c<=0.05 for c in coeff):
        return {"error":"COEFFICIENTS_OUT_OF_RANGE_OR_MISSING"}
    vals=simulate(list(zip(nodes,coeff)))
    SIMCOUNT+=1
    residual=np.array([vals[s] for s in SENSORS])-BASE-Y
    rmse=float(np.linalg.norm(residual)/np.sqrt(len(SENSORS)))
    return {"nodes":nodes,"coefficients":coeff,"full_simulation_rmse_m":round(rmse,7),
            "max_abs_pressure_error_m":round(float(np.max(np.abs(residual))),7),
            "simulations_executed_total":SIMCOUNT,
            "verified_against":"synthetic observations, not hidden truth"}
def hospital_safety_review(args):
    return {"status":"NO_PHYSICAL_ACTION",
            "warning":"Hospital junction ID, minimum allowable pressure, valve operation matrix and operator approval absent",
            "safe_validation":"No physical valve test without utility hydraulic review, live hospital pressure telemetry, abort criteria, backup supply and qualified operator",
            "cannot_guarantee_hospital_pressure":True}
DISPATCH={"inspect_network":inspect_network,
          "inspect_observations":inspect_observations,
          "scan_single_leaks":scan_single_leaks,
          "fit_two_leaks":fit_two_leaks,
          "simulate_pair":simulate_pair,
          "hospital_safety_review":hospital_safety_review}
def execute(name,args):
    if name not in DISPATCH:
        return {"error":"UNKNOWN_TOOL","allowed":[t["name"] for t in TOOLS]}
    if not isinstance(args,dict):
        return {"error":"INVALID_ARGUMENTS"}
    try:
        return clean(DISPATCH[name](args))
    except Exception as e:
        return {"error":"TOOL_EXCEPTION","exception_type":type(e).__name__}
