'use strict';

const sharp = require('sharp');

const logoCache = new Map();
const logoRequestMap = new Map();
const logoCacheTtlMs = 5 * 60 * 1000;
const logoCacheLimit = 128;
const maxLogoInputBytes = 256 * 1024;
const maxLogoOutputBytes = 32 * 1024;
const logoDimension = 96;
const logoFetchTimeoutMs = 2500;
const allowedLogoHosts = new Set(['firebasestorage.googleapis.com', 'storage.googleapis.com']);
const allowedLogoFormats = new Set(['avif', 'gif', 'jpeg', 'png', 'webp']);

async function readLimitedResponse(response, maxBytes) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error('The logo image exceeds the size limit.');
  }

  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error('The logo image exceeds the size limit.');
    return buffer;
  }

  const reader = response.body.getReader();
  const chunkList = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('The logo image exceeds the size limit.');
    }
    chunkList.push(Buffer.from(value));
  }
  return Buffer.concat(chunkList, totalBytes);
}

async function createLogoDataUri(logoUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), logoFetchTimeoutMs);
  try {
    const response = await fetch(logoUrl, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`Storage returned HTTP ${response.status}.`);
    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!contentType?.startsWith('image/')) throw new Error('The logo response is not an image.');

    const inputBuffer = await readLimitedResponse(response, maxLogoInputBytes);
    const image = sharp(inputBuffer, { limitInputPixels: 16_000_000 });
    const metadata = await image.metadata();
    if (!allowedLogoFormats.has(metadata.format)) throw new Error('The logo image format is not supported.');

    const outputBuffer = await image
      .resize(logoDimension, logoDimension, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78, alphaQuality: 82, effort: 2 })
      .toBuffer();
    if (outputBuffer.byteLength > maxLogoOutputBytes) {
      throw new Error('The optimized logo image exceeds the size limit.');
    }
    return `data:image/webp;base64,${outputBuffer.toString('base64')}`;
  } finally {
    clearTimeout(timer);
  }
}

async function createFaviconDataUri(logoDataUri) {
  const prefix = 'data:image/webp;base64,';
  if (typeof logoDataUri !== 'string' || !logoDataUri.startsWith(prefix)) return null;
  const base64 = logoDataUri.slice(prefix.length);
  if (!base64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;

  try {
    const logoBuffer = Buffer.from(base64, 'base64');
    if (!logoBuffer.byteLength || logoBuffer.byteLength > maxLogoOutputBytes) return null;
    const faviconBuffer = await sharp(logoBuffer, { limitInputPixels: 16_000_000 })
      .resize(32, 32, { fit: 'inside', withoutEnlargement: true })
      .png({ palette: true, quality: 85 })
      .toBuffer();
    if (faviconBuffer.byteLength > 16 * 1024) return null;
    return `data:image/png;base64,${faviconBuffer.toString('base64')}`;
  } catch {
    return null;
  }
}

function fetchLogoDataUri(value) {
  let logoUrl;
  try {
    logoUrl = new URL(typeof value === 'string' ? value.trim() : '');
  } catch {
    return Promise.resolve(null);
  }
  if (logoUrl.protocol !== 'https:' || !allowedLogoHosts.has(logoUrl.hostname) || logoUrl.username || logoUrl.password) {
    return Promise.resolve(null);
  }

  const cacheKey = logoUrl.toString();
  const cachedEntry = logoCache.get(cacheKey);
  if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
    logoCache.delete(cacheKey);
    logoCache.set(cacheKey, cachedEntry);
    return Promise.resolve(cachedEntry.dataUri);
  }
  if (logoRequestMap.has(cacheKey)) return logoRequestMap.get(cacheKey);

  const request = createLogoDataUri(cacheKey)
    .then((dataUri) => {
      if (!dataUri) return null;
      logoCache.set(cacheKey, { dataUri, expiresAt: Date.now() + logoCacheTtlMs });
      while (logoCache.size > logoCacheLimit) {
        logoCache.delete(logoCache.keys().next().value);
      }
      return dataUri;
    })
    .catch(() => null)
    .finally(() => logoRequestMap.delete(cacheKey));
  logoRequestMap.set(cacheKey, request);
  return request;
}

exports.createFaviconDataUri = createFaviconDataUri;
exports.fetchLogoDataUri = fetchLogoDataUri;
