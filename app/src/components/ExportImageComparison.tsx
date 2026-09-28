import {useRef,useState} from "react";
import type {ExportPreview} from "../../shared/export-preparation";
const size=(n:number)=>n>=1048576?`${(n/1048576).toFixed(2)} MB`:`${(n/1024).toFixed(1)} KB`;
export function imageDataBytes(uri:string){const encoded=uri.split(",")[1]??"";return Math.max(0,Math.floor(encoded.length*3/4)-(encoded.endsWith("==")?2:encoded.endsWith("=")?1:0));}
export function ExportImageComparison({preview,current,busy,actualSize,transparent}:{preview:ExportPreview;current:boolean;busy:boolean;actualSize:boolean;transparent:boolean}){
 const root=useRef<HTMLDivElement>(null);
 const [hover,setHover]=useState(false);const [pinned,setPinned]=useState(false);
 const point=useRef({x:50,y:50});
 const move=(x:number,y:number)=>{point.current={x:Math.max(0,Math.min(100,x)),y:Math.max(0,Math.min(100,y))};root.current?.style.setProperty("--inspect-x",`${point.current.x}%`);root.current?.style.setProperty("--inspect-y",`${point.current.y}%`);};
 const active=!actualSize&&(hover||pinned);
 return <div ref={root} className={`exportInspection ${active?"isInspecting":""}`}>
   <div className="exportSizeSummary" role="status"><strong>{current?`WebP: ${size(preview.outputBytes)}`:busy?"Updating file size…":"File size needs refresh"}</strong><span>{current?`${preview.width} × ${preview.height} px · Original file: ${size(preview.sourceBytes)}`:`Previous preview: ${size(preview.outputBytes)} · not the current settings`}</span></div>
   {!actualSize&&<p className="exportInspectHint">Hover over either image to inspect both at 3×. Click or tap to hold zoom; use arrow keys to move, Escape to reset.</p>}
   <div className={`exportPrepCompare ${transparent?"isTransparent":""} ${actualSize?"isActualSize":""}`}>
    {[{src:preview.reference,label:"Prepared image · before compression",alt:"Prepared image before WebP compression",bytes:imageDataBytes(preview.reference)},{src:preview.image,label:"WebP",alt:"Actual WebP output at the selected settings",bytes:preview.outputBytes}].map(item=><figure key={item.label}>
      <figcaption><span>{item.label}</span><strong>{size(item.bytes)}{!current&&<small> · previous preview</small>}</strong></figcaption>
      <div className="exportInspectPane" tabIndex={0} role="button" aria-label={`Inspect ${item.label}`} aria-pressed={pinned} onPointerEnter={e=>{if(e.pointerType==="mouse")setHover(true);}} onPointerLeave={()=>setHover(false)} onPointerMove={e=>{if(actualSize)return;const rect=e.currentTarget.getBoundingClientRect();move((e.clientX-rect.left)/rect.width*100,(e.clientY-rect.top)/rect.height*100);}} onClick={()=>{if(!actualSize)setPinned(value=>!value);}} onKeyDown={e=>{
        if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setPinned(false);setHover(false);move(50,50);}
        else if(e.key==="Enter"||e.key===" "){e.preventDefault();if(!actualSize)setPinned(value=>!value);}
        else if(e.key.startsWith("Arrow")&&!actualSize){e.preventDefault();setPinned(true);move(point.current.x+(e.key==="ArrowLeft"?-5:e.key==="ArrowRight"?5:0),point.current.y+(e.key==="ArrowUp"?-5:e.key==="ArrowDown"?5:0));}
      }}><img src={item.src} alt={item.alt} draggable={false}/></div>
    </figure>)}
   </div>
 </div>;
}
