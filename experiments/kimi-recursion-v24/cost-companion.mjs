// Model architecture's domain-independent arithmetic companion: compute only
// the sum of the item costs for IDs that Kimi already selected. NEVER modify
// the chosen subset or choose a better one. The independent oracle stays separate.
export function reconcileSelectedCost(problem,output){
 if(!output||typeof output!=='object'||!Array.isArray(output.selected))
  return {answer:output,adjusted:false,verifiedCost:null};
 if(output.selected.length===0&&output.cost===null)
  return {answer:output,adjusted:false,verifiedCost:null};
 const costs=new Map(problem.controls.map(x=>[x.id,x.cost]));
 if(output.selected.some(x=>typeof x!=='string'||!costs.has(x))||
    new Set(output.selected).size!==output.selected.length)
  return {answer:output,adjusted:false,verifiedCost:null};
 const verifiedCost=output.selected.reduce((n,x)=>n+costs.get(x),0);
 return {answer:{...output,cost:verifiedCost},
  adjusted:output.cost!==verifiedCost,verifiedCost};
}
