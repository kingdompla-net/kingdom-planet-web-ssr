'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { fetchAppGetApp, fetchAppGetAppByHost, loadAppForRequest } = require('./appData');
const { createFaviconDataUri, fetchLogoDataUri } = require('./logo');
const { normalizeHost, parseHostMap } = require('./host');
const { collectClientAssets, findClientEntryKey, getClientOrigin, loadClientAssets } = require('./clientAssets');
const { getTextMeta, renderDocument } = require('./document');
const { createAppWebSsrHandler } = require('./handler');

exports.createAppWebSsrHandler = createAppWebSsrHandler;
exports.createFaviconDataUri = createFaviconDataUri;
exports.fetchAppGetApp = fetchAppGetApp;
exports.fetchAppGetAppByHost = fetchAppGetAppByHost;
exports.fetchLogoDataUri = fetchLogoDataUri;
exports.collectClientAssets = collectClientAssets;
exports.findClientEntryKey = findClientEntryKey;
exports.getClientOrigin = getClientOrigin;
exports.getTextMeta = getTextMeta;
exports.loadAppForRequest = loadAppForRequest;
exports.loadClientAssets = loadClientAssets;
exports.normalizeHost = normalizeHost;
exports.parseHostMap = parseHostMap;
exports.renderDocument = renderDocument;

exports.appWebSsr = onRequest(
  { region: 'us-central1', timeoutSeconds: 30, memory: '512MiB', concurrency: 80 },
  createAppWebSsrHandler(),
);
