import React from 'react';
/** Tiny decorative arcade band: pixel sprites animate without a render loop. */
export function RetroArcade({playing}:{playing:boolean}){
 return <div className="retro-arcade" data-playing={playing} aria-hidden="true">
  <svg className="arcade-cabinet" viewBox="0 0 32 40" shapeRendering="crispEdges"><path d="M5 1h22v5h3v20h-4v13H4V26H1V6h4z" fill="var(--retro-panel)" stroke="var(--retro-salmon)" strokeWidth="2"/><path d="M6 7h20v15H6z" fill="var(--bg)"/><path d="M10 10h3v3h-3zm9 0h3v3h-3zm-6 6h6v3h-6z" fill="var(--accent)"/><path d="M3 25h26v4H3z" fill="var(--retro-salmon)"/><path d="M9 24h2v4H9zm12 2h3v2h-3zM13 33h6v2h-6z" fill="var(--accent)"/></svg>
  <span className="arcade-stars"><i/><i/><i/></span>
  <svg className="arcade-alien" viewBox="0 0 24 24" shapeRendering="crispEdges">
   <g fill="var(--accent)"><path d="M5 2h2v2h2v2h6V4h2V2h2v2h-2v2h3v3h2v8h-3v3h-3v-3H8v3H5v-3H2V9h2V6h3V4H5z"/><path className="alien-feet-a" d="M2 17h3v3h3v2H3v-2H1v-3zm17 0h3v3h-2v2h-5v-2h4z"/><path className="alien-feet-b" d="M1 13h2v-3h2v4H3v4H1zm20-3h2v8h-2v-4h-2v-4zM6 19h3v3H6zm9 0h3v3h-3z"/></g>
   <g className="alien-eyes" fill="var(--bg)"><path d="M7 9h3v4H7zm7 0h3v4h-3z"/></g><path d="M10 15h4v1h-4z" fill="var(--retro-salmon)"/>
  </svg>
  <span className="arcade-stars arcade-stars-right"><i/><i/><i/></span>
  <svg className="arcade-cabinet arcade-cabinet-right" viewBox="0 0 32 40" shapeRendering="crispEdges"><path d="M5 1h22v5h3v20h-4v13H4V26H1V6h4z" fill="var(--retro-panel)" stroke="var(--retro-salmon)" strokeWidth="2"/><path d="M6 7h20v15H6z" fill="var(--bg)"/><g className="arcade-screen" fill="var(--accent)"><path d="M9 17h3v3H9zm5-4h3v7h-3zm5-4h3v11h-3z"/></g><path d="M3 25h26v4H3z" fill="var(--retro-salmon)"/><path d="M9 24h2v4H9zm12 2h3v2h-3zM13 33h6v2h-6z" fill="var(--accent)"/></svg>
 </div>;
}
