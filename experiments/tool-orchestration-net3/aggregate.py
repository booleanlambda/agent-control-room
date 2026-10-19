"""Post-run AAU system-level completion from *existing* independently measured tools.

IMPORTANT: Not a Kimi-authored final response. Never overwrite model submission or
historical verdict. Do not access sealed truth before writing the candidate.
"""
from pathlib import Path
import hashlib
import json
import math

DIR=Path(__file__).parent/"evidence"
RAW=DIR/"trial.json"
def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()

def derive_from_tool_evidence(trial):
    prev="0"*64
    for row in trial.get("audit_events",[]):
        event_json=json.dumps(row["event"],sort_keys=True,separators=(",",":"))
        assert row["previous"]==prev and row["hash"]==sha(prev+event_json), "INVALID_FORENSIC_CHAIN"
        prev=row["hash"]
    assert prev==trial["audit_head"], "INVALID_FORENSIC_HEAD"
    for call in trial.get("calls",[]):
        assert sha(call["response_content"])==call["response_sha256"], "MODEL_RECEIPT_TAMPERED"
    possibilities={}
    for evt in trial.get("tool_events",[]):
        assert sha(json.dumps(evt["result"],sort_keys=True))==evt["result_sha256"], "TOOL_RECEIPT_TAMPERED"
        if evt["name"] not in ("optimize_pair","simulate_pair"):
            continue
        r=evt["result"]
        nodes=r.get("nodes")
        coeff=r.get("fitted_coefficients",r.get("coefficients"))
        score=r.get("full_simulation_rmse_m")
        if (not isinstance(nodes,list) or len(nodes)!=2 or
            not all(isinstance(n,str) for n in nodes) or nodes[0]==nodes[1] or
            not isinstance(coeff,list) or len(coeff)!=2 or
            not isinstance(score,(int,float)) or not math.isfinite(score) or score<0):
            continue
        key=tuple(sorted(nodes))
        item={"nodes":nodes,"coefficients":coeff,"full_epanet_rmse_m":score,
              "model_tool_turn":evt["turn"],"independent_tool":evt["name"],
              "tool_output_sha256":evt["result_sha256"]}
        if key not in possibilities or score<possibilities[key]["full_epanet_rmse_m"]:
            possibilities[key]=item
    ranked=sorted(possibilities.values(),key=lambda x:x["full_epanet_rmse_m"])
    if not ranked:
        return {"status":"NO_EXECUTABLE_EVIDENCE","model_submitted_answer":bool(trial.get("final")),
                "evidence_head":trial["audit_head"]}
    return {"status":"SYSTEM_ASSEMBLED_FROM_VERIFIED_TOOL_OUTPUTS",
            "model_submitted_answer":bool(trial.get("final")),
            "candidate":ranked[0],
            "ranked_pairs":ranked[:10],
            "evaluated_unique_pairs":len(ranked),
            "evidence_head":trial["audit_head"],
            "provider_tokens_reported":trial.get("total_provider_tokens"),
            "model_calls":len(trial.get("calls",[])),
            "tool_calls":len(trial.get("tool_events",[])),
            "notes":"Deterministic ranking of full EPANET error receipts, not a new model answer or hidden-oracle inference."}

if __name__=="__main__":
    trial=json.loads(RAW.read_text())
    answer=derive_from_tool_evidence(trial)
    output=DIR/"system-assembled-answer.json"
    output.write_text(json.dumps(answer,indent=2))
    # Only the independent post-assembly assessment reads hidden truth.
    truth=json.loads((DIR/"sealed_truth.json").read_text())
    success=set(answer.get("candidate",{}).get("nodes",[]))==set(truth["hidden_leak_nodes"])
    result={"candidate_file":"system-assembled-answer.json",
            "system_output_matches_sealed_pair":success,
            "kimis_own_final_was_submitted":bool(trial.get("final")),
            "original_trial_status":trial.get("status"),
            "model_oracle_unchanged":True,
            "benchmark_scope":"EPA Net3 14 synthetic sensors; no field measurements"}
    (DIR/"system-assembled-verdict.json").write_text(json.dumps(result,indent=2))
    print("AAU_SYSTEM_AGGREGATION="+json.dumps({"status":answer.get("status"),
         "best_pair":answer.get("candidate",{}).get("nodes"),
         "best_rmse_m":answer.get("candidate",{}).get("full_epanet_rmse_m"),
         "matches_hidden_truth":success,
         "kimi_submitted_final":bool(trial.get("final"))}))
