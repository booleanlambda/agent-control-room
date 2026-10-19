"""Exact-conversation continuation of the previous 15-call Kimi/EPANET experiment.
Original model outputs and all tool results are replayed into the chat context from
unaltered GitHub Actions evidence. No answer key enters model state. No calls are repeated.
"""
import hashlib
import json
import time
import live
import tools_runtime as runtime
from prepare import OUT

ORIGINAL_TRIAL_SHA256="86da1acbfa35ec393230a9407897e3496c4e18bc0f9c1853d7a84c2c188f5173"
PREVIOUS_MEASUREMENT_SHA256="d9d03d8c32d0eb459b4ec4da5ab3fe611d122d9622170e11bc84a8ba350c5926"
NEW_TOTAL_TOKEN_CEILING=100000

def check_original(trial_raw,trial,visible):
    if hashlib.sha256(trial_raw).hexdigest()!=ORIGINAL_TRIAL_SHA256:
        raise RuntimeError("PRIOR_TRIAL_ARTIFACT_MISMATCH")
    if live.sha(json.dumps(visible,sort_keys=True))!=PREVIOUS_MEASUREMENT_SHA256:
        raise RuntimeError("MEASUREMENT_CHANGED")
    if trial.get("status")!="MODEL_TOKEN_BUDGET":
        raise RuntimeError("PRIOR_TRIAL_STATUS_UNEXPECTED")
    if len(trial.get("calls",[]))!=15 or len(trial.get("tool_events",[]))!=15:
        raise RuntimeError("PRIOR_HISTORY_LENGTH_MISMATCH")
    usage_sum=sum(int(c["usage"]["total_tokens"]) for c in trial["calls"])
    if usage_sum!=trial.get("total_provider_tokens") or usage_sum!=67793:
        raise RuntimeError("PRIOR_PROVIDER_USAGE_MISMATCH")
    prev="0"*64
    for entry in trial.get("audit_events",[]):
        s=json.dumps(entry["event"],sort_keys=True,separators=(",",":"))
        h=live.sha(prev+s)
        if entry["previous"]!=prev or entry["hash"]!=h:
            raise RuntimeError("PRIOR_EVENT_CHAIN_INVALID")
        prev=h
    if prev!=trial["audit_head"]:
        raise RuntimeError("PRIOR_EVENT_HEAD_MISMATCH")
    for c in trial["calls"]:
        if live.sha(c["response_content"])!=c["response_sha256"]:
            raise RuntimeError("PRIOR_MODEL_RESPONSE_HASH_MISMATCH")
    for t in trial["tool_events"]:
        if live.sha(json.dumps(t["result"],sort_keys=True))!=t["result_sha256"]:
            raise RuntimeError("PRIOR_TOOL_RESULT_HASH_MISMATCH")

def initial_messages(visible):
    # Exact initial messages from the completed first-15-call trial.
    problem=(
       "This is a controlled EPA EPANET Net3 water-network benchmark (not a real water utility). "
       "Two independently simulated leak emitters changed pressure at fourteen sensors. "
       "Using only the computational tools listed below, identify the most likely pair "
       "of leak junctions and estimate strengths. You are NOT given the answer key. "
       "Use tools to inspect real simulated observations, calculate hypotheses, verify "
       "your proposed pair with full EPANET hydraulics, and then submit. "
       "Do not claim to have conducted a real hospital safety test. "
       "Decide which tools to use and in what order. No arbitrary model-turn ceiling; total provider compute budget is 75000 tokens. Submit your best-supported ranked result once evidence is sufficient, rather than indefinitely exploring. The answer is assessed independently after your final reply. "
       "On each turn produce JSON only. Tool call schema: "
       "{\"type\":\"tool\",\"name\":\"one listed tool name\",\"arguments\":{},\"why\":\"brief justification\"}. "
       "Finish schema: {\"type\":\"final\",\"ranked_pairs\":[{\"nodes\":[\"node1\",\"node2\"],"
       "\"coefficients\":[0.01,0.01]}],\"uncertainty\":\"...\","
       "\"independent_validation\":\"...\",\"operational_safety\":\"...\"}. "
       "Do not invent sensor values or take physical valve actions."
    )
    return [{"role":"system","content":"You are an inexpensive, fallible tool-using coordinator. Use observed evidence, not intuition. Select and invoke tools. Never invent test results."},
      {"role":"user","content":json.dumps({"task":problem,"benchmark":visible["benchmark"],
         "data_type":visible["measurement_type"],
         "available_tools":runtime.TOOLS,"sensor_count":len(visible["sensors"]),
         "public_file_hash":(OUT/"input-sha256.txt").read_text().strip()})}]

def main():
    prior_file=OUT/"trial.json"
    original_bytes=prior_file.read_bytes()
    trial=json.loads(original_bytes)
    visible=json.loads((OUT/"observations.json").read_text())
    check_original(original_bytes,trial,visible)
    messages=initial_messages(visible)
    total=0
    for i,(call,event) in enumerate(zip(trial["calls"],trial["tool_events"])):
        decision=json.loads(call["response_content"])
        if decision.get("type")!="tool" or decision.get("name")!=event["name"] or decision.get("arguments")!=event["args"]:
            raise RuntimeError("PRIOR_DECISION_TOOL_MISMATCH")
        messages.append({"role":"assistant","content":call["response_content"]})
        total+=int(call["usage"]["total_tokens"])
        messages.append({"role":"user","content":json.dumps({
           "tool_name":event["name"],"actual_tool_result":event["result"],
           "remaining_provider_token_budget":max(0,75000-total),
           "instruction":"Choose your next action based on these results. No fixed turn limit. Avoid redundant experiments, submit a ranked result when the evidence justifies one."})})
    # Persistence preserves the exact historical trial as a distinct file.
    (OUT/"trial-before-continuation.json").write_bytes(original_bytes)
    live.audit=trial
    live.events=trial["audit_events"]
    live.previous=trial["audit_head"]
    live.TOKEN_COUNT=total
    live.MAX_TOTAL_TOKENS=NEW_TOTAL_TOKEN_CEILING
    live.audit["original_trial_sha256"]=ORIGINAL_TRIAL_SHA256
    live.audit["prior_compute_tokens"]=total
    live.audit["continuation_budget_provider_tokens"]=NEW_TOTAL_TOKEN_CEILING
    live.audit["prior_status"]=trial["status"]
    live.audit["status"]="continuing"
    live.record({"kind":"BUDGET_EXTENSION","prior_total_tokens":total,
                 "new_total_token_ceiling":NEW_TOTAL_TOKEN_CEILING,
                 "original_trial_sha256":ORIGINAL_TRIAL_SHA256,
                 "reason":"USER_REQUESTED_CONTINUATION; NO_CHANGE_TO_OBSERVATIONS_OR_VERIFIER"})
    # A factual budget notice, not a diagnosis or suggested answer.
    messages.append({"role":"user","content":json.dumps({
       "execution_notice":"The compute budget has been extended from 75000 to 100000 provider tokens to continue the SAME unresolved benchmark. All prior observed tool outputs and your 15 model decisions are preserved. There are no changes to data, tools, or correctness criteria.",
       "remaining_provider_token_budget":NEW_TOTAL_TOKEN_CEILING-total,
       "instruction":"Continue your investigation or submit the best-supported result based on the available evidence, as you decide. No answer-key information is available."})})
    # Recover the old tool's cached computational library. No Kimi call, no hidden-key use.
    runtime.execute("scan_single_leaks",{})
    full=runtime.execute("fit_two_leaks",{})
    if full.get("hypotheses_examined")!=len(runtime.JUNCTIONS)*(len(runtime.JUNCTIONS)-1)//2:
        raise RuntimeError("FULL_CANDIDATE_TOOL_REHYDRATION_FAILED")
    live.record({"kind":"TOOL_CACHE_REHYDRATED","pair_count":full["hypotheses_examined"]})
    live.persist()
    turn=len(live.audit["calls"])
    while True:
        if live.TOKEN_COUNT>=NEW_TOTAL_TOKEN_CEILING:
            live.audit["status"]="MODEL_TOKEN_BUDGET"
            live.record({"kind":"STOP","reason":live.audit["status"]})
            break
        turn+=1
        try:
            raw=live.call_kimi(messages)
            decision=json.loads(raw)
            if not isinstance(decision,dict):
                raise ValueError("INVALID_JSON_OBJECT")
        except Exception as e:
            live.audit["status"]="MODEL_TOKEN_BUDGET" if str(e)=="MODEL_TOKEN_BUDGET" else "MODEL_OR_JSON_FAILURE"
            live.audit["error_kind"]=type(e).__name__
            live.record({"kind":"STOP","reason":live.audit["status"]})
            break
        messages.append({"role":"assistant","content":raw})
        if decision.get("type")=="final":
            live.audit["final"]=decision
            live.audit["status"]="submitted"
            live.record({"kind":"FINAL_SUBMISSION","submission_sha256":live.sha(json.dumps(decision,sort_keys=True))})
            break
        if decision.get("type")!="tool":
            live.audit["status"]="INVALID_DECISION_TYPE"
            live.record({"kind":"STOP","reason":live.audit["status"]})
            break
        name=decision.get("name")
        if not isinstance(name,str):
            name=""
        args=decision.get("arguments",{})
        t0=time.monotonic()
        result=runtime.execute(name,args)
        duration=round(time.monotonic()-t0,3)
        t={"turn":turn,"name":name,"args":args,"why":decision.get("why"),
           "result":result,"duration_seconds":duration,
           "result_sha256":live.sha(json.dumps(result,sort_keys=True))}
        live.audit["tool_events"].append(t)
        live.record({"kind":"TOOL_EXECUTION","name":name,"turn":turn,"duration":duration,
                    "result_sha256":t["result_sha256"],"error":result.get("error")})
        live.persist()
        messages.append({"role":"user","content":json.dumps({"tool_name":name,
             "actual_tool_result":result,
             "remaining_provider_token_budget":max(0,NEW_TOTAL_TOKEN_CEILING-live.TOKEN_COUNT),
             "instruction":"Choose your next action based on these results. No fixed turn limit. Avoid redundant experiments, submit a ranked result when the evidence justifies one."})})
    live.audit["total_provider_tokens"]=live.TOKEN_COUNT
    live.persist()
    print("AAU_NET3_CONTINUED="+json.dumps({"status":live.audit["status"],
          "prior_calls":15,"total_calls":len(live.audit["calls"]),
          "new_calls":len(live.audit["calls"])-15,
          "total_tool_calls":len(live.audit["tool_events"]),
          "total_provider_tokens":live.TOKEN_COUNT,
          "submission":live.audit["final"],"audit_head":live.audit["audit_head"]}))
    if not live.audit["final"]:
        raise RuntimeError(live.audit["status"])

if __name__=="__main__":
    main()
