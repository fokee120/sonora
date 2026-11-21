import React, { useEffect } from 'react';
import { useNetworkState } from '../../hooks/useNetworkState.js';
import { useCloudAccount, initializeCloudAccount, hasAccountAccess, refreshCloudSession } from '../../lib/cloudAccount.js';
import { AccountCard } from '../settings/AccountCard.js';

export function SignInGate({ children }: { children: React.ReactNode }) {
  const account = useCloudAccount();
  useNetworkState();
  useEffect(() => initializeCloudAccount(), []);

  if (hasAccountAccess()) return <>{children}</>;

  return <main className="signin-page">
    <div className="signin-identity">
      <span className="eyebrow">SONORA</span>
      <h1>Your music.<br/>Your world.</h1>
      <p>A place for everything you love listening to.</p>
    </div>
    <div className="signin-panel">
      {!account.ready ? <p role="status">Opening your listening space…</p> : <>
        {account.sessionUnavailable ? <>
          <h2>Waiting for Sonora</h2>
          <p role="status">We couldn’t check your account. Try again when the server is reachable.</p>
        </> : <>
          <h2>Welcome to Sonora</h2>
          <p>Sign in with Google to open your library and start listening.</p>
          <AccountCard/>
        </>}
        <button className="text-button" onClick={() => void refreshCloudSession()}>Check connection again</button>
      </>}
      <small>Your playlists follow your account. Downloads stay on this device.</small>
    </div>
  </main>;
}

