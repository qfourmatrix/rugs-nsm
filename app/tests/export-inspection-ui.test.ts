// @vitest-environment jsdom
import {act,createElement} from "react";
import {createRoot} from "react-dom/client";
import {expect,it} from "vitest";
import {ExportImageComparison,imageDataBytes} from "../src/components/ExportImageComparison";
import {initialExportPreparation} from "../src/components/ExportPreparation";
import {DEFAULT_PREPARATION,DEFAULT_MAIN_IMAGE} from "../shared/export-preparation";
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
it("shows current sizes, marks stale sizes and synchronizes keyboard zoom without changing the draft",async()=>{
 const div=document.createElement("div");document.body.append(div);const root=createRoot(div);
 const preview={image:"data:image/webp;base64,AAAA",reference:"data:image/png;base64,AAAA",sourceBytes:2097152,outputBytes:68000,width:1024,height:1024,sourceSha256:"a".repeat(64)};
 try{
 await act(async()=>root.render(createElement(ExportImageComparison,{preview,current:true,busy:false,actualSize:false,transparent:true})));
 expect(div.textContent).toContain("WebP: 66.4 KB");expect(div.textContent).toContain("Original file: 2.00 MB");
 const pane=div.querySelector('[role="button"]')!;
 await act(async()=>pane.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true})));
 expect(div.querySelector('.exportInspection')?.classList.contains('isInspecting')).toBe(true);
 expect((div.querySelector('.exportInspection') as HTMLElement).style.getPropertyValue('--inspect-x')).toBe('55%');
 await act(async()=>pane.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));
 expect(div.querySelector('.exportInspection')?.classList.contains('isInspecting')).toBe(false);
 await act(async()=>root.render(createElement(ExportImageComparison,{preview,current:false,busy:true,actualSize:false,transparent:true})));
 expect(div.textContent).toContain("Updating file size…");expect(div.textContent).toContain("not the current settings");
 }finally{await act(async()=>root.unmount());div.remove();}
 expect(imageDataBytes('data:image/png;base64,YQ==')).toBe(1);
 expect(imageDataBytes('data:image/png;base64,YWI=')).toBe(2);
});
it("restores saved main-image framing, selected cutout and source review after reopening",()=>{
 const draft={...DEFAULT_PREPARATION,mainImages:{rug:{...DEFAULT_MAIN_IMAGE,rotation:90,transparent:true,frame:true,cutoutId:'11111111-1111-4111-8111-111111111111',reviewedSourceSha256:'a'.repeat(64)}}};
 localStorage.setItem('rugs-studio-export-draft-v1',JSON.stringify(draft));
 expect(initialExportPreparation()).toEqual(draft);localStorage.clear();
});
