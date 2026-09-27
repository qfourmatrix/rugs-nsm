// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { MainImageTools } from "../src/components/MainImageTools";
import * as api from "../src/api";
vi.mock("../src/api",()=>({ApiError:class extends Error{},applyTopDown:vi.fn(),cutoutPreviewUrl:vi.fn(()=>"/cutout"),generateTopDown:vi.fn(),getJobs:vi.fn(),getMainCutouts:vi.fn(),getTopDown:vi.fn(),imageUrl:vi.fn((id,kind,file)=>`/${id}/${kind}/${file}`),restoreCutout:vi.fn(),topDownOriginalUrl:vi.fn(()=>"/original")}));
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,container:HTMLDivElement;const changed=vi.fn(),cutout=vi.fn();
const button=(name:string)=>[...container.querySelectorAll<HTMLButtonElement>("button")].find(b=>b.textContent===name)!;
beforeEach(()=>{vi.useFakeTimers();vi.clearAllMocks();vi.mocked(api.getMainCutouts).mockResolvedValue([]);vi.mocked(api.getJobs).mockResolvedValue([]);vi.mocked(api.getTopDown).mockResolvedValue({sourceSha256:"a".repeat(64),originalSha256:null,canRestore:false,candidates:[]});vi.mocked(api.generateTopDown).mockResolvedValue({runId:"one",jobIds:["one"]});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();});
it("restores a keyboard lasso only on explicit click, without generating an image",async()=>{
 vi.mocked(api.restoreCutout).mockResolvedValue({id:"new",status:"ready"} as never);
 await act(async()=>root.render(createElement(MainImageTools,{productId:"rug",baseImage:"base.jpg",cutoutId:crypto.randomUUID(),onCutout:cutout,onBaseChanged:changed})));
 await act(async()=>button("Restore with lasso").click());
 const svg=container.querySelector("svg[role=application]")!;
 const key=async(value:string)=>act(async()=>svg.dispatchEvent(new KeyboardEvent("keydown",{key:value,bubbles:true})));
 await key("Enter");await key("ArrowRight");await key("Enter");await key("ArrowDown");await key("Enter");
 expect(api.restoreCutout).not.toHaveBeenCalled();expect(button("Restore area").disabled).toBe(false);
 await act(async()=>button("Restore area").click());
 expect(api.restoreCutout).toHaveBeenCalledTimes(1);expect(cutout).toHaveBeenCalledWith(expect.objectContaining({id:"new"}));
 expect(api.generateTopDown).not.toHaveBeenCalled();
 await act(async()=>container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());
 expect(container.querySelector("img")?.getAttribute("src")).toBe("/rug/base/base.jpg");
});
it("does not generate on opening, prevents duplicate clicks and accepts only an explicit candidate",async()=>{
 await act(async()=>root.render(createElement(MainImageTools,{productId:"rug",baseImage:"base.png",onCutout:cutout,onBaseChanged:changed})));
 await act(async()=>button("Make top-down").click());expect(api.generateTopDown).not.toHaveBeenCalled();
 await act(async()=>{button("Generate top-down").click();button("Generate top-down").click();});expect(api.generateTopDown).toHaveBeenCalledTimes(1);
 vi.mocked(api.getJobs).mockResolvedValue([{jobId:"one",shotId:"top_down_base",status:"succeeded",createdAt:new Date().toISOString(),assetId:"new"}] as never);
 vi.mocked(api.getTopDown).mockResolvedValue({sourceSha256:"a".repeat(64),originalSha256:"a".repeat(64),canRestore:false,candidates:[{assetId:"new",file:"new.png",createdAt:new Date().toISOString()}]});
 await act(async()=>vi.advanceTimersByTimeAsync(1500));
 expect(api.applyTopDown).not.toHaveBeenCalled();
 vi.mocked(api.applyTopDown).mockResolvedValue({sourceSha256:"b".repeat(64)});
 await act(async()=>button("Accept").click());
 expect(api.applyTopDown).toHaveBeenCalledWith("rug","a".repeat(64),"new");expect(changed).toHaveBeenCalledWith("b".repeat(64));
});
