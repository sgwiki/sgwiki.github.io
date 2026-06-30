const http = require('http');
const https = require('https');
const url = require('url');

const N = parseInt(process.env.CLAUDE_MEM_PROXY_N || '3', 10);
const TARGET_URL = process.env.PROXY_TARGET_URL || 'https://api.z.ai/api/anthropic';
const PORT = 37701;
const ADMIN_URL = 'http://admin:3002/running';

const queue = [];

async function checkAdminAndProcessQueue() {
    if (queue.length === 0) return;

    try {
        const adminRes = await new Promise((resolve, reject) => {
            const req = http.get(ADMIN_URL, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => resolve(data));
            });
            req.on('error', reject);
        });

        const status = JSON.parse(adminRes);
        const activeJobs = status.running + status.queued;

        if (activeJobs <= N) {
            const task = queue.shift();
            if (task) {
                console.log(`[llm-proxy] activeJobs=${activeJobs} <= ${N}, processing task. Queue length: ${queue.length}`);
                task();
            }
        }
    } catch (err) {
        console.error('[llm-proxy] Error checking admin API:', err.message);
    }
}

setInterval(checkAdminAndProcessQueue, 2000);

const server = http.createServer((clientReq, clientRes) => {
    let body = [];
    clientReq.on('data', chunk => body.push(chunk));
    clientReq.on('end', () => {
        body = Buffer.concat(body);
        
        queue.push(() => {
            const targetUrl = new URL(clientReq.url, TARGET_URL);
            const options = {
                hostname: targetUrl.hostname,
                port: targetUrl.port || 443,
                path: targetUrl.pathname + targetUrl.search,
                method: clientReq.method,
                headers: {
                    ...clientReq.headers
                }
            };
            
            // Remove headers that might cause issues with proxying
            delete options.headers['host'];

            const proxyReq = https.request(options, (proxyRes) => {
                clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
                proxyRes.pipe(clientRes, { end: true });
            });

            proxyReq.on('error', (err) => {
                console.error('[llm-proxy] Proxy error:', err.message);
                clientRes.writeHead(500);
                clientRes.end('Proxy Error');
            });

            proxyReq.write(body);
            proxyReq.end();
        });
        console.log(`[llm-proxy] Queued LLM request. Queue length: ${queue.length}`);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[llm-proxy] Listening on 127.0.0.1:${PORT}`);
    console.log(`[llm-proxy] Target: ${TARGET_URL}`);
    console.log(`[llm-proxy] N threshold: ${N}`);
});
