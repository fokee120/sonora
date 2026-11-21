const key='sonora:silent-pause-enabled';
export function silentPauseEnabled():boolean{try{return localStorage.getItem(key)==='1';}catch{return false;}}
export function setSilentPauseEnabled(enabled:boolean):void{localStorage.setItem(key,enabled?'1':'0');window.dispatchEvent(new Event('sonora:playback-preferences'));}
