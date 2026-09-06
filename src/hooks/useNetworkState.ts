import { useState, useEffect, useCallback } from 'react';

export interface NetworkStatus {
  isOnline: boolean;
  isChecking: boolean;
  lastChecked: number;
  recheck: () => Promise<boolean>;
}

export function useNetworkState(): NetworkStatus {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [lastChecked, setLastChecked] = useState<number>(Date.now());

  const checkRealConnectivity = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setIsOnline(false);
      setLastChecked(Date.now());
      return false;
    }

    setIsChecking(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);

      const res = await fetch(`/api/health?t=${Date.now()}`, {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);

      const online = res.ok;
      setIsOnline(online);
      setLastChecked(Date.now());
      setIsChecking(false);
      return online;
    } catch {
      const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
      setIsOnline(online);
      setLastChecked(Date.now());
      setIsChecking(false);
      return online;
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setLastChecked(Date.now());
      checkRealConnectivity();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setLastChecked(Date.now());
    };

    const handleFocus = () => {
      checkRealConnectivity();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkRealConnectivity();
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const interval = setInterval(checkRealConnectivity, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [checkRealConnectivity]);

  return {
    isOnline,
    isChecking,
    lastChecked,
    recheck: checkRealConnectivity,
  };
}
