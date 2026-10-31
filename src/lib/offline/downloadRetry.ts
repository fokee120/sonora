export function waitForDownloadRetry(ms:number,signal:AbortSignal):Promise<void>{
 return new Promise((resolve,reject)=>{signal.throwIfAborted();const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},ms);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
}
/** One initial attempt, then three retries. Cancellation never retries. */
export async function retryDownload<T>(operation:(attempt:number)=>Promise<T>,signal:AbortSignal,onRetry:()=>Promise<void>=async()=>{},wait=waitForDownloadRetry):Promise<T>{
 for(let attempt=0;;attempt++){signal.throwIfAborted();try{return await operation(attempt);}catch(error){if(signal.aborted||attempt>=3)throw error;await onRetry();await wait(5000,signal);}}
}
