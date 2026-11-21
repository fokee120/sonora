import { ComicScene } from '../common/ComicScene.js';
import { COMIC_HEROES, comicHero } from '../../lib/comicHeroes.js';
import {cropImage} from '../common/PhotoCropper.js';
import React, { useState } from 'react';
import { Check, ImagePlus, RotateCcw, X } from 'lucide-react';
import { VISUAL_THEMES, PALETTES, useAppearance, chooseTheme, chooseComicHero, choosePalette, setPinkMode, getThemeColors, updateAppearance, setBackgroundPhoto, removeBackgroundPhoto } from '../../lib/appearance.js';
import { notify } from '../common/ToastHost.js';
export function AppearanceCard(){
 const appearance=useAppearance(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const change=(fn:()=>void)=>{try{fn();setError('');}catch{setError('Couldn’t save your appearance. Check available device storage.');}};
 return <section className="settings-card appearance-card"><div className="section-heading"><div><h2>Appearance</h2><p>Change the whole mood. Make the details your own.</p></div><button className="player-icon" title="Reset colors" aria-label="Reset colors" onClick={()=>change(()=>choosePalette('default'))}><RotateCcw size={17}/></button></div>
 <div className="theme-studio" aria-label="Visual themes">{VISUAL_THEMES.map(theme=><button key={theme.id} aria-label={theme.name+' theme'} aria-pressed={appearance.style===theme.id} className={'theme-design theme-design-'+theme.id} onClick={()=>change(()=>chooseTheme(theme.id))}>
 <span className="theme-design-scene" aria-hidden="true"><span className="theme-sample-label">sonora</span>{theme.id!=='comics'&&<><span className="theme-sample-track"><i/><span><b>A song for today</b><small>Your own little world</small></span><em>▶</em></span><span className="theme-sample-bars"><i/><i/><i/><i/><i/><i/><i/></span></>}</span><span className="theme-design-caption"><span><strong>{theme.name}</strong><small>{theme.description}</small></span>{appearance.style===theme.id&&<Check size={19}/>}</span></button>)}</div>
 {appearance.style==='pink'&&<div className="pink-mode-control"><div><strong>Pink Energy</strong><span>{appearance.pinkMode==='dark'?'Midnight pink':'Strawberry milk'}</span></div><label><span>Dark</span><button type="button" role="switch" aria-label="Pink Energy dark mode" aria-checked={appearance.pinkMode==='dark'} className="pink-mode-switch" onClick={()=>change(()=>setPinkMode(appearance.pinkMode==='dark'?'light':'dark'))}><i/></button><span>Light</span></label></div>}
 {appearance.style==='comics'&&<section className="comic-picker" aria-labelledby="comic-picker-title">
   <header><h3 id="comic-picker-title">Choose your hero</h3></header>
     <div className="comic-picker-feature">
     <ComicScene heroId={appearance.comicHeroId} placement="picker"/>
     <div className="comic-picker-feature-title"><p>{comicHero(appearance.comicHeroId).edition}</p><strong>{comicHero(appearance.comicHeroId).name}</strong></div>
   </div>
   <div className="comic-picker-grid" role="group" aria-label="Comic heroes">
     {COMIC_HEROES.map(hero=><button key={hero.id} type="button" aria-pressed={appearance.comicHeroId===hero.id} aria-label={hero.name}
       style={{'--issue-accent':hero.accent,'--issue-paper':hero.background,'--issue-world':'url('+hero.world+')'} as React.CSSProperties}
       onClick={()=>change(()=>chooseComicHero(hero.id))}>
       <span className="comic-picker-cover"><img className="comic-picker-poster" src={hero.displayArt} alt="" decoding="async" />
         {appearance.comicHeroId===hero.id&&<span className="comic-picker-check" aria-hidden="true"><Check size={16}/></span>}
       </span>
       <span className="comic-picker-name">{hero.name}</span>
     </button>)}
   </div>
 </section>}
 <p className="appearance-palette-label">Colors</p><div className="theme-options" aria-label="Color themes">{[{...getThemeColors(appearance.style,appearance.pinkMode,appearance.comicHeroId),id:'default',name:'Theme default'},...PALETTES,{...(appearance.customColors??appearance),id:'custom',name:'Custom'}].map(theme=><button key={theme.id} aria-label={theme.name+' colors'} aria-pressed={appearance.preset===theme.id} className="theme-option" onClick={()=>change(()=>choosePalette(theme.id))}><span style={{background:theme.background,color:theme.accent}}><i style={{background:theme.accent}}/>{appearance.preset===theme.id&&<Check size={15}/>}</span><small>{theme.name}</small></button>)}</div>
 <div className="custom-colors"><label>Accent color<span><input type="color" aria-label="Accent color" value={appearance.accent} onChange={e=>change(()=>updateAppearance({accent:e.target.value,preset:'custom'}))}/><code>{appearance.accent.toUpperCase()}</code></span></label><label>Background color<span><input type="color" aria-label="Background color" value={appearance.background} onChange={e=>change(()=>updateAppearance({background:e.target.value,preset:'custom'}))}/><code>{appearance.background.toUpperCase()}</code></span></label></div>
 <div className="appearance-photo-preview" aria-hidden="true"><div/><span>Make it your own.</span></div>
 <div className="flex flex-wrap gap-2"><label className="action-button photo-upload"><ImagePlus size={17}/>{busy?'Saving photo…':appearance.hasPhoto?'Change background photo':'Add background photo'}<input type="file" accept="image/*" aria-label="Background photo" disabled={busy} onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;setBusy(true);setError('');try{const cropped=await cropImage(file,9/16);if(!cropped)return;const blob=await(await fetch(cropped)).blob();await setBackgroundPhoto(new File([blob],'background.jpg',{type:'image/jpeg'}));notify('Background photo saved');}catch(reason){setError(reason instanceof Error?reason.message:'Couldn’t open that photo.');}finally{setBusy(false);}}}/></label>{appearance.hasPhoto&&<button className="action-button" disabled={busy} onClick={async()=>{setBusy(true);try{await removeBackgroundPhoto();setError('');notify('Background photo removed');}catch{setError('Couldn’t remove the photo. Try again.');}finally{setBusy(false);}}}><X size={16}/>Remove photo</button>}</div>
 {appearance.hasPhoto&&<div className="photo-adjustments"><label>Photo dimming <span>{Math.round(appearance.dim*100)}%</span><input aria-label="Photo dimming" type="range" min="20" max="95" value={Math.round(appearance.dim*100)} onChange={e=>change(()=>updateAppearance({dim:Number(e.target.value)/100}))}/></label><label>Photo blur <span>{appearance.blur} px</span><input aria-label="Photo blur" type="range" min="0" max="24" value={appearance.blur} onChange={e=>change(()=>updateAppearance({blur:Number(e.target.value)}))}/></label></div>}
 <p className="text-xs">Your photo stays on this device and is available offline.</p>{error&&<p role="alert">{error}</p>}</section>;
}
