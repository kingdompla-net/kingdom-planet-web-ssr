'use strict';

const {
  getAppWebSsrUrl,
  getKpApiBaseUrl,
} = require('./config');
const {
  createForwardedHeaders,
  getRequestBody,
  getRequestTarget,
  normalizeHost,
  parseUpstreamBase,
  readHeader,
} = require('./request');
const { writeUpstreamResponse } = require('./response');

const timeoutMs = 55_000;

function createAppWebGatewayHandler(dependencies = {}) {
  const readAppWebSsrUrl = dependencies.getAppWebSsrUrl ?? getAppWebSsrUrl;
  const readKpApiBaseUrl = dependencies.getApiBaseUrl ?? getKpApiBaseUrl;
  const fetchRequest = dependencies.fetch ?? globalThis.fetch;
  const logError = dependencies.logError ?? console.error;

  return async (request, response) => {
    const host = normalizeHost(
      readHeader(request, 'x-forwarded-host') || readHeader(request, 'host'),
    );
    if (!host) return response.status(400).send('Invalid website host.');

    const protocolHeader = readHeader(request, 'x-forwarded-proto');
    const protocol = protocolHeader === 'http' ? 'http' : 'https';
    const method = String(request.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(method)) {
      return response.status(405).set('Allow', 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS').send('Method Not Allowed');
    }

    try {
      const target = getRequestTarget(request, {
        getApiBaseUrl: () => {
          const value = readKpApiBaseUrl();
          if (!value) throw new Error('KP_API_BASE_URL is not configured.');
          return parseUpstreamBase(value, 'KP_API_BASE_URL').toString().replace(/\/$/, '');
        },
        getAppWebSsrUrl: () => {
          const value = readAppWebSsrUrl();
          if (!value) throw new Error('APP_WEB_SSR_URL is not configured.');
          return parseUpstreamBase(value, 'APP_WEB_SSR_URL').toString().replace(/\/$/, '');
        },
      });
      if (!target.isApiRequest && method === 'HEAD') {
        return response.status(405).set('Allow', 'GET').send('Method Not Allowed');
      }

      const upstreamResponse = await fetchRequest(target.url, {
        method,
        headers: createForwardedHeaders(request, host, protocol, target.isApiRequest),
        body: getRequestBody(request, method),
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      return writeUpstreamResponse(upstreamResponse, response, method);
    } catch (error) {
      if (error.status === 405) {
        return response.status(405).set('Allow', 'GET, HEAD').send(error.message);
      }
      logError('appWebGateway upstream request failed.', {
        path: request.path || request.url || '/',
        message: error.message,
      });
      if (response.headersSent) {
        response.destroy(error);
        return undefined;
      }
      return response.status(502).send('The requested KP service is temporarily unavailable.');
    }
  };
}

module.exports = { createAppWebGatewayHandler };
