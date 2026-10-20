#!/usr/bin/env python3
"""Fail-closed structural/audit-boundary check for blind Kimi tool selections.

Original external obligations are NOT provided to Kimi. The gate does not
pretend that naming a package or passing a synthetic smoke proves full toolchain
suitability. Semantic specialists must still verify the original fixed rubric.
"""
import json,hashlib,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
KEYS={
 "problem_formulation":dict,"required_computations":list,"selected_tools":list,
 "tool_selection_justification":list,"rejected_alternatives":list,
 "execution_sequence":list,"interface_contracts":list,
 "requirement_to_tool_mapping":list,"installation_and_test_commands":list,
 "independent_verification_tests":list,"resource_and_performance_analysis":dict,
 "unresolved_gaps":list,"stage1_assessment":dict,"stage2_authorized":bool
}
def _unique_id(items,label,problems):
    ids=[x.get("id") for x in items if isinstance(x,dict)]
    if len(ids)!=len(items) or any(not isinstance(x,str) or not x for x in ids):
        problems.append("MISSING_OR_INVALID_IDS:"+label)
    if len(set(ids))!=len(ids):problems.append("DUPLICATE_IDS:"+label)
    return set(x for x in ids if isinstance(x,str))
def validate(p,external_manifest):
    errors=[]
    for k,t in KEYS.items():
        if k not in p or not isinstance(p[k],t):errors.append("MISSING_OR_WRONG_TYPE:"+k)
    if errors:return {"result":"BLOCKED_INVALID_SCHEMA","structural_errors":errors,"stage2_authorized":False}
    requirements=p["required_computations"];tools=p["selected_tools"];links=p["interface_contracts"]
    tests=p["independent_verification_tests"]
    req_ids=_unique_id(requirements,"computations",errors)
    tool_ids=_unique_id(tools,"selected_tools",errors)
    interface_ids=_unique_id(links,"interface_contracts",errors)
    test_ids=_unique_id(tests,"independent_verification_tests",errors)
    mapped=[]
    map_keys=[]
    for x in p["requirement_to_tool_mapping"]:
        if not isinstance(x,dict):errors.append("INVALID_MAPPING_RECORD");continue
        r=x.get("requirement_id");map_keys.append(r)
        selected=x.get("tool_ids",[])
        if r not in req_ids:errors.append("UNKNOWN_REQUIREMENT_MAPPING:"+str(r))
        if not isinstance(selected,list) or not selected:errors.append("MISSING_SELECTED_TOOLS_FOR:"+str(r));continue
        if any(t not in tool_ids for t in selected):errors.append("UNKNOWN_TOOL_ID_FOR:"+str(r))
        trefs=x.get("verification_test_ids",[])
        if not isinstance(trefs,list) or not trefs:errors.append("MISSING_VERIFIER_REFERENCES_FOR:"+str(r))
        elif any(t not in test_ids for t in trefs):errors.append("UNKNOWN_VERIFIER_ID_FOR:"+str(r))
        mapped.append(r)
    hard={r.get("id") for r in requirements if isinstance(r,dict) and r.get("hard_requirement") is True}
    for r in sorted(hard-set(mapped)):errors.append("HARD_REQUIREMENT_UNMAPPED:"+str(r))
    if len(set(map_keys))!=len(map_keys):errors.append("DUPLICATE_REQUIREMENT_MAPPING")
    for t in tools:
        if not isinstance(t,dict):errors.append("INVALID_TOOL_RECORD");continue
        for field in ("name","concrete_executable_operation","math_fidelity_and_assumptions",
                      "installation_command","input_artifacts","output_artifacts","limitations"):
            if not t.get(field):errors.append("TOOL_MISSING_"+field+":"+str(t.get("id")))
        if any(r not in req_ids for r in t.get("requirement_ids",[])):
            errors.append("TOOL_UNKNOWN_REQUIREMENT:"+str(t.get("id")))
    for edge in links:
        if not isinstance(edge,dict):errors.append("INVALID_INTERFACE_RECORD");continue
        for k in ("from_tool_id","to_tool_id"):
            if edge.get(k) not in tool_ids:errors.append("UNKNOWN_INTERFACE_ENDPOINT:"+str(edge.get("id"))+":"+k)
        for k in ("artifact","fields_with_types_and_units","key_and_time_mapping","conversion","invalid_data_rejection"):
            if not edge.get(k):errors.append("UNTYPED_OR_UNCHECKABLE_INTERFACE:"+str(edge.get("id"))+":"+k)
    for test in tests:
        if not isinstance(test,dict):errors.append("INVALID_TEST_RECORD");continue
        for k in ("independent_checker","positive_case","negative_case","rejection_threshold"):
            if not test.get(k):errors.append("UNFALSIFIABLE_TEST:"+str(test.get("id"))+":"+k)
        if test.get("execution_status") not in ("NOT_RUN","EXECUTED_EVIDENCE_LINKED"):
            errors.append("INVALID_EXECUTION_STATUS:"+str(test.get("id")))
        if test.get("execution_status")=="EXECUTED_EVIDENCE_LINKED":
            errors.append("UNSUPPORTED_EXECUTION_CLAIM:"+str(test.get("id")))
        if any(r not in req_ids for r in test.get("requirement_ids",[])):
            errors.append("TEST_UNKNOWN_REQUIREMENT:"+str(test.get("id")))
    for test in p["installation_and_test_commands"]:
        if not isinstance(test,dict):errors.append("INVALID_INSTALL_TEST_ROW");continue
        if test.get("tool_id") not in tool_ids:errors.append("INSTALL_UNKNOWN_TOOL")
        if test.get("execution_status")!="NOT_RUN":
            errors.append("UNSUPPORTED_INSTALL_TEST_EXECUTION_CLAIM:"+str(test.get("tool_id")))
    if p["stage2_authorized"] is not False:errors.append("UNAUTHORIZED_STAGE2")
    if p["stage1_assessment"].get("status") not in ("BLOCKED","PROPOSAL_FOR_EXTERNAL_VERIFICATION"):
        errors.append("INVALID_SELF_ASSESSMENT")
    for item in external_manifest.get("mandatory_obligations",[]):
        if not item.get("id"):errors.append("EXTERNAL_MANIFEST_BROKEN")
    return {
      "result":"BLOCKED_INVALID_SELECTION_STRUCTURE" if errors else "STRUCTURALLY_COMPLETE_PENDING_INDEPENDENT_SUITABILITY_AND_EXECUTION",
      "structural_errors":errors,
      "counts":{"hard_requirements_model_listed":len(hard),"all_requirements_model_listed":len(req_ids),
                "selected_tools":len(tool_ids),"typed_interfaces":len(interface_ids),
                "independent_tests_proposed":len(test_ids)},
      "external_obligations":[{"id":o["id"],"criterion":o.get("criterion"),"verification":"NOT_INFERRED_FROM_MODEL; REQUIRES_INDEPENDENT_CAPABILITY_AND_DOMAIN_CHECK"} for o in external_manifest["mandatory_obligations"]],
      "external_required_interface_ids":[i["id"] for i in external_manifest["mandatory_interface_contracts"]],
      "independent_full_toolchain_verification":"NOT_PASSED",
      "original_frozen_11_criteria_score":None,
      "stage2_authorized":False,
      "scope_limit":"Structural closure is not proof of real tool API support, numerical suitability, integration, 15-minute performance, field safety, or six-scenario correctness."
    }

def main():
    receipt_path=ROOT/"evidence_v5"/"run.json"
    if not receipt_path.exists():
        print("AAU_V5_INDEPENDENT_GATE=NO_PROVIDER_RECEIPT")
        return 1
    receipt=json.loads(receipt_path.read_text())
    manifest=json.loads((ROOT/"external_tool_proof_obligations_v1.json").read_text())
    if receipt.get("status")!="PROPOSED_PENDING_INDEPENDENT_GATE":
        result={"result":"NO_COMPLETE_MODEL_PROPOSAL","provider_status":receipt.get("status"),"stage2_authorized":False}
    else:
        result=validate(receipt["model_proposal"],manifest)
    result["source_prompt_sha256"]=receipt.get("frozen_file_sha256",{}).get("TOOL_SELECTION_GENERIC_V5_SYSTEM.md")
    result["source_problem_sha256"]=receipt.get("frozen_file_sha256",{}).get("challenge.json")
    result["provider_response_sha256"]=(receipt.get("provider_receipt") or {}).get("response_content_sha256")
    result["model_requested"]="kimi-k2.6"
    result["thinking_requested"]="enabled"
    out=ROOT/"evidence_v5"/"independent-structural-verdict.json"
    out.write_text(json.dumps(result,indent=2,ensure_ascii=False)+"\n")
    print("AAU_V5_INDEPENDENT_GATE="+json.dumps({"result":result["result"],"errors":len(result.get("structural_errors",[])),
          "stage2_authorized":False}))
    return 0
if __name__=="__main__":sys.exit(main())
