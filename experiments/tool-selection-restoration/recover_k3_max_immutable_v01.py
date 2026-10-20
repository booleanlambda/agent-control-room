#!/usr/bin/env python3
"""Forensic-only recovery of ONE immutable Kimi K3 thinking-MAX response.

Recover a COMPLETE, unique root JSON object after non-JSON preamble.
Never rewrite source data, never invoke model/provider, never self-certify tool
suitability. Strict original-format violation remains a recorded FAIL.
"""
from __future__ import annotations
import hashlib,json,pathlib,sys
from v5_independent_structure_gate import validate

HERE=pathlib.Path(__file__).resolve().parent
SOURCE=HERE/"k3_on_v6_original_immutable"
OUT=HERE/"evidence_k3_on_v6_recovered_forensics_v01"
OUT.mkdir(exist_ok=True)
SUMMARY_DIGEST="79c3a5c59d4b5d19dc89849e54693c92addb796d392e9b9390dbbf691911422b"
RAW_WRAPPER_DIGEST="35627bfd01f7ad4d9bfd60cd4fc47112eebcd55c1b7067f2cfe83a5d97c1efe3"
CONTENT_DIGEST="d4b385e4ba863e1699a75808dcfc5bf5c2ab45592c76511153c7d292708ff61e"
CANONICAL_PROPOSAL_DIGEST="8a85fc94359cbe40616e1e20a052190ae4f02a40c7aab295d13030c1b47219a3"
PROVIDER_RUN=39502332304
def h(b):return hashlib.sha256(b).hexdigest()
def write(path,x):
 (OUT/path).write_text(json.dumps(x,ensure_ascii=False,sort_keys=True,indent=2)+"\n",encoding="utf-8")
def main():
 summary_data=(SOURCE/"summary.json").read_bytes()
 raw_data=(SOURCE/"raw_final_response.json").read_bytes()
 assert h(summary_data)==SUMMARY_DIGEST,"Frozen original summary differs"
 assert h(raw_data)==RAW_WRAPPER_DIGEST,"Frozen original final response differs"
 summary=json.loads(summary_data)
 assert summary["status"]=="FINAL_JSON_PARSE_FAILURE"
 assert summary["proposal"] is None
 assert len(summary["attempts"])==3
 assert [a["finish_reason"] for a in summary["attempts"]]==["tool_calls","tool_calls","stop"]
 raw=json.loads(raw_data)["raw"]
 assert h(raw.encode("utf8"))==CONTENT_DIGEST
 # raw_decode is a deterministic format recovery, NOT an LLM response rewriting.
 # Require one complete root object and no trailing non-whitespace or second doc.
 begin=raw.find("{")
 assert begin>0,"This test specifically recovered non-JSON preamble"
 candidate,ending=json.JSONDecoder().raw_decode(raw,begin)
 assert isinstance(candidate,dict),"Root must be object"
 assert not raw[ending:].strip(),"Non-whitespace trailing content"
 canonical=json.dumps(candidate,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()
 assert h(canonical)==CANONICAL_PROPOSAL_DIGEST,"Recovered proposal identity changed"
 manifest=json.loads((HERE/"external_tool_proof_obligations_v1.json").read_text())
 structural=validate(candidate,manifest)
 tool_calls=summary.get("tool_invocations",[])
 valid_parallel=sum(t["name"]=="parallel_software_discovery" and isinstance(t.get("output"),dict) and "result_count" in t["output"] for t in tool_calls)
 err_parallel=[{"turn":t["turn"],"error":t["output"].get("error")} for t in tool_calls
               if t["name"]=="parallel_software_discovery" and isinstance(t.get("output"),dict) and t["output"].get("error")]
 reasoning_chars=sum(int(a.get("reasoning_chars") or 0) for a in summary["attempts"])
 reasoning_token_s=sum(int((a.get("usage",{}).get("completion_tokens_details") or {}).get("reasoning_tokens") or 0) for a in summary["attempts"])
 assert reasoning_chars>0 and reasoning_token_s>0,"No real provider thinking evidence"
 interfaces=candidate.get("interface_contracts",[])
 selected=candidate.get("selected_tools",[])
 texts=" ".join(str(i.get(k,"")) for i in interfaces for k in ("conversion","fields_with_types_and_units","invalid_data_rejection")).lower()
 install=" ".join(str(t.get("installation_command","")) for t in selected).lower()
 flags={
   "v5_pysp_nonexistent_pin": "pysp==6.0.0" in install,
   "v5_nearest_hour": "rounded to nearest hour" in texts,
   "v6_unsafe_floor_availability_stated": "arrival slot = floor" in texts or "floor(arrival_s/3600)" in texts,
   "explicit_conservative_ceiling": "conservative ceil" in texts,
   "osrm_install_prerequisites_explicit": "osrm-extract" in install and "osrm-partition" in install and "osrm-customize" in install,
   "commercial_studies_unexecuted": all("not_run" in str(t.get("execution_status","")).lower() for t in candidate.get("installation_and_test_commands",[])),
   "model_claimed_uccr_unavailable": "registry tools were not present" in raw.lower() or "registry tools were unavailable" in raw.lower(),
   "uccr_tools_offered_after_first_turn": True,
 }
 record={
  "original_workflow_run":PROVIDER_RUN,
  "source_sha256":{"summary":SUMMARY_DIGEST,"raw_wrapper":RAW_WRAPPER_DIGEST,
                   "raw_final_content":CONTENT_DIGEST,"canonical_proposal":CANONICAL_PROPOSAL_DIGEST},
  "source_not_rewritten":True,
  "original_final_format_contract":"FAIL_EXTRA_TEXT_BEFORE_JSON",
  "original_provider_status":"COMPLETED_FINISH_STOP",
  "original_runtime_status":summary["status"],
  "recovery_method":"json.JSONDecoder.raw_decode once from first root brace, requiring complete consumed tail",
  "recovered_json_status":"COMPLETE_UNIQUE_ROOT_JSON_WITH_PREAMBLE_REMOVED",
  "non_json_preamble_characters":begin,
  "provider_turns":len(summary["attempts"]),
  "provider_finish_reasons":[a["finish_reason"] for a in summary["attempts"]],
  "total_tokens":sum(int(a.get("usage",{}).get("total_tokens") or 0) for a in summary["attempts"]),
  "observed_reasoning_characters":reasoning_chars,
  "observed_reasoning_tokens":reasoning_token_s,
  "thinking_on_confirmed":True,
  "parallel_invocation_count":sum(t["name"]=="parallel_software_discovery" for t in tool_calls),
  "parallel_completed_searches":valid_parallel,
  "parallel_errors":err_parallel,
  "registry_tool_calls":sum(t["name"] in ("search_capabilities","inspect_operation") for t in tool_calls),
  "selected_tools":[{"id":t.get("id"),"name":t.get("name")} for t in selected],
  "required_computations":len(candidate.get("required_computations",[])),
  "interfaces":len(interfaces),
  "independent_tests":len(candidate.get("independent_verification_tests",[])),
  "self_assessment":candidate.get("stage1_assessment",{}).get("status"),
  "stage2_authorized":False,
  "deterministic_pattern_observations":flags,
  "structural_verdict":structural,
  "strict_benchmark_pass":False,
  "toolchain_suitability":"UNVERIFIED_NOT_RUN",
  "caveats":[
     "No model re-inference or added provider search call; analysis uses original archived response.",
     "Model should have output only JSON; deterministic recovery does not erase failure.",
     "Original run did not query UCCR registry even though it was offered after first provider turn.",
     "This script checks structural consistency and pattern flags, not all mathematical or executable soundness."
  ],
 }
 write("recovered_original_proposal.json",candidate)
 write("postmortem.json",record)
 print("AAU_K3_MAX_DETERMINISTIC_RECOVERY="+json.dumps({
  "original_run":PROVIDER_RUN,"original_failure":record["original_final_format_contract"],
  "recoverable":True,"model_thinking_on":True,
  "reasoning_chars":reasoning_chars,"reasoning_tokens":reasoning_token_s,
  "structural_result":structural.get("result"),"structural_errors":len(structural.get("structural_errors",[])),
  "tools":len(selected),"interfaces":len(interfaces),"tests":record["independent_tests"],
  "self_assessment":record["self_assessment"],"parallel_successful":valid_parallel,
  "parallel_errors":err_parallel,"registry_calls":record["registry_tool_calls"],
  "stage2_authorized":False},sort_keys=True),flush=True)
 return 0

if __name__=="__main__":sys.exit(main())
