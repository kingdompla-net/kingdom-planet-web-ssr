'use strict';

const privateRoutePattern =
  /^\/(?:account|admin|auth|dashboard|mypage|payment)(?:\/|$)|^\/media\/[^/]+\/?$/i;
const mediaFieldPattern = /(?:image|file|media|video|audio|pdf|logo|asset|upload|url)/i;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const entityMap = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entityMap[character];
  });
}

function serializeScriptJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => {
    const escapedMap = {
      '<': '\\u003c',
      '>': '\\u003e',
      '&': '\\u0026',
      '\u2028': '\\u2028',
      '\u2029': '\\u2029',
    };
    return escapedMap[character];
  });
}

function getTextMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  const textMeta = Object.create(null);
  for (const [key, field] of Object.entries(meta)) {
    if (mediaFieldPattern.test(key)) continue;
    const type = typeof field?.type === 'string' ? field.type : '';
    if (mediaFieldPattern.test(type)) continue;
    const value = typeof field === 'string' ? field : field?.value;
    if (typeof value !== 'string') continue;
    const text = value.trim();
    if (!text || /^(?:https?:|data:|blob:)/i.test(text)) continue;
    textMeta[key] = text;
  }
  return textMeta;
}

function getPageName(pathname) {
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  if (!firstSegment) return null;
  try {
    return decodeURIComponent(firstSegment)
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (character) => character.toUpperCase());
  } catch {
    return firstSegment.replace(/[-_]+/g, ' ');
  }
}

function getMetadata(requestUrl, origin, appInfo) {
  const url = new URL(requestUrl, origin);
  const appName = appInfo?.name?.trim() || 'KP App';
  const appDescription = appInfo?.desc?.trim();
  const pageName = getPageName(url.pathname);
  const title = url.pathname === '/' ? appName : `${pageName || appName} | ${appName}`;
  const description = appDescription || `${title} website.`;
  const canonicalUrl = new URL(url.pathname, origin).toString();

  return {
    title,
    description,
    canonicalUrl,
    indexable: !privateRoutePattern.test(url.pathname),
  };
}

function assetUrl(origin, file) {
  return new URL(`/${String(file).replace(/^\/+/, '')}`, origin).toString();
}

function renderDocument({
  appId,
  appResponse,
  faviconDataUri,
  origin,
  requestUrl,
  clientAssets,
  rendered,
  brandLogoDataUri,
}) {
  const appInfo = appResponse?.app_info ?? {};
  const metadata = getMetadata(requestUrl, origin, appInfo);
  const styleTags = clientAssets.styleFileList
    .map((file) => `<link rel="stylesheet" href="${escapeHtml(assetUrl(origin, file))}">`)
    .join('');
  const preloadTags = clientAssets.modulePreloadList
    .map((file) => `<link rel="modulepreload" href="${escapeHtml(assetUrl(origin, file))}">`)
    .join('');
  const bootstrap = serializeScriptJson({
    appId,
    appName: appInfo.name ?? null,
    appDescription: appInfo.desc ?? null,
    appMetaText: appInfo.meta ?? {},
    logoDataUri: brandLogoDataUri ?? null,
    queryState: rendered?.queryState ?? null,
  });
  const faviconTag = faviconDataUri
    ? `<link rel="icon" type="image/png" sizes="32x32" href="${escapeHtml(faviconDataUri)}">`
    : '';

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    faviconTag,
    `<title>${escapeHtml(metadata.title)}</title>`,
    `<meta name="description" content="${escapeHtml(metadata.description)}">`,
    `<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}">`,
    `<meta name="robots" content="${metadata.indexable ? 'index,follow' : 'noindex,nofollow'}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${escapeHtml(appInfo.name?.trim() || 'KP App')}">`,
    `<meta property="og:title" content="${escapeHtml(metadata.title)}">`,
    `<meta property="og:description" content="${escapeHtml(metadata.description)}">`,
    `<meta property="og:url" content="${escapeHtml(metadata.canonicalUrl)}">`,
    '<meta name="twitter:card" content="summary">',
    `<meta name="twitter:title" content="${escapeHtml(metadata.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(metadata.description)}">`,
    preloadTags,
    styleTags,
    '</head>',
    '<body>',
    `<div id="root">${typeof rendered?.bodyHtml === 'string' ? rendered.bodyHtml : ''}</div>`,
    `<script>window.__APP_WEB_SSR__=${bootstrap};</script>`,
    `<script type="module" src="${escapeHtml(assetUrl(origin, clientAssets.entryFile))}"></script>`,
    '</body>',
    '</html>',
  ].join('');
}

function renderFallbackDocument() {
  return '<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Page temporarily unavailable</title><meta name="robots" content="noindex,nofollow"></head><body><main><h1>Page temporarily unavailable</h1><p>Please try again later.</p></main></body></html>';
}

exports.getTextMeta = getTextMeta;
exports.renderDocument = renderDocument;
exports.renderFallbackDocument = renderFallbackDocument;
