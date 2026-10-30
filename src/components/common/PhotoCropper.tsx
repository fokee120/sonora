import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Overlay} from './Overlay.js';
import {X,RotateCcw} from 'lucide-react';
export async function cropImage(file:File,aspect=1):Promise<string|null>{
 if(!file.type.startsWith('image/')||file.type==='image/svg+xml')throw Error('Choose a JPEG, PNG, or WebP photo.');
 if(file.size>25*1024**2)throw Error('Choose a photo smaller than 25 MB.');
 const source=URL.createObjectURL(file),image=new Image();image.src=source;
 try{await image.decode();}catch{URL.revokeObjectURL(source);throw Error('That photo could not be opened.');}
 return new Promise(resolve=>{const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let finished=false;const finish=(value:string|null)=>{if(finished)return;finished=true;resolve(value);setTimeout(()=>{root.unmount();host.remove();URL.revokeObjectURL(source);},0);};root.render(<CropEditor image={image} aspect={aspect} finish={finish}/>);});
}
function CropEditor({image,aspect,finish}:{image:HTMLImageElement;aspect:number;finish:(value:string|null)=>void}){
 const width=Math.min(320,window.innerWidth-64,420*aspect),height=width/aspect;
 const base=Math.max(width/image.naturalWidth,height/image.naturalHeight);
 const [zoom,setZoom]=useState(1),[position,setPosition]=useState({x:0,y:0}),[error,setError]=useState('');
 const drag=useRef<{x:number;y:number;px:number;py:number}|null>(null);
 const clamp=(x:number,y:number,z=zoom)=>({x:Math.max(-(image.naturalWidth*base*z-width)/2,Math.min((image.naturalWidth*base*z-width)/2,x)),y:Math.max(-(image.naturalHeight*base*z-height)/2,Math.min((image.naturalHeight*base*z-height)/2,y))});
 useEffect(()=>{setPosition(p=>clamp(p.x,p.y));},[zoom]);
 const save=()=>{try{const canvas=document.createElement('canvas');canvas.width=aspect===1?600:1080;canvas.height=Math.round(canvas.width/aspect);const ctx=canvas.getContext('2d');if(!ctx)throw Error();const scale=base*zoom;ctx.drawImage(image,(image.naturalWidth*scale-width)/2/scale-position.x/scale,(image.naturalHeight*scale-height)/2/scale-position.y/scale,width/scale,height/scale,0,0,canvas.width,canvas.height);finish(canvas.toDataURL('image/jpeg',.88));}catch{setError('Couldn’t prepare the crop. Try another photo.');}};
 return <Overlay isOpen onClose={()=>finish(null)} label="Crop photo"><div className="photo-crop-editor"><header><div><p className="eyebrow">MAKE IT FIT</p><h2>Crop photo</h2></div><button type="button" className="player-icon" aria-label="Cancel crop" onClick={()=>finish(null)}><X size={22}/></button></header><p>Drag to position your photo. Zoom in to get closer.</p><div className="photo-crop-frame" style={{width,height}} onPointerDown={e=>{if(!e.isPrimary)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,px:position.x,py:position.y};}} onPointerMove={e=>{if(!drag.current)return;setPosition(clamp(drag.current.px+e.clientX-drag.current.x,drag.current.py+e.clientY-drag.current.y));}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}><img src={image.src} alt="Photo crop preview" draggable={false} style={{width:image.naturalWidth*base*zoom,height:image.naturalHeight*base*zoom,transform:`translate(calc(-50% + ${position.x}px),calc(-50% + ${position.y}px))`}}/><div className="photo-crop-grid" aria-hidden="true"/></div><label className="photo-crop-zoom">Zoom<input aria-label="Crop zoom" type="range" min="1" max="4" step="0.01" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>{error&&<p role="alert">{error}</p>}<footer><button type="button" className="text-button" onClick={()=>{setZoom(1);setPosition({x:0,y:0});}}><RotateCcw size={16}/>Reset</button><button type="button" className="profile-primary" onClick={save}>Use photo</button></footer></div></Overlay>;
}
