'use strict';

const { createHash } = require('node:crypto');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const rendererCache = new Map();
const rendererRequestMap = new Map();
const rendererCacheTtlMs = 5 * 60 * 1000;
const rendererCacheLimit = 8;
const maxRendererBytes = 4 * 1024 * 1024;
const rendererFetchTimeoutMs = 5000;

async function fetchRenderer(origin) {
  const url = new URL('/ssr/entry-server.js', origin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), rendererFetchTimeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      headers: { Accept: 'text/javascript, application/javascript' },
    });
    if (!response.ok) {
      throw new Error(`The FE SSR renderer returned HTTP ${response.status}.`);
    }
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxRendererBytes) {
      throw new Error('The FE SSR renderer exceeds the size limit.');
    }
    const source = Buffer.from(await response.arrayBuffer());
    if (!source.byteLength || source.byteLength > maxRendererBytes) {
      throw new Error('The FE SSR renderer is empty or exceeds the size limit.');
    }

    const digest = createHash('sha256').update(source).digest('hex');
    const directory = await mkdtemp(path.join(os.tmpdir(), 'kp-app-ssr-'));
    const rendererPath = path.join(directory, `entry-server-${digest}.mjs`);
    try {
      await writeFile(rendererPath, source, { mode: 0o600 });
      const renderer = await import(pathToFileURL(rendererPath).href);
      if (typeof renderer.render !== 'function') {
        throw new Error('The FE SSR renderer does not export render().');
      }
      return { renderer, directory };
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }
}

function loadRenderer(origin) {
  const rendererUrl = new URL('/ssr/entry-server.js', origin).toString();
  const cacheEntry = rendererCache.get(rendererUrl);
  if (cacheEntry && cacheEntry.expiresAt > Date.now()) {
    rendererCache.delete(rendererUrl);
    rendererCache.set(rendererUrl, cacheEntry);
    return Promise.resolve(cacheEntry.renderer);
  }
  if (rendererRequestMap.has(rendererUrl)) return rendererRequestMap.get(rendererUrl);

  const request = fetchRenderer(origin)
    .then(({ renderer, directory }) => {
      rendererCache.set(rendererUrl, {
        renderer,
        directory,
        expiresAt: Date.now() + rendererCacheTtlMs,
      });
      while (rendererCache.size > rendererCacheLimit) {
        const oldestRendererUrl = rendererCache.keys().next().value;
        const oldestEntry = rendererCache.get(oldestRendererUrl);
        rendererCache.delete(oldestRendererUrl);
        if (oldestEntry?.directory) {
          rm(oldestEntry.directory, { recursive: true, force: true }).catch(() => {});
        }
      }
      return renderer;
    })
    .finally(() => rendererRequestMap.delete(rendererUrl));
  rendererRequestMap.set(rendererUrl, request);
  return request;
}

exports.loadRenderer = loadRenderer;
