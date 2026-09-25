// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExportPreparation } from "../src/components/ExportPreparation";
import { DEFAULT_MAIN_IMAGE, DEFAULT_PREPARATION, type ExportPreparation as Preparation } from "../shared/export-preparation";
import type { ProductSummary } from "../shared/types";
import * as api from "../src/api";
vi.mock("../src/api", () => ({ getPhotoroomStatus:vi.fn(), getMainCutouts:vi.fn(), getGallerySelection:vi.fn(), getGenerated:vi.fn(), previewGalleryExport:vi.fn(), approveMainCutout:vi.fn(), removeMainBackground:vi.fn(), thumbnailUrl:vi.fn(()=>"/thumb.png"), imageUrl:vi.fn(()=>"/base.png") }));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,container:HTMLDivElement,latest:Preparation;
const products=Array.from({length:7},(_,i)=>({id:`rug-${i}`,name:`Rug ${i}`,shape:["area","runner","round"][i%3],baseImage:"base.png"} as ProductSummary));
function Harness(){const [value,setValue]=useState({...DEFAULT_PREPARATION,mainImages:Object.fromEntries(products.map(p=>[p.id,{...DEFAULT_MAIN_IMAGE,frame:true}]))});latest=value;return createElement(ExportPreparation,{products,value,onChange:setValue,onBack:vi.fn(),onContinue:vi.fn()});}
const button=(label:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent?.trim()===label)!;
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();localStorage.clear();vi.mocked(api.getPhotoroomStatus).mockResolvedValue({configured:false});vi.mocked(api.getMainCutouts).mockResolvedValue([]);vi.mocked(api.getGallerySelection).mockResolvedValue({assetIds:[]} as never);vi.mocked(api.getGenerated).mockResolvedValue({active:[],trash:[],aggregates:{}});vi.mocked(api.previewGalleryExport).mockImplementation(async()=>({image:"data:image/webp;base64,AA==",reference:"data:image/png;base64,AA==",width:600,height:600,sourceBytes:100,outputBytes:50,sourceSha256:"a".repeat(64)}));container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();});
it("starts every shape at 5% per edge, previews locally, approves only the visible page and invalidates shared edits",async()=>{
 expect(DEFAULT_MAIN_IMAGE.occupancy).toBe(90);
 await act(async()=>root.render(createElement(Harness)));
 await act(async()=>vi.advanceTimersByTimeAsync(350));
 expect(api.previewGalleryExport).toHaveBeenCalledTimes(6);
 expect(api.removeMainBackground).not.toHaveBeenCalled();
 expect(container.querySelector<HTMLInputElement>('[aria-label="Minimum edge margin"]')?.value).toBe("5");
 await act(async()=>button("Approve this page").click());
 expect(Object.values(latest.mainImages).filter(s=>s.reviewedSourceSha256)).toHaveLength(6);
 expect(latest.mainImages['rug-6'].reviewedSourceSha256).toBeUndefined();
 expect(button("Continue to WebP").disabled).toBe(true);
 await act(async()=>button("Next page").click());
 await act(async()=>vi.advanceTimersByTimeAsync(350));
 await act(async()=>button("Approve this page").click());
 expect(button("Continue to WebP").disabled).toBe(false);
 await act(async()=>button("Roomy 10%").click());
 await act(async()=>button("Apply to all main images").click());
 expect(Object.values(latest.mainImages).every(s=>s.occupancy===80&&!s.reviewedSourceSha256)).toBe(true);
 expect(button("Continue to WebP").disabled).toBe(true);
 expect(api.removeMainBackground).not.toHaveBeenCalled();
});
