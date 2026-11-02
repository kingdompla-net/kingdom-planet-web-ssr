'use strict';

function normalizeHost(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('A request Host is required.');
  }
  const hostUrl = new URL(`http://${value.trim()}`);
  if (hostUrl.username || hostUrl.password || hostUrl.pathname !== '/' || hostUrl.search || hostUrl.hash) {
    throw new Error('The request Host is invalid.');
  }
  const hostname = hostUrl.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname || hostname.length > 253) {
    throw new Error('The request Host is invalid.');
  }
  return hostname;
}

function parseHostMap(value) {
  const source = typeof value === 'string' ? JSON.parse(value) : value;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('APP_WEB_SSR_HOST_MAP must be a JSON object.');
  }

  const hostMap = Object.create(null);
  for (const [host, appId] of Object.entries(source)) {
    const normalizedHost = normalizeHost(host);
    if (typeof appId !== 'string' || !appId.trim() || appId.length > 128) {
      throw new Error(`APP_WEB_SSR_HOST_MAP has an invalid app ID for ${host}.`);
    }
    hostMap[normalizedHost] = appId.trim();
  }
  return hostMap;
}

exports.normalizeHost = normalizeHost;
exports.parseHostMap = parseHostMap;
