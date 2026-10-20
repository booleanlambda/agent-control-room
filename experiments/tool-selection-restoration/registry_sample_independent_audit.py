#!/usr/bin/env python3
"""Independently inspect Kimi's registry-assisted output; no claim of domain-level proof."""
import json, hashlib, re, sys
from pathlib import Path
from v5_independent_structure_gate import validate

ROOT=Path(__file__).resolve().parent
E=ROOT/"evidence_registry_v01"

def main():
    receipt_path=E/"run.json"
    if not receipt_path.exists():
        print("AAU_REGISTRY_AUDIT=NO_RECEIPT")
        return 1
    receipt=json.loads(receipt_path.read_text())
    catalog=json.loads((ROOT/"capability_registry_sample_v01.json").read_text())
    manifest=json.loads((ROOT/"external_tool_proof_obligations_v1.json").read_text())
    if receipt.get("status")!="PROPOSED_PENDING_INDEPENDENT_GATE":
        result={"result":"NO_COMPLETE_MODEL_PROPOSAL","provider_status":receipt.get("status"),
                "stage2_authorized":False}
    else:
        proposed=receipt["model_proposal"]
        result=validate(proposed,manifest)
        text=json.dumps(proposed,ensure_ascii=False)
        ids=[x["operation_id"] for x in catalog["tool_operations"]]
        referenced=[x for x in ids if x in text]
        result["catalog_consultation"]={
          "catalog_id":catalog["registry_id"],
          "catalog_sha256":receipt["frozen_file_sha256"].get("capability_registry_sample_v01.json"),
          "sample_operations_available":len(ids),
          "sample_operations_explicitly_referenced":referenced,
          "explicit_reference_count":len(referenced),
          "reference_notice":"A textual citation is evidence of reference, not of correct tool suitability",
          "new_tool_candidates":len([t for t in proposed.get("selected_tools",[]) if
                              not any(x in json.dumps(t,ensure_ascii=False) for x in ids)]),
          "catalog_not_exhaustive":True
        }
        result["proposal_brief"]={
            "selected_tools":[{"id":t.get("id"),"name":t.get("name"),
               "operation":str(t.get("concrete_executable_operation",""))[:220]}
               for t in proposed.get("selected_tools",[]) if isinstance(t,dict)],
            "required_computations":len(proposed.get("required_computations",[])),
            "independent_test_specs":len(proposed.get("independent_verification_tests",[])),
            "interface_specs":len(proposed.get("interface_contracts",[])),
            "unresolved_gaps":proposed.get("unresolved_gaps",[]),
            "self_assessment":proposed.get("stage1_assessment",{}),
        }
    result["provider_response_sha256"]=(receipt.get("provider_receipt") or {}).get("response_content_sha256")
    result["prior_comparison_run"]={"run_id":39451190485,
        "notice":"Reference assisted vs blind differs by sample and added user instruction; no causal claims or retroactive original score."}
    result["stage2_authorized"]=False
    (E/"independent-registry-audit.json").write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n")
    brief=result.get("proposal_brief",{})
    print("AAU_REGISTRY_AUDIT="+json.dumps({
      "result":result["result"],"structural_errors":result.get("structural_errors",[]),
      "catalog_references":(result.get("catalog_consultation") or {}).get("sample_operations_explicitly_referenced",[]),
      "selected_tools":brief.get("selected_tools",[]),
      "unresolved_gaps":str(brief.get("unresolved_gaps",[]))[:280],
      "stage2_authorized":False
    },ensure_ascii=False),flush=True)
    return 0

if __name__=="__main__":raise SystemExit(main())
