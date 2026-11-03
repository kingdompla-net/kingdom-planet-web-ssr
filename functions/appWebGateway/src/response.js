'use strict';

const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const responseHeaderBlockSet = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function copyResponseHeaderMap(upstreamResponse, response) {
  upstreamResponse.headers.forEach((value, name) => {
    if (!responseHeaderBlockSet.has(name.toLowerCase())) {
      response.setHeader(name, value);
    }
  });
  const cookieList = upstreamResponse.headers.getSetCookie?.() ?? [];
  if (cookieList.length > 0) response.setHeader('set-cookie', cookieList);
}

async function writeUpstreamResponse(upstreamResponse, response, method) {
  response.status(upstreamResponse.status);
  copyResponseHeaderMap(upstreamResponse, response);
  if (method === 'HEAD' || !upstreamResponse.body) return response.end();
  await pipeline(Readable.fromWeb(upstreamResponse.body), response);
  return undefined;
}

module.exports = { writeUpstreamResponse };
