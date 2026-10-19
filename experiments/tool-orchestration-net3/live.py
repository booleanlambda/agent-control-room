"""One bounded live Kimi trial. Real Moonshot calls direct genuine EPA hydraulic tools.
No retries, no leaked ground truth, no model-owned verifier, raw responses preserved.
"""
import hashlib
import json
import os
import time
import urllib.request
from pathlib import Path
from prepare import OUT
from tools_runtime import TOOLS, execute

MODEL="kimi-k2.6"
MAX_TOTAL_TOKENS=75000
MAX_OUTPUT_TOKENS=4096
TOKEN_COUNT=0
events=[]
previous="0"*64
audit={"model":MODEL,"mode":"thinking_off","max_per_call_output_tokens":MAX_OUTPUT_TOKENS,
       "tool_contract":TOOLS,"budget_provider_tokens":MAX_TOTAL_TOKENS,"max_model_calls":None,"calls":[],
       "tool_events":[],"status":"started","final":None}
def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()
def record(e):
    global previous
    data=json.dumps(e,sort_keys=True,separators=(",",":"))
    h=sha(previous+data)
    events.append({"previous":previous,"event":e,"hash":h})
    previous=h
def persist():
    audit["audit_events"]=events
    audit["audit_head"]=previous
    (OUT/"trial.json").write_text(json.dumps(audit,indent=2))
def call_kimi(messages):
    global TOKEN_COUNT
    key=os.environ.get("MOONSHOT_API_KEY","").strip()
    if not key:
        raise RuntimeError("PROVIDER_SECRET_MISSING")
    # A financial compute cap, not a fixed model-turn count. Reserve context + output.
    approx_input_tokens=(len(json.dumps(messages))+2)//3
    available=MAX_TOTAL_TOKENS-TOKEN_COUNT-approx_input_tokens
    if available<512:
        raise RuntimeError("MODEL_TOKEN_BUDGET")
    output_limit=min(MAX_OUTPUT_TOKENS,available)
    body=json.dumps({"model":MODEL,"thinking":{"type":"disabled"},"temperature":0.6,
                     "response_format":{"type":"json_object"},"max_tokens":output_limit,
                     "stream":False,"messages":messages}).encode()
    req=urllib.request.Request("https://api.moonshot.ai/v1/chat/completions",
         data=body,headers={"Authorization":"Bearer "+key,
                            "Content-Type":"application/json","Accept":"application/json"},
         method="POST")
    with urllib.request.urlopen(req,timeout=100) as resp:
        data=json.load(resp)
    c=data.get("choices",[{}])[0]
    raw=c.get("message",{}).get("content","")
    usage=data.get("usage",{})
    TOKEN_COUNT+=int(usage.get("total_tokens") or 0)
    receipt={"call":len(audit["calls"])+1,"finish_reason":c.get("finish_reason"),
             "model":data.get("model",MODEL),"usage":usage,
             "response_content":raw,"response_sha256":sha(raw),
             "raw_message_hash":sha(json.dumps(c.get("message",{}),sort_keys=True))}
    audit["calls"].append(receipt)
    record({"kind":"MODEL_RESPONSE","call":receipt["call"],
            "hash":receipt["response_sha256"],"tokens":usage.get("total_tokens"),
            "finish":receipt["finish_reason"]})
    persist()
    if c.get("finish_reason")!="stop":
        raise RuntimeError("PROVIDER_FINISH_NOT_STOP")
    return raw
def main():
    visible=json.loads((OUT/"observations.json").read_text())
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
    messages=[{"role":"system","content":"You are an inexpensive, fallible tool-using coordinator. Use observed evidence, not intuition. Select and invoke tools. Never invent test results."},
      {"role":"user","content":json.dumps({"task":problem,"benchmark":visible["benchmark"],
         "data_type":visible["measurement_type"],
         "available_tools":TOOLS,"sensor_count":len(visible["sensors"]),
         "public_file_hash":(OUT/"input-sha256.txt").read_text().strip()})}]
    record({"kind":"START","measurement_sha256":sha(json.dumps(visible,sort_keys=True)),"available_tools":[t["name"] for t in TOOLS]})
    persist()
    turn=0
    while True:
        if TOKEN_COUNT>=MAX_TOTAL_TOKENS:
            audit["status"]="MODEL_TOKEN_BUDGET"
            record({"kind":"STOP","reason":audit["status"]})
            break
        turn+=1
        try:
            raw=call_kimi(messages)
            decision=json.loads(raw)
            if not isinstance(decision,dict): raise ValueError("INVALID_JSON_OBJECT")
        except Exception as e:
            audit["status"]="MODEL_TOKEN_BUDGET" if str(e)=="MODEL_TOKEN_BUDGET" else "MODEL_OR_JSON_FAILURE"
            audit["error_kind"]=type(e).__name__
            record({"kind":"STOP","reason":audit["status"]});break
        messages.append({"role":"assistant","content":raw})
        if decision.get("type")=="final":
            audit["final"]=decision
            audit["status"]="submitted"
            record({"kind":"FINAL_SUBMISSION","submission_sha256":sha(json.dumps(decision,sort_keys=True))})
            break
        if decision.get("type")!="tool":
            audit["status"]="INVALID_DECISION_TYPE"
            record({"kind":"STOP","reason":audit["status"]});break
        name=decision.get("name")
        if not isinstance(name,str):name=""
        args=decision.get("arguments",{})
        start=time.monotonic()
        result=execute(name,args)
        duration=round(time.monotonic()-start,3)
        t={"turn":turn,"name":name,"args":args,"why":decision.get("why"),
           "result":result,"duration_seconds":duration,"result_sha256":sha(json.dumps(result,sort_keys=True))}
        audit["tool_events"].append(t)
        record({"kind":"TOOL_EXECUTION","name":name,"turn":turn,"duration":duration,
                "result_sha256":t["result_sha256"],"error":result.get("error")})
        persist()
        messages.append({"role":"user","content":json.dumps({"tool_name":name,
               "actual_tool_result":result,
               "remaining_provider_token_budget":max(0,MAX_TOTAL_TOKENS-TOKEN_COUNT),
               "instruction":"Choose your next action based on these results. No fixed turn limit. Avoid redundant experiments, submit a ranked result when the evidence justifies one."})})
    audit["total_provider_tokens"]=TOKEN_COUNT
    persist()
    print("AAU_NET3_LIVE="+json.dumps({"status":audit["status"],
      "model_calls":len(audit["calls"]),"tool_calls":len(audit["tool_events"]),
      "provider_tokens":TOKEN_COUNT,
      "tools_used":[t["name"] for t in audit["tool_events"]],
      "final_sha":sha(json.dumps(audit["final"],sort_keys=True)) if audit["final"] else None,
      "audit_head":audit["audit_head"]}))
    if not audit["final"]:
        raise RuntimeError(audit["status"])
if __name__=="__main__":
    try:
        main()
    except Exception:
        persist()
        raise
