/** User-separated original sprites, kept as individual PNGs with their native alpha. */
export const RETRO_SPRITE_FILES = [
 '01_arcade_cabinet.png','02_pink_floating_robot.png','03_lime_seated_robot.png',
 '04_asteroid_01.png','05_green_star.png','06_asteroid_02.png','07_asteroid_03.png',
 '08_asteroid_04.png','09_coral_star.png','10_asteroid_05.png','11_ringed_planet.png',
 '12_cyan_star_01.png','13_asteroid_06.png','14_cyan_star_02.png','15_purple_star.png',
 '16_red_star_01.png','17_crystal_cluster.png','18_red_star_02.png','19_asteroid_07.png',
 '20_asteroid_08.png','21_wired_game_controller.png','22_floating_rock_platform.png',
 '23_purple_crystal.png',
] as const;
export type RetroSpriteFile=typeof RETRO_SPRITE_FILES[number];
export type RetroSpriteImages=Map<RetroSpriteFile,HTMLImageElement>;
export type RetroSpriteBounds={width:number;height:number;quoteTop:number;quoteBottom:number;compact:boolean};
const pending=new Map<RetroSpriteFile,Promise<HTMLImageElement|null>>();
async function loadSprite(file:RetroSpriteFile){
 let task=pending.get(file);
 if(!task){
  task=(async()=>{
   let objectUrl:string|undefined;
   try{
    const response=await fetch('/mood-overlays/retro-sprites/'+file,{signal:AbortSignal.timeout(6000)});
    if(!response.ok)return null;
    objectUrl=URL.createObjectURL(await response.blob());const image=new Image();image.src=objectUrl;await image.decode();
    image.dataset.moodSprite=file;return image;
   }catch{return null;}finally{if(objectUrl)URL.revokeObjectURL(objectUrl);}
  })();
  pending.set(file,task);void task.then(image=>{if(!image)pending.delete(file);});
 }
 return task;
}
export async function loadRetroSprites():Promise<RetroSpriteImages>{
 const result=new Map<RetroSpriteFile,HTMLImageElement>();
 await Promise.all(RETRO_SPRITE_FILES.map(async file=>{const image=await loadSprite(file);if(image)result.set(file,image);}));
 return result;
}
/** Deterministic art direction gives both shapes the same cast and a balanced orbit. */
export function drawRetroSprites(c:CanvasRenderingContext2D,images:RetroSpriteImages,b:RetroSpriteBounds){
 const {width:W,height:H,quoteTop:top,quoteBottom:bottom,compact}=b,span=bottom-top;
 const draw=(file:RetroSpriteFile,x:number,y:number,width:number,opacity=1)=>{
  const image=images.get(file);if(!image)return;
  const w=Math.round(width),h=Math.round(w*image.naturalHeight/image.naturalWidth);
  // Frame crossings are intentional; the PNG itself always remains fully on the photo.
  x=Math.round(Math.max(18,Math.min(W-w-18,x)));y=Math.round(Math.max(18,Math.min(H-h-18,y)));
  c.save();c.imageSmoothingEnabled=false;c.globalAlpha=opacity;c.drawImage(image,x,y,w,h);c.restore();
 };
 // Tiny orbiting details occupy different depths, rather than repeating one cluster.
 draw('04_asteroid_01.png',W*.31,26,compact?22:32,.85);
 draw('06_asteroid_02.png',W-76,top+span*.53,compact?24:40,.9);
 draw('07_asteroid_03.png',W*.61,H-65,compact?18:24,.8);
 draw('08_asteroid_04.png',24,top+span*.08,compact?22:32,.8);
 draw('10_asteroid_05.png',W*.65,top-32,compact?20:28,.65);
 draw('13_asteroid_06.png',W*.4,top+span*.52,compact?18:26,.45);
 draw('19_asteroid_07.png',W-94,H-216,compact?22:34,.8);
 draw('20_asteroid_08.png',W*.56,30,compact?18:26,.85);
 draw('05_green_star.png',W*.46,28,compact?24:36);
 draw('09_coral_star.png',58,top-42,compact?24:40);
 draw('12_cyan_star_01.png',W-72,top+span*.13,compact?23:34);
 draw('14_cyan_star_02.png',W*.53,bottom+32,compact?19:28,.9);
 draw('15_purple_star.png',43,82,compact?22:30);
 draw('16_red_star_01.png',W*.76,48,compact?18:26);
 draw('18_red_star_02.png',64,bottom+18,compact?20:30);
 // The planet crowns the frame; the two robots greet the listener from opposite sides.
 draw('11_ringed_planet.png',W-(compact?158:218),20,compact?120:180);
 draw('02_pink_floating_robot.png',W-(compact?100:180),top+span*.14-(compact?22:24),compact?72:150);
 draw('03_lime_seated_robot.png',compact?28:24,top+span*.67-(compact?25:40),compact?64:130);
 draw('23_purple_crystal.png',58,top-(compact?96:108),compact?26:38);
 // The arcade sits on its own platform; the controller and crystals float separately.
 const platformWidth=compact?144:244,platformX=compact?128:88,platformY=H-(compact?95:112);
 draw('22_floating_rock_platform.png',platformX,platformY,platformWidth);
 const arcadeHeight=compact?91:204,arcadeWidth=arcadeHeight*518/684;
 draw('01_arcade_cabinet.png',platformX+(platformWidth-arcadeWidth)/2-6,platformY-arcadeHeight+10,arcadeWidth);
 draw('21_wired_game_controller.png',W*.43,H-(compact?127:176),compact?100:144);
 draw('17_crystal_cluster.png',W-(compact?190:230),H-(compact?212:276),compact?50:92);
}
