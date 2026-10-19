"""Independent, fail-closed Stage-One tool sufficiency gate for AAU.
Tool names and model assurances NEVER confer a pass.
Inputs: immutable A/B/C/D bundle; external reviewer obligations; REAL narrow smoke results.
Outputs: machine-checkable blocked/open interfaces, hashes and test evidence.
"""
import hashlib
import json
from pathlib import Path
import re
import sys

def sha(blob):
    return hashlib.sha256(blob).hexdigest()

def _tokens(text):
    return set(re.findall(r"[a-zA-Z_][a-zA-Z_0-9]*",text.lower()))

def all_tools(bundle):
    a=bundle.get("original_A_proposal",{})
    d=bundle.get("v41_D_repair_delta",{})
    items=a.get("essential_tools",[])+a.get("optional_tools",[])+d.get("new_or_replaced_tools",[])
    tools={}
    duplicates=[]
    for t in items:
        identifier=t.get("id")
        if not identifier or identifier in tools:
            duplicates.append(identifier)
        else:
            tools[identifier]=t
    return tools,duplicates

def all_interfaces(bundle):
    # Original interfaces lack IDs; artificial keys for evidence only.
    a=bundle.get("original_A_proposal",{})
    d=bundle.get("v41_D_repair_delta",{})
    return [dict(row,id=row.get("id") or "A-%03d"%i)
            for i,row in enumerate(a.get("tool_interfaces",[]),1)]+d.get("interface_additions",[])

def validate_proposal(bundle,manifest,probes):
    tools,duplicates=all_tools(bundle)
    interfaces=all_interfaces(bundle)
    probe_dict=probes.get("probes",{})
    bindings=manifest.get("candidate_bindings",[])
    roles={}
    for item in bindings:
        if item["tool_id"] not in tools:
            continue
        # External reviewer role mapping, NOT automated keyword/model assertion.
        roles.setdefault(item["role"],[]).append(item)
    cap={}
    for requirement in manifest["mandatory_obligations"]:
        role_results=[]
        for role in requirement["roles"]:
            candidates=roles.get(role,[])
            candidate_evidence=[]
            for item in candidates:
                probe_id=item.get("test")
                result=probe_dict.get(probe_id,{}) if probe_id else {}
                status=result.get("status")
                candidate_evidence.append({
                    "tool_id":item["tool_id"],"role":role,"probe":probe_id,
                    "probe_status":status if status else "NO_INDEPENDENT_PROBE",
                    "scope":item.get("claim_scope"),
                    "verified_narrow_api":status=="PASS_NARROW_CAPABILITY_ONLY"
                })
            role_results.append({"role":role,
                "status":"ABSENT" if not candidates else
                        ("SMOKE_VERIFIED_SCOPE_LIMITED" if any(p["verified_narrow_api"] for p in candidate_evidence)
                         else "UNSUBSTANTIATED"),
                "tools":candidate_evidence})
        cap[requirement["id"]]={
            "criterion":requirement["criterion"],"roles":role_results,
            "acceptance_context":requirement.get("extra_evidence"),
            "capability_gap":any(r["status"]!="SMOKE_VERIFIED_SCOPE_LIMITED" for r in role_results),
            "task_validated":False  # Real network and safety data were NEVER supplied.
        }
    contract_results=[]
    for obligation in manifest["mandatory_interface_contracts"]:
        from_set={item["tool_id"] for item in roles.get(obligation["from_role"],[])}
        to_set={item["tool_id"] for item in roles.get(obligation["to_role"],[])}
        possible=[]
        for edge in interfaces:
            a=edge.get("from_id");b=edge.get("to_id")
            if a in from_set and b in to_set:
                serialized=json.dumps(edge,ensure_ascii=False).lower()
                missing=[field for field in obligation["required_fields"]
                         if field.lower() not in _tokens(serialized)]
                # Checked only explicitly documented field schema, not tool names/narrative.
                artifact=str(edge.get("artifact_with_schema_and_units") or edge.get("typed_artifact") or "")
                artifact_tokens=_tokens(artifact)
                missing=[field for field in obligation["required_fields"]
                         if field.lower() not in artifact_tokens]
                possible.append({"interface_id":edge.get("id"),
                    "missing_required_typed_fields":missing,
                    "has_rejection_rule":bool(edge.get("invalid_data_rejection") or edge.get("failure_if_invalid")),
                    "has_full_declared_contract":not missing and bool(edge.get("invalid_data_rejection") or edge.get("failure_if_invalid"))})
        contract_results.append({
            "id":obligation["id"],"criterion":obligation["criterion"],
            "from_role":obligation["from_role"],"to_role":obligation["to_role"],
            "candidate_edges":possible,
            "status":"DECLARED_CONTRACT_SCOPE_UNVERIFIED" if any(x["has_full_declared_contract"] for x in possible)
                     else "MISSING_OR_INCOMPLETE_CONTRACT",
            "required_fields":obligation["required_fields"],
            "notes":obligation["proof"]
        })
    d=bundle.get("v41_D_repair_delta",{})
    c=bundle.get("original_C_adversarial_audit",{})
    mandatory_ids={x["audit_id"] for x in c.get("reconciliation",[]) if x.get("mandatory")}
    repair_rows=d.get("audit_repairs",[])
    repair_ids=[x.get("audit_id") for x in repair_rows]
    missing_audit=sorted(mandatory_ids-set(repair_ids))
    duplicate_repair=sorted({x for x in repair_ids if repair_ids.count(x)>1})
    unknown_tools_in_repairs=sorted({t for x in repair_rows for t in x.get("selected_tool_ids",[])
                                    if t not in tools})
    unknown_interfaces_in_repairs=sorted({i for x in repair_rows for i in x.get("interface_ids",[])
        if i not in {e.get("id") for e in interfaces}})
    gaps=[row["id"] for row in cap.values() if row["capability_gap"]]
    bad_contracts=[x["id"] for x in contract_results if x["status"]=="MISSING_OR_INCOMPLETE_CONTRACT"]
    structural_issues={
        "duplicate_selected_tool_ids":duplicates,
        "missing_mandatory_audit_repair_ids":missing_audit,
        "duplicate_audit_repair_ids":duplicate_repair,
        "unknown_tools_in_repair_claims":unknown_tools_in_repairs,
        "unknown_interface_ids_in_repair_claims":unknown_interfaces_in_repairs,
        "model_requested_stage2":d.get("stage2_authorized") is not False,
    }
    has_structural_error=any(v for v in structural_issues.values())
    model_self_status=d.get("stage1_assessment",{}).get("status")
    # No "PASS" is emitted: these probes do not verify application to 4,800 buses or safety.
    return {
        "gate":"AAU_STAGE1_TOOL_PROOF_EXTERNAL_V1",
        "result":"BLOCKED" if (gaps or bad_contracts or has_structural_error) else "NEEDS_INDEPENDENT_DOMAIN_VALIDATION",
        "model_self_assessment":model_self_status,
        "original_rubric_score":None,
        "independent_original_rubric_grading":"NOT_REPLACED_BY_THIS_GATE",
        "capabilities":cap,
        "interface_contracts":contract_results,
        "structural_issues":structural_issues,
        "unsubstantiated_or_missing_capability_ids":gaps,
        "unimplemented_interface_contract_ids":bad_contracts,
        "stage2_authorized":False,
        "limitations":["Passing minimal executable API probes does not prove field suitability",
                       "Model capability claims are not validation evidence",
                       "No physical data or live operations have been supplied",
                       "Critical protection and synchronization require specialist verification"]
    }

def main(argv):
    if len(argv)!=5:
        raise SystemExit("usage: tool_selection_proof_gate.py bundle.json manifest.json probes.json verdict.json")
    p_bundle,p_manifest,p_probes,p_output=map(Path,argv[1:5])
    bundle=json.loads(p_bundle.read_text())
    manifest=json.loads(p_manifest.read_text())
    probes=json.loads(p_probes.read_text())
    provenance=bundle.get("provenance",{})
    if provenance.get("source_actions_run")!=39285019757:
        raise ValueError("UNTRUSTED_ORIGIN_FOR_THIS_REPLAY")
    if provenance.get("v41_response_sha256")!="8e1916ce618918f53f365a839eccf981c914ca88328be52c982a8d86500111cd":
        raise ValueError("V41_RESPONSE_HASH_MISMATCH")
    if manifest.get("challenge_sha256")!="56321d16f88d1c46eec36a6c51a435a75cba6d72f55a824364a4dcf39a636c16":
        raise ValueError("CHALLENGE_HASH_MISMATCH")
    if manifest.get("original_rubric_sha256")!="ad8f605c7ee0f885f4c4ca0b891fc9495b5271712114c4c492e17574c8ea95d9":
        raise ValueError("GRADING_RUBRIC_MISMATCH")
    out=validate_proposal(bundle,manifest,probes)
    out["evidence_provenance"]={
        "provider_original_sha256":provenance.get("original_response_sha256"),
        "provider_v41_delta_sha256":provenance["v41_response_sha256"],
        "bundle_sha256":sha(p_bundle.read_bytes()),
        "manifest_sha256":sha(p_manifest.read_bytes()),
        "smoke_evidence_sha256":sha(p_probes.read_bytes())
    }
    p_output.parent.mkdir(parents=True,exist_ok=True)
    p_output.write_text(json.dumps(out,indent=2,ensure_ascii=False,sort_keys=True))
    print("AAU_TOOL_PROOF_GATE="+json.dumps({
        "result":out["result"],
        "unsubstantiated_or_missing_capability_ids":out["unsubstantiated_or_missing_capability_ids"],
        "unimplemented_interface_contract_ids":out["unimplemented_interface_contract_ids"],
        "original_rubric_score":None,
        "stage2_authorized":False
    }),flush=True)

if __name__=="__main__":
    main(sys.argv)
