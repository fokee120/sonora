// Shared by the playlist button and song swipe until the page is refreshed.
let lastPlaylistId: string | null = null;
export const getSwipePlaylist = () => lastPlaylistId;
export const rememberSwipePlaylist = (id: string | null) => { lastPlaylistId = id; };
