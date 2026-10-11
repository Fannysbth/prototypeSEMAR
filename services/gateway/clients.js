import { callService } from '../../shared/http.js';

export function createClients(config) {
  const key = config.secrets.INTERNAL_API_KEY;
  const call = (base, path, opts = {}) => callService({ baseUrl: config.urls[base], path, internalKey: key, ...opts });
  return {
    auth: {
      login: (body, requestId) => call('auth', '/v1/login', { method: 'POST', body, requestId }),
      demoUsers: () => call('auth', '/v1/demo-users'),
    },
    privacy: {
      minimize: (body, requestId) => call('privacy', '/v1/minimize', { method: 'POST', body, requestId }),
      reidentify: (body, requestId) => call('privacy', '/v1/reidentify', { method: 'POST', body, requestId }),
      revoke: (body, requestId) => call('privacy', '/v1/revoke', { method: 'POST', body, requestId }),
      audit: (limit = 100) => call('privacy', `/v1/audit?limit=${limit}`),
      stats: () => call('privacy', '/v1/stats'),
      policy: () => call('privacy', '/v1/policy'),
    },
    claims: {
      create: (body, requestId) => call('claims', '/v1/claims', { method: 'POST', body, requestId }),
      list: (q = '') => call('claims', `/v1/claims${q}`),
      stats: () => call('claims', '/v1/stats'),
    },
    fraud: {
      analyze: (body, requestId) => call('fraud', '/v1/analyze', { method: 'POST', body, requestId }),
      cases: (q = '') => call('fraud', `/v1/cases${q}`),
      getCase: (id) => call('fraud', `/v1/cases/${encodeURIComponent(id)}`),
      review: (id, body) => call('fraud', `/v1/cases/${encodeURIComponent(id)}/review`, { method: 'POST', body }),
      stats: () => call('fraud', '/v1/stats'),
    },
    notify: {
      send: (body, requestId) => call('notify', '/v1/notifications', { method: 'POST', body, requestId }),
      list: () => call('notify', '/v1/notifications'),
    },
    tap: (service) => call(service, '/internal/tap'),
    clearTap: (service) => call(service, '/internal/tap', { method: 'DELETE' }),
    health: async (service) => {
      try { const r = await fetch(`${config.urls[service]}/health`, { signal: AbortSignal.timeout(1500) }); return r.ok; } catch { return false; }
    },
  };
}
