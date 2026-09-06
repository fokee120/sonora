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
    if (!navigator.onLine) {
      setIsOnline(false);
      return false;
    }

    setIsChecking(true);
    try {
      // Ping our own lightweight health endpoint with cache busting
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
      setIsOnline(false);
      setLastChecked(Date.now());
      setIsChecking(false);
      return false;
    }
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      // Don't just trust the event; verify with real request
      checkRealConnectivity();
    };

    const handleOffline = () => {
      setIsOnline(false);
      setLastChecked(Date.now());
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Periodic check every 30 seconds
    const interval = setInterval(checkRealConnectivity, 30000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
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
