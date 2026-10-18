"""Public EPA Net3 EPANET benchmark with independent synthetic dual-leak observations.
This is not real field telemetry. Answer-key nodes never enter the model messages.
"""
import hashlib
import json
from pathlib import Path
import numpy as np
import wntr

ROOT=Path(__file__).parent
OUT=ROOT/"evidence"
OUT.mkdir(parents=True, exist_ok=True)
EMITTER=0.012

def make_network(leaks=None):
    network=wntr.network.WaterNetworkModel("Net3")
    network.options.time.duration=0
    network.options.time.report_timestep=3600
    if leaks:
        for node, coefficient in leaks:
            network.get_node(node).emitter_coefficient=float(coefficient)
    return network

def simulate(leaks=None):
    net=make_network(leaks)
    result=wntr.sim.EpanetSimulator(net).run_sim()
    return {node:float(val) for node,val in result.node["pressure"].iloc[-1].items()
            if node in net.junction_name_list}

def main():
    net=make_network()
    junctions=sorted(net.junction_name_list)
    sensors=list(dict.fromkeys(junctions[round(i*(len(junctions)-1)/13)] for i in range(14)))
    truth=[junctions[len(junctions)//4],junctions[(len(junctions)*3)//4]]
    baseline=simulate()
    leak_obs=simulate([(node,EMITTER) for node in truth])
    observations={n:{"baseline_m":round(baseline[n],5),
                     "observed_m":round(leak_obs[n],5),
                     "delta_m":round(leak_obs[n]-baseline[n],5)}
                  for n in sensors}
    visible={
       "benchmark":"US EPA EPANET Net3 hydraulic model",
       "measurement_type":"synthetic two-leak pressure observations on real public network topology",
       "junctions":junctions,
       "sensors":sensors,
       "pipes":len(net.pipe_name_list),
       "observations":observations,
       "emitter_search_coefficient":EMITTER,
       "units":"pressure m; emitter coefficient m^3/s/m^0.5",
       "answer_key_visible_to_model":False,
       "source":"wntr.network.WaterNetworkModel('Net3')",
       "no_telemetry_data":True}
    secret={"hidden_leak_nodes":truth,"hidden_emitter_coefficients":[EMITTER,EMITTER]}
    (OUT/"observations.json").write_text(json.dumps(visible,indent=2))
    (OUT/"sealed_truth.json").write_text(json.dumps(secret,indent=2))
    payload= json.dumps(visible,sort_keys=True).encode()
    (OUT/"input-sha256.txt").write_text(hashlib.sha256(payload).hexdigest()+"\n")
    print("NET3_PREPARED="+json.dumps({"junctionCount":len(junctions),
      "pipes":len(net.pipe_name_list),"sensors":len(sensors),
      "measurementSha256":hashlib.sha256(payload).hexdigest(),
      "deltaRange_m":[min(v["delta_m"] for v in observations.values()),
                      max(v["delta_m"] for v in observations.values())],
      "benchmark":"Net3, synthetic leak injections"}))
if __name__=="__main__":
    main()
