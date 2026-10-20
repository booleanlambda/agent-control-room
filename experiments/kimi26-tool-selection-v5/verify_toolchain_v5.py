#!/usr/bin/env python3
"""Reviewer-owned, non-LLM executable Stage-1 gate on a fresh Kimi toolchain.
Bounded smoke probes establish narrow API execution; they never certify domain safety.
"""
import hashlib, json, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parent
BENCH=ROOT.parent/"tool-selection-restoration"
PROPOSAL=ROOT/"evidence/toolchain-proposal.json"
SAVED_REVIEW=ROOT/"INDEPENDENT_STAGE1_VERDICT.json"
MANIFEST=BENCH/"external_tool_proof_obligations_v1.json"
OUTPUT=ROOT/"proof_output"
OUTPUT.mkdir(exist_ok=True)

def sha(data):return hashlib.sha256(data).hexdigest()

def main():
    p=json.loads(PROPOSAL.read_text())
    review=json.loads(SAVED_REVIEW.read_text())
    manifest=json.loads(MANIFEST.read_text())
    smoke=json.loads((OUTPUT/"smoke-results.json").read_text())
    run=json.loads((ROOT/"evidence/run.json").read_text())
    assert manifest["challenge_sha256"]==run["challenge_sha256"],"CHALLENGE_HASH_DRIFT"
    assert review["evidence_sources"]["raw_model_content_sha256"]==run["provider_receipt"]["raw_content_sha256"],"MODEL_EVIDENCE_DRIFT"
    assert review["binding_verdict"]["stage2_authorized"] is False
    assert p["stage2_authorized"] is False
    available={t.get("id") for t in p["selected_tools"]}
    roles={
      "unbalanced_powerflow":{"tool_id":"T2","probe":"opendss_unbalanced"},
      "discrete_optimizer":{"tool_id":"T1","probe":"highs_mip"},
      "topology_graph":{"tool_id":"T3","probe":"networkx_radiality"},
      "crew_vehicle_routing":{"tool_id":"T4","probe":"ortools_vrp"},
      "mobile_generator_road_transport":{"tool_id":None,"probe":None},
      "reconfigured_protection_coordination":{"tool_id":None,"probe":None},
      "synchronism_reclose_checker":{"tool_id":None,"probe":None},
      "grid_forming_stability":{"tool_id":"T5","probe":None},
      "cold_load_dynamics":{"tool_id":None,"probe":None},
    }
    role_audit=[]
    for role,binding in roles.items():
        tid=binding["tool_id"];test=binding["probe"]
        probe=(smoke.get("probes") or {}).get(test,{}) if test else {}
        probe_ok=probe.get("status")=="PASS_NARROW_CAPABILITY_ONLY"
        role_audit.append({"role":role,"reviewer_bound_tool_id":tid,
          "tool_present":tid in available if tid else False,
          "probe":test,"probe_status":probe.get("status","NOT_RUN") if test else "NO_APPLICABLE_PROBE",
          "narrow_capability_observed":probe_ok if tid in available else False,
          "full_domain_suitability":"UNVERIFIED"})
    check=[]
    interfaces=p.get("interface_contracts") or []
    for req in manifest["mandatory_interface_contracts"]:
        required=set(req["required_fields"])
        found=[]
        for edge in interfaces:
            fields={f.get("field") for f in edge.get("fields_with_types_and_units",[]) if isinstance(f,dict)}
            if required.issubset(fields):
                found.append({"from":edge.get("from_tool_id"),"to":edge.get("to_tool_id")})
        check.append({"id":req["id"],"required_fields":sorted(required),
                      "status":"FIELDS_DECLARED_NOT_DOMAIN_VERIFIED" if found else "CRITICAL_INTERFACE_MISSING",
                      "candidate_edges":found})
    missing=[x["role"] for x in role_audit if x["reviewer_bound_tool_id"] is None]
    absent=[x["id"] for x in check if x["status"]=="CRITICAL_INTERFACE_MISSING"]
    out={
      "stage":"STAGE1_EXTERNAL_PROOF_ONLY","status":"BLOCKED",
      "stage1_pass":False,"stage2_authorized":False,
      "probe_scope":"Small synthetic API capability only, not protection or 4800-bus evidence",
      "saved_model_proposal_sha256":sha(PROPOSAL.read_bytes()),
      "saved_external_review_sha256":sha(SAVED_REVIEW.read_bytes()),
      "mandatory_role_audit":role_audit,
      "critical_absent_reviewer_roles":missing,
      "critical_interface_audit":check,
      "missing_critical_interfaces":absent,
      "original_review_score":review["original_rubric_result"]["score"],
      "original_review_mandatory_failures":review["original_rubric_result"]["mandatory_failures"],
      "independent_selected_tool_mapping_note":"Mappings are reviewer-authored from the archived candidate, not model self-grade.",
      "why_blocked":"No mobile generator route->arrival/setup contract; no bidirectional protection or synchronism checker; these are not proved by narrow API smoke tests."
    }
    (OUTPUT/"v5-executable-proof-verdict.json").write_text(json.dumps(out,indent=2,ensure_ascii=False)+"\n")
    print(json.dumps({"result":"BLOCKED","missing_roles":missing,
        "missing_interfaces":absent,"narrow_probes_passed":sum(x["narrow_capability_observed"] for x in role_audit),
        "stage2_authorized":False}))
    return 0 # Successful execution of a fail-closed verifier, not a domain pass.

if __name__=="__main__":sys.exit(main())
