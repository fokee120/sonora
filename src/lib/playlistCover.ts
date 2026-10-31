import {cropImage} from '../components/common/PhotoCropper.js';
/** Shared crop step for direct playlist cover selection and the playlist editor. */
export const readPlaylistCover=(file:File)=>cropImage(file);
