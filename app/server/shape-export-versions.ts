import path from "node:path";
import {readFile} from "node:fs/promises";
import {z} from "zod";
import {atomicWriteJson} from "./fsUtils";
import {WorkScheduler} from "./work-scheduler";
const mutations=new WorkScheduler(1,100);
const file=(root:string)=>path.join(root,".product-shot-queue","shape-export-versions.json");
export async function readExportVersions(root:string):Promise<Record<string,string>> {
 try{return z.record(z.string(),z.string()).parse(JSON.parse(await readFile(file(root),"utf8")));}
 catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return {};throw error;}
}
export function selectExportVersion(root:string,key:string,id:string){return mutations.run(async()=>{const current=await readExportVersions(root);current[key]=id;await atomicWriteJson(file(root),current);});}
