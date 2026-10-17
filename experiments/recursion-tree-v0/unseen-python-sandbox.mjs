// Executes model-authored Python in a tightly isolated disposable Docker
// sandbox. Never passes provider secrets/environment/network/host filesystem.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const IMAGE='python:3.12-alpine';
export async function runIsolatedPython(code,input,{timeoutMs=8000}={}){
 if(process.env.GITHUB_ACTIONS!=='true'||process.env.AAU_PYTHON_SANDBOX!=='yes')
  throw Error('SANDBOX_DISPOSABLE_CI_ONLY');
 if(typeof code!=='string'||code.length<10||code.length>12000)
  return {ok:false,error:'code_size_bounds'};
 const folder=await mkdtemp(join(tmpdir(),'aau-closed-python-'));
 const file=join(folder,'solver.py'),name='aau-sandbox-'+randomUUID().slice(0,12);
 const args=['run','--rm','--name',name,'-i','--network','none',
  '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
  '--pids-limit','32','--memory','192m','--cpus','1',
  '--user','65534:65534','--tmpfs','/tmp:rw,nosuid,nodev,size=8m',
  '--mount','type=bind,src='+file+',dst=/app/solver.py,readonly',
  IMAGE,'python','-B','/app/solver.py'];
 let proc=null;
 try{
  await writeFile(file,code,{encoding:'utf8',mode:0o644});
  return await new Promise(resolve=>{
   const started=Date.now();let out='',err='',truncated=false;
   let completed=false;
   const child=spawn('docker',args,{env:{PATH:'/usr/local/bin:/usr/bin:/bin',
     DOCKER_HOST:'unix:///var/run/docker.sock'},stdio:['pipe','pipe','pipe']});
   proc=child;
   function finish(result){
    if(completed)return;completed=true;clearTimeout(clock);
    resolve({...result,elapsedMs:Date.now()-started});
   }
   const clock=setTimeout(()=>{
    // Docker daemon terminates the container independently of CLI signals.
    spawn('docker',['rm','-f',name],{env:{PATH:'/usr/local/bin:/usr/bin:/bin'},
      stdio:'ignore'}).on('error',()=>{});
    child.kill('SIGKILL');finish({ok:false,error:'python_timeout'});
   },timeoutMs);
   child.stdout.on('data',b=>{out+=String(b);if(out.length>32000){truncated=true;child.kill('SIGKILL')}});
   child.stderr.on('data',b=>{err+=String(b);if(err.length>8000){truncated=true;child.kill('SIGKILL')}});
   child.on('error',e=>finish({ok:false,error:'docker_spawn_'+String(e.code||e.name)}));
   child.on('close',code=>{
    if(truncated){finish({ok:false,error:'output_limit_exceeded'});return}
    if(code!==0){finish({ok:false,error:'python_exit_'+code,stderr:err.slice(0,1200)});return}
    let parsed=null;
    try{parsed=JSON.parse(out.trim())}catch{
      finish({ok:false,error:'stdout_not_one_json_object',stdoutExcerpt:out.slice(0,350)});
      return;
    }
    if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')
      finish({ok:false,error:'output_not_object'});
    else finish({ok:true,result:parsed,stdoutLength:out.length});
   });
   child.stdin.on('error',()=>{});
   child.stdin.end(JSON.stringify(input)+'\n');
  });
 }finally{
  if(proc?.exitCode===null)proc.kill('SIGKILL');
  await rm(folder,{recursive:true,force:true}).catch(()=>{});
 }
}
