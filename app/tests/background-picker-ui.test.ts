// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { BackgroundLibraryPanel } from "../src/components/GeneratePanel";
import type { BackgroundLibraryState, ProductSummary } from "../shared/types";

import { getBackgroundRecommendations } from "../src/api";
vi.mock("../src/api", async importOriginal => ({ ...await importOriginal<typeof import("../src/api")>(), getBackgroundRecommendations: vi.fn() }));
beforeEach(() => vi.mocked(getBackgroundRecommendations).mockReset().mockResolvedValue({productId:"rug",status:"not_curated",curatedAt:null,unavailableCount:0,recommendations:[]}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("browses every background with at most48 mounted cards and selects from the final page", async () => {
  const library: BackgroundLibraryState = { manifestPath: null, manifestMtimeMs: null, manifestSha256: null, scannedAt: null,
    labelLogoPath: null, labelLogoExists: false, errors: [], backgrounds: Array.from({ length: 145 }, (_, i) => ({
      id: `room-${i}`, title: `Room ${i}`, type: "interior_living", runnerArchetype: null, runnerShotCompatibility: [],
      previewImagePath: "preview.jpg", promptPath: "prompt.txt", fingerprint: `${i}`, firstSeenAt: "", lastSeenAt: "", usedAt: null, useCount: 0, status: "new"
    })) };
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const onBackgroundChange = vi.fn();
  const product: ProductSummary = { id: "rug", name: "Rug", familyId: "rug", sourceProductId: "rug", shape: "area", status: "ready", baseImage: "base.png", referenceImages: [], createdAt: "", errors: [], counts: { totalShots: 5, accepted: 0, reviewNeeded: 0, failed: 0, running: 0 } };
  const button = (text: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(element => element.getAttribute("aria-label") === text || element.textContent?.trim() === text)!;
  try {
    await act(async () => root.render(createElement(BackgroundLibraryPanel, { product, selectedShot: null, library, selectedBackground: null,
      selectedBackgroundId: null, disabled: false, onManifestSave: vi.fn(), onRescan: vi.fn(), onLabelLogoSave: vi.fn(), onBackgroundChange })));
    await act(async () => button("Choose Background").click());
    const seen = new Set<string>();
    for (let page = 0; page < 4; page++) {
      const cards = container.querySelectorAll<HTMLButtonElement>(".backgroundCard");
      expect(cards.length).toBe(page === 3 ? 1 : 48);
      cards.forEach(card => seen.add(card.querySelector("strong")!.textContent!));
      if (page < 3) await act(async () => button("Next backgrounds").click());
    }
    expect(seen.size).toBe(145);
    expect(button("Next backgrounds").disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>(".backgroundCard")!.click());
    expect(onBackgroundChange).toHaveBeenCalledWith("room-144");
    expect(container.querySelectorAll(".backgroundCard")).toHaveLength(0);
    await act(async () => button("Choose Background").click());
    expect(container.querySelectorAll(".backgroundCard")).toHaveLength(48);
    expect(button("Previous backgrounds").disabled).toBe(true);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

const testLibrary: BackgroundLibraryState = {manifestPath:null,manifestMtimeMs:null,manifestSha256:null,scannedAt:null,labelLogoPath:null,labelLogoExists:false,errors:[],backgrounds:[0,1,2].map(i=>({id:`room-${i}`,title:`Room ${i}`,type:'living',runnerArchetype:null,runnerShotCompatibility:[],previewImagePath:'preview.jpg',promptPath:'prompt.txt',fingerprint:`${i}`,firstSeenAt:'',lastSeenAt:'',usedAt:null,useCount:0,status:i===1?'used':'new'}))};
const testProduct: ProductSummary = {id:'rug',name:'Rug',familyId:'rug',sourceProductId:'rug',shape:'area',status:'ready',baseImage:'base.png',referenceImages:[],createdAt:'',errors:[],counts:{totalShots:5,accepted:0,reviewNeeded:0,failed:0,running:0}};
const picks = (productId='rug') => ({productId,status:'ready' as const,curatedAt:'2026-09-25T00:00:00Z',unavailableCount:0,recommendations:[{backgroundId:'room-2',rank:1,reason:'Calm architecture frames the strong motif.'},{backgroundId:'room-1',rank:2,reason:'Warm timber echoes the ochre.'}]});
async function setupPicker() {
 const container=document.createElement('div');document.body.append(container);const root=createRoot(container);const onBackgroundChange=vi.fn();
 const render = async (product=testProduct) => {await act(async()=>root.render(createElement(BackgroundLibraryPanel,{product,selectedShot:null,library:testLibrary,selectedBackground:null,selectedBackgroundId:null,disabled:false,onManifestSave:vi.fn(),onRescan:vi.fn(),onLabelLogoSave:vi.fn(),onBackgroundChange})));};
 const button=(name:string)=>[...container.querySelectorAll<HTMLButtonElement>('button')].find(el=>el.getAttribute('aria-label')===name || el.textContent?.trim()===name)!;
 const recommended=()=>container.querySelector<HTMLButtonElement>('.backgroundFilters button')!;
 const click=async(el:HTMLButtonElement)=>{await act(async()=>el.click());};
 await render();await click(button('Choose Background'));
 return {container,root,render,button,recommended,click,onBackgroundChange,close:async()=>{await act(async()=>root.unmount());container.remove();}};
}
it('shows curated order and reasons, keeps New/Used browsing and uses the existing selection callback',async()=>{
 vi.mocked(getBackgroundRecommendations).mockResolvedValue(picks());const p=await setupPicker();
 try {await p.click(p.recommended());
 expect([...p.container.querySelectorAll('.backgroundCard strong')].map(el=>el.textContent)).toEqual(['1. Room 2','2. Room 1']);
 expect(p.container.textContent).toContain('Calm architecture');expect(p.button('Next backgrounds')).toBeUndefined();expect(p.container.querySelector('[role=dialog]')?.textContent).not.toContain('Shuffle');
 await p.click(p.button('used'));expect(p.container.querySelectorAll('.backgroundCard')).toHaveLength(1);
 await p.click(p.recommended());await p.click(p.container.querySelector<HTMLButtonElement>('.backgroundCard')!);
 expect(p.onBackgroundChange).toHaveBeenCalledWith('room-2');expect(p.container.querySelector('[role=dialog]')).toBeNull();
 }finally{await p.close();}
});
it('recovers from a failed recommendation request and leaves All available',async()=>{
 vi.mocked(getBackgroundRecommendations).mockRejectedValueOnce(new Error('network')).mockResolvedValue(picks());const p=await setupPicker();
 try{await p.click(p.recommended());expect(p.container.textContent).toContain('Couldn’t load');await p.click(p.button('Try again'));expect(p.container.querySelectorAll('.backgroundRecommendationCard')).toHaveLength(2);
 }finally{await p.close();}
});
it('explains stale recommendations and never silently substitutes rooms',async()=>{
 vi.mocked(getBackgroundRecommendations).mockResolvedValue({...picks(),status:'stale',recommendations:[]});const p=await setupPicker();
 try{await p.click(p.recommended());expect(p.container.textContent).toContain('image has changed');expect(p.container.querySelectorAll('.backgroundCard')).toHaveLength(0);await p.click(p.button('Browse all backgrounds'));expect(p.container.querySelectorAll('.backgroundCard')).toHaveLength(3);}finally{await p.close();}
});
it('ignores a late response for the previous rug and aborts its request',async()=>{
 let resolveOld!:(value:ReturnType<typeof picks>)=>void;
 vi.mocked(getBackgroundRecommendations).mockImplementationOnce(()=>new Promise(resolve=>{resolveOld=resolve;})).mockResolvedValueOnce({...picks('other'),recommendations:[{backgroundId:'room-0',rank:1,reason:'For the next rug.'}]});
 const p=await setupPicker();
 try{const signal=vi.mocked(getBackgroundRecommendations).mock.calls[0][2];await p.render({...testProduct,id:'other'});expect(signal?.aborted).toBe(true);await p.click(p.recommended());await act(async()=>resolveOld(picks()));expect(p.container.querySelector('.backgroundCard strong')?.textContent).toBe('1. Room 0');expect(p.container.textContent).not.toContain('Calm architecture');}finally{await p.close();}
});
it('closes on Escape and restores the invoking button focus',async()=>{
 const p=await setupPicker();try{
 await p.click(p.button('Close background picker'));const trigger=p.button('Choose Background');trigger.focus();await p.click(trigger);
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(p.container.querySelector('[role=dialog]')).toBeNull();expect(document.activeElement).toBe(trigger);
 }finally{await p.close();}
});
