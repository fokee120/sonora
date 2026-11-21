import type {RetroSpriteBounds} from './retroSprites.js';
export const GOTHAM_SPRITE_FILES=["01_saxophonist_with_saxophone.png","02_art_deco_skyline_group.png","03_vintage_streetlamp.png","04_crescent_moon.png","05_crimson_smoke_large_left.png","06_crimson_smoke_lower_left.png","07_crimson_smoke_upper_center.png","08_crimson_smoke_upper_right.png","09_crimson_smoke_lower_right.png","10_skyscraper_empire.png","11_skyscraper_spire.png","12_skyscraper_office.png","13_skyscraper_setbacks.png","14_skyscraper_twin_spires.png","15_skyscraper_narrow.png","16_art_deco_arch_bridge.png","17_gold_saxophone_alone.png"] as const;
const cache=new Map<string,Promise<HTMLImageElement|null>>();
export async function loadGothamSprites(){
 const images=new Map<string,HTMLImageElement>();
 await Promise.all(GOTHAM_SPRITE_FILES.filter((_,i)=>i<9||i===16).map(async file=>{
  let task=cache.get(file);if(!task){task=(async()=>{let url:string|undefined;try{const response=await fetch('/mood-overlays/gotham-sprites/'+file,{signal:AbortSignal.timeout(6000)});if(!response.ok)return null;url=URL.createObjectURL(await response.blob());const image=new Image();image.src=url;await image.decode();image.dataset.moodSprite=file;return image;}catch{return null;}finally{if(url)URL.revokeObjectURL(url);}})();cache.set(file,task);void task.then(image=>{if(!image)cache.delete(file);});}const image=await task;if(image)images.set(file,image);
 }));return images;
}
export function drawGothamSprites(c:CanvasRenderingContext2D,images:Map<string,HTMLImageElement>,b:RetroSpriteBounds,accent='#d7b477'){
 const {width:W,height:H,quoteTop:top,quoteBottom:bottom,compact}=b,span=bottom-top;
 const draw=(index:number,x:number,y:number,width:number,alpha=1)=>{const image=images.get(GOTHAM_SPRITE_FILES[index-1]);if(!image)return;const w=Math.round(width),h=Math.round(w*image.naturalHeight/image.naturalWidth);x=Math.round(Math.max(18,Math.min(W-w-18,x)));y=Math.round(Math.max(18,Math.min(H-h-18,y)));c.save();c.globalAlpha=alpha;c.drawImage(image,x,y,w,h);c.restore();};
 // A common ground line is the inner bottom border of the Art Deco frame.
 const ground=H-76;
 const grounded=(index:number,x:number,width:number,alpha=1)=>{const image=images.get(GOTHAM_SPRITE_FILES[index-1]);if(!image)return;const h=Math.round(Math.round(width)*image.naturalHeight/image.naturalWidth);draw(index,x,ground-h,width,alpha);};
 // Smoke behind the skyline, with separate foreground veils below.
 draw(7,W*.46,28,compact?90:150,.65);draw(8,W-170,top-40,compact?110:170,.7);
 grounded(2,W*.32,compact?230:W*.48,.9);
 // Lamp and player occupy the same pavement, with the lamp behind his shoulder.
 const playerWidth=compact?96:175,playerX=compact?60:66;
 const player=images.get(GOTHAM_SPRITE_FILES[0]),lamp=images.get(GOTHAM_SPRITE_FILES[2]);
 if(player&&lamp){
  const playerHeight=playerWidth*player.naturalHeight/player.naturalWidth;
  const lampHeight=playerHeight*1.48,lampWidth=lampHeight*lamp.naturalWidth/lamp.naturalHeight;
  grounded(3,playerX+playerWidth*.2-lampWidth*.5,lampWidth);
 }
 grounded(1,compact?60:66,compact?96:175);
 draw(4,W-(compact?130:162),25,compact?72:100);
 // Floating ornaments are stars, never disconnected architecture.
 const sparkle=(x:number,y:number,r:number)=>{c.beginPath();c.moveTo(x,y-r);c.lineTo(x+r*.28,y-r*.28);c.lineTo(x+r,y);c.lineTo(x+r*.28,y+r*.28);c.lineTo(x,y+r);c.lineTo(x-r*.28,y+r*.28);c.lineTo(x-r,y);c.lineTo(x-r*.28,y-r*.28);c.closePath();c.fillStyle=accent;c.fill();};
 for(let i=0;i<Math.max(4,Math.floor(H/155));i++){const y=160+i*(H-340)/Math.max(3,Math.floor(H/155)-1);sparkle(65,y,i%2?5:9);sparkle(W-65,y+23,i%2?8:4);}
 for(const [x,y,r]of [[W*.32,40,5],[W*.7,54,7],[W*.6,H-55,4]])sparkle(x,y,r);
 // Crimson clouds cross the frame and overlap the lower scenery as translucent layers.
 draw(5,22,top+span*.26,compact?100:180,.7);
 draw(6,40,ground-(compact?57:104),compact?145:230,.82);
 draw(9,W-210,bottom-70,compact?110:200,.72);
 draw(17,W-(compact?202:245),H-(compact?207:300),compact?40:64,.95);
}

