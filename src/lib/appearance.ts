import { useSyncExternalStore } from 'react';
import { dbService } from './db.js';

export type ThemeStyle = 'classic' | 'notebook' | 'retro' | 'gotham' | 'pink';
export const THEMES: readonly {id:string;name:string;background:string;accent:string;style:ThemeStyle;description:string}[] = [
 { id:'notebook',name:'Notebook',background:'#f4efdf',accent:'#375b9b',style:'notebook',description:'Paper, ink & handwritten notes' },
 { id:'retro',name:'Retro',background:'#15172e',accent:'#d9fa70',style:'retro',description:'Pixel type & arcade controls' },
 { id:'forest',name:'Forest',background:'#101312',accent:'#b8e4cc',style:'classic',description:'Classic Sonora' },
 { id:'midnight',name:'Midnight',background:'#0c121f',accent:'#a9ccff',style:'classic',description:'Classic Sonora' },
 { id:'violet',name:'Velvet',background:'#17111e',accent:'#d7b6f4',style:'classic',description:'Classic Sonora' },
 { id:'ember',name:'Ember',background:'#1b1210',accent:'#f5b795',style:'classic',description:'Classic Sonora' },
 { id:'rose',name:'Rose',background:'#1b1116',accent:'#efb7cb',style:'classic',description:'Classic Sonora' },
 { id:'graphite',name:'Graphite',background:'#121212',accent:'#dedede',style:'classic',description:'Classic Sonora' },
] as const;
export const VISUAL_THEMES = [
 {id:'classic',name:'Default',background:'#101312',accent:'#b8e4cc',description:'The original Sonora'},
 {id:'notebook',name:'Notebook',background:'#f4efdf',accent:'#375b9b',description:'Paper, ink & handwritten notes'},
 {id:'retro',name:'Retro',background:'#15172e',accent:'#d9fa70',description:'Pixel type & arcade controls'},
 {id:'pink',name:'Pink Energy',background:'#fff0f6',accent:'#c72e78',description:'Kitten kisses, bows & cherry-pink dreams'},
 {id:'gotham',name:'Gotham Nights',background:'#0c1421',accent:'#d7b477',description:'Lamplight, vinyl & midnight jazz'},
] as const;
export const PALETTES = THEMES.filter(theme=>theme.style==='classic');
export type Appearance = { preset:string; style:ThemeStyle; customColors?:{accent:string;background:string}; accent:string; background:string; hasPhoto:boolean; dim:number; blur:number; pinkMode:'light'|'dark' };
const defaults:Appearance={preset:'default',style:'classic',accent:'#b8e4cc',background:'#101312',hasPhoto:false,dim:.7,blur:0,pinkMode:'light'};
const KEY='sonora:appearance:v1', PHOTO='sonora:appearance:photo';
const valid=(v:unknown):v is string=>typeof v==='string'&&/^#[a-f0-9]{6}$/i.test(v);
function read():Appearance {
 try {
  const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(!saved)return defaults;
  const style=VISUAL_THEMES.some(theme=>theme.id===saved.style)?saved.style:THEMES.find(theme=>theme.id===saved.preset)?.style??'classic';
  const pinkMode=saved.pinkMode==='dark'||saved.pinkMode==='light'?saved.pinkMode:style==='pink'&&valid(saved.background)&&luminance(saved.background)<=.38?'dark':'light';
  const theme=getThemeColors(style,pinkMode);
  const accent=valid(saved.accent)?saved.accent:theme.accent,background=valid(saved.background)?saved.background:theme.background;
  const legacyDefault=['notebook','retro'].includes(saved.preset)||(saved.preset==='forest'&&style==='classic');
  const preset=legacyDefault?(accent===theme.accent&&background===theme.background?'default':'custom')
   :saved.preset==='default'||saved.preset==='custom'||PALETTES.some(palette=>palette.id===saved.preset)?saved.preset:'custom';
  const customColors=valid(saved.customColors?.accent)&&valid(saved.customColors?.background)?saved.customColors:preset==='custom'?{accent,background}:undefined;
  return {...defaults,style,preset,accent,background,customColors,pinkMode,hasPhoto:!!saved.hasPhoto,
   dim:Number.isFinite(saved.dim)?Math.max(.2,Math.min(.95,saved.dim)):defaults.dim,blur:Number.isFinite(saved.blur)?Math.max(0,Math.min(24,saved.blur)):0};
 }catch{return defaults;}
}
const listeners=new Set<()=>void>();
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>listeners.delete(listener);};
const snapshot=()=>current;
export const useAppearance=()=>useSyncExternalStore(subscribe,snapshot);
const rgb=(hex:string)=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
export function mix(a:string,b:string,amount:number){const x=rgb(a),y=rgb(b);return '#'+x.map((v,i)=>Math.round(v+(y[i]-v)*amount).toString(16).padStart(2,'0')).join('');}
function luminance(hex:string){const [r,g,b]=rgb(hex).map(v=>{const n=v/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return .2126*r+.7152*g+.0722*b;}
let current=read(),photoUrl:string|null=null,initialized=false;
function apply(){
 const root=document.documentElement,bg=current.background,light=luminance(bg)>.38;
 const ink=light?(current.style==='notebook'?'#29394d':current.style==='pink'?'#662546':'#17201a'):(current.style==='pink'?'#ffe4f0':'#f1f5f2'),opposite=light?'#000000':'#ffffff';
 let readable=current.accent;
 for(let i=0;i<10;i++){const a=luminance(readable),b=luminance(bg);if((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5)break;readable=mix(readable,ink,.2);}
 const vars:Record<string,string>={
  '--bg':bg,'--surface':mix(bg,opposite,.045),'--surface-active':mix(bg,opposite,.11),'--surface-raised':mix(bg,opposite,.065),
  '--accent':current.accent,'--accent-readable':readable,'--accent-on':luminance(current.accent)>.2?(current.style==='pink'?'#4b1834':'#142018'):'#ffffff',
  '--text-primary':ink,'--text-dim':mix(ink,bg,.38),'--text-muted':mix(ink,bg,.5),'--border':mix(bg,ink,.11),
  '--hero':mix(bg,current.accent,.15),'--selected':mix(bg,current.accent,.17),'--player-surface':mix(bg,current.accent,.2),
  '--photo-dim':String(current.dim),'--photo-blur':current.blur+'px','--photo-image':photoUrl?'url("'+photoUrl+'")':'none',
  '--color-white':ink,
 };
 for(const [key,value]of Object.entries(vars))root.style.setProperty(key,value);
 for(const family of ['blue','indigo'])for(const [shade,fraction]of [[200,.25],[300,.1],[400,0],[500,-.18],[600,-.5],[700,-.65],[800,-.75],[950,-.9]] as const)root.style.setProperty('--color-'+family+'-'+shade,fraction>=0?mix(readable,ink,fraction):mix(bg,readable,1+fraction));
 for(const [shade,amount]of [[50,.97],[100,.92],[200,.8],[300,.7],[400,.56],[500,.43],[600,.3],[700,.2],[800,.1],[900,.045],[950,.012]] as const)root.style.setProperty('--color-zinc-'+shade,mix(bg,ink,amount));
 root.dataset.pinkMode=current.pinkMode;root.dataset.theme=current.preset;root.dataset.style=current.style;root.dataset.photo=String(!!photoUrl&&current.hasPhoto);root.style.colorScheme=light?'light':'dark';
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',bg);
 for(const listener of listeners)listener();
}
export function updateAppearance(patch:Partial<Appearance>){
 const next={...current,...patch};
 if(next.style==='pink'&&patch.background&&!patch.pinkMode)next.pinkMode=luminance(next.background)>.38?'light':'dark';
 if(patch.preset==='custom'&&(patch.accent||patch.background))next.customColors={accent:next.accent,background:next.background};
 if(!valid(next.accent)||!valid(next.background))throw Error('Choose a valid color.');
 localStorage.setItem(KEY,JSON.stringify(next));current=next;apply();
}
export function getThemeColors(style:ThemeStyle,mode:'light'|'dark'='light'){
 const theme=VISUAL_THEMES.find(theme=>theme.id===style)!;
 return style==='pink'&&mode==='dark'?{...theme,background:'#1f1420',accent:'#f29bc4'}:theme;
}
export function setPinkMode(mode:'light'|'dark'){
 const colors=getThemeColors('pink',mode);
 updateAppearance({pinkMode:mode,background:colors.background,accent:current.preset==='default'?colors.accent:current.accent,preset:current.preset==='default'?'default':'custom'});
}
export function chooseTheme(id:string){
 const theme=VISUAL_THEMES.find(theme=>theme.id===id);
 if(theme){const colors=getThemeColors(theme.id,current.pinkMode);updateAppearance({preset:'default',style:theme.id,accent:colors.accent,background:colors.background});}
 else choosePalette(id);
}
export function choosePalette(id:string){
 const palette=id==='default'?getThemeColors(current.style,current.pinkMode):id==='custom'?(current.customColors??current):PALETTES.find(palette=>palette.id===id);
 if(palette)updateAppearance({preset:id,accent:palette.accent,background:palette.background});
}
export async function setBackgroundPhoto(file:File){
 if(!file.type.startsWith('image/')||file.type==='image/svg+xml')throw Error('Choose a photo such as a JPEG, PNG, or WebP image.');
 if(file.size>25*1024**2)throw Error('Choose a photo smaller than 25 MB.');
 const input=URL.createObjectURL(file);
 try{
  const image=new Image();image.src=input;await image.decode();
  if(!image.naturalWidth||!image.naturalHeight)throw Error('That photo could not be opened.');
  const scale=Math.min(1,1920/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  canvas.getContext('2d')!.drawImage(image,0,0,canvas.width,canvas.height);
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(v=>v?resolve(v):reject(Error('Couldn’t save that photo.')),'image/jpeg',.86));
  await dbService.setSetting(PHOTO,{bytes:await blob.arrayBuffer(),mimeType:blob.type});
  updateAppearance({hasPhoto:true});
  if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=URL.createObjectURL(blob);apply();
 }finally{URL.revokeObjectURL(input);}
}
export async function removeBackgroundPhoto(){await dbService.setSetting(PHOTO,null);updateAppearance({hasPhoto:false});if(photoUrl)URL.revokeObjectURL(photoUrl);photoUrl=null;apply();}
export async function initializeAppearance(){
 if(initialized)return;initialized=true;apply();
 if(current.hasPhoto)try{const saved=await dbService.getSetting<Blob|{bytes:ArrayBuffer;mimeType:string}|null>(PHOTO,null);const blob=saved instanceof Blob?saved:saved&&'bytes' in saved?new Blob([saved.bytes],{type:saved.mimeType}):null;if(blob){photoUrl=URL.createObjectURL(blob);apply();}}catch{}
}
