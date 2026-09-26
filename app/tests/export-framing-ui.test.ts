// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExportPreparation, initialExportPreparation } from "../src/components/ExportPreparation";
import { DEFAULT_MAIN_IMAGE, DEFAULT_PREPARATION, type ExportPreparation as Preparation } from "../shared/export-preparation";
import type { ProductSummary } from "../shared/types";
import * as api from "../src/api";
vi.mock("../src/api", () => ({ ApiError: class extends Error {}, getCutoutBatch:vi.fn(), startCutoutBatch:vi.fn(), controlCutoutBatch:vi.fn(), getPhotoroomStatus:vi.fn(), getMainCutouts:vi.fn(), getGallerySelection:vi.fn(), getGenerated:vi.fn(), previewGalleryExport:vi.fn(), approveMainCutout:vi.fn(), removeMainBackground:vi.fn(), thumbnailUrl:vi.fn(()=>"/thumb.png"), imageUrl:vi.fn(()=>"/base.png") }));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,container:HTMLDivElement,latest:Preparation;
const download=vi.fn();
const products=Array.from({length:7},(_,i)=>({id:`rug-${i}`,familyId:`family-${Math.floor(i/3)}`,name:`Rug ${i}`,shape:["area","runner","round"][i%3],baseImage:"base.png"} as ProductSummary));
function Harness({items=products}:{items?:ProductSummary[]}){const [value,setValue]=useState({...DEFAULT_PREPARATION,mainImages:Object.fromEntries(items.map(p=>[p.id,{...DEFAULT_MAIN_IMAGE,frame:true}]))});latest=value;return createElement(ExportPreparation,{products:items,value,onChange:setValue,onBack:vi.fn(),onContinue:download});}
const button=(label:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.trim()===label)!;
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();localStorage.clear();vi.mocked(api.getCutoutBatch).mockResolvedValue(null);vi.mocked(api.getPhotoroomStatus).mockResolvedValue({configured:false});vi.mocked(api.getMainCutouts).mockResolvedValue([]);vi.mocked(api.getGallerySelection).mockResolvedValue({assetIds:[]} as never);vi.mocked(api.getGenerated).mockResolvedValue({active:[],trash:[],aggregates:{}});vi.mocked(api.previewGalleryExport).mockImplementation(async()=>({image:"data:image/webp;base64,AA==",reference:"data:image/png;base64,AA==",width:600,height:600,sourceBytes:100,outputBytes:50,sourceSha256:"a".repeat(64)}));container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();});
it("starts every shape at 5% per edge, previews locally, approves every family and invalidates shared edits",async()=>{
 expect(DEFAULT_MAIN_IMAGE.occupancy).toBe(90);
 await act(async()=>root.render(createElement(Harness)));
 await act(async()=>vi.advanceTimersByTimeAsync(350));
 expect(api.previewGalleryExport).toHaveBeenCalledTimes(7);
 expect(api.removeMainBackground).not.toHaveBeenCalled();
 expect(container.querySelector<HTMLInputElement>('[aria-label="Minimum edge margin"]')?.value).toBe("5");
 await act(async()=>button("Approve all").click());
 expect(Object.values(latest.mainImages).filter(s=>s.reviewedSourceSha256)).toHaveLength(7);
 expect(latest.mainImages['rug-6'].reviewedSourceSha256).toBe('a'.repeat(64));
 expect(button("Next families")).toBeUndefined();
 expect(button("Continue to WebP").disabled).toBe(false);
 await act(async()=>button("Roomy 10%").click());
 await act(async()=>button("Apply to all main images").click());
 expect(Object.values(latest.mainImages).every(s=>s.occupancy===80&&!s.reviewedSourceSha256)).toBe(true);
 expect(button("Continue to WebP").disabled).toBe(true);
 expect(api.removeMainBackground).not.toHaveBeenCalled();
});

it("groups families, rotates on the card, refreshes only that preview and restores the saved draft", async () => {
 await act(async()=>root.render(createElement(Harness)));
 await act(async()=>vi.advanceTimersByTimeAsync(350));
 expect(container.querySelectorAll(".exportPrepFamily")).toHaveLength(3);
 expect([...container.querySelectorAll('.exportPrepFamily')][0].querySelectorAll("figure")).toHaveLength(3);
 await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Rotate family-0 area right"]')!.click());
 expect(latest.mainImages["rug-0"].rotation).toBe(90);
 await act(async()=>vi.advanceTimersByTimeAsync(350));
 expect(api.previewGalleryExport).toHaveBeenCalledTimes(8);
 expect(initialExportPreparation().mainImages["rug-0"].rotation).toBe(90);
 expect(api.removeMainBackground).not.toHaveBeenCalled();
});
it("submits every selected product in one batch and keeps rotation available during processing", async () => {
 vi.mocked(api.getPhotoroomStatus).mockResolvedValue({configured:true});
 vi.mocked(api.startCutoutBatch).mockImplementation(async(ids,id)=>({id,status:"running",updatedAt:new Date().toISOString(),items:ids.map(productId=>({productId,requestId:crypto.randomUUID(),status:"queued"}))}));
 await act(async()=>root.render(createElement(Harness)));
 await act(async()=>button("Remove all backgrounds").click());
 expect(api.startCutoutBatch).toHaveBeenCalledWith(products.map(p=>p.id),expect.any(String));
 expect(api.startCutoutBatch).toHaveBeenCalledTimes(1);
 const rotate=container.querySelector<HTMLButtonElement>('[aria-label="Rotate family-0 area right"]')!;
 expect(rotate.disabled).toBe(false);
 await act(async()=>rotate.click());
 expect(latest.mainImages["rug-0"].rotation).toBe(90);
 expect(button("Pause batch")).toBeDefined();
});

it("keeps preview failures isolated and approves only ready jobs", async () => {
 vi.mocked(api.getCutoutBatch).mockResolvedValue({id:crypto.randomUUID(),status:"completed",updatedAt:new Date().toISOString(),items:[{productId:"rug-1",requestId:crypto.randomUUID(),status:"failed"}]} as never);
 vi.mocked(api.previewGalleryExport).mockRejectedValueOnce(new Error("unreadable image"));
 await act(async()=>root.render(createElement(Harness)));
 await act(async()=>vi.advanceTimersByTimeAsync(350));
 expect(api.previewGalleryExport).toHaveBeenCalledTimes(7);
 await act(async()=>button("Approve all").click());
 expect(latest.mainImages["rug-0"].reviewedSourceSha256).toBeUndefined();
 expect(latest.mainImages["rug-1"].reviewedSourceSha256).toBeUndefined();
 expect(Object.values(latest.mainImages).filter(s=>s.reviewedSourceSha256)).toHaveLength(5);
 expect(button("Continue to WebP").disabled).toBe(true);
});
it("persists transparent canvas settings and offers separate WebP and PNG downloads", async () => {
 await act(async()=>root.render(createElement(Harness)));
 await act(async()=>vi.advanceTimersByTimeAsync(350));
 await act(async()=>container.querySelector<HTMLInputElement>('[aria-label="Transparent background"]')!.click());
 expect(container.querySelector<HTMLInputElement>('[aria-label="Canvas color"]')!.disabled).toBe(true);
 await act(async()=>button("Apply to all main images").click());
 expect(Object.values(latest.mainImages).every(s=>s.transparent&&!s.reviewedSourceSha256)).toBe(true);
 await act(async()=>vi.advanceTimersByTimeAsync(350));
 await act(async()=>button("Approve all").click());
 await act(async()=>button("Continue to WebP").click());
 await act(async()=>vi.advanceTimersByTimeAsync(350));
 await act(async()=>button("Shopify WebPs").click());
 expect(download).toHaveBeenLastCalledWith("webp");
 await act(async()=>button("Room-viewer PNGs").click());
 expect(download).toHaveBeenLastCalledWith("png");
 expect(api.removeMainBackground).not.toHaveBeenCalled();
});

it("shows large collections without pages, reuses previews and approves beyond the search filter", async () => {
 const many=Array.from({length:70},(_,i)=>({...products[0],id:`rug-${i}`,familyId:`family-${i}`}));
 await act(async()=>root.render(createElement(Harness,{items:many})));
 await act(async()=>vi.advanceTimersByTimeAsync(350));
 expect(container.querySelectorAll(".exportPrepFamily")).toHaveLength(70);
 expect(api.previewGalleryExport).toHaveBeenCalledTimes(70);
 await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="Rotate family-69 area right"]')!.click());
 await act(async()=>vi.advanceTimersByTimeAsync(350));
 expect(api.previewGalleryExport).toHaveBeenCalledTimes(71);
 const search=container.querySelector<HTMLInputElement>('input[type="search"]')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(search,"family-69");search.dispatchEvent(new Event("input",{bubbles:true}));});
 expect(container.querySelectorAll(".exportPrepFamily")).toHaveLength(1);
 await act(async()=>button("Approve all").click());
 expect(Object.values(latest.mainImages).filter(s=>s.reviewedSourceSha256)).toHaveLength(70);
 expect(api.previewGalleryExport).toHaveBeenCalledTimes(71);
});
