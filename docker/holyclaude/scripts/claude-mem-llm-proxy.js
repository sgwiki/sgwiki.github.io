const http = require('http');
const https = require('https');

const DEFAULT_TARGET_URL = 'https://api.z.ai/api/anthropic';
const DEFAULT_ADMIN_URL = 'http://admin:3002/running';

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function makeConfig(overrides = {}) {
  return {
    threshold: overrides.threshold ?? intEnv('CLAUDE_MEM_PROXY_N', 3),
    targetUrl: overrides.targetUrl ?? process.env.PROXY_TARGET_URL ?? DEFAULT_TARGET_URL,
    adminUrl: overrides.adminUrl ?? process.env.CLAUDE_MEM_ADMIN_URL ?? DEFAULT_ADMIN_URL,
    port: overrides.port ?? intEnv('CLAUDE_MEM_PROXY_PORT', 37701),
    host: overrides.host ?? process.env.CLAUDE_MEM_PROXY_HOST ?? '127.0.0.1',
    intervalMs: overrides.intervalMs ?? intEnv('CLAUDE_MEM_PROXY_INTERVAL_MS', 2000),
    adminTimeoutMs: overrides.adminTimeoutMs ?? intEnv('CLAUDE_MEM_PROXY_ADMIN_TIMEOUT_MS', 2000),
    upstreamTimeoutMs:
      overrides.upstreamTimeoutMs ?? intEnv('CLAUDE_MEM_PROXY_UPSTREAM_TIMEOUT_MS', 120000),
    failOpenAfterMs:
      overrides.failOpenAfterMs ?? intEnv('CLAUDE_MEM_PROXY_FAIL_OPEN_AFTER_MS', 10000),
    maxQueue: overrides.maxQueue ?? intEnv('CLAUDE_MEM_PROXY_MAX_QUEUE', 100),
    maxQueuedAgeMs:
      overrides.maxQueuedAgeMs ?? intEnv('CLAUDE_MEM_PROXY_MAX_QUEUED_AGE_MS', 5 * 60 * 1000),
    now: overrides.now ?? (() => Date.now()),
    logger: overrides.logger ?? console,
  };
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload)}\n`);
}

function requestText(requestUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(requestUrl);
    const transport = parsed.protocol === 'http:' ? http : https;
    const req = transport.get(parsed, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data);
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
  });
}

class QueueEntry {
  constructor({ req, res, body, enqueuedAt }) {
    this.req = req;
    this.res = res;
    this.body = body;
    this.enqueuedAt = enqueuedAt;
  }
}

class ClaudeMemProxy {
  constructor(config = {}) {
    this.config = makeConfig(config);
    this.queue = [];
    this.lastAdminOkAt = null;
    this.firstAdminFailureAt = null;
    this.lastAdminError = null;
    this.lastActiveJobs = null;
    this.interval = null;
    this.server = http.createServer((req, res) => this.handleRequest(req, res));
  }

  start() {
    this.interval = setInterval(() => this.processQueue(), this.config.intervalMs);
    this.interval.unref?.();
    this.server.listen(this.config.port, this.config.host, () => {
      this.config.logger.log(`[llm-proxy] Listening on ${this.config.host}:${this.config.port}`);
      this.config.logger.log(`[llm-proxy] Target: ${this.config.targetUrl}`);
      this.config.logger.log(`[llm-proxy] Admin: ${this.config.adminUrl}`);
      this.config.logger.log(`[llm-proxy] N threshold: ${this.config.threshold}`);
    });
    return this.server;
  }

  close(callback) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.server.close(callback);
  }

  health() {
    const now = this.config.now();
    const oldest = this.queue[0] ? now - this.queue[0].enqueuedAt : 0;
    return {
      status: 'ok',
      admin_url: this.config.adminUrl,
      target_url: this.config.targetUrl,
      threshold: this.config.threshold,
      queue_length: this.queue.length,
      oldest_queued_age_ms: oldest,
      last_admin_ok_at: this.lastAdminOkAt,
      first_admin_failure_at: this.firstAdminFailureAt,
      last_admin_error: this.lastAdminError,
      last_active_jobs: this.lastActiveJobs,
    };
  }

  handleRequest(req, res) {
    if (req.method === 'GET' && req.url === '/health') {
      writeJson(res, 200, this.health());
      return;
    }

    const body = [];
    req.on('data', (chunk) => body.push(chunk));
    req.on('end', () => {
      if (this.queue.length >= this.config.maxQueue) {
        writeJson(res, 503, {
          error: 'proxy queue full',
          queue_length: this.queue.length,
          max_queue: this.config.maxQueue,
        });
        return;
      }

      this.queue.push(
        new QueueEntry({
          req,
          res,
          body: Buffer.concat(body),
          enqueuedAt: this.config.now(),
        }),
      );
      this.config.logger.log(`[llm-proxy] Queued LLM request. Queue length: ${this.queue.length}`);
      this.processQueue();
    });
  }

  async adminState() {
    const adminRes = await requestText(this.config.adminUrl, this.config.adminTimeoutMs);
    const status = JSON.parse(adminRes);
    const activeJobs = Number(status.running || 0) + Number(status.queued || 0);
    this.lastAdminOkAt = new Date(this.config.now()).toISOString();
    this.firstAdminFailureAt = null;
    this.lastAdminError = null;
    this.lastActiveJobs = activeJobs;
    return { activeJobs, failOpen: false };
  }

  adminFailureState(error) {
    const now = this.config.now();
    if (!this.firstAdminFailureAt) {
      this.firstAdminFailureAt = new Date(now).toISOString();
    }
    this.lastAdminError = error.message || String(error);
    this.config.logger.error('[llm-proxy] Error checking admin API:', this.lastAdminError);
    const firstFailureMs = Date.parse(this.firstAdminFailureAt);
    return {
      activeJobs: null,
      failOpen: Number.isFinite(firstFailureMs) && now - firstFailureMs >= this.config.failOpenAfterMs,
    };
  }

  expireOldEntries() {
    const now = this.config.now();
    while (this.queue[0] && now - this.queue[0].enqueuedAt > this.config.maxQueuedAgeMs) {
      const entry = this.queue.shift();
      writeJson(entry.res, 503, {
        error: 'proxy queue entry expired',
        max_queued_age_ms: this.config.maxQueuedAgeMs,
      });
      this.config.logger.error('[llm-proxy] Dropped expired LLM request.');
    }
  }

  async processQueue() {
    if (this.queue.length === 0) return;
    this.expireOldEntries();
    if (this.queue.length === 0) return;

    let state;
    try {
      state = await this.adminState();
    } catch (error) {
      state = this.adminFailureState(error);
    }

    if (!state.failOpen && (state.activeJobs === null || state.activeJobs > this.config.threshold)) {
      return;
    }

    const entry = this.queue.shift();
    if (!entry) return;
    const activeLabel = state.failOpen ? 'fail-open' : `activeJobs=${state.activeJobs}`;
    this.config.logger.log(
      `[llm-proxy] ${activeLabel} <= ${this.config.threshold}, processing task. Queue length: ${this.queue.length}`,
    );
    this.forward(entry);
  }

  forward(entry) {
    const targetUrl = new URL(entry.req.url, this.config.targetUrl);
    const transport = targetUrl.protocol === 'http:' ? http : https;
    const options = {
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'http:' ? 80 : 443),
      path: targetUrl.pathname + targetUrl.search,
      method: entry.req.method,
      headers: { ...entry.req.headers },
    };
    delete options.headers.host;

    const proxyReq = transport.request(options, (proxyRes) => {
      entry.res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(entry.res, { end: true });
    });

    proxyReq.setTimeout(this.config.upstreamTimeoutMs, () => {
      proxyReq.destroy(new Error(`upstream timed out after ${this.config.upstreamTimeoutMs}ms`));
    });

    proxyReq.on('error', (err) => {
      this.config.logger.error('[llm-proxy] Proxy error:', err.message);
      if (!entry.res.headersSent) {
        writeJson(entry.res, err.message.includes('timed out') ? 504 : 502, {
          error: 'proxy upstream failure',
          message: err.message,
        });
      } else {
        entry.res.end();
      }
    });

    proxyReq.write(entry.body);
    proxyReq.end();
  }
}

function createProxy(config) {
  return new ClaudeMemProxy(config);
}

if (require.main === module) {
  createProxy().start();
}

module.exports = { ClaudeMemProxy, createProxy, makeConfig };
