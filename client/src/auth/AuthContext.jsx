import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthContext } from './authContext.js';
import { apiRequest } from '../api/apiClient.js';

export function AuthProvider({ children }) {
  const [auth, setAuth] = useState({ user: null, loading: true, error: null });
  const [attempt, setAttempt] = useState(0);
  const csrfToken = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    async function bootstrap() {
      try {
        let user = null;
        try {
          ({ user } = await apiRequest('/auth/me', {
            signal: controller.signal,
          }));
        } catch (error) {
          if (error.status !== 401) throw error;
        }
        const data = await apiRequest('/auth/csrf', {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        csrfToken.current = data.csrfToken;
        setAuth({ user, loading: false, error: null });
      } catch (error) {
        if (!controller.signal.aborted) {
          setAuth({ user: null, loading: false, error: error.message });
        }
      }
    }
    bootstrap();
    return () => controller.abort();
  }, [attempt]);

  const request = useCallback(async (path, options = {}) => {
    try {
      const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(
        (options.method ?? 'GET').toUpperCase(),
      );
      if (unsafe && !csrfToken.current) {
        csrfToken.current = (await apiRequest('/auth/csrf')).csrfToken;
      }
      return await apiRequest(path, {
        ...options,
        headers: {
          ...options.headers,
          ...(unsafe && { 'X-CSRF-Token': csrfToken.current }),
        },
      });
    } catch (error) {
      if (error.status === 401) {
        csrfToken.current = null;
        setAuth({ user: null, loading: false, error: null });
      }
      if (error.code === 'CSRF_INVALID') {
        csrfToken.current = null;
        error.message = 'Your session changed. Please try again.';
      }
      throw error;
    }
  }, []);

  const login = useCallback(
    async (credentials) => {
      const data = await request('/auth/login', {
        method: 'POST',
        body: credentials,
      });
      csrfToken.current = data.csrfToken;
      setAuth({ user: data.user, loading: false, error: null });
    },
    [request],
  );

  const logout = useCallback(async () => {
    await request('/auth/logout', { method: 'POST' });
    csrfToken.current = null;
    setAuth({ user: null, loading: false, error: null });
  }, [request]);

  const retry = () => {
    setAuth({ user: null, loading: true, error: null });
    setAttempt((value) => value + 1);
  };

  return (
    <AuthContext.Provider value={{ ...auth, login, logout, request, retry }}>
      {children}
    </AuthContext.Provider>
  );
}
