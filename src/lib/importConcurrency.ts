/** Run independent import lookups concurrently while preserving source order. */
export async function orderedPool<T,R>(items:T[],concurrency:number,task:(item:T,index:number)=>Promise<R>):Promise<R[]>{
 const results=new Array<R>(items.length);let cursor=0,error:unknown,failed=false;
 await Promise.all(Array.from({length:Math.min(Math.max(1,Math.floor(concurrency)),items.length)},async()=>{while(!failed&&cursor<items.length){const index=cursor++;try{results[index]=await task(items[index],index);}catch(e){if(!failed){failed=true;error=e;}}}}));
 if(failed)throw error;return results;
}
