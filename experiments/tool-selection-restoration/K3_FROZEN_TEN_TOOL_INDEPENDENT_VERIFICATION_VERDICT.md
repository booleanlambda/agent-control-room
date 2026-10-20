# AAU — Independent Verification of K3's Frozen 10-Tool Selection

**Final selection suitability: FAILED AS SUBMITTED. Stage 2 not authorized.**

## Provenance / reproducibility
- Original K3 proposal was NOT altered: https://github.com/booleanlambda/agent-control-room/actions/runs/39478425234 (artifact 12291535745).
- Frozen JSON summary SHA256: 03fe111ccdf0f745257e747acae61565fb37f1111d389cd747a01b154bee8e26.
- Canonical proposal SHA256: 4a65c8e7d10749e4d21b31e28da3ee88bcf7384ebce176a10da70481fd4cc01a.
- Original independent CI: https://github.com/booleanlambda/agent-control-room/actions/runs/39496567340. OR-Tools and HiGHS shared-process native linker conflict observed.
- Controlled isolated rerun PASSED: https://github.com/booleanlambda/agent-control-room/actions/runs/39497006533. Evidence artifact 12297644075.

## Per-tool independent findings

| K3 selected tool | Evidence | Disposition as submitted |
|---|---|---|
| OpenDSSDirect/dss-python | Kimi installed dss-python 0.15.7 but its specified OpenDSSDirect-style import is absent. After independently adding opendssdirect.py 0.9.4, a synthetic three-phase feeder converged, bus phase voltages about 0.999495 pu. | FAIL exact installer, corrected narrow API PASS |
| NetworkX 3.6.1 | Real graph API tested on positive radial tree, negative cycle and disconnected graph. | PASS narrow API only |
| Google OR-Tools 9.12.4544 | In shared Python process after HiGHS import: libortools unresolved Highs symbol. In isolated venv: feasible route [0,1,2,0] and impossible window correctly rejected. | PASS isolated narrow API; runtime interoperability defect |
| Pyomo 6.10.1/HiGHS 1.15.1 | Binary generator-placement MILP optimal; impossible 100kW demand correctly identified infeasible. | PASS narrow API only |
| ETAP | Vendor official protection, motor and dynamics capabilities established. No commercial license/executable grid model. | Official documented; NOT EXECUTED |
| PSCAD/EMTDC | Official licensed Python mhi.pscad Automation Library, Windows 64-bit dependency, relevant EMT solver. Not installed or run. | Official documented; NOT EXECUTED |
| EMTP / EMTP-RV | Official EMTPWorks documents JavaScript and export scripting; no licensed run or verified Python connection. | Official documented; NOT EXECUTED |
| Eaton CYME / CYMTCC | Official protection coordination TCC software documented; no licensed run or automation API test. | Official documented; NOT EXECUTED |
| PySP 6.0.0 | Selected command pip install pysp==6.0.0 is WRONG: PyPI pysp project is unrelated Python-Support-Package with no 6.0.0 release. Pyomo PySP project recommends mpi-sppy successor. | **CONFIRMED TOOL IDENTITY / INSTALL FAILURE** |
| OSRM | Official route/table and preprocessing APIs exist. Kimi's bare Docker command does not load a road graph or start a route service. Dynamic closure handling and real time-dependent data not exercised. | Partly documented; unexecuted |

## Two independently demonstrated interoperability faults

**IC2: unsafe time conversion.** Kimi prescribes rounding route-arrival timestamps to nearest hour for Pyomo. A crew arriving 08:29 can be represented as 08:00 and downstream switching can precede physical crew arrival by 29 minutes. Deterministic counterexample confirmed.

**IC5: insufficient electrical transfer.** Kimi transfers bus ID/voltage/loading/scenario from OpenDSS to ETAP. Those fields omit topology, conductor impedances, protective-device settings and DER fault-current model; an independent protection/selectivity calculation cannot be constructed from the specified handoff. ETAP import code was not evidenced.

**IC1 remains unverified:** OSRM-generated travel-time matrices must respect units, unreachable roads, scenario-dependent closures and explicit machine-readable conversion to OR-Tools.

## Attribution / scoring

- The earlier 0 structural errors is valid for the JSON graph, not sufficient evidence of computational suitability.
- Kimi is responsible for the wrong PySP package, OpenDSS installation mismatch, unsafe IC2 conversion and incomplete IC5 input contract.
- The mixed HiGHS/OR-Tools native load conflict is an architecture/deployment compatibility defect: both components work independently when isolated but are not certified interoperable in one process.
- Four licensed engines have documentary support for domain fit but cannot be validated with this GitHub runner; do not count them as either executable successes or independently proven wrong choices.
- Full 4,800-bus x 72h x six-scenario, road-to-generator-to-switch scheduling, DER fault protection/synchronism and under-15-minute optimization benchmark remains unexecuted.
- **Final as-selected toolchain PASS: NO. Execution and physical safety: NOT VERIFIED.** No defensible numeric percentage overall.

## Official evidence
- https://pypi.org/project/pysp/
- https://github.com/Pyomo/pysp
- https://github.com/pyomo/mpi-sppy
- https://developers.google.com/optimization/routing/original_cp_solver
- https://project-osrm.org/docs/v26.4.0/tools
- https://www.pscad.com/software/pscad/automation-library
- https://etap.com/solutions/Protection-Coordination
- https://www.emtp.com/documentation/emtp-overview
- https://www.eaton.com/in/en-us/products/utility-grid-solutions/software-modules/protective-device-coordination-software.html

Original K3 proposal untouched. Corrective experiments are explicitly separated from Kimi's as-submitted response.