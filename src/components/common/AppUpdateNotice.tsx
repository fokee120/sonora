import { useAppUpdateStatus } from '../../lib/offline/appShell.js';

export function AppUpdateNotice() {
  const status = useAppUpdateStatus();
  if (status === 'idle') return null;
  const label = status === 'installing' ? 'Updating Sonora…'
    : status === 'waiting' ? 'Update ready. Sonora will restart when idle.'
    : 'Restarting Sonora…';
  return <div className="sonora-update-notice" role="status" aria-live="polite">
    <span>{label}</span>
    {status !== 'waiting' && <div className="sonora-update-progress" aria-hidden="true"><i /></div>}
  </div>;
}
