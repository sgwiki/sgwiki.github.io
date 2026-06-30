import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createProxy } = require('./claude-mem-llm-proxy.js');

const silentLogger = {
  log() {},
  error() {},
};

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function baseUrl(server) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}`;
}

function requestText(requestUrl, { method = 'GET', body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(requestUrl);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({ statusCode: res.statusCode, body: data });
        });
      },
    );
    req.setTimeout(1000, () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function startProxy(config) {
  const proxy = createProxy({ port: 0, host: '127.0.0.1', logger: silentLogger, ...config });
  proxy.start();
  await once(proxy.server, 'listening');
  return proxy;
}

async function closeProxy(proxy) {
  await new Promise((resolve) => proxy.close(resolve));
}

test('forwards a queued request when admin load is under threshold', async () => {
  const admin = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ running: 0, queued: 0 }));
  });
  const target = await startServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ path: req.url, body }));
    });
  });
  const proxy = await startProxy({
    adminUrl: `${baseUrl(admin)}/running`,
    targetUrl: baseUrl(target),
    intervalMs: 5,
  });

  try {
    const response = await requestText(`${baseUrl(proxy.server)}/v1/messages`, {
      method: 'POST',
      body: 'hello',
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), { path: '/v1/messages', body: 'hello' });
  } finally {
    await closeProxy(proxy);
    await closeServer(target);
    await closeServer(admin);
  }
});

test('rejects new requests when the proxy queue is full', async () => {
  const proxy = await startProxy({ maxQueue: 0 });
  try {
    const response = await requestText(`${baseUrl(proxy.server)}/v1/messages`, {
      method: 'POST',
      body: 'hello',
    });
    assert.equal(response.statusCode, 503);
    assert.match(response.body, /proxy queue full/);
  } finally {
    await closeProxy(proxy);
  }
});

test('fail-opens after repeated admin lookup failures', async () => {
  const target = await startServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  const proxy = await startProxy({
    adminUrl: 'http://127.0.0.1:9/running',
    targetUrl: baseUrl(target),
    adminTimeoutMs: 10,
    failOpenAfterMs: 1,
    intervalMs: 5,
  });

  try {
    const response = await requestText(`${baseUrl(proxy.server)}/v1/messages`, {
      method: 'POST',
      body: 'hello',
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body, 'ok');
  } finally {
    await closeProxy(proxy);
    await closeServer(target);
  }
});
