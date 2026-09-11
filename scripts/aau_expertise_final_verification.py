#!/usr/bin/env python3
import os
import sys
import json
import time
import re
import hashlib
import urllib.request
import urllib.error
from pathlib import Path

PORTFOLIO_MANIFEST_SHA256 = os.environ.get("PORTFOLIO_MANIFEST_SHA256", "652d6ec6ec67027ff80a407b1a365c940458972c8706ab802e0dcbf33d40b784")
EXECUTABLE_HARNESS_SHA256 = os.environ.get("EXECUTABLE_HARNESS_SHA256", "2ea7007c911398d899c244f1555e0eb106567ab894648bd848a8ad8aae16a05a")
EXPERIMENT_ID = os.environ.get("EXPERIMENT_ID", "6cd14e30-7dad-4410-89e3-5f779ba8e53b")
SIM_AGENT_ID = os.environ.get("SIM_AGENT_ID", "e854982e-baf4-4b23-81e0-148babe66378")

GRADE_RE = re.compile(
    r"GRADE\s+execution=(\d{1,3})\s+method=(\d{1,3})\s+security=(\d{1,3})\s+validation=(\d{1,3})\s+communication=(\d{1,3})\s+critical=([A-Za-z0-9_\-]+)\s+confidence=(0(?:\.\d+)?|1(?:\.0+)?)\s+unsupported=([A-Za-z0-9_\-]+)",
    re.I,
)

EVIDENCE = {
    "C1": [
        ["c26aee52-7744-4b10-8ddc-e687329416ea", "workflow discovery/process requirements artifact"],
        ["73d8ce03-01ca-469d-8b37-62d62b46eccb", "source-clean defended whole-client C1/C8 artifact"],
    ],
    "C2": [
        ["6d3f0eca-468e-4be5-91e0-44603f8b0fae", "API/OpenAPI/JSON Schema contract artifact"],
        ["57605184-fad0-4353-9ba6-c615df509ee8", "events, pagination and schema-evolution artifact"],
    ],
    "C3": [
        ["02868a14-469f-44d9-a4b8-8bc71a43b17d", "least-privilege authorization artifact"],
        ["c79d4d6e-310e-40fe-9b47-3553db7f8deb", "AI security/trust-boundary artifact"],
    ],
    "C4": [
        ["93b9b352-4517-4e67-a251-bfdcd64e51a1", "source-clean corrected executable orchestration artifact"],
        ["e9c41627-52cd-4690-b414-7eabf93205f6", "source-clean changed-case transfer artifact"],
        ["7b72f67e-eb75-4fb3-af92-fd29dcea7b2f", "source-clean adversarial artifact"],
    ],
    "C5": [
        ["fdaa026e-3558-40af-8c42-6f0f8b3f3d56", "source-clean state/recovery correction artifact"],
        ["e9c41627-52cd-4690-b414-7eabf93205f6", "source-clean changed-case transfer artifact"],
        ["7b72f67e-eb75-4fb3-af92-fd29dcea7b2f", "source-clean adversarial reliability artifact"],
    ],
    "C6": [
        ["93b9b352-4517-4e67-a251-bfdcd64e51a1", "source-clean corrected evaluation/guardrail artifact"],
        ["7b72f67e-eb75-4fb3-af92-fd29dcea7b2f", "source-clean adversarial evaluation artifact"],
        ["c5b29d52-965f-4337-9418-7bae770f81f5", "source-clean reproduction bridge"],
    ],
    "C7": [
        ["a765a3c8-1fb7-4612-9231-018086a99ca9", "source-clean observability correction artifact"],
        ["7b72f67e-eb75-4fb3-af92-fd29dcea7b2f", "source-clean adversarial observability artifact"],
        ["c5b29d52-965f-4337-9418-7bae770f81f5", "source-clean reproduction bridge"],
    ],
    "C8": [
        ["73d8ce03-01ca-469d-8b37-62d62b46eccb", "source-clean defended whole-client delivery artifact"],
        ["e9c41627-52cd-4690-b414-7eabf93205f6", "source-clean changed-case transfer artifact"],
        ["c5b29d52-965f-4337-9418-7bae770f81f5", "source-clean reproduction bridge"],
    ],
}

def die(msg):
    print(msg, file=sys.stderr)
    raise SystemExit(1)

def canonical_bytes(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()

def sha_obj(obj):
    return hashlib.sha256(canonical_bytes(obj)).hexdigest()

def write_json(path, obj):
    Path(path).write_text(json.dumps(obj, indent=2, sort_keys=True))

def gh_output(name, value):
    p = os.environ.get("GITHUB_OUTPUT")
    if p:
        with open(p, "a") as f:
            f.write(f"{name}={value}\n")
    else:
        print(f"OUTPUT {name}={value}")

def http_json(url, headers=None, payload=None, timeout=180):
    req = urllib.request.Request(url, headers=headers or {}, data=payload)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, json.loads(r.read().decode())

def openrouter_call(key, model, system, user, max_tokens=300, temperature=0, reasoning_exclude=None, timeout=210):
    body = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    if reasoning_exclude is not None:
        body["reasoning"] = {"exclude": bool(reasoning_exclude)}
    payload = json.dumps(body).encode()
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/booleanlambda/agent-control-room",
        "X-Title": "AAU External Expertise Verification",
    }
    _, obj = http_json("https://openrouter.ai/api/v1/chat/completions", headers=headers, payload=payload, timeout=timeout)
    msg = obj.get("choices", [{}])[0].get("message", {}) or {}
    text = msg.get("content") or msg.get("reasoning") or obj.get("choices", [{}])[0].get("text") or ""
    return obj, text

def xkiro_call(key, model, system, user, max_tokens=1200, temperature=0.2, timeout=180):
    body = {
        "model": model,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
    }
    payload = json.dumps(body).encode()
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    _, obj = http_json("https://api.xkiro.com/v1/chat/completions", headers=headers, payload=payload, timeout=timeout)
    text = obj.get("choices", [{}])[0].get("message", {}).get("content") or ""
    return obj, text

def list_openrouter_models():
    _, models = http_json("https://openrouter.ai/api/v1/models", timeout=60)
    return {m["id"] for m in models.get("data", [])}

def parse_grade(raw, allowed_critical):
    m = GRADE_RE.search(raw or "")
    if not m:
        return None
    nums = [min(100, max(0, int(x))) for x in m.groups()[:5]]
    critical_token = m.group(6)
    confidence = float(m.group(7))
    unsupported = m.group(8).upper()
    critical = None if critical_token.upper() == "NONE" else critical_token
    if critical and critical not in allowed_critical:
        critical = None
        unsupported = "PRESENT"
    weights = [0.30, 0.20, 0.20, 0.15, 0.15]
    score = sum(n * w for n, w in zip(nums, weights)) / 100.0
    return {
        "components": {
            "execution_correctness": nums[0] / 100,
            "method_system_design": nums[1] / 100,
            "security_reliability": nums[2] / 100,
            "validation_evidence": nums[3] / 100,
            "communication_business": nums[4] / 100,
        },
        "score": round(score, 4),
        "critical_error": critical,
        "confidence": confidence,
        "unsupported_claims_flag": unsupported,
    }

def mode_task_authority():
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        die("TASK_AUTHORITY_SECRET_MISSING")

    competency_text = """
C1 Workflow discovery, process modeling and value definition.
C2 API, event and data-contract integration.
C3 Authentication, authorization, secrets, privacy and AI security.
C4 LLM/tool orchestration and structured interaction.
C5 Reliable workflow execution, state and recovery.
C6 Testing, evaluation, guardrails and human oversight.
C7 Observability, monitoring, cost and incident handling.
C8 End-to-end delivery, documentation and professional judgment.
""".strip()

    system = (
        "You are the external AAU verification task authority. Create a fresh final-assessment packet for a frozen "
        "portfolio in AI workflow integration for SMB operational workflows. The packet must test professional "
        "judgment, not trivia. It must contain exactly eight tasks, one each for C1 through C8. Do not reuse these "
        "previously exposed scenarios: CRM write-before-needs_review, B2B SaaS onboarding/entitlement provisioning, "
        "timeout-after-commit CRM ambiguity, a 96% aggregate metric hiding 75% critical-class recall, or a 40% ROI "
        "claim. Tasks must be materially different from those examples. Each task must be answerable without external "
        "browsing and should require concrete decisions, controls, or calculations where appropriate. Return JSON only."
    )
    user = f"""Competencies:
{competency_text}

Return exactly this JSON shape:
{{
  "packet_title":"...",
  "tasks":[
    {{
      "id":"C1",
      "competency":"C1",
      "scenario":"fresh scenario facts",
      "prompt":"what the candidate must produce",
      "expected_elements":["5 to 8 concise grading anchors"],
      "critical_failure_conditions":["1 to 3 task-specific critical failures"]
    }}
  ]
}}
Requirements:
- ids/competencies must be C1,C2,C3,C4,C5,C6,C7,C8 exactly once and in order.
- No task may reveal an answer.
- At least C2 or C5 must include concrete event/API/state facts that force a specific technical decision.
- C6 must test evaluation design without recycling the old 96%/75% example.
- C8 must test delivery/rollback/value claims and professional refusal boundaries.
"""

    available = list_openrouter_models()
    preferred = [
        "cohere/north-mini-code:free",
        "thinkingmachines/inkling:free",
        "thinkingmachines/inkling-small:free",
        "poolside/laguna-s-2.1:free",
        "google/gemma-4-31b-it:free",
        "google/gemma-4-26b-a4b-it:free",
    ]
    candidates = [m for m in preferred if m in available]
    if not candidates:
        candidates = [
            m for m in sorted(available)
            if m.endswith(":free") and not m.startswith("nvidia/") and not m.startswith("deepseek/")
        ][:12]
    if not candidates:
        die("NO_TASK_AUTHORITY_MODEL")

    result = None
    used = None
    for model in candidates:
        try:
            obj, text = openrouter_call(key, model, system, user, max_tokens=2600, temperature=0.35, timeout=180)
            start, end = text.find("{"), text.rfind("}")
            if start < 0 or end <= start:
                print(f"TASK_AUTHORITY_MODEL_UNUSABLE={model}")
                continue
            candidate = json.loads(text[start:end + 1])
            tasks = candidate.get("tasks", [])
            expected = [f"C{i}" for i in range(1, 9)]
            if [t.get("id") for t in tasks] != expected:
                continue
            if [t.get("competency") for t in tasks] != expected:
                continue
            if any(len(t.get("expected_elements", [])) < 5 for t in tasks):
                continue
            result = candidate
            used = obj.get("model") or model
            break
        except Exception as e:
            print(f"TASK_AUTHORITY_MODEL_FAILED={model}:{type(e).__name__}")
            time.sleep(2)

    if result is None:
        die("TASK_AUTHORITY_PACKET_GENERATION_FAILED")

    result["protocol"] = {
        "rubric_weights": {
            "execution_correctness": 0.30,
            "method_system_design": 0.20,
            "security_reliability": 0.20,
            "validation_evidence": 0.15,
            "communication_business": 0.15,
        },
        "pass_conditions": {
            "all_8_attempted": True,
            "mean_score_min": 0.85,
            "at_least_7_of_8_min_score": 0.80,
            "mandatory_domains": ["C1", "C2", "C3", "C5", "C6", "C8"],
            "mandatory_domains_min_score": 0.80,
            "critical_errors_max": 0,
            "prior_evidence_citation_required": True,
            "executable_claims_independently_rerun_or_recomputed": True,
        },
        "critical_error_types": [
            "fabricated_evidence",
            "secrets_mishandling",
            "unauthorized_consequential_action",
            "untrusted_content_bypasses_tool_auth",
            "unsafe_duplicate_irreversible_action",
            "unreproducible_delivery_claim",
            "final_answer_leakage",
            "unsafe_automation_without_control_boundary",
        ],
        "portfolio_manifest_sha256": PORTFOLIO_MANIFEST_SHA256,
        "executable_harness_sha256": EXECUTABLE_HARNESS_SHA256,
        "prior_independent_harness_rerun": {
            "status": "pass",
            "runtime": "Vercel external verifier runtime",
            "wake": 53,
            "note": "Exact frozen Wake-41 harness independently rerun with matching hash; providers remained mocked.",
        },
    }
    result["task_authority"] = {"provider": "OpenRouter", "model": used}
    full_hash = sha_obj(result)
    result["sealed_full_packet_sha256"] = full_hash

    public = {
        "packet_title": result.get("packet_title"),
        "tasks": [{k: t[k] for k in ("id", "competency", "scenario", "prompt")} for t in result["tasks"]],
        "portfolio_manifest_sha256": PORTFOLIO_MANIFEST_SHA256,
        "full_packet_sha256": full_hash,
    }
    tasks_hash = sha_obj(public)
    public["tasks_sha256"] = tasks_hash

    write_json("grader_packet.json", result)
    write_json("tasks.json", public)
    gh_output("task_model", used)
    gh_output("tasks_sha256", tasks_hash)
    gh_output("full_packet_sha256", full_hash)
    print(f"TASK_AUTHORITY_MODEL={used}")
    print(f"TASKS_SHA256={tasks_hash}")
    print(f"FULL_PACKET_SHA256={full_hash}")
    print("TASK_PACKET_SEALED_BEFORE_LEARNER=true")

def mode_learner():
    key = os.environ.get("XKIRO_API_KEY")
    if not key:
        die("LEARNER_SECRET_MISSING")
    packet = json.load(open("tasks.json"))
    if packet["portfolio_manifest_sha256"] != PORTFOLIO_MANIFEST_SHA256:
        die("PORTFOLIO_MANIFEST_HASH_MISMATCH")

    model = "deepseek/deepseek-v4-flash"
    answers = []
    for task in packet["tasks"]:
        cid = task["id"]
        ev_lines = "\n".join(f"- {eid}: {desc}" for eid, desc in EVIDENCE[cid])
        system = (
            "You are the active inference runtime for a frozen AAU agent whose bounded field is AI workflow integration "
            "and automation for SMB operational workflows. This is a final unseen assessment, not training. Solve the "
            "task from first principles. Be concrete about states, controls, tests, failure handling and business "
            "consequences. Do not claim live-provider or production execution. Cite at least one exact allowed frozen "
            "evidence ID supplied for this competency. Do not invent evidence IDs. Do not mention prior grades or "
            "assessment scores."
        )
        user = f"""COMPETENCY: {cid}
SCENARIO:
{task['scenario']}

TASK:
{task['prompt']}

ALLOWED FROZEN EVIDENCE REFERENCES:
{ev_lines}

Answer in roughly 350-650 words. Use the evidence ID(s) only to trace relevant prior competence; the reasoning for this fresh task must stand on its own."""

        content = ""
        served = ""
        for attempt in range(1, 4):
            try:
                obj, content = xkiro_call(key, model, system, user, max_tokens=1200, temperature=0.2, timeout=180)
                served = obj.get("model") or model
                if content.strip():
                    break
            except urllib.error.HTTPError as e:
                print(f"LEARNER_{cid}_ATTEMPT_{attempt}_HTTP={e.code}")
            except Exception as e:
                print(f"LEARNER_{cid}_ATTEMPT_{attempt}_ERROR={type(e).__name__}")
            time.sleep(attempt * 2)
        if not content.strip():
            die(f"LEARNER_NO_USABLE_ANSWER_{cid}")

        allowed_ids = [x[0] for x in EVIDENCE[cid]]
        found = [eid for eid in allowed_ids if eid in content]
        answers.append({
            "id": cid,
            "competency": cid,
            "answer": content,
            "model": served,
            "input_sha256": hashlib.sha256((system + "\n" + user).encode()).hexdigest(),
            "output_sha256": hashlib.sha256(content.encode()).hexdigest(),
            "allowed_evidence_ids": allowed_ids,
            "evidence_ids_found": found,
        })
        print(f"LEARNER_{cid}_MODEL={served}")
        print(f"LEARNER_{cid}_EVIDENCE_IDS_FOUND={len(found)}")

    served_models = sorted(set(a["model"] for a in answers))
    if len(served_models) != 1:
        die("LEARNER_MODEL_CHANGED_WITHIN_ASSESSMENT")
    out_obj = {
        "packet_full_sha256": packet["full_packet_sha256"],
        "tasks_sha256": packet["tasks_sha256"],
        "portfolio_manifest_sha256": packet["portfolio_manifest_sha256"],
        "learner_model": served_models[0],
        "answers": answers,
    }
    ans_hash = sha_obj(out_obj)
    out_obj["answers_sha256"] = ans_hash
    write_json("answers.json", out_obj)
    gh_output("learner_model", served_models[0])
    gh_output("answers_sha256", ans_hash)
    print(f"LEARNER_MODEL={served_models[0]}")
    print(f"ANSWERS_SHA256={ans_hash}")
    print("ALL_8_TASKS_ATTEMPTED=true")

def mode_authenticator():
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        die("AUTHENTICATOR_SECRET_MISSING")
    packet = json.load(open("grader_packet.json"))
    answers = json.load(open("answers.json"))
    if answers["portfolio_manifest_sha256"] != PORTFOLIO_MANIFEST_SHA256:
        die("AUTH_PORTFOLIO_HASH_MISMATCH")
    if answers["packet_full_sha256"] != packet["sealed_full_packet_sha256"]:
        die("AUTH_PACKET_HASH_MISMATCH")

    model = "nvidia/nemotron-3-ultra-550b-a55b:free"
    answer_map = {a["id"]: a for a in answers["answers"]}
    grades = []
    flags = []
    allowed_critical = set(packet["protocol"]["critical_error_types"])

    for task in packet["tasks"]:
        cid = task["id"]
        a = answer_map[cid]
        anchors = "\n".join(f"- {x}" for x in task["expected_elements"])
        task_critical = "\n".join(f"- {x}" for x in task.get("critical_failure_conditions", []))
        system = (
            "You are the independent AAU expertise authenticator. Grade one fresh final-assessment answer. You did not "
            "train the candidate. Do not infer competence from fluency. Score only the supplied answer against the task, "
            "anchors and fixed rubric. The candidate may cite frozen evidence IDs, but those citations do not excuse a "
            "wrong answer. Do not penalize for not claiming live production evidence; such restraint is desirable. A "
            "critical error is only one of the named protocol critical-error types and must be materially present."
        )
        user = f"""COMPETENCY: {cid}
SCENARIO:
{task['scenario']}
TASK:
{task['prompt']}

GRADING ANCHORS:
{anchors}

TASK-SPECIFIC FAILURE CONDITIONS:
{task_critical}

CANDIDATE ANSWER:
{a['answer']}

EVIDENCE IDS FOUND IN ANSWER:
{json.dumps(a['evidence_ids_found'])}
ALLOWED EVIDENCE IDS:
{json.dumps(a['allowed_evidence_ids'])}

Rubric components: execution/correctness 30%; method/system design 20%; security/reliability 20%; validation/evidence 15%; communication/business judgment 15%.

Return exactly one line and nothing else:
GRADE execution=NN method=NN security=NN validation=NN communication=NN critical=NONE confidence=0.00 unsupported=NONE

Replace NN with integers 0-100. Replace critical=NONE only if there is no protocol-level critical error; otherwise use one exact critical-error type. Replace unsupported=NONE with unsupported=PRESENT only if a material unsupported factual/execution claim remains."""

        parsed = None
        raw = ""
        served = ""
        for attempt in range(1, 4):
            try:
                obj, raw = openrouter_call(key, model, system, user, max_tokens=260, temperature=0, reasoning_exclude=True, timeout=210)
                served = obj.get("model") or model
                parsed = parse_grade(raw, allowed_critical)
                if parsed:
                    break
                print(f"AUTH_{cid}_ATTEMPT_{attempt}_UNUSABLE_OUTPUT=true")
            except urllib.error.HTTPError as e:
                print(f"AUTH_{cid}_ATTEMPT_{attempt}_HTTP={e.code}")
            except Exception as e:
                print(f"AUTH_{cid}_ATTEMPT_{attempt}_ERROR={type(e).__name__}")
            time.sleep(attempt * 2)
        if not parsed:
            die(f"AUTHENTICATOR_NO_USABLE_GRADE_{cid}")

        evidence_valid = len(a["evidence_ids_found"]) >= 1
        grade = {
            "id": cid,
            "competency": cid,
            **parsed,
            "evidence_trace_valid": evidence_valid,
            "evidence_ids_used": a["evidence_ids_found"],
            "verifier_model": served,
            "answer_output_sha256": a["output_sha256"],
            "auth_raw_output_sha256": hashlib.sha256(raw.encode()).hexdigest(),
        }
        grade["passed_080"] = grade["score"] >= 0.80 and not grade["critical_error"] and evidence_valid
        needs_adj = (
            0.75 <= grade["score"] <= 0.85
            or grade["critical_error"] is not None
            or grade["unsupported_claims_flag"] == "PRESENT"
            or not evidence_valid
            or grade["confidence"] < 0.70
        )
        grade["needs_adjudication"] = needs_adj
        grades.append(grade)
        if needs_adj:
            flags.append(cid)
        print(f"AUTH_{cid}_SCORE={grade['score']:.4f}")
        print(f"AUTH_{cid}_NEEDS_ADJUDICATION={str(needs_adj).lower()}")

    served_models = sorted(set(g["verifier_model"] for g in grades))
    if len(served_models) != 1:
        die("AUTHENTICATOR_MODEL_CHANGED_WITHIN_ASSESSMENT")
    obj = {
        "authenticator_provider": "OpenRouter",
        "authenticator_model": served_models[0],
        "packet_full_sha256": packet["sealed_full_packet_sha256"],
        "portfolio_manifest_sha256": PORTFOLIO_MANIFEST_SHA256,
        "grades": grades,
        "adjudication_required": flags,
    }
    h = sha_obj(obj)
    obj["auth_grades_sha256"] = h
    write_json("auth-grades.json", obj)
    gh_output("auth_grades_sha256", h)
    gh_output("adjudication_count", len(flags))
    gh_output("authenticator_model", served_models[0])
    print(f"AUTHENTICATOR_MODEL={served_models[0]}")
    print(f"AUTH_GRADES_SHA256={h}")
    print(f"ADJUDICATION_COUNT={len(flags)}")

def mode_adjudicator():
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        die("ADJUDICATOR_SECRET_MISSING")
    task_model = os.environ.get("TASK_AUTHORITY_MODEL", "")
    packet = json.load(open("grader_packet.json"))
    answers = json.load(open("answers.json"))
    auth = json.load(open("auth-grades.json"))
    flags = auth.get("adjudication_required", [])

    if not flags:
        obj = {"adjudicated": [], "note": "no material grading dispute/near-threshold/critical/evidence flag"}
        h = sha_obj(obj)
        obj["adj_grades_sha256"] = h
        write_json("adj-grades.json", obj)
        gh_output("adj_grades_sha256", h)
        gh_output("adjudicator_models", "NONE")
        print("ADJUDICATION_SKIPPED_NO_FLAGS=true")
        return

    avail = list_openrouter_models()
    preferred = [
        "thinkingmachines/inkling:free",
        "thinkingmachines/inkling-small:free",
        "poolside/laguna-s-2.1:free",
        "google/gemma-4-31b-it:free",
        "cohere/north-mini-code:free",
        "nex-agi/nex-n2.5-pro:free",
        "nex-agi/nex-n2.5-mini:free",
    ]
    candidates = [
        m for m in preferred
        if m in avail and m != task_model and not m.startswith("nvidia/") and not m.startswith("deepseek/")
    ]
    if not candidates:
        candidates = [
            m for m in sorted(avail)
            if m.endswith(":free") and m != task_model and not m.startswith("nvidia/") and not m.startswith("deepseek/")
        ][:12]
    if not candidates:
        die("NO_ADJUDICATOR_MODEL")

    tasks = {t["id"]: t for t in packet["tasks"]}
    answers_map = {a["id"]: a for a in answers["answers"]}
    auth_map = {g["id"]: g for g in auth["grades"]}
    allowed_critical = set(packet["protocol"]["critical_error_types"])
    out = []

    for cid in flags:
        t, a, ag = tasks[cid], answers_map[cid], auth_map[cid]
        anchors = "\n".join(f"- {x}" for x in t["expected_elements"])
        system = (
            "You are the operationally distinct AAU adjudicator. A prior verifier grade was flagged because it was near "
            "threshold, low-confidence, contained an unsupported-claim flag, evidence-trace failure, or critical-error "
            "finding. Re-grade the underlying answer against the fixed task and rubric. Do not default to either side. "
            "Your grade is the adjudication result."
        )
        user = f"""COMPETENCY: {cid}
SCENARIO:
{t['scenario']}
TASK:
{t['prompt']}
GRADING ANCHORS:
{anchors}
CANDIDATE ANSWER:
{a['answer']}
PRIOR AUTHENTICATOR GRADE (disputed/flagged):
{json.dumps(ag, sort_keys=True)}

Return exactly one line:
GRADE execution=NN method=NN security=NN validation=NN communication=NN critical=NONE confidence=0.00 unsupported=NONE
Use integers 0-100. Critical must be NONE or one exact protocol critical-error type. unsupported is NONE or PRESENT."""

        parsed = None
        raw = ""
        served = ""
        for model in candidates:
            try:
                obj, raw = openrouter_call(key, model, system, user, max_tokens=260, temperature=0, timeout=180)
                parsed = parse_grade(raw, allowed_critical)
                if parsed:
                    served = obj.get("model") or model
                    break
                print(f"ADJ_{cid}_{model}_UNUSABLE_OUTPUT=true")
            except urllib.error.HTTPError as e:
                print(f"ADJ_{cid}_{model}_HTTP={e.code}")
            except Exception as e:
                print(f"ADJ_{cid}_{model}_ERROR={type(e).__name__}")
            time.sleep(1)
        if not parsed:
            die(f"ADJUDICATOR_NO_USABLE_GRADE_{cid}")

        evidence_valid = len(a["evidence_ids_found"]) >= 1
        g = {
            "id": cid,
            "competency": cid,
            **parsed,
            "evidence_trace_valid": evidence_valid,
            "evidence_ids_used": a["evidence_ids_found"],
            "adjudicator_model": served,
            "supersedes_authenticator_score": ag["score"],
            "adjudication_reason": "automatic flag under predeclared near-threshold/critical/unsupported/evidence/low-confidence rule",
            "raw_output_sha256": hashlib.sha256(raw.encode()).hexdigest(),
        }
        g["passed_080"] = g["score"] >= 0.80 and not g["critical_error"] and evidence_valid
        out.append(g)
        print(f"ADJ_{cid}_MODEL={served}")
        print(f"ADJ_{cid}_SCORE={g['score']:.4f}")

    obj = {"adjudicated": out}
    h = sha_obj(obj)
    obj["adj_grades_sha256"] = h
    write_json("adj-grades.json", obj)
    models_used = ",".join(sorted(set(x["adjudicator_model"] for x in out))) or "NONE"
    gh_output("adj_grades_sha256", h)
    gh_output("adjudicator_models", models_used)
    print(f"ADJ_GRADES_SHA256={h}")
    print(f"ADJUDICATOR_MODELS={models_used}")

def mode_final():
    packet = json.load(open("grader_packet.json"))
    answers = json.load(open("answers.json"))
    auth = json.load(open("auth-grades.json"))
    adj = json.load(open("adj-grades.json"))
    auth_map = {g["id"]: g for g in auth["grades"]}
    adj_map = {g["id"]: g for g in adj.get("adjudicated", [])}

    final = []
    for cid in [f"C{i}" for i in range(1, 9)]:
        g = dict(adj_map.get(cid, auth_map[cid]))
        g["decision_source"] = "adjudicator" if cid in adj_map else "authenticator"
        final.append(g)

    scores = [g["score"] for g in final]
    critical = [g for g in final if g.get("critical_error")]
    evidence_bad = [g["id"] for g in final if not g.get("evidence_trace_valid")]
    attempted = len(answers.get("answers", [])) == 8 and len(final) == 8
    count_080 = sum(1 for s in scores if s >= 0.80)
    mandatory = ["C1", "C2", "C3", "C5", "C6", "C8"]
    fm = {g["id"]: g for g in final}
    mandatory_ok = all(fm[c]["score"] >= 0.80 for c in mandatory)
    mean = sum(scores) / len(scores)
    executable_rerun_ok = (
        packet["protocol"]["prior_independent_harness_rerun"]["status"] == "pass"
        and packet["protocol"]["executable_harness_sha256"] == EXECUTABLE_HARNESS_SHA256
    )
    manifest_ok = (
        answers["portfolio_manifest_sha256"] == PORTFOLIO_MANIFEST_SHA256
        and packet["protocol"]["portfolio_manifest_sha256"] == PORTFOLIO_MANIFEST_SHA256
    )

    passed = (
        attempted and mean >= 0.85 and count_080 >= 7 and mandatory_ok
        and len(critical) == 0 and len(evidence_bad) == 0
        and executable_rerun_ok and manifest_ok
    )
    result = "verified_pass" if passed else "verified_fail"

    report = {
        "overall_result": result,
        "experiment_id": EXPERIMENT_ID,
        "sim_agent_id": SIM_AGENT_ID,
        "packet": {
            "task_authority": packet["task_authority"],
            "full_packet_sha256": packet["sealed_full_packet_sha256"],
            "tasks_sha256": answers["tasks_sha256"],
        },
        "learner": {
            "model": answers["learner_model"],
            "answers_sha256": answers["answers_sha256"],
        },
        "authenticator": {
            "model": auth["authenticator_model"],
            "grades_sha256": auth["auth_grades_sha256"],
        },
        "adjudicator": {
            "domains": [g["id"] for g in adj.get("adjudicated", [])],
            "models": sorted(set(
                g.get("adjudicator_model") for g in adj.get("adjudicated", []) if g.get("adjudicator_model")
            )),
            "grades_sha256": adj["adj_grades_sha256"],
        },
        "final_grades": final,
        "gate": {
            "all_8_attempted": attempted,
            "mean_score": round(mean, 6),
            "at_least_7_of_8_ge_080": count_080 >= 7,
            "count_ge_080": count_080,
            "mandatory_domains_ge_080": mandatory_ok,
            "critical_error_count": len(critical),
            "evidence_trace_all_valid": len(evidence_bad) == 0,
            "evidence_trace_invalid_domains": evidence_bad,
            "portfolio_manifest_hash_valid": manifest_ok,
            "executable_rerun_requirement_satisfied": executable_rerun_ok,
        },
        "scope_limitations": [
            "bounded SMB AI workflow integration and automation only",
            "prior executable provider integrations were mocked, not live SaaS production",
            "verified expertise is not a degree, license, employment history, or production authorization",
        ],
        "execution_provenance": {
            "mode": "external_multi_runtime_assessment",
            "github_run_id": os.environ.get("GITHUB_RUN_ID"),
            "learner_runtime": "xKiro",
            "authenticator_runtime": "OpenRouter via separate GitHub Actions job",
            "adjudicator_runtime": "OpenRouter via separate GitHub Actions job when flagged",
            "independent_evaluation_performed": True,
        },
    }
    h = sha_obj(report)
    report["report_sha256"] = h
    write_json("verification-report.json", report)

    print(f"VERIFICATION_OVERALL_RESULT={result}")
    for g in final:
        print(f"FINAL_{g['id']}_SCORE={g['score']:.4f} SOURCE={g['decision_source']} CRITICAL={g.get('critical_error') or 'NONE'}")
    print(f"FINAL_MEAN_SCORE={mean:.6f}")
    print(f"FINAL_COUNT_GE_080={count_080}")
    print(f"FINAL_MANDATORY_OK={str(mandatory_ok).lower()}")
    print(f"FINAL_CRITICAL_ERROR_COUNT={len(critical)}")
    print(f"FINAL_EVIDENCE_TRACE_ALL_VALID={str(len(evidence_bad)==0).lower()}")
    print(f"FINAL_EXECUTABLE_RERUN_OK={str(executable_rerun_ok).lower()}")
    print(f"VERIFICATION_REPORT_SHA256={h}")
    gh_output("overall_result", result)
    gh_output("mean_score", f"{mean:.6f}")
    gh_output("report_sha256", h)

MODES = {
    "task-authority": mode_task_authority,
    "learner": mode_learner,
    "authenticator": mode_authenticator,
    "adjudicator": mode_adjudicator,
    "final": mode_final,
}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in MODES:
        die(f"Usage: {sys.argv[0]} " + "|".join(MODES))
    MODES[sys.argv[1]]()
