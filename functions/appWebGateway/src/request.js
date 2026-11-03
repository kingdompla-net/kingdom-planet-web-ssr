'use strict';

const documentHeaderNameList = [
  'accept',
  'accept-language',
  'referer',
  'user-agent',
];
const apiHeaderNameList = [
  ...documentHeaderNameList,
  'authorization',
  'content-type',
  'cookie',
  'origin',
  'x-csrf-token',
  'x-requested-with',
];

function firstHeaderValue(value) {
  if (Array.isArray(value)) value = value[0];
  return typeof value === 'string' ? value.split(',')[0].trim() : '';
}

function readHeader(request, name) {
  if (typeof request.get === 'function') return firstHeaderValue(request.get(name));
  return firstHeaderValue(request.headers?.[name.toLowerCase()]);
}

function normalizeHost(value) {
  if (!value) return '';
  try {
    const url = new URL(`https://${value}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return '';
    }
    return url.host.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

function makeUpstreamUrl(baseUrl, routePath, search) {
  const upstreamUrl = new URL(baseUrl);
  const basePath = upstreamUrl.pathname.replace(/\/+$/, '');
  const suffixPath = routePath.replace(/^\/+/, '');
  upstreamUrl.pathname = `${basePath}/${suffixPath}` || '/';
  upstreamUrl.search = search;
  return upstreamUrl;
}

function parseUpstreamBase(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL.`);
  }

  const isLocalHttp =
    url.protocol === 'http:' &&
    ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new Error(`${label} must use HTTPS outside the local emulator.`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${label} must not include credentials, a query, or a fragment.`);
  }
  return url;
}

function getRequestTarget(request, dependencyMap) {
  const requestUrl = new URL(request.originalUrl || request.url || '/', 'https://request.invalid');
  const isApiRequest =
    requestUrl.pathname === '/kp-api' || requestUrl.pathname.startsWith('/kp-api/');
  if (isApiRequest) {
    const apiBaseUrl = dependencyMap.getKpApiBaseUrl();
    const apiRoutePath = requestUrl.pathname.slice('/kp-api'.length) || '/';
    return {
      isApiRequest: true,
      url: makeUpstreamUrl(apiBaseUrl, apiRoutePath, requestUrl.search),
    };
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const error = new Error('Only GET and HEAD requests are supported for website documents.');
    error.status = 405;
    throw error;
  }

  const appWebSsrUrl = dependencyMap.getAppWebSsrUrl();
  const forwardedUrl = makeUpstreamUrl(appWebSsrUrl, requestUrl.pathname, requestUrl.search);
  return { isApiRequest: false, url: forwardedUrl };
}

function createForwardedHeaderSet(request, host, protocol, isApiRequest) {
  const headerSet = new Headers();
  const headerNameList = isApiRequest ? apiHeaderNameList : documentHeaderNameList;
  for (const name of headerNameList) {
    const value = readHeader(request, name);
    if (value) headerSet.set(name, value);
  }
  headerSet.set('x-forwarded-host', host);
  headerSet.set('x-forwarded-proto', protocol);
  if (isApiRequest && !headerSet.has('origin')) {
    headerSet.set('origin', `${protocol}://${host}`);
  }
  return headerSet;
}

function getRequestBody(request, method) {
  if (method === 'GET' || method === 'HEAD') return undefined;
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (request.rawBody instanceof Uint8Array) return Buffer.from(request.rawBody);
  if (request.body === undefined || request.body === null) return undefined;
  return Buffer.from(JSON.stringify(request.body));
}

module.exports = {
  createForwardedHeaderSet,
  getRequestBody,
  getRequestTarget,
  normalizeHost,
  parseUpstreamBase,
  readHeader,
};
