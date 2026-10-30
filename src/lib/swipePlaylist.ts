// Deliberately memory-only: a fresh page always asks for a destination again.
let lastPlaylistId: string | null = null;
export const getSwipePlaylist = () => lastPlaylistId;
export const rememberSwipePlaylist = (id: string | null) => { lastPlaylistId = id; };
