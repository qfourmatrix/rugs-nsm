import { mkdtemp, mkdir, writeFile, stat, rm, unlink, rename, utimes, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { getProductBackgroundRecommendations } from '../server/background-recommendations';
import { BackgroundRecommendationsPackSchema, type BackgroundRecommendationsPack } from '../shared/background-recommendations';
import type { ProductSummary, BackgroundRecord } from '../shared/types';
let root: string, filename: string, pack: BackgroundRecommendationsPack;
const product: ProductSummary = { id:'rug', name:'Rug', familyId:'rug', sourceProductId:'rug', shape:'area', status:'ready', baseImage:'base.png', referenceImages:[], createdAt:'', errors:[], counts:{totalShots:5,accepted:0,reviewNeeded:0,failed:0,running:0} };
const room = (id: string, type='living'): BackgroundRecord => ({id,title:id,type,runnerArchetype:null,runnerShotCompatibility:[],previewImagePath:'preview.jpg',promptPath:null,fingerprint:id,firstSeenAt:'',lastSeenAt:'',usedAt:null,useCount:0,status:'new'});
const backgrounds = [room('two'),room('one'),room('hall','runner_hallway')];
const read = (overrides = {}) => getProductBackgroundRecommendations({productRoot:root,product,backgrounds,shotId:'wide_room_hero',...overrides});
const save = () => writeFile(filename,JSON.stringify(pack));
beforeEach(async () => {
 root=await mkdtemp(path.join(os.tmpdir(),'recommendations-'));
 await mkdir(path.join(root,'rug'));
 await mkdir(path.join(root,'.product-shot-queue'));
 await writeFile(path.join(root,'rug','base.png'),'source');
 const info=await stat(path.join(root,'rug','base.png'));
 filename=path.join(root,'.product-shot-queue','background-recommendations.json');
 pack={version:1,curatedAt:'2026-09-25T00:00:00Z',products:[{productId:'rug',shape:'area',baseImage:{file:'base.png',size:info.size,mtimeMs:Math.trunc(info.mtimeMs)},recommendations:[{backgroundId:'one',reason:'Quiet architecture.'},{backgroundId:'two',reason:'Warm timber.'}]}]};
});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
it('keeps curated rank regardless of library order and allows inline prompts without changing the catalog',async()=>{
 await save(); const before=await stat(filename); const result=await read();
 expect(result.status).toBe('ready'); expect(result.recommendations.map(r=>[r.backgroundId,r.rank])).toEqual([['one',1],['two',2]]);
 expect(result.recommendations[0].reason).toBe('Quiet architecture.');
 expect((await stat(filename)).mtimeMs).toBe(before.mtimeMs);
 expect(await readdir(path.join(root,'.product-shot-queue'))).toEqual(['background-recommendations.json']);
});
it('isolates products and detects changed base metadata, names, and shape',async()=>{
 await save();
 expect((await read({product:{...product,id:'other'}})).status).toBe('not_curated');
 expect((await read({product:{...product,shape:'round'}})).status).toBe('stale');
 expect((await read({product:{...product,baseImage:'different.png'}})).status).toBe('stale');
 await utimes(path.join(root,'rug','base.png'),new Date(),new Date('2026-01-01'));
 expect((await read()).status).toBe('stale');
});
it('removes unavailable and incompatible rooms without reranking or falling back',async()=>{
 pack.products[0].recommendations.splice(1,0,{backgroundId:'hall',reason:'Wrong shape'},{backgroundId:'retired',reason:'Gone'}); await save();
 const result=await read(); expect(result.recommendations.map(r=>r.rank)).toEqual([1,4]); expect(result.unavailableCount).toBe(2);
 expect((await read({backgrounds:[]})).status).toBe('unavailable');
 expect((await read({shotId:'topdown'})).status).toBe('not_applicable');
});
it('only recommends Runner rooms for Runner room shots',async()=>{
 pack.products[0].shape='runner'; pack.products[0].recommendations.push({backgroundId:'hall',reason:'Clear lane.'}); await save();
 expect((await read({product:{...product,shape:'runner'}})).recommendations.map(r=>r.backgroundId)).toEqual(['hall']);
});
it('handles absent, corrupt, atomically replaced and deleted packs',async()=>{
 expect((await read()).status).toBe('not_curated'); await writeFile(filename,'broken'); expect((await read()).status).toBe('unavailable');
 await save(); expect((await read()).recommendations).toHaveLength(2);
 pack.products[0].recommendations.reverse(); await writeFile(filename+'.next',JSON.stringify(pack)); await rename(filename+'.next',filename);
 expect((await read()).recommendations[0].backgroundId).toBe('two');
 await unlink(filename); expect((await read()).status).toBe('not_curated');
});
it('rejects ambiguous or unsafe packs',()=>{
 const entry=pack.products[0];
 expect(BackgroundRecommendationsPackSchema.safeParse({...pack,products:[entry,entry]}).success).toBe(false);
 expect(BackgroundRecommendationsPackSchema.safeParse({...pack,products:[{...entry,productId:'../rug'}]}).success).toBe(false);
 expect(BackgroundRecommendationsPackSchema.safeParse({...pack,products:[{...entry,recommendations:[entry.recommendations[0],entry.recommendations[0]]}]}).success).toBe(false);
});

it('previews imports without writes, merges unrelated entries, backs up and is idempotent',async()=>{
 const { importBackgroundRecommendations }=await import('../server/background-recommendations-import');
 const other={...pack.products[0],productId:'unrelated'};await writeFile(filename,JSON.stringify({...pack,products:[other]}));
 const original=await (await import('node:fs/promises')).readFile(filename,'utf8');
 const preview=await importBackgroundRecommendations({productRoot:root,pack});expect(preview.applied).toBe(false);expect(preview.accepted).toBe(1);
 expect(await (await import('node:fs/promises')).readFile(filename,'utf8')).toBe(original);
 const result=await importBackgroundRecommendations({productRoot:root,pack,apply:true});expect(result.applied).toBe(true);expect(result.backup).toBeTruthy();
 expect(await (await import('node:fs/promises')).readFile(result.backup!,'utf8')).toBe(original);
 expect(JSON.parse(await (await import('node:fs/promises')).readFile(filename,'utf8')).products.map((p:{productId:string})=>p.productId)).toEqual(['unrelated','rug']);
 expect((await importBackgroundRecommendations({productRoot:root,pack,apply:true})).changed).toBe(false);
 await writeFile(path.join(root,'rug','base.png'),'changed');
 expect((await importBackgroundRecommendations({productRoot:root,pack,apply:true})).skipped.map(item=>item.productId)).toEqual(['rug']);
});
