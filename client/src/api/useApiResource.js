import { useEffect, useState } from 'react';
import { useAuth } from '../auth/useAuth.js';

export function useApiResource(path) {
  const { request } = useAuth();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState(null);
  const key = `${path}|${attempt}`;
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await request(path, { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ key, data, error: null });
      } catch (error) {
        if (!controller.signal.aborted) setResult({ key, data: null, error });
      }
    }
    load();
    return () => controller.abort();
  }, [key, path, request]);
  return {
    data: result?.key === key ? result.data : null,
    error: result?.key === key ? result.error : null,
    loading: result?.key !== key,
    retry: () => setAttempt((value) => value + 1),
  };
}
