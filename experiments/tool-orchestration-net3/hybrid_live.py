"""Fresh AAU hybrid benchmark: Kimi thinking OFF operates hydraulic tools;
Kimi thinking ON assesses evidence only at deterministic event checkpoints.
Independent hidden truth is never imported into this process.
This is NOT a replay of a prior 15/18-turn experiment.
"""
import hashlib
import json
import math
import os
import time
import urllib.error
import urllib.request

from prepare import OUT
from tools_runtime import TOOLS, execute

MODEL="kimi-k2.6"
TOTAL_PROVIDER_TOKEN_BUDGET=100000
MAX_OFF_OUTPUT=4096
MAX_ON_OUTPUT=32768
MODEL_CALL_TIMEOUT_S={"off":180,"on":600}
QUALITY_THRESHOLD_M=0.001  # 1mm tolerance for noiseless 5dp synthetic pressures
PLATEAU_ACTIONS=4
BUDGET_REVIEW_FRACTION=0.70

prior="0"*64
events=[]
tokens=0
off_messages=[]
actual_actions=[]
evaluations=[]
seen_args=set()
best_rmse=None
stagnation=0
bad_actions=0
last_review_action_index=-999
reviewed_quality_levels=set()
budget_review_done=False
last_review_topic=""
audit={
 "model":MODEL,"mode":"hybrid_off_operate_on_verify",
 "off_completion_max_tokens":MAX_OFF_OUTPUT,
 "on_completion_max_tokens":MAX_ON_OUTPUT,
 "provider_token_budget":TOTAL_PROVIDER_TOKEN_BUDGET,
 "checkpoint_config":{"quality_rmse_m":QUALITY_THRESHOLD_M,"plateau_tools":PLATEAU_ACTIONS,
                       "budget_fraction":BUDGET_REVIEW_FRACTION,
                       "invalid_or_duplicate_actions":2},
 "model_calls":[],"calls":[],"tool_events":[],"reviews":[],
 "final":None,"status":"started"}

def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()

def record(obj):
    global prior
    h=sha(prior+json.dumps(obj,sort_keys=True,separators=(",",":")))
    events.append({"previous":prior,"event":obj,"hash":h})
    prior=h

def persist():
    audit["audit_events"]=events
    audit["audit_head"]=prior
    audit["total_provider_tokens"]=tokens
    (OUT/"trial.json").write_text(json.dumps(audit,indent=2))

def request(messages, mode):
    """All provider calls are live, thinking modes in native Moonshot API."""
    global tokens
    key=os.environ.get("MOONSHOT_API_KEY","").strip()
    if not key:
        raise RuntimeError("PROVIDER_SECRET_MISSING")
    allowance=TOTAL_PROVIDER_TOKEN_BUDGET-tokens
    # Conservative input accounting: prior 3-chars/token guess under-reserved.
    # Keep a non-spendable 2048-token buffer, and a full reasoning-output allowance.
    estimate_input=max(2048,(len(json.dumps(messages,ensure_ascii=False))+1)//2)
    max_out=min(MAX_OFF_OUTPUT if mode=="off" else MAX_ON_OUTPUT,
                allowance-estimate_input-2048)
    if (mode=="on" and max_out<12000) or (mode=="off" and max_out<512):
        raise RuntimeError("MODEL_TOKEN_BUDGET")
    payload={
       "model":MODEL,
       "thinking":{"type":"enabled" if mode=="on" else "disabled"},
       "temperature":1.0 if mode=="on" else 0.6,
       "response_format":{"type":"json_object"},
       "max_tokens":max_out,"stream":False,"messages":messages}
    req=urllib.request.Request("https://api.moonshot.ai/v1/chat/completions",
      data=json.dumps(payload).encode(),
      headers={"Authorization":"Bearer "+key,
               "Content-Type":"application/json","Accept":"application/json"},
      method="POST")
    try:
        with urllib.request.urlopen(req,timeout=MODEL_CALL_TIMEOUT_S[mode]) as resp:
            data=json.load(resp)
    except Exception as e:
        record({"kind":"PROVIDER_ERROR","mode":mode,"error_class":type(e).__name__,
                "http_code":getattr(e,"code",None)})
        persist()
        raise
    c=data.get("choices",[{}])[0]
    message=c.get("message",{})
    raw=message.get("content") or ""
    usage=data.get("usage",{})
    n=int(usage.get("total_tokens") or 0)
    tokens+=n
    receipt={
       "call":len(audit["model_calls"])+1,"mode":mode,
       "finish_reason":c.get("finish_reason"),
       "response_content":raw,"response_sha256":sha(raw),
       "raw_message_hash":sha(json.dumps(message,sort_keys=True)),
       "reasoning_content_sha256":sha(message.get("reasoning_content") or ""),
       "reasoning_tokens":(usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
       "usage":usage,"model":data.get("model",MODEL),
       "max_tokens_requested":max_out}
    audit["model_calls"].append(receipt)
    audit["calls"].append(receipt)  # Compatible with the unchanged independent verifier.
    record({"kind":"MODEL_RESPONSE","mode":mode,"call":receipt["call"],
            "response_sha256":receipt["response_sha256"],"tokens":n,
            "reasoning_tokens":receipt["reasoning_tokens"],
            "finish_reason":receipt["finish_reason"]})
    persist()
    if c.get("finish_reason")!="stop":
        raise RuntimeError("PROVIDER_FINISH_NOT_STOP")
    try:
        result=json.loads(raw)
        if not isinstance(result,dict):
            raise ValueError("ROOT_NOT_OBJECT")
        return result,raw
    except Exception:
        record({"kind":"INVALID_MODEL_JSON","mode":mode,"response_sha256":sha(raw)})
        persist()
        raise

def best_evidence():
    valid=[x for x in evaluations if isinstance(x.get("rmse"),(int,float))
           and math.isfinite(x["rmse"]) and x["rmse"]>=0]
    return sorted(valid,key=lambda x:x["rmse"])[:12]

def quality_candidate():
    """Only actual executed nonlinear EPANET results are eligible."""
    return next((x for x in best_evidence() if x["tool"]=="optimize_pair" and x["rmse"]<=QUALITY_THRESHOLD_M),None)

def confirmation(candidate):
    if candidate is None:
        return None
    for e in evaluations:
        if e["tool"]!="simulate_pair" or e["tool_turn"]==candidate["tool_turn"]:
            continue
        if set(e["nodes"])!=set(candidate["nodes"]):
            continue
        # Results must be computed for the candidate's actual fitted parameters.
        expected={str(n):float(c) for n,c in zip(candidate["nodes"],candidate["coefficients"])}
        actual={str(n):float(c) for n,c in zip(e["nodes"],e["coefficients"])}
        if any(abs(expected[n]-actual[n])>1e-6 for n in expected):
            continue
        if e["rmse"]<=QUALITY_THRESHOLD_M:
            return e
    return None

def quality_level():
    q=quality_candidate()
    if q is None:
        return 0
    return 2 if confirmation(q) else 1

def reviewed_evidence():
    return {
      "best_full_epanet_results":best_evidence(),
      "very_low_error_candidate":quality_candidate(),
      "separate_full_epanet_confirmation":confirmation(quality_candidate()),
      "measurement_precision":"0.00001 m pressure rounding, synthetic and noise-free",
      "quality_threshold_m":QUALITY_THRESHOLD_M,
      "total_tool_actions":len(audit["tool_events"]),
      "all_pair_search_executed":any(t["name"]=="fit_two_leaks" and
                                    t["result"].get("hypotheses_examined")==4186
                                    for t in audit["tool_events"]),
      "all_pair_search_summaries":[{
            "turn":t["turn"],
            "hypotheses_examined":t["result"].get("hypotheses_examined"),
            "top_pairs":t["result"].get("top_pairs",[])[:25]}
            for t in audit["tool_events"]
            if t["name"]=="fit_two_leaks" and t["result"].get("hypotheses_examined")==4186][-2:],
      "all_distinct_tested_pairs":[list(sorted(x["nodes"])) for x in best_evidence()],
      "last_6_tool_actions":[{"turn":x["turn"],"name":x["name"],"args":x["args"],
         "result":x["result"],"sha256":x["result_sha256"]}
          for x in audit["tool_events"][-6:]],
      "remaining_compute_tokens":TOTAL_PROVIDER_TOKEN_BUDGET-tokens,
      "actual_provider_tokens_so_far":tokens}

def tool_step(decision):
    global stagnation,bad_actions,best_rmse
    name=decision.get("name","")
    args=decision.get("arguments",{})
    duplicate_key=json.dumps({"name":name,"arguments":args},sort_keys=True)
    repeated=duplicate_key in seen_args
    seen_args.add(duplicate_key)
    t0=time.monotonic()
    output=execute(name,args)
    duration=round(time.monotonic()-t0,3)
    tool_rec={"turn":len(audit["tool_events"])+1,"name":name,"args":args,
           "why":decision.get("why",""),"result":output,
           "duration_seconds":duration,
           "result_sha256":sha(json.dumps(output,sort_keys=True))}
    audit["tool_events"].append(tool_rec)
    record({"kind":"TOOL_EXECUTION","mode":"off","turn":tool_rec["turn"],
            "name":name,"duration_s":duration,"result_sha256":tool_rec["result_sha256"],
            "error":output.get("error") if isinstance(output,dict) else None,
            "identical_replay":repeated})
    if not isinstance(output,dict):
        raise RuntimeError("INVALID_TOOL_OUTPUT")
    if output.get("error") or repeated:
        bad_actions+=1
    else:
        bad_actions=0
    curr=output.get("full_simulation_rmse_m")
    if name in ("optimize_pair","simulate_pair") and isinstance(curr,(int,float)) and math.isfinite(curr):
        nodes=output.get("nodes",[])
        coefficients=output.get("fitted_coefficients",output.get("coefficients",[]))
        if len(nodes)==2 and len(coefficients)==2:
            evaluations.append({"nodes":nodes,"coefficients":coefficients,
               "rmse":float(curr),"tool":name,"tool_turn":tool_rec["turn"],
               "tool_result_sha256":tool_rec["result_sha256"]})
            if best_rmse is None or curr < best_rmse*0.9:
                stagnation=0
            else:
                stagnation+=1
            best_rmse=min(best_rmse,float(curr)) if best_rmse is not None else float(curr)
    elif not output.get("error"):
        stagnation+=1
    persist()
    return output

def checkpoint(final_proposal=False):
    global budget_review_done
    if final_proposal:
        return "OFF_PROPOSED_FINAL"
    level=quality_level()
    if level>0 and level not in reviewed_quality_levels:
        return "FIRST_STRONG_FIT" if level==1 else "CONFIRMATION_COMPLETE"
    if bad_actions>=2 and len(audit["tool_events"])-last_review_action_index>=2:
        return "REPEATED_INVALID_OR_DUPLICATE_TOOLS"
    if best_rmse is not None and stagnation>=PLATEAU_ACTIONS and len(audit["tool_events"])-last_review_action_index>=4:
        return "SUSTAINED_NO_IMPROVEMENT"
    if tokens>=TOTAL_PROVIDER_TOKEN_BUDGET*BUDGET_REVIEW_FRACTION and not budget_review_done:
        budget_review_done=True
        return "BUDGET_RESERVE_CHECK"
    return None

def on_review(trigger, proposed=None):
    global last_review_action_index,stagnation,bad_actions,last_review_topic
    last_review_action_index=len(audit["tool_events"])
    last_review_topic=trigger
    level=quality_level()
    if level:
        reviewed_quality_levels.add(level)
    envelope={
      "role":"verifier","trigger":trigger,
      "scope":"Same fresh benchmark, hidden ground truth never supplied",
      "proposal_from_thinking_off":proposed,
      "measured_evidence":reviewed_evidence(),
      "tools_available_for_further_work":TOOLS,
      "operator_may_resume":True}
    on_messages=[
      {"role":"system","content":(
        "You are Kimi thinking ON, AAU's independent skeptical evidence reviewer. "
        "The thinking-OFF coordinator has run genuine EPA Net3 tools. Only inspect the "
        "tool evidence in the next message. You have no answer key, and no license to invent "
        "tool results. You may approve a final answer ONLY if a full nonlinear EPANET fit "
        "has RMSE <= 0.001 m AND a distinct simulate_pair invocation confirms exactly that "
        "pair at the same coefficients with RMSE <= 0.001 m. "
        "Otherwise request targeted additional tools, or abstain. "
        "Do not launch tools yourself, don't keep verifying without articulating a "
        "material question. The all-junction screening tool is exhaustive; if its "
        "hypotheses_examined equals 4186 do NOT recommend running the same broad "
        "screen again unless you identify a distinct new reason. Recommend targeted "
        "untested junction pairs with exact tool arguments when remediation is needed. "
        "JSON ONLY: "
        "{\"decision\":\"accept|remediate|abstain\","
        "\"ranked_pairs\":[{\"nodes\":[\"a\",\"b\"],\"coefficients\":[0.01,0.01]}],"
        "\"next_action\":\"a specific tool and its arguments, if remediation\","
        "\"why\":\"brief evidence-grounded justification\","
        "\"confidence\":\"...\","
        "\"operational_safety\":\"synthetic benchmark only\"}.")},
      {"role":"user","content":json.dumps(envelope)}]
    response,raw=request(on_messages,"on")
    choice=response.get("decision")
    approved=False
    error=None
    candidate=quality_candidate()
    confirm=confirmation(candidate)
    if choice=="accept":
        pairs=response.get("ranked_pairs")
        actual=pairs[0] if isinstance(pairs,list) and pairs and isinstance(pairs[0],dict) else {}
        predicted=actual.get("nodes",[])
        if not candidate or not confirm:
            error="NO_INDEPENDENT_QUALITY_CONFIRMATION"
        elif not isinstance(predicted,list) or set(predicted)!=set(candidate["nodes"]):
            error="REVIEWER_SUBMITTED_UNSUPPORTED_PAIR"
        else:
            approved=True
    review={"review_number":len(audit["reviews"])+1,
        "trigger":trigger,"operator_proposal":proposed,
        "on_call":audit["model_calls"][-1]["call"],"decision":response,
        "authorized_acceptance":approved,"gate_error":error,
        "evidence_stage":quality_level(),"best_pair":candidate,
        "confirmation":confirm}
    audit["reviews"].append(review)
    record({"kind":"THINKING_ON_VERIFICATION","trigger":trigger,
            "decision":choice,"authorized_acceptance":approved,"gate_error":error,
            "call":review["on_call"],
            "verdict_sha256":sha(json.dumps(response,sort_keys=True))})
    stagnation=0
    bad_actions=0
    persist()
    if approved:
        final={"type":"final","ranked_pairs":response["ranked_pairs"],
             "uncertainty":response.get("confidence",""),
             "independent_validation":response.get("why",""),
             "operational_safety":response.get("operational_safety",""),
             "authored_by":"Kimi thinking ON after Kimi thinking OFF tool-directed evidence",
             "verification_trigger":trigger}
        audit["final"]=final
        audit["status"]="submitted"
        record({"kind":"FINAL_SUBMISSION","authored_by":"thinking_on",
            "submission_sha256":sha(json.dumps(final,sort_keys=True))})
        persist()
        return True
    off_messages.append({"role":"user","content":json.dumps({
       "evidence_review_trigger":trigger,
       "reviewer_decision":response,
       "gate_rejection":error,
       "instruction":"Continue independently with the specific missing evidence, or propose your best supported answer. Never claim a calculation you have not performed.",
       "remaining_provider_tokens":max(0,TOTAL_PROVIDER_TOKEN_BUDGET-tokens)})})
    return False

def compact_off_context():
    """Explicitly compact long model-context history without discarding forensic receipts.
    No data is silently truncated: old actions remain in trial.json and a deterministic
    ledger of all tool calls is supplied with every compacted request.
    """
    global off_messages
    if len(off_messages)<=18:
        return
    old=off_messages
    original_hash=sha(json.dumps(old,sort_keys=True))
    ledger=[]
    for t in audit["tool_events"]:
        r=t["result"]
        entry={"turn":t["turn"],"tool":t["name"],"arguments":t["args"],
               "error":r.get("error"),"nonlinear_rmse_m":r.get("full_simulation_rmse_m"),
               "nodes":r.get("nodes"),
               "coefficients":r.get("fitted_coefficients",r.get("coefficients"))}
        if t["name"]=="fit_two_leaks" and r.get("hypotheses_examined"):
            entry["all_pairs_screened"]=r["hypotheses_examined"]
            entry["ranked_candidates"]=r.get("top_pairs",[])[:15]
        ledger.append(entry)
    summary={"history_compaction":"EXPLICIT_AUDITED_RECAP",
             "every_prior_tool_action":ledger,
             "all_past_full_epanet_results":best_evidence(),
             "all_prior_review_decisions":[{
                "trigger":r["trigger"],"decision":r["decision"],
                "accepted":r["authorized_acceptance"]} for r in audit["reviews"]],
             "full_original_raw_transcript_preserved_in_trial_json":True,
             "prior_context_sha256":original_hash}
    off_messages=old[:2]+[{"role":"user","content":json.dumps(summary)}]+old[-10:]
    record({"kind":"CONTEXT_COMPACTED","model_mode":"off",
            "before_sha256":original_hash,
            "original_message_count":len(old),"replayed_recent_messages":10,
            "recap_includes_all_tool_receipts":len(ledger),
            "new_context_sha256":sha(json.dumps(off_messages,sort_keys=True))})
    persist()

def main():
    global off_messages
    visible=json.loads((OUT/"observations.json").read_text())
    prompt=(
      "This is a controlled EPA EPANET Net3 water-network benchmark (not a real water utility). "
      "Two independently simulated leak emitters changed pressure at fourteen sensors. "
      "Using only the computational tools listed below, identify the most likely pair "
      "of leak junctions and estimate strengths. You are NOT given the answer key. "
      "Inspect actual synthetic observations, calculate hypotheses, verify your proposed "
      "pair with full EPANET hydraulics, and then submit. No physical valve actions. "
      "Decide which tools to use and in what order. No arbitrary model turn ceiling; "
      "the joint system budget is 100000 provider tokens shared with an independent "
      "thinking-ON evidence reviewer. "
      "On each turn output a JSON object for a tool call: "
      "{\"type\":\"tool\",\"name\":\"one listed tool\",\"arguments\":{},\"why\":\"brief justification\"}. "
      "Or propose final JSON: "
      "{\"type\":\"final\",\"ranked_pairs\":[{\"nodes\":[\"node1\",\"node2\"],"
      "\"coefficients\":[0.01,0.01]}],\"uncertainty\":\"...\","
      "\"independent_validation\":\"...\",\"operational_safety\":\"...\"}. "
      "Do not invent sensor values or claim to have run real hospital safety tests."
    )
    off_messages=[
      {"role":"system","content":"You are an inexpensive fallible tool-using problem solver. Choose tools and operate them based on measured evidence, not unsupported guesses. Independent reviewer may examine results at evidence checkpoints."},
      {"role":"user","content":json.dumps({
         "task":prompt,"benchmark":visible["benchmark"],
         "data_type":visible["measurement_type"],"available_tools":TOOLS,
         "sensor_count":len(visible["sensors"]),
         "public_file_hash":(OUT/"input-sha256.txt").read_text().strip()})}]
    record({"kind":"START","measurement_sha256":sha(json.dumps(visible,sort_keys=True)),
            "tool_names":[x["name"] for x in TOOLS],"budget":TOTAL_PROVIDER_TOKEN_BUDGET,
            "review_policy":audit["checkpoint_config"]})
    persist()
    while not audit["final"]:
        if tokens>=TOTAL_PROVIDER_TOKEN_BUDGET:
            audit["status"]="MODEL_TOKEN_BUDGET"
            record({"kind":"STOP","reason":audit["status"]})
            break
        try:
            compact_off_context()
            decision,raw=request(off_messages,"off")
            off_messages.append({"role":"assistant","content":raw})
            if decision.get("type")=="tool":
                output=tool_step(decision)
                off_messages.append({"role":"user","content":json.dumps({
                    "tool_name":decision.get("name"),
                    "actual_tool_result":output,
                    "remaining_provider_token_budget":max(0,TOTAL_PROVIDER_TOKEN_BUDGET-tokens),
                    "instruction":"Based on measured tool evidence, select next action or propose final. A distinct independent simulation can corroborate optimized pair evidence."})})
                trigger=checkpoint()
            elif decision.get("type")=="final":
                trigger=checkpoint(final_proposal=True)
            else:
                record({"kind":"BAD_OFF_DECISION","response_sha256":sha(raw)})
                off_messages.append({"role":"user","content":"Invalid decision schema. Select a tool or a complete final proposal in JSON."})
                trigger=None
            if trigger:
                if on_review(trigger,decision if decision.get("type")=="final" else None):
                    break
        except Exception as e:
            audit["status"]="MODEL_TOKEN_BUDGET" if str(e)=="MODEL_TOKEN_BUDGET" else "MODEL_OR_RUNTIME_ERROR"
            audit["error_class"]=type(e).__name__
            record({"kind":"STOP","reason":audit["status"],"error_class":audit["error_class"]})
            break
    audit["total_provider_tokens"]=tokens
    persist()
    modes={"off":sum(c["mode"]=="off" for c in audit["model_calls"]),
           "on":sum(c["mode"]=="on" for c in audit["model_calls"])}
    total_reasoning=sum(int(c.get("reasoning_tokens") or 0) for c in audit["model_calls"])
    print("AAU_NET3_HYBRID="+json.dumps({
        "status":audit["status"],
        "off_calls":modes["off"],"on_calls":modes["on"],
        "reviews":[{"trigger":r["trigger"],
                    "decision":r["decision"].get("decision"),
                    "approved":r["authorized_acceptance"]} for r in audit["reviews"]],
        "tool_calls":len(audit["tool_events"]),
        "provider_tokens":tokens,"reasoning_tokens":total_reasoning,
        "final_pair":audit["final"]["ranked_pairs"][0]["nodes"] if audit["final"] else None,
        "audit_head":audit["audit_head"]}))
    if not audit["final"]:
        raise RuntimeError(audit["status"])

if __name__=="__main__":
    main()
