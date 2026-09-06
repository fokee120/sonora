import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App once
const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Configure Google Auth Provider with Google Drive readonly scope
const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
provider.setCustomParameters({
  prompt: 'select_account',
});

// Cache the access token in memory & persistent local storage as client fallback
let cachedAccessToken: string | null =
  typeof window !== 'undefined' ? localStorage.getItem('gdrive_access_token') : null;
let isSigningIn = false;

export interface DriveServerSessionResponse {
  connected: boolean;
  user: {
    uid?: string;
    email?: string;
    displayName?: string;
    photoURL?: string;
  } | null;
  connectedAt?: number;
  lastUsedAt?: number;
}

/**
 * Check if the server already maintains an active Google Drive session
 */
export const fetchServerDriveSession = async (): Promise<DriveServerSessionResponse> => {
  try {
    const res = await fetch('/api/drive/session');
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('Failed to check server-side Google Drive session:', err);
  }
  return { connected: false, user: null };
};

/**
 * Persist the Google Drive login session to the server side
 */
export const saveDriveSessionToServer = async (
  accessToken: string,
  user?: { uid?: string; email?: string; displayName?: string; photoURL?: string } | null
): Promise<boolean> => {
  try {
    const res = await fetch('/api/drive/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        accessToken,
        user: user
          ? {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
            }
          : null,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('Failed to save Google Drive session to server:', err);
    return false;
  }
};

/**
 * Initialize auth listener.
 * Automatically checks server-side session first so login is retained across refreshes!
 */
export const initGoogleAuth = (
  onAuthChange: (user: any | null, accessToken: string | null) => void
) => {
  // Check server-side session immediately
  fetchServerDriveSession().then((serverSession) => {
    if (serverSession.connected && serverSession.user) {
      // Server already has an active login
      const token = cachedAccessToken || 'server-active-token';
      onAuthChange(serverSession.user, token);
    }
  });

  return onAuthStateChanged(auth, async (user: User | null) => {
    if (!user) {
      // Even if Firebase client user is null, check if server has persistent login
      const serverSession = await fetchServerDriveSession();
      if (serverSession.connected && serverSession.user) {
        onAuthChange(serverSession.user, cachedAccessToken || 'server-active-token');
      } else {
        cachedAccessToken = null;
        if (typeof window !== 'undefined') {
          localStorage.removeItem('gdrive_access_token');
        }
        onAuthChange(null, null);
      }
      return;
    }

    if (cachedAccessToken) {
      // Sync with server in background to ensure server has it
      saveDriveSessionToServer(cachedAccessToken, {
        uid: user.uid,
        email: user.email || undefined,
        displayName: user.displayName || undefined,
        photoURL: user.photoURL || undefined,
      });
      onAuthChange(user, cachedAccessToken);
    } else if (!isSigningIn) {
      // Check if server already has the token stored
      const serverSession = await fetchServerDriveSession();
      if (serverSession.connected) {
        onAuthChange(user, 'server-active-token');
      } else {
        onAuthChange(user, null);
      }
    }
  });
};

/**
 * Interactive popup sign-in to obtain Google Drive permissions and access token,
 * then immediately saves and keeps the login on the server side!
 */
export const signInWithGoogleDrive = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);

    if (!credential?.accessToken) {
      throw new Error('Could not acquire Google Drive access token from authentication credentials');
    }

    cachedAccessToken = credential.accessToken;
    if (typeof window !== 'undefined') {
      localStorage.setItem('gdrive_access_token', cachedAccessToken);
    }

    // Persist login to the server side
    await saveDriveSessionToServer(cachedAccessToken, {
      uid: result.user.uid,
      email: result.user.email || undefined,
      displayName: result.user.displayName || undefined,
      photoURL: result.user.photoURL || undefined,
    });

    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Google Drive sign-in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

/**
 * Retrieve current cached access token.
 */
export const getDriveAccessToken = (): string | null => {
  if (!cachedAccessToken && typeof window !== 'undefined') {
    cachedAccessToken = localStorage.getItem('gdrive_access_token');
  }
  return cachedAccessToken;
};

/**
 * Check if active drive access token is present.
 */
export const isDriveAuthenticated = (): boolean => {
  return Boolean(getDriveAccessToken());
};

/**
 * Sign out and clear server-side session and local tokens.
 */
export const logoutGoogleDrive = async (): Promise<void> => {
  try {
    // Disconnect server-side session
    await fetch('/api/drive/session', { method: 'DELETE' });
    await signOut(auth);
  } catch (err) {
    console.warn('Error during logout from Google Drive:', err);
  } finally {
    cachedAccessToken = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem('gdrive_access_token');
      localStorage.removeItem('gdrive_user');
    }
  }
};

