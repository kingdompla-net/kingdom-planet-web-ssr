'use strict';

const { defineString } = require('firebase-functions/params');

const appWebSsrUrlParam = defineString('APP_WEB_SSR_URL');
const kpApiBaseUrlParam = defineString('KP_API_BASE_URL');

function readConfiguredValue(environmentName, parameter) {
  const environmentValue = process.env[environmentName];
  if (typeof environmentValue === 'string' && environmentValue.trim()) {
    return environmentValue.trim();
  }
  try {
    const parameterValue = parameter.value();
    return typeof parameterValue === 'string' ? parameterValue.trim() : '';
  } catch {
    return '';
  }
}

function getAppWebSsrUrl() {
  return readConfiguredValue('APP_WEB_SSR_URL', appWebSsrUrlParam);
}

function getKpApiBaseUrl() {
  return readConfiguredValue('KP_API_BASE_URL', kpApiBaseUrlParam);
}

module.exports = { getAppWebSsrUrl, getKpApiBaseUrl };
