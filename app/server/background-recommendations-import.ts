import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BackgroundRecommendationsPackSchema, BACKGROUND_RECOMMENDATIONS_FILENAME, type BackgroundRecommendationsPack } from '../shared/background-recommendations';
import { scanProducts } from './scanner';

export async function importBackgroundRecommendations({productRoot, pack, apply = false}: {productRoot:string;pack:BackgroundRecommendationsPack;apply?:boolean}) {
  pack = BackgroundRecommendationsPackSchema.parse(pack);
  if (!(await fs.lstat(productRoot)).isDirectory()) throw new Error('Catalog must already exist.');
  const {products} = await scanProducts({productRoot});
  const byId = new Map(products.map(product=>[product.id,product]));
  const accepted: typeof pack.products = [];
  const skipped: {productId:string;reason:string}[] = [];
  for (const entry of pack.products) {
    const product=byId.get(entry.productId);
    const base=product?.baseImage ? await fs.lstat(path.join(productRoot,product.id,product.baseImage)).catch(()=>null) : null;
    if (!product || product.status!=='ready' || product.shape!==entry.shape || product.baseImage!==entry.baseImage.file || !base?.isFile() || base.size!==entry.baseImage.size || Math.trunc(base.mtimeMs)!==entry.baseImage.mtimeMs) {
      skipped.push({productId:entry.productId,reason:'Missing, invalid or changed source rug.'});
    } else accepted.push(entry);
  }
  const directory=path.join(productRoot,'.product-shot-queue');
  const directoryInfo=await fs.lstat(directory).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
  if(directoryInfo && !directoryInfo.isDirectory())throw new Error('Catalog settings must be a real directory.');
  const filename=path.join(directory,BACKGROUND_RECOMMENDATIONS_FILENAME);
  const readExisting=async()=>{
    const info=await fs.lstat(filename).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
    if(!info)return null;
    if(!info.isFile() || info.size>4*1024*1024)throw new Error('Existing pack is not a regular, bounded file.');
    return {text:await fs.readFile(filename,'utf8')};
  };
  const merge=async()=>{
    const existing=await readExisting();
    const previous=existing ? BackgroundRecommendationsPackSchema.parse(JSON.parse(existing.text)) : null;
    const merged=new Map(previous?.products.map(item=>[item.productId,item]) ?? []);
    for(const entry of accepted)merged.set(entry.productId,entry);
    const result=BackgroundRecommendationsPackSchema.parse({...pack,products:[...merged.values()]});
    const changed=accepted.length>0 && JSON.stringify(previous)!==JSON.stringify(result);
    return {existing,result,changed};
  };
  if(!apply){const {changed}=await merge();return {applied:false,changed,accepted:accepted.length,skipped,backup:null as string|null};}
  await fs.mkdir(directory,{recursive:true});
  const lockPath=path.join(directory,'.background-recommendations-import.lock');
  const lock=await fs.open(lockPath,'wx',0o600);
  const temporary=filename+'.'+randomUUID()+'.tmp';
  try {
    const {existing,result,changed}=await merge();
    if(!changed)return {applied:false,changed:false,accepted:accepted.length,skipped,backup:null};
    const backup=existing ? filename+'.backup-'+randomUUID() : null;
    if(backup)await fs.copyFile(filename,backup,constants.COPYFILE_EXCL);
    await fs.writeFile(temporary,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
    await fs.rename(temporary,filename);
    return {applied:true,changed:true,accepted:accepted.length,skipped,backup};
  } finally {
    await fs.rm(temporary,{force:true});
    await lock.close();await fs.unlink(lockPath);
  }
}
