# Kimi K2.6: autonomous repair of unfamiliar faults (2026-10-17)

**Scope:** isolated research, draft PR #45. No Silas or production changes.

## Verified execution
- Corrected live run: [GitHub Actions 39041149100](https://github.com/booleanlambda/agent-control-room/actions/runs/39041149100). Immutable evidence artifact `aau-kimi-unfamiliar-failure-corrected-real-evidence` (ID **12103837370**), includes all source code, diagnoses, live model outputs, hidden validation, and provider usage.
- **10 genuine calls, 29,481 provider-reported tokens**, model `kimi-k2.6` thinking disabled, all calls HTTP 200/finish=stop. 5 calls for each of two unrelated seeded defects. No hidden inputs/results or actual fault-line hint appeared in model messages.
- Earlier single API attempt [39041006967](https://github.com/booleanlambda/agent-control-room/actions/runs/39041006967) was rejected HTTP 400 before model response, with zero reported provider tokens; nonstandard temperature `0.55` was changed to recommended `0.6` for a NEW, separately dispatched call. No automatic retry of an ambiguous response.

## Graph routing: repaired code PASS, self-test FAIL
- Faulty Python returned cost **70**, whereas independent oracle was **40**. Without a diagnosis hint, Kimi correctly identified an extra `+3` applied to each battery-charging unit.
- First model-authored source correction produced valid global minimum **40** and passed **both unseen cases** (optimal costs **39** on a new graph and **41** with different charger prices). No oracle function was available to Kimi as a calculation tool.
- Kimi submitted multiple property-test scripts; each exited `python_exit_1` when run with the documented `{"input": problem_json, "output": candidate_result}` test interface. They incorrectly treated the wrapper as a bare graph problem and/or ignored the supplied candidate, rather than verifying it. Runtime only returned generic exit codes, not public stderr. Actions `diagnose,repair,tests,repair,tests`.

## Number theory: repaired code PASS, self-test FAIL
- Faulty Python used quadratic congruence divisor **19** instead of specified **17**, producing count **4**, score **511**. Kimi independently located the mismatch.
- First model-authored correction passed the public case (count **3**, optimum score **378**, tuple `[4,10,6]`) and **both hidden cases** (one count **6**, optimum **519**, `[12,7,8]`; one count **3**, optimum **378**).
- Three subsequent model-written verification scripts also exited `python_exit_1` under the specified input/output wrapper. None passed the verifier acceptance gate. Actions `diagnose,repair,tests,tests,tests`.

## Strict assessment and recovery
**2/2 unfamiliar seeded program defects independently identified and repaired; 4/4 held-out algorithm cases passed.** The complete autonomous self-remediation lifecycle **did not pass (0/2)** because the model-generated verification scripts crashed. The two failures demonstrate distinct fault diagnosis across familiar research domains, **not a general success rate**.

After examining the immutable live artifact, the **research-only** verifier runner was revised to provide up to 1,000 characters of actual **public-only Python stderr** and emphasize that self-written tests must evaluate `{"input": ..., "output": ...}`. No new model calls were made with these changes; hidden outputs remain sealed.

All Python ran in isolated Docker with network disabled, read-only filesystem, no credentials and bounded resources. The one-time credentialed workflow was deleted after dispatch. No production merge, deployment, or Silas wake. Separate production Systemic Runtime Tree CI remains failing.
