#!/usr/bin/env python3
"""Independent AAU verifier for the FROZEN K3 toolchain proposal from run 39478425234.

Does not repair, rewrite, or re-ask Kimi. NEVER auto-approve restoration safety.
Distinguishes exact-invocation, actual API execution, provider documentation,
and untested multi-tool domain integration.
"""
import hashlib,importlib.util,json,os,pathlib,subprocess,sys,time,urllib.request
from datetime import datetime,timedelta,timezone
ROOT=pathlib.Path(__file__).parent
FROZEN_SUMMARY_SHA256="03fe111ccdf0f745257e747acae61565fb37f1111d389cd747a01b154bee8e26"
FROZEN_PROPOSAL_SHA256="4a65c8e7d10749e4d21b31e28da3ee88bcf7384ebce176a10da70481fd4cc01a"
ARTIFACT_RUN=39478425234
OUT=ROOT/"evidence_k3_independent_verifier_v01"
OUT.mkdir(exist_ok=True)
report={"source_run":ARTIFACT_RUN,"changed_original_selection":False,"stage2_authorized":False,
        "tests":{},"tools":{},"interfaces":{},"scope":"synthetic, not a complete distribution-feeder task"}
def emit():
 (OUT/"verification.json").write_text(json.dumps(report,sort_keys=True,indent=2)+"\n")
def record(key,status,detail,**extra):
 report["tests"][key]={"status":status,"detail":detail,**extra}
 emit()
def run(name,fn):
 try:
  x=fn()
  record(name,"PASS",str(x)[:900])
 except Exception as e:
  record(name,"FAIL",type(e).__name__+": "+str(e)[:600])
def load_frozen():
 p=ROOT/"frozen_original_summary.json"
 b=p.read_bytes()
 assert hashlib.sha256(b).hexdigest()==FROZEN_SUMMARY_SHA256,"Unpinned model receipt"
 d=json.loads(b)
 assert d.get("status")=="PROPOSAL_PENDING_EXTERNAL_VERIFICATION","Kimi selection incomplete"
 o=d.get("proposal")
 digest=hashlib.sha256(json.dumps(o,sort_keys=True,separators=(",",":")).encode()).hexdigest()
 assert digest==FROZEN_PROPOSAL_SHA256,"Model proposal changed"
 assert len(o["selected_tools"])==10,"tool count drift"
 assert [t["id"] for t in o["selected_tools"]]==[
  "tool.opendss","tool.networkx","tool.ortools","tool.pyomo_highs",
  "tool.etap","tool.pscad","tool.emtp","tool.cyme","tool.pysp","tool.osrm"],"Selected tools modified"
 report["proposal_sha256"]=digest
 report["source_summary_sha256"]=hashlib.sha256(b).hexdigest()
 report["selection_ids"]=[t["id"] for t in o["selected_tools"]]
 emit()
 return o
P=load_frozen()
TOOL={o["id"]:o for o in P["selected_tools"]}
def pysp_index():
 with urllib.request.urlopen("https://pypi.org/pypi/pysp/json",timeout=30) as f:pkg=json.load(f)
 assert pkg["info"]["name"].lower()=="pysp"
 versions=sorted(pkg["releases"].keys())
 assert "6.0.0" not in versions,"An unexpected 6.0.0 now exists: must review manual"
 description=(pkg["info"].get("summary") or "")+" "+(pkg["info"].get("description") or "")[:500]
 assert "Python-Support" in description or "Support-Package" in description,"Changed PyPI identity"
 report["tools"]["tool.pysp"]={"classification":"FAIL_AS_SELECTED","explanation":
  "pip install pysp==6.0.0 does not match the unrelated pysp PyPI project; Pyomo PySP is separate legacy software, mpi-sppy successor",
  "available_versions":versions[-8:],"pypi_summary":pkg["info"].get("summary"),
  "official_successor":"https://github.com/Pyomo/pysp"}
 return "CONFIRMED_WRONG_DISTRIBUTION_NO_PINNED_6.0.0"
run("pypi_pysp_package_identity",pysp_index)

def opendss_exact_and_corrected():
 # Probe the installation exactly proposed by Kimi FIRST; no model repair before grading.
 installed=importlib.util.find_spec("opendssdirect")
 # A clean GitHub runner has installed only dss-python in preceding workflow step.
 assert installed is None,"Expected opendssdirect missing after only dss-python installation"
 import dss
 report["tools"]["tool.opendss"]={"classification":"FAIL_EXACT_INSTALL_COMMAND",
   "detail":"Kimi installs dss-python only but concrete call is OpenDSSDirect-style; opendssdirect unavailable",
   "dss_python_importable":True,
   "corrected_adapter_required":"pip install opendssdirect.py==0.9.4 (independent corrective action, not Kimi's selection)"}
 return "dss import works; selected opendssdirect-style invocation unavailable"
run("opendss_as_selected_install",opendss_exact_and_corrected)

def graph_test():
 import networkx as nx
 assert nx.__version__=="3.6.1",nx.__version__
 g=nx.Graph([(0,1),(1,2),(2,3)])
 assert nx.is_tree(g)
 g.add_edge(3,0)
 assert not nx.is_tree(g) and len(nx.cycle_basis(g))==1
 g.remove_edge(0,1)
 assert nx.is_tree(g)
 g.add_node(99)
 assert not nx.is_tree(g)
 report["tools"]["tool.networkx"]={"classification":"PASS_SYNTHETIC_API_ONLY",
 "positive":"4-bus radiality","negative":"loop and disconnected bus detected",
 "limitation":"simple nx.Graph collapses parallel feeder edges; not 3-phase or physical safety"}
 return "nx.is_tree/nx.cycle_basis positive and two negative fixtures PASS"
run("networkx_radiality_api",graph_test)

def optimization_test():
 import pyomo.environ as pe,highspy
 m=pe.ConcreteModel()
 m.G=pe.RangeSet(1,2)
 m.x=pe.Var(m.G,within=pe.Binary)
 m.cap=pe.Param(m.G,initialize={1:10,2:4})
 m.cost=pe.Param(m.G,initialize={1:5,2:8})
 m.con=pe.Constraint(expr=sum(m.cap[g]*m.x[g] for g in m.G)>=7)
 m.obj=pe.Objective(expr=sum(m.cost[g]*m.x[g] for g in m.G))
 solver=pe.SolverFactory("appsi_highs")
 assert solver.available()
 outcome=solver.solve(m)
 assert str(outcome.solver.termination_condition).lower()=="optimal"
 assert int(round(pe.value(m.x[1])))==1 and int(round(pe.value(m.x[2])))==0
 m.con.set_value(sum(m.cap[g]*m.x[g] for g in m.G)>=100)
 res=solver.solve(m,load_solutions=False)
 assert "infeasible" in str(res.solver.termination_condition).lower()
 report["tools"]["tool.pyomo_highs"]={"classification":"PASS_SYNTHETIC_MIP_ONLY",
 "positive":"generator choice 10kW/4kW, minimum load 7kW",
 "negative":"infeasible 100kW demand correctly identified",
 "limitation":"No 4800-bus 72h 6-scenario actual runtime"}
 return "Pyomo appsi_highs optimal and infeasible independently tested"
run("pyomo_highs_solver_execution",optimization_test)

def routing_test():
 from ortools.constraint_solver import pywrapcp,routing_enums_pb2
 def solve(earliest1,latest1):
  mat=[[0,6,10],[6,0,3],[10,3,0]]
  manager=pywrapcp.RoutingIndexManager(3,1,0)
  rt=pywrapcp.RoutingModel(manager)
  def transit(i,j):
   return mat[manager.IndexToNode(i)][manager.IndexToNode(j)]
  idx=rt.RegisterTransitCallback(transit)
  rt.SetArcCostEvaluatorOfAllVehicles(idx)
  rt.AddDimension(idx,0,100,False,"Time")
  dim=rt.GetDimensionOrDie("Time")
  dim.CumulVar(manager.NodeToIndex(0)).SetRange(0,0)
  dim.CumulVar(manager.NodeToIndex(1)).SetRange(earliest1,latest1)
  dim.CumulVar(manager.NodeToIndex(2)).SetRange(0,40)
  params=pywrapcp.DefaultRoutingSearchParameters()
  params.first_solution_strategy=routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
  params.time_limit.seconds=5
  result=rt.SolveWithParameters(params)
  return manager,rt,dim,result
 mgr,rt,dim,solution=solve(0,20)
 assert solution is not None,"Feasible crew/generator route not found"
 route=[];idx=rt.Start(0)
 while not rt.IsEnd(idx):
  route.append(mgr.IndexToNode(idx));idx=solution.Value(rt.NextVar(idx))
 route.append(mgr.IndexToNode(idx))
 assert sorted(route)==[0,0,1,2],route
 assert solve(0,0)[3] is None,"Impossible delivery window accepted"
 report["tools"]["tool.ortools"]={"classification":"PASS_SYNTHETIC_VRP_ONLY",
 "positive_route":route,"negative":"arrival-before-drive impossible time window rejected",
 "incorrect_claim":"Kimi describes pywrapcp routing as CP-SAT based; docs say it uses OR-Tools original CP routing solver",
 "limitations":"No generator electrical setup coupling/skill-validation or flooded time-dependent graph"}
 return "Routing solve positive and impossible-window negative PASS"
def isolated_routing_test():
 import inspect
 # Run the EXACT routing fixture in a fresh Python interpreter/isolated environment.
 # The first suite's Pyomo+HiGHS import triggered a native C++ symbol conflict
 # when combined with ortools in-process. This is a meaningful integration problem,
 # not proof OR-Tools routing itself is invalid.
 python=os.environ.get("AAU_ORTOOLS_PYTHON",sys.executable)
 child='import json\nreport={"tools":{}}\n'+inspect.getsource(routing_test)+'\nrouting_test()\nprint(json.dumps(report["tools"]["tool.ortools"]))\n'
 done=subprocess.run([python,"-c",child],text=True,capture_output=True,timeout=35)
 if done.returncode:
  raise AssertionError("Isolated ORTools subprocess failed: "+done.stderr[-650:])
 result=json.loads(done.stdout.strip().splitlines()[-1])
 result["execution_environment"]="Isolated process, independent Python environment"
 result["prior_shared_process_import_failure"]="Observed in original CI run #39496567340"
 report["tools"]["tool.ortools"]=result
 return "OS-LEVEL ISOLATION: "+str(result)
run("ortools_routing_in_isolated_process",isolated_routing_test)

def contracts():
 i={x["id"]:x for x in P["interface_contracts"]}
 assert all(x in i for x in ["ic1","ic2","ic3","ic4","ic5"])
 # Counterexample: if arrival at 08:29 and rounded to nearest hour to 08:00,
 # planner may energize 29 minutes BEFORE crew arrival, violating invariant.
 actual=datetime(2026,10,20,8,29,tzinfo=timezone.utc)
 rounded=actual.replace(minute=0,second=0)
 assert rounded<actual
 assert "rounded to nearest hour" in i["ic2"]["conversion"]
 report["interfaces"]["ic2"]={"classification":"FAIL_LOSSY_TIME_CONVERSION",
  "test":"08:29 actual arrival -> 08:00 rounded start: invalid premature task start",
  "remedy_required":"ceil to feasible discrete slot or retain actual timestamp; prohibit early energization"}
 # OpenDSS electrical bus voltage & loading summary is not a complete ETAP
 # protection model: feeder topology, relay type/settings, IBR fault models absent.
 net=i["ic5"]
 assert "voltage_pu" in net["fields_with_types_and_units"]
 assert "relay" not in net["fields_with_types_and_units"].lower()
 report["interfaces"]["ic5"]={"classification":"FAIL_INSUFFICIENT_ELECTRICAL_HANDOFF",
  "test":"Voltage/loading summary contains no feeder topology, relay settings or fault-duty models",
  "remedy_required":"Engine-agnostic full network/topology/relay/DER export with validated lossless importer"}
 # OSRM travel-time matrix is needed but not proven to account for changing closures,
 # vehicle types, flooded/no-go zones or no-path semantics.
 report["interfaces"]["ic1"]={"classification":"NOT_END_TO_END_VERIFIED",
  "test":"OSRM -> OR-Tools time matrix cannot be proven without road extract and scenario closure test",
  "requirements":"Explicit scenario closure + unreachable edge, canonical node IDs, seconds-to-integer time unit."}
 return "ic2 unsafe rounding counterexample and ic5 insufficient protection transfer verified"
run("typed_interoperability_contract_counterexamples",contracts)

def registry_licensing():
 fixed={
 "tool.etap":{"classification":"OFFICIAL_CAPABILITY_DOCUMENTED_EXECUTION_BLOCKED",
              "access":"commercial licensed application unavailable in Linux runner",
              "official":"https://etap.com/solutions/Protection-Coordination",
              "api":"etapPY automation identified in vendor's 2026 release, not a tested callable"},
 "tool.pscad":{"classification":"OFFICIAL_CAPABILITY_DOCUMENTED_EXECUTION_BLOCKED",
              "access":"PSCAD licensed Windows application required, unavailable in Linux runner",
              "official":"https://www.pscad.com/software/pscad/automation-library",
              "api":"mhi.pscad automation can launch/simulate with licensed install, untested here"},
 "tool.emtp":{"classification":"DOCUMENTATION_ONLY_EXECUTION_BLOCKED",
              "access":"commercial EMTP-RV installation/license/model needed",
              "official":"https://www.emtp.com/"},
 "tool.cyme":{"classification":"OFFICIAL_CAPABILITY_DOCUMENTED_EXECUTION_BLOCKED",
              "access":"Eaton CYMTCC commercial protection package missing",
              "official":"https://www.eaton.com/in/en-us/products/utility-grid-solutions/software-modules/protective-device-coordination-software.html"}
 }
 report["tools"].update(fixed)
 return "Four commercial candidates: official capabilities considered, NO simulations executed"
run("commercial_product_verification_scope",registry_licensing)

def osrm_claim():
 t=TOOL["tool.osrm"]
 assert t["installation_command"].startswith("docker run osrm/osrm-backend")
 assert "custom speed profiles" in t["concrete_executable_operation"]
 report["tools"]["tool.osrm"]={"classification":"PARTIAL_DOCUMENTED_API_ONLY",
   "executable_as_selected":False,
   "reason":"Bare docker run does not load OSM extract or build graph; OSRM docs require extraction+customization+router startup",
   "time_dependent_claim":"Snapshot/profile-based recustomization is not demonstrated continuous time-dependent routing per query",
   "official":"https://project-osrm.org/docs/v26.4.0/tools",
   "runtime_road_data":"NOT_SUPPLIED"}
 return "As-written Docker command incomplete; spatial preproc/data required"
run("osrm_documented_prerequisites",osrm_claim)

if __name__=="__main__":
 emit()
 failed=[k for k,v in report["tests"].items() if v["status"]=="FAIL"]
 report["overall"]="TOOLCHAIN_NOT_VERIFIED"
 report["mandatory_fix_needed"]=["tool.pysp","tool.opendss exact installer","ic2","ic5"]
 report["actual_probe_failures"]=failed
 emit()
 print("K3_FROZEN_INDEPENDENT_VERIFICATION="+json.dumps({
   "overall":report["overall"],"tests":report["tests"],
   "tool_statuses":{k:v.get("classification") for k,v in report["tools"].items()},
   "interface_statuses":{k:v.get("classification") for k,v in report["interfaces"].items()},
   "untested_commercial":["tool.etap","tool.pscad","tool.emtp","tool.cyme"],
   "stage2_authorized":False},sort_keys=True),flush=True)
 sys.exit(0 if not failed else 1)
