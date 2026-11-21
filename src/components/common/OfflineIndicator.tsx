import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApp } from '../../context/AppContext.js';

export const OfflineIndicator: React.FC = () => {
  const { isOnline, recheckConnection } = useApp();
  const [reconnecting, setReconnecting] = useState(false);
  const [failed, setFailed] = useState(false);

  async function reconnect() {
    setReconnecting(true);
    setFailed(false);
    try {
      setFailed(!await recheckConnection());
    } catch {
      setFailed(true);
    } finally {
      setReconnecting(false);
    }
  }

  if (isOnline) return null;
  return <div className="home-offline-status">
    <button type="button" onClick={() => void reconnect()} disabled={reconnecting} aria-label={reconnecting ? 'Connecting' : 'Offline mode. Tap to reconnect'} className="home-offline-reconnect">
      <RefreshCw size={14} aria-hidden="true" className={reconnecting ? 'animate-spin' : ''} />
      {reconnecting ? 'Connecting…' : 'Offline mode'}
    </button>
    {failed && <span role="status" className="sr-only">Server still unreachable</span>}
  </div>;
};
