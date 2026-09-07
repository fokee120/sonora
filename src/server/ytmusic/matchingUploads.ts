import { cleanSongTitle, type YtmSong } from './YoutubeMusicClient.js';

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const artistName = (value: string) => normalize(value.replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, ''));
const titleName = (song: YtmSong) => {
  const title = normalize(cleanSongTitle(song.title));
  const artist = artistName(song.artist);
  return title.startsWith(artist + ' ') ? title.slice(artist.length + 1) : title;
};

// An alternate upload must match the artist, title/version and approximate duration.
// Do not turn a failed album track into a cover, live performance, remix or short clip.
export function matchingUploads(original: YtmSong, candidates: YtmSong[]): YtmSong[] {
  if (!original.durationSeconds || artistName(original.artist) === 'unknown artist') return [];
  return candidates.filter(candidate =>
    /^[\w-]{11}$/.test(candidate.videoId) && candidate.videoId !== original.videoId &&
    artistName(candidate.artist) === artistName(original.artist) &&
    titleName(candidate) === titleName(original) &&
    candidate.durationSeconds > 0 &&
    Math.abs(candidate.durationSeconds - original.durationSeconds) <= Math.min(8, original.durationSeconds * 0.04)
  );
}
