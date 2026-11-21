const heroes = [
  { id: 'spider-man', name: 'Spider-Man', edition: 'Above the avenues', background: '#14253f', accent: '#f71920', secondary: '#1767b5' },
  { id: 'iron-man', name: 'Iron Man', edition: 'Arc reactor', background: '#241820', accent: '#ffcd8c', secondary: '#954a44' },
  { id: 'moon-knight', name: 'Moon Knight', edition: 'Under the crescent', background: '#151d2d', accent: '#dfe8ea', secondary: '#526a91' },
  { id: 'daredevil', name: 'Daredevil', edition: 'Hell’s Kitchen after dark', background: '#24171f', accent: '#ff9d9f', secondary: '#952f4c' },
  { id: 'black-panther', name: 'Black Panther', edition: 'Vibranium nights', background: '#1d192e', accent: '#dfc3ff', secondary: '#6b53a1' },
  { id: 'storm', name: 'Storm', edition: 'Eye of the storm', background: '#122529', accent: '#bff3db', secondary: '#337f82' },
] as const;

export type ComicHeroId = (typeof heroes)[number]['id'];

export const COMIC_HEROES = heroes.map(hero => {
  const prefix = '/themes/comics/worlds/' + hero.id;
  return {
    ...hero,
    art: prefix + '-comic-sticker.webp',
    displayArt: prefix + (hero.id === 'spider-man' ? '-crawl-sticker.webp' : '-comic-sticker.webp'),
    world: prefix + '-world.svg',
    mark: hero.id === 'storm' ? prefix + '-mark.svg' : '/themes/comics/panels/' + hero.id + '-mark.svg',
  };
});

export function comicHero(id: unknown) {
  return COMIC_HEROES.find(hero => hero.id === id) ?? COMIC_HEROES[0];
}
