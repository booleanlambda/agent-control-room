#!/usr/bin/env python3
"""Check actual Kimi K3 thinking-off support; do not substitute low reasoning."""
import os,json,time,pathlib,urllib.request,urllib.error,sys
E=pathlib.Path(__file__).resolve().parent/"evidence_k3_off"
E.mkdir(exist_ok=True)
def save(x):(E/"compatibility.json").write_text(json.dumps(x,indent=2)+"\n")
def check(label,params):
 key=os.environ.get("MOONSHOT_API_KEY","").strip()
 if not key:return {"protocol":label,"status":"NO_MOONSHOT_KEY"}
 payload={"model":"kimi-k3","messages":[{"role":"user","content":"Reply exactly OK."}],
          "max_tokens":128,"stream":False,**params}
 req=urllib.request.Request("https://api.moonshot.ai/v1/chat/completions",
       data=json.dumps(payload).encode(),method="POST",
       headers={"Content-Type":"application/json","Authorization":"Bearer "+key})
 start=time.monotonic()
 try:
  with urllib.request.urlopen(req,timeout=120) as response:
   result=json.load(response)
  choice=(result.get("choices") or [{}])[0]
  m=choice.get("message") or {}
  reasoning=m.get("reasoning_content") or ""
  reasoning_tokens=((result.get("usage") or {}).get("completion_tokens_details") or {}).get("reasoning_tokens")
  verified=(result.get("model")=="kimi-k3" and choice.get("finish_reason")=="stop"
   and bool(m.get("content")) and not reasoning and reasoning_tokens in (None,0))
  return {"protocol":label,"status":"HTTP_OK","model_returned":result.get("model"),
     "finish_reason":choice.get("finish_reason"),"reasoning_chars":len(reasoning),
     "reasoning_tokens":reasoning_tokens,"thinking_off_verified":verified,
     "elapsed":round(time.monotonic()-start,2)}
 except urllib.error.HTTPError as exc:
  raw=exc.read(1200).decode("utf8","replace")
  return {"protocol":label,"status":"HTTP_REJECTED","http_status":exc.code,
    "sanitized_provider_error":raw[:800],"elapsed":round(time.monotonic()-start,2)}
 except Exception as exc:
  return {"protocol":label,"status":"REQUEST_FAILED","error_kind":type(exc).__name__,
     "sanitized_error":str(exc)[:150],"elapsed":round(time.monotonic()-start,2)}
def bedrock():
 access=os.environ.get("AWS_ACCESS_KEY_ID","")
 secret=os.environ.get("AWS_SECRET_ACCESS_KEY","")
 api_key=os.environ.get("AWS_BEDROCK_API_KEY","")
 if not ((access and secret) or api_key):
  return {"protocol":"aws_bedrock_reasoning_none","status":"NO_CONFIGURED_AWS_CREDENTIALS"}
 start=time.monotonic()
 try:
  payload={"messages":[{"role":"user","content":"Reply exactly OK."}],
      "max_tokens":128,"reasoning_effort":"none"}
  if access and secret:
   import boto3
   client=boto3.client("bedrock-runtime",region_name="us-east-1")
   resp=client.invoke_model(modelId="us.moonshotai.kimi-k3",
       contentType="application/json",body=json.dumps(payload))
   out=json.loads(resp["body"].read())
  else:
   req=urllib.request.Request("https://bedrock-runtime.us-east-1.amazonaws.com/openai/v1/chat/completions",
     data=json.dumps({"model":"us.moonshotai.kimi-k3",**payload}).encode(),
     method="POST",headers={"Authorization":"Bearer "+api_key,"Content-Type":"application/json"})
   with urllib.request.urlopen(req,timeout=120) as response:out=json.load(response)
  choice=(out.get("choices") or [{}])[0]
  m=choice.get("message") or {}
  details=((out.get("usage") or {}).get("completion_tokens_details") or {})
  return {"protocol":"aws_bedrock_reasoning_none","status":"HTTP_OK",
   "model_returned":out.get("model"),"finish_reason":choice.get("finish_reason"),
   "reasoning_chars":len(m.get("reasoning_content") or ""),"reasoning_tokens":details.get("reasoning_tokens"),
   "thinking_off_verified":bool(m.get("content")) and not m.get("reasoning_content") and details.get("reasoning_tokens") in (None,0),
   "elapsed":round(time.monotonic()-start,2)}
 except Exception as exc:
  return {"protocol":"aws_bedrock_reasoning_none","status":"REJECTED_OR_UNAVAILABLE",
    "error_kind":type(exc).__name__,"sanitized_error":str(exc)[:160],
    "elapsed":round(time.monotonic()-start,2)}
def main():
 result={"model":"kimi-k3","requested":"thinking off","stage2_authorized":False,"probes":[]}
 for name,settings in [
  ("moonshot_thinking_disabled",{"thinking":{"type":"disabled"}}),
  ("moonshot_reasoning_effort_none",{"reasoning_effort":"none"})
 ]:
  probe=check(name,settings);result["probes"].append(probe);save(result)
  if probe.get("thinking_off_verified"):break
 if not any(p.get("thinking_off_verified") for p in result["probes"]):
  result["probes"].append(bedrock())
 result["status"]="OFF_AVAILABLE" if any(p.get("thinking_off_verified") for p in result["probes"]) else "OFF_UNAVAILABLE_WITH_CONFIGURED_ACCESS"
 save(result)
 print("AAU_K3_OFF_COMPATIBILITY="+json.dumps(result),flush=True)
 return 0
if __name__=="__main__":sys.exit(main())
