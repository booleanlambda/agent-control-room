"""Sealed independent judge. Invoked after Kimi has made its final decision.
No ground truth imported by model, prompts, or tool endpoints.
"""
import hashlib
import json
from pathlib import Path
from prepare import OUT

def digest(x):
    return hashlib.sha256(x.encode()).hexdigest()
trial=json.loads((OUT/"trial.json").read_text())
secret=json.loads((OUT/"sealed_truth.json").read_text())
goal=set(secret["hidden_leak_nodes"])
final=trial.get("final") or {}
pairs=final.get("ranked_pairs",[])
valid=[]
for row in pairs if isinstance(pairs,list) else []:
    nodes=row.get("nodes",[]) if isinstance(row,dict) else []
    if isinstance(nodes,list) and len(nodes)==2 and all(isinstance(n,str) for n in nodes):
        valid.append(nodes)
top1=set(valid[0]) if valid else set()
top3=any(set(p)==goal for p in valid[:3])
tools=trial.get("tool_events",[])
calls=[x.get("name") for x in tools]
audit_ok=True
prior="0"*64
for item in trial.get("audit_events",[]):
    event_json=json.dumps(item["event"],sort_keys=True,separators=(",",":"))
    check=digest(prior+event_json)
    if item.get("previous")!=prior or item.get("hash")!=check:
        audit_ok=False
    prior=check
audit_ok=audit_ok and trial.get("audit_head")==prior
proof={
 "run_status":trial.get("status"),
 "actual_model_calls":len(trial.get("calls",[])),
 "tool_calls":len(tools),
 "tool_sequence":calls,
 "submitted_pairs":valid[:5],
 "exact_top1":top1==goal,
 "exact_top3":top3,
 "top1_true_junctions_recovered":len(top1.intersection(goal)),
 "both_true_junctions":secret["hidden_leak_nodes"],
 "forensic_event_chain_valid":audit_ok,
 "full_epanet_simulation_was_invoked":"simulate_pair" in calls,
 "benchmark":"EPA Net3; hidden synthetic dual leak, not utility field telemetry",
 "limitations":"One instance, one model run, no real physical valve test or measured field leaks"
}
(OUT/"independent-verdict.json").write_text(json.dumps(proof,indent=2))
print("AAU_NET3_INDEPENDENT_VERDICT="+json.dumps(proof))
if not audit_ok:
    raise SystemExit("FORENSIC_CHAIN_MISMATCH")
