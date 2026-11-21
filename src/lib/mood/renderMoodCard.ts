import {comicHero} from '../comicHeroes.js';
import type {Appearance} from '../appearance.js';
import {mix} from '../appearance.js';
import {readArtwork} from '../artwork.js';
import {loadRetroSprites,drawRetroSprites} from './retroSprites.js';
import {loadGothamSprites,drawGothamSprites} from './gothamSprites.js';
export type MoodCardAspect='portrait'|'landscape';
export type MoodCardInput={lines:string[];title:string;artist:string;appearance:Appearance;artworkUrl?:string;trackId?:string;aspect?:MoodCardAspect};
function luminance(hex:string){const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722;}
function light(hex:string){const s=hex.slice(1);return .2126*parseInt(s.slice(0,2),16)+.7152*parseInt(s.slice(2,4),16)+.0722*parseInt(s.slice(4,6),16)>150;}
function path(c:CanvasRenderingContext2D,points:number[][],fill:string){c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fillStyle=fill;c.fill();}
function line(c:CanvasRenderingContext2D,x:number,y:number,x2:number,y2:number,color:string,width=2){c.beginPath();c.moveTo(x,y);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width;c.stroke();}
function circle(c:CanvasRenderingContext2D,x:number,y:number,r:number,color:string){c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle=color;c.fill();}
function heart(c:CanvasRenderingContext2D,x:number,y:number,size:number,color:string){c.save();c.translate(x,y);c.scale(size/30,size/30);c.beginPath();c.moveTo(0,9);c.bezierCurveTo(-27,-8,-12,-28,0,-13);c.bezierCurveTo(12,-28,27,-8,0,9);c.fillStyle=color;c.fill();c.restore();}
function star(c:CanvasRenderingContext2D,x:number,y:number,r:number,color:string){line(c,x-r,y,x+r,y,color,2);line(c,x,y-r,x,y+r,color,2);}
function bow(c:CanvasRenderingContext2D,x:number,y:number,s:number,a:string,ink:string){c.save();c.translate(x,y);c.rotate(-.13);path(c,[[-8,0],[-s,-s*.55],[-s*.87,s*.45]],a);path(c,[[8,0],[s,-s*.55],[s*.87,s*.45]],a);path(c,[[-9,5],[-s*.45,s*.9],[-s*.2,s*.8],[0,12]],a);path(c,[[9,5],[s*.45,s*.9],[s*.2,s*.8],[0,12]],a);circle(c,0,0,12,mix(a,ink,.12));line(c,-s*.8,-s*.25,-15,-2,mix(a,ink,.2));line(c,s*.8,-s*.25,15,-2,mix(a,ink,.2));c.restore();}
function wrap(c:CanvasRenderingContext2D,text:string,width:number){const rows:string[]=[];let row='';for(const word of text.trim().split(/\s+/u)){if(c.measureText(word).width>width){if(row)rows.push(row);row='';for(const char of Array.from(word)){if(row&&c.measureText(row+char).width>width){rows.push(row);row='';}row+=char;}}else if(row&&c.measureText(row+' '+word).width>width){rows.push(row);row=word;}else row+=(row?' ':'')+word;}if(row)rows.push(row);return rows;}
function ellipsis(c:CanvasRenderingContext2D,text:string,width:number){
 if(c.measureText(text).width<=width)return text;
 const parts=Array.from(text);while(parts.length&&c.measureText(parts.join('')+'…').width>width)parts.pop();return parts.join('')+'…';
}
function metadataRows(c:CanvasRenderingContext2D,text:string,width:number){
 const rows=wrap(c,text,width);return rows.length>2?[rows[0],ellipsis(c,rows.slice(1).join(' '),width)]:rows;
}
async function coverImage(input:MoodCardInput):Promise<HTMLImageElement|null>{
 let url:string|undefined;
 try{
  let blob=input.trackId?await readArtwork(input.trackId):null;
  if(!blob&&input.artworkUrl){
   const source=new URL(input.artworkUrl,location.href);
   const trusted=/^((?:lh\d+|yt3)\.googleusercontent\.com|yt3\.ggpht\.com|i\.ytimg\.com)$/.test(source.hostname);
   const response=await fetch(trusted?'/api/artwork?url='+encodeURIComponent(source.href):source.href,{signal:AbortSignal.timeout(7000)});
   if(response.ok&&response.headers.get('content-type')?.startsWith('image/'))blob=await response.blob();
  }
  if(!blob?.size||blob.size>8*1024*1024)return null;
  url=URL.createObjectURL(blob);const image=new Image();image.src=url;await image.decode();return image;
 }catch{return null;}finally{if(url)URL.revokeObjectURL(url);}
}
function box(c:CanvasRenderingContext2D,x:number,y:number,w:number,h:number,fill:string,r=0,stroke?:string,width=1){c.beginPath();c.roundRect(x,y,w,h,r);c.fillStyle=fill;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=width;c.stroke();}}
function diamond(c:CanvasRenderingContext2D,x:number,y:number,r:number,color:string){path(c,[[x,y-r],[x+r*.3,y-r*.3],[x+r,y],[x+r*.3,y+r*.3],[x,y+r],[x-r*.3,y+r*.3],[x-r,y],[x-r*.3,y-r*.3]],color);}
function note(c:CanvasRenderingContext2D,x:number,y:number,s:number,color:string){circle(c,x,y,s*.28,color);line(c,x+s*.23,y,x+s*.23,y-s,color,s*.1);line(c,x+s*.23,y-s,x+s*.7,y-s*.8,color,s*.14);}
function tape(c:CanvasRenderingContext2D,x:number,y:number,w:number,color:string,angle:number){c.save();c.translate(x,y);c.rotate(angle);box(c,-w/2,-14,w,28,color);for(let i=-w/2+5;i<w/2;i+=12)line(c,i,-14,i+9,14,'#ffffff24',4);c.restore();}
const overlayImages=new Map<string,Promise<HTMLImageElement|null>>();
function overlayImage(url:string){
 let task=overlayImages.get(url);
 if(!task){task=(async()=>{try{const response=await fetch(url,{signal:AbortSignal.timeout(6000)});if(!response.ok)return null;const blob=await response.blob(),objectUrl=URL.createObjectURL(blob);try{const image=new Image();image.src=objectUrl;await image.decode();return image;}finally{URL.revokeObjectURL(objectUrl);}}catch{return null;}})();overlayImages.set(url,task);void task.then(image=>{if(!image)overlayImages.delete(url);});}
 return task;
}
export async function renderMoodCard(input:MoodCardInput):Promise<{blob:Blob;width:number;height:number}>{
 const {appearance:a,title,artist}=input,lines=input.lines.map(l=>l.trim()).filter(Boolean);
 if(!lines.length||lines.length>10)throw Error('Select between one and ten lyric lines.');
 if(lines.join('').length>2400)throw Error('These lines are too long for one card. Select fewer lines.');
 const style=a.style||'classic',font=style==='notebook'?'"Sonora Hand"':style==='retro'?'"Sonora Pixel"':style==='gotham'?'Georgia':'Arial';
 if(style==='notebook'||style==='retro')await document.fonts.load('700 84px '+font);
 const illustrationUrl=style==='aero'?'/themes/aero/shoreline.svg'
  :style==='comics'?comicHero(a.comicHeroId).art
  :style==='pink'?'/mood-overlays/pink-v3.webp':null;
 const [cover,illustration,retroSprites,gothamSprites]=await Promise.all([
  coverImage(input),illustrationUrl?overlayImage(illustrationUrl):Promise.resolve(null),
  style==='retro'?loadRetroSprites():Promise.resolve(null),
  style==='gotham'?loadGothamSprites():Promise.resolve(null),
 ]);
 const canvas=document.createElement('canvas'),c=canvas.getContext('2d');if(!c)throw Error('Image creation is unavailable.');
 const compact=lines.length<=2,landscape=!compact&&input.aspect==='landscape';
 let W=landscape?1440:1080;
 if(landscape){c.font='600 '+Math.round(60-lines.length*1.4)+'px '+font;W=Math.max(960,Math.min(1440,Math.ceil(Math.max(...lines.map(line=>c.measureText(line).width))+284)));}
 const inset=compact?112:128,headerY=compact?84:104,coverSize=compact?154:landscape?182:190,copyX=inset+coverSize+28,copyWidth=W-inset-copyX;
 const titleSize=compact?68:landscape?80:84,artistSize=compact?54:landscape?64:70,titleStep=Math.ceil(titleSize*1.15),artistStep=Math.ceil(artistSize*1.2);
 c.font='800 '+titleSize+'px '+font;const titleRows=metadataRows(c,title,copyWidth);
 c.font='700 '+artistSize+'px '+font;const artistRows=metadataRows(c,artist,copyWidth);
 const titleHeight=titleRows.length*titleStep,headerBottom=headerY+Math.max(coverSize,titleHeight+8+artistRows.length*artistStep);
 let size=compact?(style==='notebook'?46:44):landscape?Math.round(60-lines.length*1.4):Math.round(69-lines.length*.6);
 const textWidth=W-inset*2-28,leading=style==='notebook'?1.35:1.28;
 const measure=()=>{c.font='600 '+size+'px '+font;const rows=lines.map(text=>wrap(c,text,textWidth)),step=Math.ceil(size*leading),gap=Math.round(size*.34);return {rows,step,gap,height:rows.reduce((n,r)=>n+r.length*step,0)+(lines.length-1)*gap};};
 const topGap=compact?34:48,bottomGap=compact?30:44,footerHeight=compact?126:landscape?210:228,maxHeight=compact?1800:landscape?1300:2400;
 let text=measure();
 while(size>26&&headerBottom+topGap+text.height+bottomGap+footerHeight>maxHeight){size--;text=measure();}
 if(headerBottom+topGap+text.height+bottomGap+footerHeight>maxHeight)throw Error('These lines need more room. Select fewer lines.');
 // The frame follows the actual measured text; there is no fixed-ratio empty canvas.
 const H=Math.ceil(headerBottom+topGap+text.height+bottomGap+footerHeight),quoteTop=headerBottom+topGap,quoteBottom=quoteTop+text.height;
 canvas.width=W;canvas.height=H;
 const bg=a.background,accent=a.accent,isLight=light(bg),ink=isLight?(style==='pink'?'#662546':'#29394d'):'#f5f0e8';
 let textAccent=accent;for(let i=0;i<12;i++){const x=luminance(textAccent),y=luminance(bg);if((Math.max(x,y)+.05)/(Math.min(x,y)+.05)>=4.5)break;textAccent=mix(textAccent,ink,.2);}
 const soft=mix(bg,accent,.14),edge=mix(bg,accent,.48),paper=mix(bg,isLight?'#ffffff':'#000000',isLight?.34:.12),secondary=mix(accent,style==='retro'?'#b39aff':style==='gotham'?'#743448':ink,.32),frame=52;
 c.fillStyle=bg;c.fillRect(0,0,W,H);
 const wash=c.createLinearGradient(0,0,W,H);wash.addColorStop(0,mix(bg,accent,.15));wash.addColorStop(1,bg);c.fillStyle=wash;c.fillRect(0,0,W,H);
 if(style==='aero'){
  if(illustration)c.drawImage(illustration,0,0,W,H);
  const frost=c.createLinearGradient(0,0,W,H);
  frost.addColorStop(0,'#f5fffee8');frost.addColorStop(.5,'#e4f8f2df');frost.addColorStop(1,'#d3f5f9de');
  c.save();
  c.beginPath();c.roundRect(55,55,W-110,H-110,38);c.clip();
  c.fillStyle=frost;c.fillRect(55,55,W-110,H-110);
  c.restore();
  c.beginPath();c.roundRect(55,55,W-110,H-110,38);c.strokeStyle='#ffffff';c.lineWidth=4;c.stroke();
  box(c,inset-20,quoteTop-17,W-inset*2+40,text.height+34,'#edfaff',22,'#80b8cb',2);
 }else if(style==='comics'){
  const coverWidth=Math.round(W*.39);
  if(illustration){
   const artHeight=coverWidth*illustration.naturalHeight/illustration.naturalWidth;
   c.save();c.globalAlpha=.62;c.drawImage(illustration,W-coverWidth-frame,frame,coverWidth,artHeight);c.restore();
  }
  for(let x=frame+12;x<W-frame;x+=13)for(let y=frame+12;y<H-frame;y+=13)circle(c,x,y,1.6,mix(bg,accent,.38));
  c.strokeStyle=edge;c.lineWidth=6;c.strokeRect(frame,frame,W-frame*2,H-frame*2);
  box(c,inset-20,quoteTop-17,W-inset*2+40,text.height+34,paper,0,accent,4);
 }else if(style==='pink'){
  // Gingham, lace, separate ribbon stickers and a flat cartoon kitten.
  for(let x=0;x<W;x+=34)for(let y=0;y<H;y+=34)if((x/34+y/34)%2===0){c.fillStyle=mix(bg,accent,.075);c.fillRect(x,y,34,34);}
  box(c,72,64,W-144,H-128,mix(bg,accent,.25),30);
  for(let x=92;x<W-85;x+=28){circle(c,x,79,18,paper);circle(c,x,H-79,18,paper);}
  for(let y=100;y<H-90;y+=28){circle(c,87,y,18,paper);circle(c,W-87,y,18,paper);}
  box(c,87,79,W-174,H-158,paper,20);
  c.save();c.setLineDash([3,9]);c.strokeStyle=mix(bg,accent,.38);c.lineWidth=2;c.strokeRect(103,94,W-206,H-188);c.restore();
  for(const [x,y,s]of [[83,92,48],[W-84,170,36],[W-84,quoteTop+text.height*.6,36],[90,quoteTop+text.height*.45,28]])bow(c,x,y,s,accent,ink);
  for(const side of [62,W-62])for(let y=240;y<H-180;y+=110){heart(c,side,y,16,mix(bg,accent,.56));diamond(c,side,y+52,6,mix(bg,accent,.45));}
  box(c,inset-12,quoteTop-12,W-inset*2+24,text.height+24,mix(paper,accent,.035),18);
  c.save();c.translate(W-164,H-110);c.rotate(-.04);path(c,[[-144,-28],[128,-28],[144,0],[128,28],[-144,28],[-130,0]],mix(bg,accent,.2));c.restore();
 }else if(style==='notebook'){
  // A scrapbook page with layered torn paper and a deliberately small doodle vocabulary.
  for(let x=0;x<W;x+=25)for(let y=0;y<H;y+=25){circle(c,x,y,1,mix(bg,accent,.12));}
  path(c,[[64,72],[W-60,57],[W-49,H-81],[W-94,H-68],[W-130,H-78],[W-168,H-63],[120,H-59],[66,H-83]],mix(bg,accent,.17));
  path(c,[[83,60],[W-81,76],[W-70,H-72],[W-106,H-80],[W-145,H-65],[91,H-73]],paper);
  for(let y=101;y<H-70;y+=36)line(c,92,y,W-82,y,mix(bg,accent,.17),1);
  line(c,112,76,112,H-74,mix(bg,'#c44d65',.5),2);
  for(let y=114;y<H-85;y+=78){circle(c,67,y,9,mix(bg,ink,.25));circle(c,67,y,5,bg);}
  tape(c,196,77,160,mix(bg,accent,.36),-.13);tape(c,W-174,86,142,mix(bg,'#ba4c59',.29),.14);
  for(const [x,y]of [[W-70,quoteTop+40],[74,quoteBottom-34],[W-100,H-100]]){star(c,x,y,18,textAccent);star(c,x+15,y+17,7,secondary);}
  c.save();c.strokeStyle=mix(bg,accent,.2);c.lineWidth=5;c.beginPath();c.arc(W-171,H-136,61,0,Math.PI*2);c.stroke();c.lineWidth=2;c.beginPath();c.arc(W-168,H-138,68,.3,5.8);c.stroke();c.restore();
  note(c,W-78,quoteTop+text.height*.55,28,mix(bg,accent,.6));
 }else if(style==='retro'){
  // A cabinet bezel surrounds the lyric stage; its status lights remain inside the bezel.
  c.imageSmoothingEnabled=false;
  for(let i=0;i<120;i++){const x=(i*173+17)%W,y=(i*89+21)%H;c.fillStyle=mix(bg,i%3?accent:secondary,.35);c.fillRect(x,y,i%3?3:6,i%3?3:6);}
  box(c,38,38,W-76,H-76,mix(bg,accent,.09),0,edge,5);box(c,57,57,W-114,H-114,paper,0,mix(bg,secondary,.36),3);
  for(let x=65;x<W-70;x+=24)for(const y of [65,H-77]){c.fillStyle=mix(bg,x%48?accent:secondary,.35);c.fillRect(x,y,12,12);}
  for(let y=100;y<H-90;y+=56)for(const x of [68,W-78]){c.fillStyle=secondary;c.fillRect(x,y,7,7);}
  box(c,inset-23,quoteTop-17,W-inset*2+46,text.height+34,mix(bg,accent,.035),0,mix(bg,accent,.18),2);
  
  for(let y=84;y<H-83;y+=6){c.fillStyle=mix(bg,ink,.018);c.fillRect(81,y,W-162,1);}
  
 }else if(style==='gotham'){
  // Deco architecture and a jazz-night scene extend behind, rather than enclosing, the quote.
  for(let i=0;i<130;i++){const x=(i*157+23)%W,y=(i*97)%H;line(c,x,y,x-13,y+35,mix(bg,'#86a3c7',.14),1);}
  box(c,75,76,W-150,H-152,mix(bg,'#141b2b',.63));
  for(const offset of [0,9,23]){c.strokeStyle=mix(bg,accent,offset===0?.75:.28);c.lineWidth=offset===0?2:1;c.strokeRect(frame+offset,frame+offset,W-2*(frame+offset),H-2*(frame+offset));}
  for(const x of [78,W-78]){for(let i=0;i<4;i++)line(c,x+(x<W/2?i:-i)*8,88,x+(x<W/2?i:-i)*8,130+i*7,edge,2);diamond(c,x,quoteTop+text.height*.5,16,edge);}
  for(const side of [66,W-66]){c.save();c.beginPath();c.rect(76,76,W-152,H-152);c.clip();path(c,[[side,150],[side-75,quoteTop+180],[side+75,quoteTop+180]],mix(bg,accent,.045));c.restore();circle(c,side,150,7,accent);}
  // Architectural fan detail stays behind the lyric type.
  c.save();c.beginPath();c.rect(90,quoteTop-20,W-180,text.height+40);c.clip();for(let i=-7;i<=7;i++)line(c,W/2,quoteBottom+140,W/2+i*135,quoteTop-90,mix(bg,accent,.06),1);c.restore();
 }else{
  // Tactile concert-poster layers, record grooves and flowing musical ribbons.
  for(let i=0;i<9;i++){c.strokeStyle=mix(bg,accent,.08+i*.012);c.lineWidth=2;c.beginPath();c.arc(W-34,96,90+i*24,0,Math.PI*2);c.stroke();}
  path(c,[[30,170],[W-50,38],[W-28,H-148],[75,H-28]],mix(bg,accent,.16));
  box(c,69,76,W-138,H-152,paper,22,edge,1);
  c.save();c.beginPath();c.roundRect(69,76,W-138,H-152,22);c.clip();
  for(let i=0;i<4;i++){c.strokeStyle=mix(bg,accent,.13+i*.03);c.lineWidth=7;c.beginPath();c.moveTo(30,H-240+i*17);c.bezierCurveTo(W*.4,H-460,W*.5,H+30,W-20,H-240+i*17);c.stroke();}
  c.restore();
  for(const [x,y,r]of [[87,99,26],[W-76,quoteTop+text.height*.36,24],[W-127,H-162,17]])diamond(c,x,y,r,textAccent);
  for(let i=0;i<6;i++){circle(c,82+i*14,H-90,3,mix(bg,accent,.65));}
  box(c,inset-18,quoteTop-16,W-inset*2+36,text.height+32,mix(paper,accent,.025),16);
 }
 // A few low-contrast specks give backgrounds print texture without raster noise cost.
 c.fillStyle=mix(bg,ink,.045);for(let i=0;i<Math.round(W*H/600);i++)c.fillRect((i*179)%W,(i*97)%H,1,1);
 if(retroSprites)drawRetroSprites(c,retroSprites,{width:W,height:H,quoteTop,quoteBottom,compact});
 if(gothamSprites)drawGothamSprites(c,gothamSprites,{width:W,height:H,quoteTop,quoteBottom,compact},accent);
 // The hero overlay may cross the frame, but reserves the song and quote as the focal point.
 if(illustration&&!['classic','notebook','comics','aero'].includes(style)){
  const artSize=compact?150:style==='gotham'?350:style==='pink'?260:300,x=style==='pink'?80:60,y=H-artSize-52;
  c.save();if(style==='retro')c.imageSmoothingEnabled=false;c.drawImage(illustration,x,y,artSize,artSize);c.restore();
 }
 // A framed album cover and larger, heavier song identity stay anchored at the top left.
 const radius=style==='retro'?0:style==='gotham'?2:8;
 box(c,inset-6,headerY-6,coverSize+12,coverSize+12,paper,radius,edge,2);
 c.save();c.beginPath();c.roundRect(inset,headerY,coverSize,coverSize,radius);c.clip();
 if(cover){const crop=Math.min(cover.naturalWidth,cover.naturalHeight);c.drawImage(cover,(cover.naturalWidth-crop)/2,(cover.naturalHeight-crop)/2,crop,crop,inset,headerY,coverSize,coverSize);}
 else{box(c,inset,headerY,coverSize,coverSize,soft);circle(c,inset+coverSize/2,headerY+coverSize/2,coverSize*.36,mix(bg,ink,.13));circle(c,inset+coverSize/2,headerY+coverSize/2,coverSize*.13,accent);circle(c,inset+coverSize/2,headerY+coverSize/2,4,bg);}
 c.restore();
 if(style==='notebook'){tape(c,inset+coverSize/2,headerY-4,100,mix(bg,accent,.4),-.12);}
 if(style==='pink'){bow(c,inset+coverSize-7,headerY+coverSize-9,28,accent,ink);}
 c.textBaseline='top';c.textAlign='left';c.fillStyle=ink;c.font='800 '+titleSize+'px '+font;
 titleRows.forEach((row,i)=>{c.direction=/[\u0590-\u08ff]/u.test(row)?'rtl':'ltr';c.fillText(row,copyX,headerY-4+i*titleStep);});
 c.fillStyle=textAccent;c.font='700 '+artistSize+'px '+font;
 artistRows.forEach((row,i)=>{c.direction=/[\u0590-\u08ff]/u.test(row)?'rtl':'ltr';c.fillText(row,copyX,headerY+titleHeight+4+i*artistStep);});
 if(style==='gotham'){diamond(c,W/2,headerBottom+22,7,accent);line(c,inset,headerBottom+22,W/2-25,headerBottom+22,edge);line(c,W/2+25,headerBottom+22,W-inset,headerBottom+22,edge);}
 else{line(c,inset,headerBottom+18,W-inset,headerBottom+18,mix(bg,accent,.25));}
 // Text begins and ends on measured content boundaries, without vertical centering slack.
 let y=quoteTop;c.textAlign='center';c.font='600 '+size+'px '+font;c.fillStyle=ink;
 for(const group of text.rows){for(const row of group){c.direction=/[\u0590-\u08ff]/u.test(row)?'rtl':'ltr';c.fillText(row,W/2,y);y+=text.step;}y+=text.gap;}
 // Brand placement shares the inner frame inset in every theme. It is never at the canvas edge.
 c.direction='ltr';c.textAlign='right';c.textBaseline='alphabetic';c.fillStyle=textAccent;c.font='700 '+(style==='retro'?26:25)+'px '+(style==='retro'?font:'Arial');
 const brandX=W-inset-10,brandY=H-108,brandLeft=brandX-c.measureText('SONORA').width;c.fillText('SONORA',brandX,brandY);
 if(style==='retro'){const barsLeft=brandLeft-34-137;for(let i=0;i<9;i++){const h=14+((i*13)%32),x=barsLeft+i*16;c.fillStyle=i%3?accent:secondary;c.fillRect(x,brandY-h,9,h);}}
 if(style==='notebook'){line(c,brandX-100,brandY+6,brandX,brandY+3,textAccent,2);}
 // Decorative footers stay within their own measured region, independent of card height.
 if(style==='gotham'){line(c,W-370,H-138,W-140,H-138,edge);diamond(c,W-384,H-138,6,accent);}
 if(style==='pink'){for(let i=0;i<3;i++)heart(c,W-inset-180-i*28,H-108,13,mix(bg,accent,.5));}
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Couldn’t create the image. Please try again.')),'image/png'));
 return {blob,width:W,height:H};
}
