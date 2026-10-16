import {writeFileSync} from 'node:fs';
import {deepConfig,newDeepTree,executeDeep,getDeepNode} from './depth10-traversability.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{
  const [name,...rest]=v.replace(/^--/,'').split('=');
  return [name,rest.join('=')||'true'];
}));
const shape=args.shape||'balanced';
const budget=args.budget?Number(args.budget):shape==='spine'?50000:1800000;
const s=newDeepTree(deepConfig(shape,budget));
const result=await executeDeep(s);
const output={
  simulation:true,
  model:'deterministic scripted stand-in, not live NVIDIA inference',
  source:'16 Silas error templates expanded as synthetic unique items',
  budgetAccounting:'per-call maximum output plus input character estimate',
  ...result,
};
const prefix=args.output||'recursion-depth10-'+shape;
writeFileSync(prefix+'.json',JSON.stringify({summary:output,tree:s},null,2)+'\n');
if(args.node){
  const node=getDeepNode(s,args.node);
  if(!node)throw Error('unknown_node:'+args.node);
  console.log('NODE='+JSON.stringify(node));
}
console.log('DEPTH10_RESULT='+JSON.stringify(output));
if(!result.complete)process.exitCode=2;
