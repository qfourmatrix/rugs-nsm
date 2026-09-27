import { useEffect, useRef, useState } from "react";
import { RotateCcw, Undo2, X } from "lucide-react";
import { downloadMainOriginalUrl, replaceMainImage, applyTopDown, cutoutPreviewUrl, generateTopDown, getJobs, getMainCutouts, getTopDown, imageUrl, restoreCutout, topDownOriginalUrl, type MainCutout } from "../api";
import { TOP_DOWN_SHOT_ID, type RestorePoint, type TopDownState } from "../../shared/main-image-tools";
import { getErrorMessage } from "../utils";

export function MainImageTools({productId,baseImage,cutoutId,onCutout,onBaseChanged}:{productId:string;baseImage:string;cutoutId?:string;onCutout:(cutout:MainCutout)=>void;onBaseChanged:(hash:string,cutout?:MainCutout)=>Promise<void>}) {
  const fileInput=useRef<HTMLInputElement>(null);
  const [replacement,setReplacement]=useState<{file:File;url:string;hash:string}|null>(null);
  useEffect(()=>()=>{if(replacement)URL.revokeObjectURL(replacement.url);},[replacement]);
  const [mode,setMode]=useState<"lasso"|"topdown"|null>(null);
  const [points,setPoints]=useState<RestorePoint[]>([]);
  const [cursor,setCursor]=useState({x:.5,y:.5});
  const [original,setOriginal]=useState(false);
  const [ratio,setRatio]=useState(1);
  const [state,setState]=useState<TopDownState|null>(null);
  const [running,setRunning]=useState(false);
  const [busy,setBusy]=useState(false);
  const busyRef=useRef(false);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState("");
  const [parentId,setParentId]=useState<string|undefined>();
  const intent=useRef<{key:string;id:string}|null>(null);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(mode!=="topdown")return;
    let active=true;let timer:ReturnType<typeof setTimeout>;let previousJobs:string|null=null;
    const poll=async()=>{try{
      const jobs=await getJobs(undefined,productId);
      if(!active)return;
      const current=jobs.filter(j=>j.shotId===TOP_DOWN_SHOT_ID).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
      setRunning(current.some(j=>["queued","generating"].includes(j.status)));
      const key=JSON.stringify(current.map(j=>[j.jobId,j.status,j.assetId]));
      if(key!==previousJobs){const next=await getTopDown(productId);if(!active)return;setState(next);previousJobs=key;}
      if(current[0]&&["failed","interrupted"].includes(current[0].status))setError(current[0].message??"Generation needs attention. Retry only when you want another paid attempt.");
    }catch(error){if(active)setError(getErrorMessage(error));}finally{if(active)timer=setTimeout(()=>void poll(),1500);}};
    void poll();return()=>{active=false;clearTimeout(timer);};
  },[mode,productId]);
  useEffect(()=>{
    setPoints([]);intent.current=null;
    if(!cutoutId){setParentId(undefined);return;}
    let active=true;void getMainCutouts(productId).then(items=>{if(active)setParentId(items.find(c=>c.id===cutoutId)?.parentId);}).catch(error=>{if(active)setError(getErrorMessage(error));});return()=>{active=false;};
  },[cutoutId,productId]);
  const run=async(action:()=>Promise<void>)=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setError(null);setNotice("");try{await action();}catch(error){if(alive.current)setError(getErrorMessage(error));}finally{busyRef.current=false;if(alive.current)setBusy(false);}};
  const generate=()=>run(async()=>{await generateTopDown(productId);if(alive.current){setMode("topdown");setRunning(true);setNotice("Generating from the preserved original. You can close this tool; the job keeps running.");}});
  const apply=()=>run(async()=>{
    if(!cutoutId||points.length<3)return;
    const key=JSON.stringify([cutoutId,points]);if(intent.current?.key!==key)intent.current={key,id:crypto.randomUUID()};
    const result=await restoreCutout(cutoutId,points,intent.current.id);
    if(alive.current){onCutout(result);setPoints([]);setNotice("Area restored. Review the rug before approving export.");}
  });
  const choose= (assetId?:string)=>run(async()=>{
    if(!state)return;const result=await applyTopDown(productId,state.sourceSha256,assetId);
    await onBaseChanged(result.sourceSha256);
    if(alive.current){setState(await getTopDown(productId));setNotice(assetId?"Accepted as the main image. Remove its background and review before export.":"Original main image restored.");}
  });
  const candidate=state?.candidates[0];
  const addPoint=(point:RestorePoint)=>{if(!busy&&points.length<128)setPoints(previous=>[...previous,point]);};
  return <section className="mainImageTools" aria-label="Repair main image">
    <div className="exportPrepActions">
      <a className="gallerySecondaryButton" href={downloadMainOriginalUrl(productId)} download>Download original</a>
      <button type="button" disabled={busy} onClick={()=>fileInput.current?.click()}>Replace image</button>
      <button type="button" disabled={busy} onClick={()=>void run(async()=>{const current=await getTopDown(productId);if(!current.canRestore){setNotice("The original is already in use.");return;}const result=await applyTopDown(productId,current.sourceSha256);await onBaseChanged(result.sourceSha256);setReplacement(null);setState(await getTopDown(productId));setNotice("Original main image restored.");})}>Restore original image</button>
      <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="Choose retouched main image" onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(!file)return;void run(async()=>{if(file.size>40*1024*1024)throw new Error("Choose an image under 40 MB.");const current=await getTopDown(productId);setReplacement({file,url:URL.createObjectURL(file),hash:current.sourceSha256});});}}/>
    </div>
    {replacement&&<div className="mainImageReplacement">
      <p>{replacement.file.name} · Review your retouched image, then replace. PNG transparency is preserved.</p>
      <img src={replacement.url} alt="Retouched image to import" style={{maxWidth:"100%",maxHeight:360,objectFit:"contain"}}/>
      <div className="exportPrepActions"><button type="button" className="galleryPrimaryButton" disabled={busy} onClick={()=>void run(async()=>{
        const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.onerror=()=>reject(new Error("Could not read this image. Choose it again."));reader.readAsDataURL(replacement.file);});
        const result=await replaceMainImage(productId,replacement.hash,data);
        await onBaseChanged(result.sourceSha256,result.cutout);setReplacement(null);setMode(null);setState(null);setNotice("Image replaced. Review and approve it before export.");
      })}>{busy?"Replacing…":"Use this image"}</button><button type="button" disabled={busy} onClick={()=>setReplacement(null)}>Cancel</button></div>
    </div>}
    <div className="exportPrepActions"><button type="button" disabled={!cutoutId||busy} aria-pressed={mode==="lasso"} onClick={()=>setMode(mode==="lasso"?null:"lasso")}>Restore with lasso</button><button type="button" aria-pressed={mode==="topdown"} onClick={()=>setMode(mode==="topdown"?null:"topdown")}>Make top-down</button></div>
    {!cutoutId&&<p>Lasso restoration becomes available after background removal.</p>}
    {mode==="lasso"&&cutoutId&&<div>
      <p>Click corners around the missing wool, then Restore area. Use small selections inside the rug; anything inside the outline returns from the original.</p>
      <label className="exportPrepCheck"><input type="checkbox" checked={original} onChange={e=>setOriginal(e.target.checked)}/> Show original while selecting</label>
      <div className="rugLasso" style={{aspectRatio:ratio}}>
        <img draggable={false} src={original?`${imageUrl(productId,"base",baseImage)}`:cutoutPreviewUrl(cutoutId)} alt={original?"Original rug for restoration":"Cutout to restore"} onLoad={e=>setRatio(e.currentTarget.naturalWidth/e.currentTarget.naturalHeight)}/>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" tabIndex={0} role="application" aria-label="Straight-edge lasso. Click to add corners. Keyboard: arrows move, Enter adds a corner, Backspace undoes, Escape clears." onPointerDown={e=>{if(e.button!==0)return;const rect=e.currentTarget.getBoundingClientRect();addPoint({x:Math.min(1,Math.max(0,(e.clientX-rect.left)/rect.width)),y:Math.min(1,Math.max(0,(e.clientY-rect.top)/rect.height))});e.currentTarget.focus();}} onKeyDown={e=>{
          const directions:Record<string,[number,number]>={ArrowLeft:[-.01,0],ArrowRight:[.01,0],ArrowUp:[0,-.01],ArrowDown:[0,.01]};
          if(directions[e.key]){e.preventDefault();const [x,y]=directions[e.key];setCursor(p=>({x:Math.max(0,Math.min(1,p.x+x)),y:Math.max(0,Math.min(1,p.y+y))}));}
          else if(e.key==="Enter"){e.preventDefault();addPoint(cursor);}else if(e.key==="Backspace"){e.preventDefault();setPoints(p=>p.slice(0,-1));}else if(e.key==="Escape"){e.preventDefault();e.stopPropagation();setPoints([]);}
        }}>
          {points.length>1&&<polygon points={points.map(p=>`${p.x*100},${p.y*100}`).join(" ")} fill="rgba(0,100,210,.2)" stroke="#0064d2" strokeWidth=".5" vectorEffect="non-scaling-stroke"/>}
          {points.map((p,i)=><circle key={i} cx={p.x*100} cy={p.y*100} r=".7" fill="white" stroke="#0064d2" strokeWidth=".3"/>)}
          <circle className="rugLassoCursor" cx={cursor.x*100} cy={cursor.y*100} r="1" fill="none" stroke="#111" strokeWidth=".3"/>
        </svg>
      </div>
      <div className="exportPrepActions"><button type="button" disabled={busy||!points.length} onClick={()=>setPoints(p=>p.slice(0,-1))}><Undo2 size={15}/> Undo point</button><button type="button" disabled={busy||!points.length} onClick={()=>setPoints([])}><X size={15}/> Clear</button><button type="button" className="galleryPrimaryButton" disabled={busy||points.length<3} onClick={()=>void apply()}>{busy?"Restoring…":"Restore area"}</button></div>
      {parentId&&<button type="button" disabled={busy} onClick={()=>void run(async()=>{const parent=(await getMainCutouts(productId)).find(c=>c.id===parentId);if(!parent)throw new Error("Previous cutout is unavailable.");onCutout(parent);})}><RotateCcw size={15}/> Undo last restore</button>}
    </div>}
    {mode==="topdown"&&<div>
      <p>Generate a directly overhead view. Check the pattern and fringe before accepting. Each Generate or Retry uses one generation; retries start from the preserved original.</p>
      {candidate&&<div className="rugTopDownCompare"><figure><figcaption>Original</figcaption><img src={topDownOriginalUrl(productId)} alt="Preserved original rug"/></figure><figure><figcaption>New top-down view</figcaption><img src={imageUrl(productId,"generated",candidate.file)} alt="Generated top-down candidate"/></figure></div>}
      <div className="exportPrepActions"><button type="button" disabled={busy||running||!state} onClick={()=>void generate()}>{running?"Generating…":candidate?"Retry":"Generate top-down"}</button>{candidate&&<button type="button" className="galleryPrimaryButton" disabled={busy||running} onClick={()=>void choose(candidate.assetId)}>Accept</button>}<button type="button" disabled={busy||running||!state?.canRestore} onClick={()=>void choose()}>Restore original</button></div>
      {running&&<p role="status">Waiting for the provider. No automatic retry or request deadline.</p>}
    </div>}
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="exportPrepError">{error}</p>}
  </section>;
}
