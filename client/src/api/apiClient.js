export async function apiRequest(
  path,
  { method = 'GET', body, headers, signal } = {},
) {
  const response = await fetch(`/api/v1${path}`, {
    method,
    signal,
    credentials: 'same-origin',
    headers: {
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined;
  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error(
      'The server returned an unreadable response. Please try again.',
    );
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? 'The request failed.');
    Object.assign(error, payload.error, { status: response.status });
    throw error;
  }
  return payload.pagination ? payload : payload.data;
}
