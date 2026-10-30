/** Expected audio-request lifecycle endings, not provider or decoder failures. */
export function isRoutineAudioCancellation(error:unknown,clientDisconnected:boolean,timedOut:boolean):boolean{
 if(timedOut)return false;
 const value=error as {name?:string;code?:string}|null;
 if(value?.code==='AUDIO_STREAM_SUPERSEDED')return true;
 return clientDisconnected&&(value?.name==='AbortError'||['ABORT_ERR','ERR_STREAM_PREMATURE_CLOSE','ECONNRESET'].includes(value?.code||''));
}
