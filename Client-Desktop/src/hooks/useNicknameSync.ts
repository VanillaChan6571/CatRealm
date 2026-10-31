import { useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { nicknameScope, useNicknamesStore } from '../stores/nicknamesStore';
import { createApi } from '../lib/api';
import { createAuthenticatedApi } from '../lib/authApi';

export function useNicknameSync() {
  const { user, serverUrl, isAuthenticated } = useAuthStore();
  useEffect(() => {
    useNicknamesStore.getState().reset();
  }, [user?.id, user?.accountType, isAuthenticated]);
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const scope = nicknameScope();
    const central = user.accountType === 'central' && !serverUrl;
    const api = central ? createAuthenticatedApi() : createApi();
    let live = true;
    void api.get('/api/profile/nicknames').then(res => {
      if (live && nicknameScope() === scope) useNicknamesStore.getState().loadNicknames(scope, res.data);
    }).catch(() => { /* Profile editor exposes retry/error UI if this refresh fails. */ });
    return () => { live = false; };
  }, [user?.id, user?.accountType, serverUrl, isAuthenticated]);
}
