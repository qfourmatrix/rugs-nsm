import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as netServer } from "node:net";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { expect, it } from "vitest";

it("uses durable admission and the shared queue, protects active jobs, retries from original and restores byte-exactly",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"top-down-http-"));await mkdir(path.join(root,"rug"));
 const source=await sharp({create:{width:80,height:80,channels:3,background:"#eee0c0"}}).png().toBuffer();
 const generated=await sharp(source).negate().png().toBuffer();await writeFile(path.join(root,"rug","base.png"),source);
 const hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
 const held:ServerResponse[]=[];const bodies:any[]=[];
 const provider=createServer((req,res)=>{let body="";req.on("data",chunk=>body+=chunk);req.on("end",()=>{bodies.push(JSON.parse(body));held.push(res);});}).listen(0,"127.0.0.1");await once(provider,"listening");
 const providerPort=(provider.address() as {port:number}).port;
 const probe=netServer().listen(0,"127.0.0.1");await once(probe,"listening");const port=(probe.address() as {port:number}).port;await new Promise<void>(resolve=>probe.close(()=>resolve()));
 const appRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
 const bootstrap=path.join(root,"server.mjs");await writeFile(bootstrap,`const {config}=await import(${JSON.stringify(pathToFileURL(path.join(appRoot,"server/config.ts")).href)});config.providerMode="laozhang";config.laozhangApiKey="test-local-only";config.laozhangEndpoint="http://127.0.0.1:${providerPort}/generate";await import(${JSON.stringify(pathToFileURL(path.join(appRoot,"server/index.ts")).href)});`);
 const child=spawn(process.execPath,["--import","tsx",bootstrap],{cwd:appRoot,stdio:["ignore","pipe","pipe"],env:{...process.env,RUGS_PRODUCT_ROOT_OVERRIDE:root,RUGS_PORT_OVERRIDE:String(port),RUGS_PROVIDER_MODE_OVERRIDE:"mock"}});
 let logs="";child.stdout!.on("data",b=>logs=(logs+b).slice(-2000));child.stderr!.on("data",b=>logs=(logs+b).slice(-2000));
 const url=`http://127.0.0.1:${port}`;
 const until=async(check:()=>Promise<boolean>|boolean)=>{const end=Date.now()+30000;while(Date.now()<end){if(child.exitCode!==null)throw Error(logs);if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error(`Condition did not settle: ${logs}`);};
 const post=(suffix:string,body:unknown,key?:string)=>fetch(url+`/api/products/rug/${suffix}`,{method:"POST",headers:{"Content-Type":"application/json",...(key?{"Idempotency-Key":key}:{})},body:JSON.stringify(body)});
 const finish=()=>held.shift()!.end(JSON.stringify({candidates:[{content:{parts:[{inlineData:{mimeType:"image/png",data:generated.toString("base64")}}]}}]}));
 try{
  await until(async()=>{try{return(await fetch(url+"/api/app-info")).ok;}catch{return false;}});
  const key=randomUUID();const first=await post("top-down",{},key);expect(first.ok).toBe(true);const result=await first.json();
  expect(await(await post("top-down",{},key)).json()).toEqual(result);
  await until(()=>bodies.length===1);
  expect((await post("top-down/apply",{expectedHash:hash(source)})).status).toBe(409);
  finish();let state:any;
  await until(async()=>{state=await(await fetch(url+"/api/products/rug/top-down")).json();return state.candidates.length===1;});
  expect((await post("top-down/apply",{expectedHash:hash(source),assetId:state.candidates[0].assetId})).ok).toBe(true);
  expect(hash(await readFile(path.join(root,"rug","base.png")))).not.toBe(hash(source));
  expect((await post("top-down",{},randomUUID())).ok).toBe(true);await until(()=>bodies.length===2);
  for(const body of bodies){const images=body.contents[0].parts.filter((p:any)=>p.inline_data);expect(images).toHaveLength(1);expect(hash(Buffer.from(images[0].inline_data.data,"base64"))).toBe(hash(source));}
  finish();await until(async()=>{state=await(await fetch(url+"/api/products/rug/top-down")).json();return state.candidates.length===2;});
  expect((await post("top-down/apply",{expectedHash:state.sourceSha256})).ok).toBe(true);
  expect(await readFile(path.join(root,"rug","base.png"))).toEqual(source);
  expect(bodies).toHaveLength(2);
 }finally{for(const res of held)res.destroy();provider.closeAllConnections();await new Promise<void>(resolve=>provider.close(()=>resolve()));child.kill("SIGTERM");if(child.exitCode===null)await once(child,"exit");await rm(root,{recursive:true,force:true});}
},90000);
