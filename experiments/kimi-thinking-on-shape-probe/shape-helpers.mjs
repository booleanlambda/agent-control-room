// Only structural metadata. Never retain model final text, private reasoning, or secrets.
const safeKey=x=>typeof x==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]{0,35}$/.test(x);
export function summarizeFinalStructure(value){
 const seen=new Set(),queue=[{value,path:'$',depth:0}],nodes=[];
 while(queue.length&&nodes.length<28){
  const {value:v,path,depth}=queue.shift();
  const kind=v===null?'null':Array.isArray(v)?'array':typeof v;
  if(!['object','array'].includes(kind)||v===null)continue;
  if(seen.has(v))continue;seen.add(v);
  const keys=kind==='object'?Object.keys(v).filter(safeKey).slice(0,18):[];
  nodes.push({path,kind,count:kind==='array'?Math.min(v.length,9999):keys.length,keys});
  if(depth>=2)continue;
  const pairs=kind==='object'?keys.map(k=>[k,v[k]]):v.slice(0,2).map((x,i)=>[String(i),x]);
  for(const [k,x] of pairs){
   if(x&&typeof x==='object')queue.push({value:x,path:kind==='array'?path+'[]':path+'.'+k,depth:depth+1});
  }
 }
 return nodes;
}
