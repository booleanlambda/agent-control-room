# Live Kimi K2.6: Self-authored Python algorithms on unseen instances

**Date:** 16–17 October 2026 UTC  
**Live GitHub Actions run:** [38994095805](https://github.com/booleanlambda/agent-control-room/actions/runs/38994095805)  
**Audit artifact:** `aau-kimi-unseen-python-cognition-audit` (ID **12086188517**)  
**Status:** **2/3 problem families passed**, 4/6 independently held-out/public
test instances passed, one domain-specific code/witness-reconstruction failure.

## Control design

This live experiment is intentionally more stringent than the earlier
microgrid benchmark: Kimi K2.6 (thinking disabled) authored the *actual Python
algorithms*, not just the formulation of a predefined optimizer. Each Python
source file was executed in isolated Docker (Python 3.12 Alpine, network
disabled, no secrets, read-only filesystem, unprivileged user, strict CPU,
memory, process and time caps). Kimi saw one public input per domain;
a second hidden instance and both reference solutions were never included
in model prompts or feedback. A trusted, independent JavaScript oracle
graded model-authored witnesses after execution. The test allows Kimi
to plan and at most two code submissions per task. It does not
refill attempts on transport/serialization errors.

**Total:** 11 genuine Kimi K2.6 model requests, 35,084 provider-reported
tokens. No scripted oracle-answer tool was made available to the model.
The test's GitHub Action exited unsuccessfully because *full suite success*
required 3/3, which is the correct conservative outcome; the achieved score
is 2/3, **not** 0/3.

## Per-domain observations

### 1. Factory assignment: failed exact witness, despite correct costs

**Five model calls, 22,415 tokens.** Kimi planned a dynamic program
over `(last_machine, used_mask, machine0_capacity, machine1_capacity)`,
using job index as the forward layer and inferring machine 2 load from the
processed-job total. This is a plausible sufficient state; it calculated
the exact optimum on both instances:

| Instance | Correct minimum | Returned numeric cost | Returned assignment |
|---|---:|---:|---|
| Public (7 jobs) | 90 | 90 | `[2,2,2,2,2,2,2]` (**infeasible**) |
| Held out (8 jobs) | 99 | 99 | `[2,2,2,2,2,2,2,2]` (**infeasible**) |

The model's first submitted program saved parent pointers in a dictionary
keyed only by its DP state, not by *job-indexed layer*;
`parent.update(new_parent)` allowed different stages to overwrite one
another. Kimi diagnosed a parent-pointer persistence problem, but its
second attempt switched to `parent = new_parent`, which **discarded**
earlier layers entirely and still failed reconstruction. The runtime
refused both outputs under the independent machine-capacity validator;
correct numeric cost alone was insufficient.

The fourth model response attempted another `code` action, but the
two-code-attempt ceiling had already been reached; no additional Python
program was executed. Call five returned HTTP 200 but
`finish_reason=length`, and was not accepted as a completed response.
No further model attempt was made. Consequently no valid final
algorithmic witness was established.

**Assessment:** significant *implementation and self-repair deficit*
in path reconstruction, **not** failure to formulate the cost DP, and
not a provider connection error. The final truncation compounds
the failure but did not cause either invalid witness.

### 2. Energy-constrained routing: success, including held-out graph

**Three model calls, 8,653 tokens.** Kimi authored general Dijkstra
search on `(node,battery_charge)` expanded states, with
single-unit positive-cost charging transitions and energy-consuming
travel edges, plus path and charging-action reconstruction.

| Instance | Independent exact cost | Model code cost | Verified witness |
|---|---:|---:|---|
| Public | 40 | 40 | `0→2→4→6`, charges `[0,8,2,0]` |
| Held out | 39 | 39 | `0→1→4→6→7`, charges `[0,0,9,0,0]` |

Both returned routes satisfy per-edge energy usage, charging location and
capacity, and terminal battery constraints. Correct cost and complete
witness match the independent graph-state shortest path verifier. One
code submission, no revision.

### 3. Diophantine optimization: success, including held-out integers

**Three model calls, 4,016 tokens.** Kimi generated its own exact Python
solver that enumerates feasible `(x,y)` with constraint-derived bounds,
computes `z` uniquely via `3x+5y+7z=total`, checks the
quadratic modular restriction, and scores all feasible triples.
This is a sound completeness argument (linear equality forces `z`)
and yields an `O(maxValue²)` algorithm.

| Instance | Feasible triples | Minimum score | Model result |
|---|---:|---:|---|
| Public | 3 | 378 | `[4,10,6]` |
| Held out | 6 | 519 | `[12,7,8]` |

Both the counts and lexicographically chosen optimum match the
independent enumerator. One code submission, no revision.

## Interpretation

This establishes a stronger capability than the preceding microgrid
test: **real Kimi-authored Python code** solved and generalized
in two distinct areas, with rigorous external grading and without an
exact-answer tool. It does **not** establish a general autonomous
problem-solving success rate from three families or full engineering
autonomy. The third family exposed a genuine software construction
failure (incorrect witness path reconstruction) despite good
mathematical state selection.

**Recommended follow-up:** Focus an isolated test on durable
*partial-solution evidence and traceback invariants*: require
every DP backtracking step to match a preserved layer and capacity
budget, and run model-authored property tests before accepting final
results. Keep the numeric objective and witness certification as
separate mandatory gates. Do not silently patch Kimi's failed source
and credit that as autonomous success.

The paid one-shot workflow trigger was removed after dispatch.
All changes remain in **draft PR #45**, unmerged and undeployed.
Silas and production AAU services were not modified or woken.
The separate production `Systemic Runtime Tree CI` is still failing.
