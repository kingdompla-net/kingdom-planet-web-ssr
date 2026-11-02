'use strict';

const { fetchAppGetAppByHost, loadAppForRequest } = require('./appData');
const { createFaviconDataUri, fetchLogoDataUri } = require('./logo');
const { normalizeHost, parseHostMap } = require('./host');
const { getClientOrigin, loadClientAssets } = require('./clientAssets');
const { loadRenderer } = require('./renderer');
const { getTextMeta, renderDocument, renderFallbackDocument } = require('./document');

const responseHeader = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'text/html; charset=utf-8',
  Vary: 'Host, X-Forwarded-Host, X-Forwarded-Proto',
  'X-Content-Type-Options': 'nosniff',
};

function firstHeaderValue(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.split(',')[0].trim() || null;
}

function createAppWebSsrHandler(dependencies = {}) {
  const loadApp = dependencies.loadApp ?? loadAppForRequest;
  const loadAppByHost = dependencies.loadAppByHost ?? fetchAppGetAppByHost;
  const loadAssets = dependencies.loadAssets ?? loadClientAssets;
  const getRenderer = dependencies.loadRenderer ?? loadRenderer;
  const loadLogo = dependencies.loadLogo ?? fetchLogoDataUri;
  const loadFavicon = dependencies.loadFavicon ?? createFaviconDataUri;
  const getHostMap = dependencies.getHostMap ?? (() => {
    const hostMapText = process.env.APP_WEB_SSR_HOST_MAP;
    return hostMapText ? parseHostMap(hostMapText) : Object.create(null);
  });
  const logError = dependencies.logError ?? console.error;

  return async (request, response) => {
    response.set(responseHeader);
    if (request.method !== 'GET') {
      return response.status(405).send('Method Not Allowed');
    }

    let host;
    let hostname;
    let appId;
    let hostMap;
    try {
      host = firstHeaderValue(request.get('x-forwarded-host') ?? request.headers?.['x-forwarded-host']) ??
        firstHeaderValue(request.get('host') ?? request.headers?.host);
      hostname = normalizeHost(host);
      hostMap = getHostMap();
      appId = hostMap[hostname];
    } catch (error) {
      logError('appWebSsr host mapping is invalid.', error.message);
      return response.status(500).send('SSR configuration is unavailable.');
    }

    const protocolHeader = firstHeaderValue(request.get('x-forwarded-proto') ?? request.headers?.['x-forwarded-proto']);
    const protocol = protocolHeader === 'http' ? 'http' : 'https';
    let origin;
    try {
      origin = getClientOrigin(host);
    } catch (error) {
      logError('appWebSsr client origin is invalid.', error.message);
      return response.status(400).send('Invalid website host.');
    }
    const requestUrl = request.originalUrl ?? request.url ?? '/';
    let appResponse = null;
    let fallbackReason = '';
    if (appId) {
      try {
        appResponse = await loadApp(appId);
      } catch (error) {
        fallbackReason = 'appGetApp';
        logError('appWebSsr appGetApp failed.', { appId, message: error.message });
      }
    } else {
      try {
        appResponse = await loadAppByHost(host, protocol);
        appId = appResponse?.app_id;
        if (!appId || !appResponse?.app_info) {
          return response.status(404).send('Unknown website host.');
        }
      } catch (error) {
        if (error.status === 404) return response.status(404).send('Unknown website host.');
        logError('appWebSsr appGetAppByHost failed.', { host: hostname, message: error.message });
        return response.status(503).send('Website information is temporarily unavailable.');
      }
    }

    try {
      const assetsPromise = Promise.resolve().then(() => loadAssets(host));
      assetsPromise.catch(() => {});
      const rendererPromise = getRenderer(origin);
      rendererPromise.catch(() => {});
      const logoPromise = loadLogo(appResponse?.app_info?.logo);
      const faviconPromise = logoPromise
        .then((logoDataUri) => loadFavicon(logoDataUri))
        .catch(() => null);
      const [clientAssets, renderer, brandLogoDataUri, faviconDataUri] = await Promise.all([
        assetsPromise,
        rendererPromise,
        logoPromise,
        faviconPromise,
      ]);
      const safeAppResponse = toSsrAppResponse(appResponse);
      const rendered = await renderer.render({
        appId,
        appResponse: safeAppResponse,
        brandLogoDataUri: fallbackReason ? null : brandLogoDataUri,
        origin,
        requestUrl,
      });
      const html = renderDocument({
        appId,
        appResponse: safeAppResponse,
        faviconDataUri: fallbackReason ? null : faviconDataUri,
        origin,
        requestUrl,
        clientAssets,
        rendered,
        brandLogoDataUri,
      });
      if (fallbackReason) response.set('X-KP-Web-SSR-Fallback', fallbackReason);
      return response.status(200).send(html);
    } catch (error) {
      logError('appWebSsr could not build the document shell.', {
        appId,
        message: error.message,
      });
      return response.status(503).send(renderFallbackDocument());
    }
  };
}

function toSsrAppResponse(appResponse) {
  if (!appResponse?.app_info) return null;
  const appInfo = appResponse.app_info;
  return {
    app_id: appResponse.app_id,
    app_info: {
      name: appInfo.name ?? null,
      desc: appInfo.desc ?? null,
      meta: getTextMeta(appInfo.meta),
    },
  };
}

exports.createAppWebSsrHandler = createAppWebSsrHandler;
