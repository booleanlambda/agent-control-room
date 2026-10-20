# AAU Kimi K3 MAX — Immutable V6 Failure Diagnosis

## Verdict

**Provider SUCCESS; experiment FAILURE.** K3 thinking ON at `reasoning_effort=max` produced a complete 13-tool JSON object with a 752-character non-JSON preamble. The strict JSON-only contract was violated. Original run **39502332304** correctly returned `FINAL_JSON_PARSE_FAILURE`, but the subsequent audit mistakenly reported thinking as unobserved because the flag is assigned only after JSON parses.

## Provider-forensic facts

- Original experiment: https://github.com/booleanlambda/agent-control-room/actions/runs/39502332304
- Provider model: `kimi-k3` in all three turns; `finish_reason=tool_calls,tool_calls,stop`.
- 3 model turns, 91,223 tokens; 17,325 provider-reported reasoning tokens, 72,128 reasoning characters. Thinking was **definitely active**.
- 7 authentic Parallel API invocations; 6 accepted live, 7th `PARALLEL_BUDGET_EXHAUSTED`.
- No UCCR registry search or inspect calls (these WERE offered by the runner after the first provider turn, notwithstanding K3's claim otherwise).
- Raw final output SHA256 `d4b385e4ba863e1699a75808dcfc5bf5c2ab45592c76511153c7d292708ff61e`, with 752 characters before the first JSON root `{`.
- Original error `Expecting value: line 1 column 1 (char 0)` on `json.loads(raw)`; this was an invalid-format preamble, not truncated provider output.

## Deterministic immutable recovery

- Follow-up run: https://github.com/booleanlambda/agent-control-room/actions/runs/39506095346
- Downloaded original immutable artifact 12301689271; pinned summary SHA256 `79c3a5c59d4b5d19dc89849e54693c92addb796d392e9b9390dbbf691911422b`.
- Used `json.JSONDecoder.raw_decode` starting at the first `{`, required exactly one complete JSON root and no trailing nonwhite text.
- Canonical JSON SHA256 `8a85fc94359cbe40616e1e20a052190ae4f02a40c7aab295d13030c1b47219a3`.
- **ZERO** new Moonshot, Parallel, or other LLM calls.
- Complete recovered proposal: 13 selected tools, 18 enumerated computations, 10 interfaces, 14 independent tests.
- Model's self-assessment `BLOCKED` and `stage2_authorized=false` preserved.
- Existing independent structural validator: `BLOCKED_INVALID_SELECTION_STRUCTURE`, **two** errors: `MISSING_VERIFIER_REFERENCES_FOR:R17` and `MISSING_VERIFIER_REFERENCES_FOR:R18` (optional DER weather profile and optional reporting computation, both listed in required-computations yet linked to no verification tests).

## Substantive observations

- K3 corrected prior unsafe hour rounding in logistics interface I4: uses **conservative CEIL** for generator available time instead of flooring actual arrival; example 07:59 arrival +30min setup can only serve 09:00 hourly slot. This is a meaningful improvement.
- K3 avoided nonexistent `pysp==6.0.0`, chose Pyomo+HiGHS directly, and used correct `dss-python` import (rather than nonexistent opendssdirect from that distribution).
- New OSRM installer still under-specifies the full sequence: a single `docker run ... osrm-extract (then partition/customize/routed)` is a description, not exact independently executable commands for all stages, despite operational semantics in its chosen API description.
- New ANDES droop/VSM grid-forming model and DPsim EMT/inverter interface remain UNVERIFIED; commercial ETAP/CYME unavailable; no full 4800-bus numerical or safety execution took place.
- K3 claimed UCCR tools were unavailable, even though all three tools were available after the first forced Parallel call; it did not choose to use them.
- The original independent audit `K3_THINKING_MAX_NOT_OBSERVED` is **a diagnostic coding bug**: the provider receipt conclusively records reasoning output; only the parse-dependent `thinking_on_verified` flag was absent.

## Outcome

**Do not classify this as a K3 cognitive budget exhaustion or provider transport failure.** It is a JSON-contract failure compounded by structural mapping gaps and some unresolved tool suitability questions. The recovered output is useful for diagnostics, but it does NOT retroactively change the original trial from FAIL to PASS. Compare it fairly with thinking OFF: OFF V6 returned clean JSON and zero structural errors at 86,714 tokens; ON MAX returned a recoverable JSON with invalid preamble, two structural errors and 91,223 tokens.

**Minimal future corrections (not implemented in the frozen model trial):** compute thinking evidence before attempting to parse; preserve the raw response and report recoverable extraneous preamble separately; preserve strict JSON format gate; check optional requirements' verification-reference policy, and avoid claiming tools unavailable when they were offered. No new inference was launched in the postmortem.