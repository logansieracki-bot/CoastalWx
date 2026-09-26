const BASE = '/api';

async function request(path, options) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  listSystems: () => request('/systems'),
  createSystem: (data) => request('/systems', { method: 'POST', body: JSON.stringify(data) }),
  updateSystem: (id, data) => request(`/systems/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteSystem: (id) => request(`/systems/${id}`, { method: 'DELETE' }),
};
