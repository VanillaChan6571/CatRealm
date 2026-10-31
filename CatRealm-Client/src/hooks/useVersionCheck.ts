import { useEffect } from 'react';
import { useVersionStore } from '../stores/versionStore';
import { useAuthStore } from '../stores/authStore';
import { AUTH_BASE } from '../lib/authApi';
import axios from 'axios';

/**
 * Hook to check server version on mount and periodically
 */
export function useVersionCheck() {
  const setServerVersion = useVersionStore((s) => s.setServerVersion);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    // Only check if central account is logged in
    if (!user || user.accountType !== 'central') return;

    const checkServerVersion = async () => {
      try {
        // Always check central auth server for central accounts
        const response = await axios.get(`${AUTH_BASE}/api/version`);
        const version = response.data?.version || response.headers['x-app-version'];

        if (version) {
          setServerVersion(version);
        }
      } catch (error) {
        // Silently fail - don't disrupt user experience
        console.debug('Version check failed:', error);
      }
    };

    // Check immediately
    checkServerVersion();

    // Check every 5 minutes
    const interval = setInterval(checkServerVersion, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user, setServerVersion]);
}
