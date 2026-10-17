"""Separate Python exhaustive auditor for eight-hour microgrid optimization.
No imports from the JavaScript solver, no network, no model output or input.
Verifies reference minimum and optimality independent of the runtime.
"""
import itertools
import json
demand = (4,6,4,7,6,5,7,5)
solar = (1,2,2,2,2,2,2,2)
tariffs = (5,9,4,12,10,7,13,6)
outputs = (0,2,3,4,5)
best = None
winners = []
feasible = 0
for candidate in itertools.product(outputs, repeat=8):
    stored = 3
    previous = 0
    energy = 0
    total_cost = 0
    allowed = True
    for h, generated in enumerate(candidate):
        next_stored = stored + solar[h] + generated - demand[h]
        battery_delta = next_stored - stored
        if (abs(generated-previous)>3 or abs(battery_delta)>2 or
                next_stored < 0 or next_stored > 6):
            allowed=False
            break
        energy += generated
        total_cost += (tariffs[h]*generated + 2*generated*generated +
                       abs(battery_delta) +
                       (11 if previous == 0 and generated > 0 else 0) +
                       (6 if h in (3,6) and generated == 5 else 0))
        previous = generated
        stored = next_stored
    if not allowed or energy>30 or stored<3:
        continue
    feasible+=1
    if best is None or total_cost<best:
        best=total_cost
        winners=[candidate]
    elif total_cost==best:
        winners.append(candidate)
result={'test':'independent_python_exhaustive_verifier',
        'feasibleSchedules':feasible,'optimalCost':best,
        'uniqueOptimum':len(winners)==1,'optimalSchedules':winners}
print('PYTHON_MICROGRID_REFERENCE='+json.dumps(result))
assert feasible==3013, result
assert best==467, result
assert winners==[(3,4,4,3,4,4,3,4)], result
