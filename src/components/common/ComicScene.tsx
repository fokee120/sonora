import { memo, type ReactNode } from 'react';
import { comicHero, type ComicHeroId } from '../../lib/comicHeroes.js';

export const ComicScene = memo(function ComicScene({ heroId, placement }: {
  heroId: ComicHeroId;
  placement: 'home' | 'picker' | 'player';
}) {
  const hero = comicHero(heroId);
  return <div key={heroId} className={'comic-scene comic-scene-' + placement} data-comic-scene={heroId} aria-hidden="true">
    <div className="comic-environment">
      <img src={hero.world} alt="" decoding="async" draggable={false}/>
    </div>
    <div className="comic-sweep"/>
    <div className="comic-newsprint"/>
    <div className="comic-contact-print" style={{ backgroundImage: 'url(' + hero.world + ')' }}/>
    <img className="comic-figure" src={placement === 'player' ? hero.art : hero.displayArt} alt="" decoding="async" draggable={false}/>
    <img className="comic-emblem" src={hero.mark} alt="" draggable={false}/>
  </div>;
});

export function ComicStage({ heroId, children }: { heroId: ComicHeroId; children: ReactNode }) {
  return <div className="comic-cover-stage">
    <ComicScene heroId={heroId} placement="player"/>
    <div className="comic-cover-mount"><div className="comic-cover-frame">{children}</div></div>
  </div>;
}
