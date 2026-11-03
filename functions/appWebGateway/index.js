'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { createAppWebGatewayHandler } = require('./src/handler');

exports.appWebGateway = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 60,
    memory: '256MiB',
    concurrency: 80,
  },
  createAppWebGatewayHandler(),
);
