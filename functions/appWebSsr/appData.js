'use strict';

async function fetchAppGetApp(appId) {
  const apiBaseUrl = getApiBaseUrl();

  const url = new URL('/v2/app', apiBaseUrl);
  url.searchParams.set('app_id', appId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: controller.signal,
    });
    const envelope = await response.json();
    if (!response.ok || envelope?.is_ok !== true || !envelope?.data?.app_info) {
      throw new Error(`appGetApp returned HTTP ${response.status}.`);
    }
    return envelope.data;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAppGetAppByHost(host, protocol) {
  const apiBaseUrl = getApiBaseUrl();

  const url = new URL('/v2/app/host', apiBaseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': host,
        'X-Forwarded-Proto': protocol,
      },
      body: '{}',
      signal: controller.signal,
    });
    const envelope = await response.json();
    if (response.status === 404) {
      const error = new Error('No KP app is registered for this host.');
      error.status = 404;
      throw error;
    }
    if (!response.ok || envelope?.is_ok !== true || !envelope?.data?.app_id || !envelope?.data?.app_info) {
      const error = new Error(`appGetAppByHost returned HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return envelope.data;
  } finally {
    clearTimeout(timer);
  }
}

function getApiBaseUrl() {
  const apiBaseUrl =
    process.env.APP_WEB_SSR_API_BASE_URL || process.env.KINGDOM_PLANET_API_URL;
  if (!apiBaseUrl) {
    throw new Error(
      'APP_WEB_SSR_API_BASE_URL or KINGDOM_PLANET_API_URL is not configured.',
    );
  }
  return apiBaseUrl;
}

async function loadAppForRequest(appId) {
  const fixtureText = process.env.APP_WEB_SSR_EMULATOR_FIXTURE_JSON;
  if (process.env.FUNCTIONS_EMULATOR === 'true' && fixtureText) {
    const fixtureMap = JSON.parse(fixtureText);
    const fixture = fixtureMap[appId];
    if (!fixture?.app_info) {
      throw new Error(`No emulator fixture is configured for app ${appId}.`);
    }
    return fixture;
  }
  return fetchAppGetApp(appId);
}

exports.fetchAppGetApp = fetchAppGetApp;
exports.fetchAppGetAppByHost = fetchAppGetAppByHost;
exports.loadAppForRequest = loadAppForRequest;
