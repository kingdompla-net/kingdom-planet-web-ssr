'use strict';

const { normalizeHost } = require('./host');

const clientAssetCache = new Map();
const clientAssetRequestMap = new Map();
const clientAssetCacheTtlMs = 60 * 1000;
const maxManifestBytes = 512 * 1024;
const manifestTimeoutMs = 1500;

function getClientOrigin(host) {
  const hostname = normalizeHost(host);
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const scheme = isLocalHost ? 'http' : 'https';
  const originUrl = new URL(`${scheme}://${host}`);
  if (originUrl.hostname.toLowerCase().replace(/\.$/, '') !== hostname) {
    throw new Error('The client asset host is invalid.');
  }
  return originUrl.origin;
}

function validateAssetPath(value) {
  if (typeof value !== 'string' || !value || value.startsWith('/')) {
    throw new Error('The client manifest contains an invalid asset path.');
  }
  const segmentList = value.split('/');
  if (segmentList.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('The client manifest contains an invalid asset path.');
  }
  return value;
}

function findClientEntryKey(manifest) {
  const entryList = Object.entries(manifest).filter(([key, entry]) =>
    entry?.isEntry === true &&
    (key.endsWith('entry-client.tsx') || entry.src?.endsWith('entry-client.tsx')),
  );
  if (entryList.length !== 1) {
    throw new Error('The client manifest must contain one entry-client.tsx entry.');
  }
  return entryList[0][0];
}

function collectClientAssets(manifest) {
  const entryKey = findClientEntryKey(manifest);
  const visited = new Set();
  const moduleFileList = [];
  const styleFileSet = new Set();

  const visit = (key) => {
    if (visited.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`The client manifest is missing ${key}.`);
    visited.add(key);
    for (const styleFile of entry.css ?? []) {
      styleFileSet.add(validateAssetPath(styleFile));
    }
    for (const importKey of entry.imports ?? []) visit(importKey);
    if (entry.file) moduleFileList.push(validateAssetPath(entry.file));
  };

  visit(entryKey);
  return {
    entryFile: validateAssetPath(manifest[entryKey].file),
    modulePreloadList: [...new Set(moduleFileList)].filter(
      (file) => file !== manifest[entryKey].file,
    ),
    styleFileList: [...styleFileSet],
  };
}

async function fetchClientAssets(origin) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), manifestTimeoutMs);
  try {
    const response = await fetch(new URL('/manifest.json', origin), {
      signal: controller.signal,
      redirect: 'error',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`The client manifest returned HTTP ${response.status}.`);
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxManifestBytes) {
      throw new Error('The client manifest exceeds the size limit.');
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > maxManifestBytes) {
      throw new Error('The client manifest exceeds the size limit.');
    }
    return collectClientAssets(JSON.parse(body.toString('utf8')));
  } finally {
    clearTimeout(timer);
  }
}

function loadClientAssets(host) {
  let origin;
  try {
    origin = getClientOrigin(host);
  } catch (error) {
    return Promise.reject(error);
  }

  const cacheEntry = clientAssetCache.get(origin);
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    return Promise.resolve(cacheEntry.assets);
  }
  if (clientAssetRequestMap.has(origin)) return clientAssetRequestMap.get(origin);

  const request = fetchClientAssets(origin)
    .then((assets) => {
      clientAssetCache.set(origin, {
        assets,
        expiresAt: Date.now() + clientAssetCacheTtlMs,
      });
      return assets;
    })
    .finally(() => clientAssetRequestMap.delete(origin));
  clientAssetRequestMap.set(origin, request);
  return request;
}

exports.collectClientAssets = collectClientAssets;
exports.findClientEntryKey = findClientEntryKey;
exports.getClientOrigin = getClientOrigin;
exports.loadClientAssets = loadClientAssets;
