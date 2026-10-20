#!/usr/bin/env python3
"""Independent structural fail-closed check. Not a scientific capability certification."""
import hashlib, json, pathlib, sys

HERE=pathlib.Path(__file__).resolve().parent
OUT=HERE/"evidence"
REQUIRED_TOP=[
  "problem_formulation","required_computations","selected_tools","rejected_alternatives",
  "execution_sequence","interface_contracts","requirement_to_tool_mapping",
  "installation_and_test_commands","independent_verification_tests",
  "resource_and_performance_analysis","unresolved_gaps","self_assessment","stage2_authorized"
]
def check():
    receipt=json.loads((OUT/"run.json").read_text())
    result={"stage":"STAGE1_EXTERNAL_STRUCTURAL_GATE_V5",
            "model_stage1_receipt_status":receipt.get("status"),
            "original_rubric":"EXTERNAL_SPECIALIST_GRADE_PENDING",
            "appropriateness_rubric":"EXTERNAL_SPECIALIST_GRADE_PENDING",
            "stage2_authorized":False,"verdict":"BLOCKED","critical_faults":[],
            "schema_errors":[],"caveat":"Structure is NOT tool capability or suitability."}
    faults=result["critical_faults"]
    if receipt.get("status")!="COMPLETE_PENDING_EXTERNAL_GATE":
        faults.append("NO_COMPLETE_PROVIDER_RECEIPT")
    proposal_file=OUT/"parsed_proposal.json"
    if not proposal_file.exists():
        faults.append("NO_PARSED_PROPOSAL")
        return result
    proposal=json.loads(proposal_file.read_text())
    missing=[k for k in REQUIRED_TOP if k not in proposal]
    if missing:
        result["schema_errors"].append({"missing_top_level_keys":missing})
        faults.append("INVALID_OR_INCOMPLETE_TOP_LEVEL_SCHEMA")
    if proposal.get("stage2_authorized") is not False:
        faults.append("MODEL_ATTEMPTED_STAGE2")
    required=proposal.get("required_computations") or []
    tools=proposal.get("selected_tools") or []
    mapping=proposal.get("requirement_to_tool_mapping") or []
    tests=proposal.get("independent_verification_tests") or []
    edges=proposal.get("interface_contracts") or []
    sequence=proposal.get("execution_sequence") or []
    if not all(isinstance(x,list) for x in [required,tools,mapping,tests,edges,sequence]):
        faults.append("WRONG_SCHEMA_COLLECTION_TYPE")
        return result
    def ids(rows):
        return [x.get("id") for x in rows if isinstance(x,dict)]
    req_ids=ids(required)
    tool_ids=ids(tools)
    test_ids=ids(tests)
    if not req_ids or not tool_ids or not mapping or not tests:
        faults.append("EMPTY_MANDATORY_COMPUTATION_TOOL_OR_TEST_COLLECTION")
    for label,values in [("requirement",req_ids),("tool",tool_ids),("test",test_ids)]:
        if len(values)!=len(set(values)) or any(not value for value in values):
            faults.append("DUPLICATE_OR_MISSING_"+label.upper()+"_ID")
    rid=set(req_ids); tid=set(tool_ids); vid=set(test_ids)
    critical_ids={x.get("id") for x in required if isinstance(x,dict) and x.get("critical") is True}
    mapped={}
    for entry in mapping:
        if not isinstance(entry,dict):continue
        r=entry.get("required_computation_id")
        mapped.setdefault(r,[]).append(entry)
        if r not in rid:
            faults.append("UNKNOWN_MAPPED_REQUIREMENT:"+str(r))
        if not entry.get("tool_ids") or any(t not in tid for t in entry.get("tool_ids",[])):
            faults.append("UNKNOWN_OR_EMPTY_SELECTED_TOOLS_FOR:"+str(r))
        if entry.get("independent_rejection_test_id") not in vid:
            faults.append("MISSING_VALID_REJECTION_TEST_FOR:"+str(r))
    for r in sorted(critical_ids):
        rows=mapped.get(r,[])
        if not rows:
            faults.append("UNMAPPED_CRITICAL_REQUIREMENT:"+str(r))
        elif all(row.get("status")=="UNRESOLVED" for row in rows):
            faults.append("CRITICAL_REQUIREMENT_DECLARED_UNRESOLVED:"+str(r))
    for t in tools:
        if not isinstance(t,dict):continue
        if not t.get("name") or not t.get("supported_method_or_api") or not t.get("mathematical_applicability"):
            faults.append("TOOL_WITHOUT_CAPABILITY_AND_APPLICABILITY:"+str(t.get("id")))
        for r in t.get("required_computation_ids",[]):
            if r not in rid:
                faults.append("TOOL_REFERENCES_UNKNOWN_REQUIREMENT:"+str(t.get("id")))
        if t.get("execution_evidence")=="OBSERVED" and not t.get("evidence_reference_or_unverified_reason"):
            faults.append("UNSUPPORTED_EXECUTION_CLAIM:"+str(t.get("id")))
    for e in edges:
        if not isinstance(e,dict):continue
        a=e.get("from_tool_id"); b=e.get("to_tool_id")
        if a not in tid or b not in tid:
            faults.append("DANGLING_TOOL_INTERFACE:"+str((a,b)))
        if not e.get("typed_fields_with_units") or not e.get("validation_and_rejection_rule"):
            faults.append("UNTYPED_OR_UNCHECKED_INTERFACE:"+str((a,b)))
    for v in tests:
        if not isinstance(v,dict):continue
        if not v.get("negative_or_injected_failure_case") or not v.get("rejection_threshold_or_rule"):
            faults.append("UNFALSIFIABLE_TEST:"+str(v.get("id")))
        if any(r not in rid for r in v.get("computation_ids",[])):
            faults.append("TEST_REFERS_UNKNOWN_REQUIREMENT:"+str(v.get("id")))
    for step in sequence:
        if not isinstance(step,dict):continue
        if any(t not in tid for t in step.get("tool_ids",[])):
            faults.append("EXECUTION_STEP_UNKNOWN_TOOL:"+str(step.get("step")))
    result["counts"]={"critical_computations":len(critical_ids),"all_computations":len(required),
                      "selected_tools":len(tools),"interfaces":len(edges),"rejection_tests":len(tests),
                      "mapped_requirements":len(mapped)}
    result["critical_faults"]=sorted(set(faults))
    result["verdict"]="BLOCKED" if faults else "STRUCTURE_ONLY_PASS_DOMAIN_AND_EXECUTION_UNVERIFIED"
    result["original_11_criteria"]={f"C{i}":"NOT_SUBSTANTIVELY_GRADED" for i in range(1,12)}
    result["five_appropriateness_criteria"]={f"A{i}":"NOT_SUBSTANTIVELY_GRADED" for i in range(1,6)}
    return result

def main():
    verdict=check()
    (OUT/"external_structural_verdict.json").write_text(json.dumps(verdict,indent=2))
    print("AAU_K26_V5_EXTERNAL_GATE="+json.dumps({
      "verdict":verdict["verdict"],"critical_faults":verdict["critical_faults"],
      "counts":verdict.get("counts",{}),"stage2_authorized":False}),flush=True)
    return 0

if __name__=="__main__":
    raise SystemExit(main())
