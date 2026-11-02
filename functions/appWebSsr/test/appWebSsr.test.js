'use strict';

const assert = require('node:assert/strict');
const { beforeEach, afterEach, describe, it } = require('mocha');
const sharp = require('sharp');

const {
  collectClientAssets,
  createAppWebSsrHandler,
  createFaviconDataUri,
  fetchAppGetApp,
  fetchAppGetAppByHost,
  fetchLogoDataUri,
  findClientEntryKey,
  getTextMeta,
  getClientOrigin,
  normalizeHost,
  parseHostMap,
  renderDocument,
} = require('../index.js');

const clientAssets = {
  entryFile: 'assets/entry-client-abc.js',
  modulePreloadList: ['assets/vendor-def.js'],
  styleFileList: ['assets/entry-client-abc.css'],
};

function createTestRenderer() {
  return async () => ({
    render({ appId, appResponse, brandLogoDataUri }) {
      const appInfo = appResponse?.app_info ?? {};
      const headline = appInfo.meta?.homepage_headline_first ?? 'Welcome';
      const about = appInfo.meta?.homepage_nav_about ?? '';
      const logo = brandLogoDataUri ? `<img src="${brandLogoDataUri}" alt="">` : '';
      return {
        bodyHtml: `<header>${logo}<span>${appInfo.name ?? 'KP App'}</span><nav>${about}</nav></header><main data-app-id="${appId}"><h1>${headline}</h1><p>${appInfo.meta?.pastor_greeting ?? ''}</p></main>`,
        queryState: { queries: [] },
      };
    },
  });
}

function createResponse() {
  return {
    statusCode: 200,
    headerMap: {},
    body: '',
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(nameOrMap, value) {
      if (typeof nameOrMap === 'string') this.headerMap[nameOrMap] = value;
      else Object.assign(this.headerMap, nameOrMap);
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

function createRequest(host, url = '/', extraHeaders = {}) {
  const headers = { host, ...extraHeaders };
  return {
    method: 'GET',
    headers,
    originalUrl: url,
    get(name) {
      return headers[name.toLowerCase()];
    },
  };
}

describe('appWebSsr host resolution and document shell', () => {
  it('normalizes forwarded hosts and validates the configured app map', () => {
    assert.equal(normalizeHost('Church-A.example.com:443'), 'church-a.example.com');
    assert.deepEqual(
      { ...parseHostMap({ 'Church-A.example.com': 'app-a' }) },
      { 'church-a.example.com': 'app-a' },
    );
    assert.throws(() => normalizeHost('user@church-a.example.com'));
    assert.throws(() => normalizeHost('church-a.example.com/path'));
    assert.throws(() => parseHostMap('{"localhost": ""}'));
    assert.equal(getClientOrigin('localhost:8088'), 'http://localhost:8088');
    assert.equal(getClientOrigin('church-a.example.com'), 'https://church-a.example.com');
  });

  it('renders app text metadata and an inline logo into the initial HTML', async () => {
    const appIdList = [];
    const handler = createAppWebSsrHandler({
      getHostMap: () => ({ 'church-a.example.com': 'app-a' }),
      loadApp: async (appId) => {
        appIdList.push(appId);
        return {
          app_info: {
            name: 'Alpha Church',
            desc: 'A place to belong.',
            logo: 'https://firebasestorage.googleapis.com/v0/b/test/o/logo.png?alt=media',
            meta: {
              homepage_headline_first: { type: 'text', value: 'A place to belong.' },
              homepage_nav_about: { type: 'text', value: 'About us' },
              hero_image: { type: 'image', value: 'https://media.example.com/hero.webp' },
              bulletin_pdf: { type: 'file', value: 'https://media.example.com/bulletin.pdf' },
              pastor_greeting: { type: 'textarea', value: 'Welcome to our church.' },
              external_link: { type: 'text', value: 'https://example.com' },
            },
          },
        };
      },
      loadAssets: async (host) => {
        assert.equal(host, 'church-a.example.com:443');
        return clientAssets;
      },
      loadRenderer: createTestRenderer(),
      loadLogo: async () => 'data:image/webp;base64,LOGO',
      loadFavicon: async () => 'data:image/png;base64,FAVICON',
      logError: () => {},
    });
    const response = createResponse();

    await handler(createRequest('church-a.example.com:443', '/?app_id=ignored'), response);

    assert.deepEqual(appIdList, ['app-a']);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headerMap['Cache-Control'], 'private, no-store, max-age=0');
    assert.match(response.body, /<title>Alpha Church<\/title>/);
    assert.match(response.body, /<meta name="description" content="A place to belong\.\">/);
    assert.match(response.body, /<div id="root"><header>/);
    assert.match(response.body, /data:image\/png;base64,FAVICON/);
    assert.match(response.body, /data:image\/webp;base64,LOGO/);
    assert.match(response.body, /<h1>A place to belong\.<\/h1>/);
    assert.match(response.body, /<nav>About us<\/nav>/);
    assert.match(response.body, /<p>Welcome to our church\.<\/p>/);
    assert.doesNotMatch(response.body, /hero_image|bulletin_pdf|external_link/);
    assert.doesNotMatch(response.body, /firebasestorage\.googleapis\.com|media\.example\.com/);
    assert.match(response.body, /https:\/\/church-a\.example\.com\/assets\/entry-client-abc\.js/);
    assert.match(response.body, /https:\/\/church-a\.example\.com\/assets\/entry-client-abc\.css/);
    assert.match(response.body, /window\.__APP_WEB_SSR__/);
  });

  it('serves the same client entry for different apps while binding each app response independently', async () => {
    const handler = createAppWebSsrHandler({
      getHostMap: () => ({
        'meadowlight.example.com': 'app-meadowlight',
        'green-pasture.example.com': 'app-green-pasture',
      }),
      loadApp: async (appId) => ({ app_info: { name: appId, meta: {} } }),
      loadAssets: async () => clientAssets,
      loadRenderer: createTestRenderer(),
      loadLogo: async () => null,
      logError: () => {},
    });
    const meadowlight = createResponse();
    const greenPasture = createResponse();

    await Promise.all([
      handler(createRequest('meadowlight.example.com'), meadowlight),
      handler(createRequest('green-pasture.example.com'), greenPasture),
    ]);

    assert.match(meadowlight.body, /<title>app-meadowlight<\/title>/);
    assert.match(greenPasture.body, /<title>app-green-pasture<\/title>/);
    assert.match(meadowlight.body, /"appId":"app-meadowlight"/);
    assert.match(greenPasture.body, /"appId":"app-green-pasture"/);
    assert.match(meadowlight.body, /assets\/entry-client-abc\.js/);
    assert.match(greenPasture.body, /assets\/entry-client-abc\.js/);
    assert.match(meadowlight.body, /data-app-id="app-meadowlight"/);
    assert.match(greenPasture.body, /data-app-id="app-green-pasture"/);
    assert.match(meadowlight.body, /<header>/);
    assert.match(greenPasture.body, /<header>/);
  });

  it('looks up an unconfigured host through appGetAppByHost', async () => {
    const hostLookupList = [];
    const handler = createAppWebSsrHandler({
      getHostMap: () => ({}),
      loadApp: async () => {
        throw new Error('The app ID lookup should use appGetAppByHost.');
      },
      loadAppByHost: async (host, protocol) => {
        hostLookupList.push({ host, protocol });
        return { app_id: 'app-a', app_info: { name: 'Alpha Church' } };
      },
      loadAssets: async () => clientAssets,
      loadRenderer: createTestRenderer(),
      loadLogo: async () => null,
      logError: () => {},
    });
    const response = createResponse();

    await handler(
      createRequest('hosting-internal:443', '/news', {
        'x-forwarded-host': 'church-a.example.com',
        'x-forwarded-proto': 'https',
      }),
      response,
    );

    assert.deepEqual(hostLookupList, [{ host: 'church-a.example.com', protocol: 'https' }]);
    assert.equal(response.statusCode, 200);
    assert.match(response.body, /<title>News \| Alpha Church<\/title>/);
    assert.match(response.body, /https:\/\/church-a\.example\.com\/news/);
  });

  it('returns 404 when appGetAppByHost does not recognize a host', async () => {
    let hostCallCount = 0;
    const handler = createAppWebSsrHandler({
      getHostMap: () => ({}),
      loadAppByHost: async () => {
        hostCallCount += 1;
        const error = new Error('No matching app.');
        error.status = 404;
        throw error;
      },
      logError: () => {},
    });
    const response = createResponse();

    await handler(createRequest('unknown.example.com'), response);

    assert.equal(response.statusCode, 404);
    assert.equal(hostCallCount, 1);
  });

  it('keeps a CSR shell available if appGetApp fails', async () => {
    const handler = createAppWebSsrHandler({
      getHostMap: () => ({ localhost: 'app-a' }),
      loadApp: async () => {
        throw new Error('network unavailable');
      },
      loadAssets: async () => clientAssets,
      loadRenderer: createTestRenderer(),
      logError: () => {},
    });
    const response = createResponse();

    await handler(createRequest('localhost:5000', '/ministries'), response);

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /<title>Ministries \| KP App<\/title>/);
    assert.match(response.body, /"appId":"app-a","appName":null,"appDescription":null/);
    assert.match(response.body, /"appMetaText":\{\},"logoDataUri":null,"queryState":\{"queries":\[\]\}/);
    assert.equal(response.headerMap['X-KP-Web-SSR-Fallback'], 'appGetApp');
  });

  it('rejects non-GET requests without contacting appGetApp', async () => {
    let appCallCount = 0;
    const handler = createAppWebSsrHandler({
      getHostMap: () => ({ localhost: 'app-a' }),
      loadApp: async () => {
        appCallCount += 1;
      },
      logError: () => {},
    });
    const request = createRequest('localhost:5000');
    request.method = 'POST';
    const response = createResponse();

    await handler(request, response);

    assert.equal(response.statusCode, 405);
    assert.equal(appCallCount, 0);
  });
});

describe('client manifest', () => {
  it('resolves entry, CSS and preloaded imports from the Vite manifest', () => {
    const manifest = {
      'src/ssr/entry-client.tsx': {
        file: 'assets/entry-client-abc.js',
        isEntry: true,
        imports: ['_shared-def.js'],
        css: ['assets/entry-client-abc.css'],
      },
      '_shared-def.js': { file: 'assets/shared-def.js' },
    };

    assert.equal(findClientEntryKey(manifest), 'src/ssr/entry-client.tsx');
    assert.deepEqual(collectClientAssets(manifest), {
      entryFile: 'assets/entry-client-abc.js',
      modulePreloadList: ['assets/shared-def.js'],
      styleFileList: ['assets/entry-client-abc.css'],
    });
    assert.throws(() => findClientEntryKey({}));
    assert.throws(() => collectClientAssets({
      'src/ssr/entry-client.tsx': { file: '../outside.js', isEntry: true },
    }));
  });
});

describe('appGetApp upstream request', () => {
  const originalFetch = global.fetch;
  const originalBaseUrl = process.env.APP_WEB_SSR_API_BASE_URL;
  const originalKingdomPlanetApiUrl = process.env.KINGDOM_PLANET_API_URL;

  beforeEach(() => {
    process.env.APP_WEB_SSR_API_BASE_URL = 'https://kp-api-dev.web.app';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.APP_WEB_SSR_API_BASE_URL;
    else process.env.APP_WEB_SSR_API_BASE_URL = originalBaseUrl;
    if (originalKingdomPlanetApiUrl === undefined) delete process.env.KINGDOM_PLANET_API_URL;
    else process.env.KINGDOM_PLANET_API_URL = originalKingdomPlanetApiUrl;
  });

  it('sends the existing public POST contract with app_id in the query', async () => {
    let requestUrl;
    let requestOptions;
    global.fetch = async (url, options) => {
      requestUrl = new URL(url);
      requestOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          is_ok: true,
          data: { app_info: { name: 'Alpha Church', desc: 'A church', logo: 'https://example.com/logo.png' } },
        }),
      };
    };

    const result = await fetchAppGetApp('app-a');

    assert.equal(requestUrl.pathname, '/v2/app');
    assert.equal(requestUrl.searchParams.get('app_id'), 'app-a');
    assert.equal(requestOptions.method, 'POST');
    assert.equal(requestOptions.body, '{}');
    assert.equal(result.app_info.name, 'Alpha Church');
  });

  it('uses the existing Kingdom Planet API base URL when the SSR-specific value is absent', async () => {
    delete process.env.APP_WEB_SSR_API_BASE_URL;
    process.env.KINGDOM_PLANET_API_URL = 'https://dev.api.kingdompla.net';
    let requestUrl;
    global.fetch = async (url) => {
      requestUrl = new URL(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ is_ok: true, data: { app_info: { name: 'Alpha Church' } } }),
      };
    };

    await fetchAppGetApp('app-a');

    assert.equal(requestUrl.origin, 'https://dev.api.kingdompla.net');
    assert.equal(requestUrl.pathname, '/v2/app');
  });

  it('resolves app info by forwarded host without an app ID parameter', async () => {
    let requestUrl;
    let requestOptions;
    global.fetch = async (url, options) => {
      requestUrl = new URL(url);
      requestOptions = options;
      return {
        ok: true,
        status: 200,
        json: async () => ({ is_ok: true, data: { app_id: 'app-a', app_info: { name: 'Alpha Church' } } }),
      };
    };

    const result = await fetchAppGetAppByHost('church-a.example.com', 'https');

    assert.equal(requestUrl.pathname, '/v2/app/host');
    assert.equal(requestUrl.search, '');
    assert.equal(requestOptions.method, 'POST');
    assert.equal(requestOptions.headers['X-Forwarded-Host'], 'church-a.example.com');
    assert.equal(requestOptions.headers['X-Forwarded-Proto'], 'https');
    assert.equal(result.app_id, 'app-a');
  });
});

describe('Firebase Storage logo optimization', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('resizes a trusted Storage image to a small cached WebP data URI', async () => {
    const inputBuffer = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 30, g: 90, b: 240, alpha: 1 } },
    }).png().toBuffer();
    let fetchCount = 0;
    global.fetch = async () => {
      fetchCount += 1;
      return {
        ok: true,
        headers: { get: (name) => (name === 'content-length' ? String(inputBuffer.length) : 'image/png') },
        arrayBuffer: async () => inputBuffer,
      };
    };
    const logoUrl = `https://firebasestorage.googleapis.com/v0/b/test/o/logo-${Date.now()}.png?alt=media`;

    const firstDataUri = await fetchLogoDataUri(logoUrl);
    const secondDataUri = await fetchLogoDataUri(logoUrl);
    const outputBuffer = Buffer.from(firstDataUri.split(',')[1], 'base64');
    const metadata = await sharp(outputBuffer).metadata();

    assert.equal(firstDataUri, secondDataUri);
    assert.equal(fetchCount, 1);
    assert.equal(metadata.format, 'webp');
    assert.ok(metadata.width <= 96);
    assert.ok(metadata.height <= 96);
    assert.ok(outputBuffer.length < inputBuffer.length);
  });

  it('creates a small PNG favicon from the optimized inline logo', async () => {
    const logoBuffer = await sharp({
      create: { width: 96, height: 96, channels: 4, background: { r: 30, g: 90, b: 240, alpha: 1 } },
    }).webp().toBuffer();
    const logoDataUri = `data:image/webp;base64,${logoBuffer.toString('base64')}`;

    const faviconDataUri = await createFaviconDataUri(logoDataUri);
    assert.match(faviconDataUri, /^data:image\/png;base64,/);
    const faviconBuffer = Buffer.from(faviconDataUri.split(',')[1], 'base64');
    const metadata = await sharp(faviconBuffer).metadata();

    assert.equal(metadata.format, 'png');
    assert.ok(metadata.width <= 32);
    assert.ok(metadata.height <= 32);
    assert.ok(faviconBuffer.length < 16 * 1024);
  });
});

describe('appWebSsr HTML document', () => {
  it('escapes app metadata and script values and includes no rendered GNB or media URL', () => {
    const scriptMarker = '</script><script>alert(1)</script>';
    const html = renderDocument({
      appId: 'app-alpha',
      appResponse: {
        app_info: {
          name: '<Alpha & Beta>',
          desc: 'A <church> & community',
          meta: { welcome: { type: 'text', value: scriptMarker } },
        },
      },
      brandLogoDataUri: 'data:image/webp;base64,LOGO',
      faviconDataUri: 'data:image/png;base64,FAVICON',
      origin: 'https://alpha.example.com',
      requestUrl: '/give?campaign=summer#top',
      clientAssets,
      rendered: {
        bodyHtml: '<main>Rendered</main>',
        queryState: { marker: scriptMarker },
      },
    });

    assert.ok(html.includes('<title>Give | &lt;Alpha &amp; Beta&gt;</title>'));
    assert.ok(html.includes('<meta name="description" content="A &lt;church&gt; &amp; community">'));
    assert.ok(html.includes('<div id="root"><main>Rendered</main></div>'));
    assert.ok(html.includes('"marker":"\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"'));
    assert.ok(!html.includes('</script><script>alert(1)</script>'));
    assert.ok(!html.includes('firebasestorage.googleapis.com'));
    assert.ok(!html.includes('<nav'));
    assert.ok(!html.includes('<header'));
    assert.ok(html.includes('https://alpha.example.com/assets/entry-client-abc.js'));
  });

  it('keeps only textual meta values and omits media-like keys and types', () => {
    assert.deepEqual({ ...getTextMeta({
      hero_title: { type: 'text', value: 'Welcome' },
      story: { type: 'textarea', value: 'A story' },
      hero_image: { type: 'image', value: 'https://example.com/hero.webp' },
      bulletin: { type: 'file', value: 'https://example.com/bulletin.pdf' },
      external_url: { type: 'text', value: 'https://example.com' },
      empty: { type: 'text', value: '  ' },
    }) }, { hero_title: 'Welcome', story: 'A story' });
  });
});
