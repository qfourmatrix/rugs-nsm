import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { scanProducts } from "./scanner";
import { atomicWriteJson, ensureDir, imageMimeType, safeChildPath, sha256File } from "./fsUtils";
import { conflictError, notFoundError, validationError } from "./errors";
import { getAssetRecord, listGeneratedAssets } from "./asset-store";
import { getCutout, resolveCutout, type MainImageCutout } from "./main-image-cutouts";
import { WorkScheduler } from "./work-scheduler";
import { RestorePolygonSchema, TOP_DOWN_SHOT_ID, type TopDownState } from "../shared/main-image-tools";
const operations = new WorkScheduler(1, 100);
const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
async function base(root: string, productId: string) {
  const product = (await scanProducts({productRoot:root,productId})).products.find(p=>p.id===productId);
  if (!product?.baseImage || product.status !== "ready") throw notFoundError("MAIN_IMAGE_NOT_FOUND", "A valid main image is required.");
  const file = safeChildPath(safeChildPath(root, productId), product.baseImage);
  return { file, filename: product.baseImage, hash: await sha256File(file) };
}
const store = (root: string, id: string) => safeChildPath(path.join(root,".product-shot-queue","main-image-originals"),id);
const OriginalSchema = z.object({ filename:z.string(), sha256:z.string(), createdAt:z.string() });
async function original(root:string,id:string) {
  let record:z.infer<typeof OriginalSchema>;
  try {record=OriginalSchema.parse(JSON.parse(await fs.readFile(path.join(store(root,id),"original.json"),"utf8")));}
  catch(error) {if((error as NodeJS.ErrnoException).code==="ENOENT")return null;throw error;}
  const file=safeChildPath(store(root,id),record.filename);
  let actual:string;try{actual=await sha256File(file);}catch{throw conflictError("ORIGINAL_MISSING","Preserved original is unavailable. Recover it from backup before continuing.");}
  if(actual!==record.sha256)throw conflictError("ORIGINAL_CHANGED","Preserved original changed. Recover it from backup before continuing.");
  return {...record,file};
}
export function preserveMainOriginal(root:string,id:string) {
  return operations.run(async()=>{
    const saved=await original(root,id);if(saved)return saved;
    const source=await base(root,id);const dir=store(root,id);await ensureDir(dir);
    const data=await fs.readFile(source.file);if(hash(data)!==source.hash)throw conflictError("SOURCE_CHANGED","Main image changed. Try again after reviewing it.");
    const file=safeChildPath(dir,source.filename);await fs.writeFile(file,data,{flag:"wx"}).catch(async error=>{if(error.code!=="EEXIST"||await sha256File(file)!==source.hash)throw error;});
    const record={filename:source.filename,sha256:source.hash,createdAt:new Date().toISOString()};
    await atomicWriteJson(path.join(dir,"original.json"),record);
    return {...record,file};
  });
}
export async function getTopDownState(root:string,id:string):Promise<TopDownState> {
  const source=await base(root,id);const saved=await original(root,id);
  const generated=await listGeneratedAssets({productRoot:root,productId:id});
  return {sourceSha256:source.hash,originalSha256:saved?.sha256??null,canRestore:!!saved&&source.hash!==saved.sha256,
    candidates:generated.active.filter(a=>a.shotId===TOP_DOWN_SHOT_ID&&a.output&&["done","review_needed","accepted"].includes(a.status)&&a.inputs.baseImage.sha256===saved?.sha256)
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(a=>({assetId:a.assetId,file:a.output!.file,createdAt:a.createdAt}))};
}
export async function topDownOriginalPath(root:string,id:string) {
  return (await original(root,id))?.file ?? (await base(root,id)).file;
}
export function changeMainImage(root:string,id:string,expectedHash:string,assetId?:string,upload?:Buffer) {
  return operations.run(async()=>{
    const current=await base(root,id);const saved=await original(root,id);
    if(!saved)throw conflictError("ORIGINAL_MISSING","No preserved original is available.");
    if(current.hash!==expectedHash)throw conflictError("SOURCE_CHANGED","Main image changed. Reload the preview before accepting or restoring.");
    let data:Buffer;
    let uploadedPng:Buffer|undefined;
    if(upload){
      if(upload.length>40*1024*1024)throw validationError("IMAGE_TOO_LARGE","Choose an image under 40 MB.");
      try {
        const image=sharp(upload,{limitInputPixels:40_000_000});const metadata=await image.metadata();
        if(!["png","jpeg","webp"].includes(metadata.format??"")||(metadata.pages??1)>1)throw Error("Unsupported format");
        uploadedPng=await image.autoOrient().toColourspace("srgb").png().toBuffer();
        const normalized=sharp(uploadedPng);const mime=imageMimeType(current.filename);
        data=await (mime==="image/jpeg"?normalized.flatten({background:"#ffffff"}).jpeg({quality:100,chromaSubsampling:"4:4:4"}):mime==="image/webp"?normalized.webp({lossless:true}):normalized.png()).toBuffer();
      } catch {throw validationError("INVALID_IMAGE","Choose a valid, single-image PNG, JPEG or WebP under 40 megapixels.");}
    }else if(assetId){
      const found=await getAssetRecord({productRoot:root,productId:id,assetId});const asset=found.asset;
      if(found.location!=="generated"||asset.productId!==id||asset.shotId!==TOP_DOWN_SHOT_ID||!asset.output||!["done","review_needed","accepted"].includes(asset.status)||asset.inputs.baseImage.sha256!==saved.sha256)throw conflictError("INVALID_TOP_DOWN","Choose a completed top-down result made from this original.");
      const image=sharp(safeChildPath(path.join(root,id,"generated"),asset.output.file)).autoOrient();
      const mime=imageMimeType(current.filename);
      data=await (mime==="image/jpeg"?image.jpeg({quality:100,chromaSubsampling:"4:4:4"}):mime==="image/webp"?image.webp({lossless:true}):image.png()).toBuffer();
    }else{
      if(current.filename!==saved.filename)throw conflictError("BASE_RENAMED","Main-image filename changed. Restore the original manually.");
      data=await fs.readFile(saved.file);
    }
    let cutout:MainImageCutout|undefined;
    if(uploadedPng&&(await sharp(uploadedPng).stats()).isOpaque===false){
      const cutoutDir=path.join(root,".product-shot-queue","main-image-cutouts");await ensureDir(cutoutDir);
      cutout={id:randomUUID(),productId:id,sourceSha256:hash(data),outputSha256:hash(uploadedPng),status:"ready",approved:false,createdAt:new Date().toISOString(),uncertainty:null,error:null,provider:"manual"};
      await fs.writeFile(path.join(cutoutDir,`${cutout.id}.png`),uploadedPng,{flag:"wx"});
      await atomicWriteJson(path.join(cutoutDir,`${cutout.id}.json`),cutout);
    }
    // Record intent and preserve every replaced version before the atomic swap.
    const dir=store(root,id);const prior=safeChildPath(dir,`${current.hash}-${current.filename}`);
    await fs.copyFile(current.file,prior);
    await atomicWriteJson(path.join(dir,`${randomUUID()}.json`),{operation:upload?"upload":assetId?"accept":"restore",assetId:assetId??null,previousSha256:current.hash,nextSha256:hash(data),originalSha256:saved.sha256,createdAt:new Date().toISOString()});
    if(await sha256File(current.file)!==current.hash)throw conflictError("SOURCE_CHANGED","Main image changed during preparation. No replacement was made.");
    const temporary=safeChildPath(path.dirname(current.file),`.main-${randomUUID()}.tmp`);
    try {const handle=await fs.open(temporary,"wx");try{await handle.writeFile(data);await handle.sync();}finally{await handle.close();}await fs.rename(temporary,current.file);}finally{await fs.rm(temporary,{force:true});}
    return {sourceSha256:hash(data),cutout};
  });
}
export async function cutoutImagePath(root:string,id:string) {
  const record=await getCutout(root,id);const source=await base(root,record.productId);
  return (await resolveCutout(root,record.productId,id,source.hash,false)).file;
}
export function restoreCutoutPolygon(root:string,id:string,input:unknown) {
  const parsed=RestorePolygonSchema.parse(input);
  return operations.run(async()=>{
    const parent=await getCutout(root,id);const source=await base(root,parent.productId);
    const resolved=await resolveCutout(root,parent.productId,id,source.hash,false);
    const signature=hash(JSON.stringify([id,parsed.points,source.hash]));
    const dir=path.join(root,".product-shot-queue","main-image-cutouts");const target=safeChildPath(dir,`${parsed.requestId}.json`);
    try {const existing=JSON.parse(await fs.readFile(target,"utf8")) as MainImageCutout & {repairSignature?:string};if(existing.repairSignature!==signature)throw conflictError("REPAIR_ID_REUSED","This repair ID belongs to another selection.");await resolveCutout(root,parent.productId,existing.id,source.hash,false);return existing;}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
    const cutout=await sharp(resolved.file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const {width,height}=cutout.info;
    const originalImage=sharp(source.file).autoOrient().toColourspace("srgb");const dimensions=await originalImage.metadata();
    const originalWidth=dimensions.autoOrient.width,originalHeight=dimensions.autoOrient.height;
    if(Math.abs(originalWidth/originalHeight-width/height)>.01)throw conflictError("CUTOUT_ALIGNMENT","Cutout no longer aligns with the original image.");
    const pixels=await originalImage.resize(width,height,{fit:"fill"}).ensureAlpha().raw().toBuffer();
    const polygon=parsed.points.map(p=>`${p.x*width},${p.y*height}`).join(" ");
    const mask=await sharp(Buffer.from(`<svg width="${width}" height="${height}"><polygon points="${polygon}" fill="white"/></svg>`)).ensureAlpha().extractChannel("alpha").raw().toBuffer();
    for(let i=0;i<mask.length;i++)if(mask[i]>=128)pixels.copy(cutout.data,i*4,i*4,i*4+4);
    const output=await sharp(cutout.data,{raw:{width,height,channels:4}}).png().toBuffer();
    if(await sha256File(source.file)!==source.hash)throw conflictError("SOURCE_CHANGED","Main image changed during repair. Select the area again.");
    const record={...parent,id:parsed.requestId,parentId:id,provider:"manual" as const,approved:false,createdAt:new Date().toISOString(),outputSha256:hash(output),repairSignature:signature,restorePoints:parsed.points};
    const imageFile=safeChildPath(dir,`${parsed.requestId}.png`);
    await fs.writeFile(imageFile,output,{flag:"wx"}).catch(async error=>{if(error.code!=="EEXIST"||await sha256File(imageFile)!==hash(output))throw error;});
    await atomicWriteJson(target,record);return record;
  });
}
