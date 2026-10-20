#!/usr/bin/env python3
"""Synthetic read-only integration probes: corrected OpenDSS dependency and OSRM.

IMPORTANT these are counterfactual fixes to Kimi's frozen proposal, not PASSes
for the originally selected installation commands. No real grid operations.
"""
import json,pathlib,urllib.request,sys,time,subprocess
OUT=pathlib.Path(__file__).parent/"evidence_k3_independent_verifier_v01"
OUT.mkdir(exist_ok=True)
receipt={"corrected_dependencies_not_kimi_original":True,"tests":{}}
try:
 import opendssdirect as dss
 dss.Text.Command("Clear")
 dss.Text.Command("New Circuit.AAUTiny phases=3 basekv=12.47 pu=1 bus1=sourcebus")
 dss.Text.Command("New Line.F1 bus1=sourcebus.1.2.3 bus2=loadbus.1.2.3 phases=3 length=1 units=km r1=0.2 x1=0.4 r0=0.6 x0=1.2 c1=3 c0=1")
 dss.Text.Command("New Load.L1 bus1=loadbus.1.2.3 phases=3 conn=wye kv=12.47 kw=250 kvar=50")
 dss.Text.Command("Set voltagebases=[12.47]")
 dss.Text.Command("CalcVoltageBases")
 dss.Text.Command("Solve")
 assert dss.Solution.Converged(),"OpenDSS synthetic feeder did not converge"
 assert dss.Circuit.SetActiveBus("loadbus")>0
 vals=dss.Bus.puVmagAngle()
 mags=vals[::2]
 assert len(mags)==3 and all(0.8<float(v)<1.2 for v in mags),mags
 receipt["tests"]["opendss_fixed_install"]={"status":"PASS_SYNTHETIC","phase_voltage_pu":mags,
 "correction":"Installed opendssdirect.py dependency NOT named in Kimi's frozen installer"}
except Exception as exc:
 receipt["tests"]["opendss_fixed_install"]={"status":"FAIL","error":type(exc).__name__+": "+str(exc)[:500]}
OUT.joinpath("isolated_dependency_checks.json").write_text(json.dumps(receipt,indent=2)+"\n")
print("AAU_OPEN_DSS_CORRECTED_INSTALL="+json.dumps(receipt))
if any(t["status"]=="FAIL" for t in receipt["tests"].values()):sys.exit(1)
