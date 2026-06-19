export interface Env {
  SUGGESTIONS: R2Bucket;
  RATE_LIMIT: KVNamespace;
  HCAPTCHA_SECRET: string;
}

interface SuggestionBody {
  token?: string;
  content?: string;
  contact?: string;
}

const RATE_LIMIT_MAX = 5;
const RATE_WINDOW_SECONDS = 3600;

async function verifyHcaptcha(token: string, secret: string): Promise<boolean> {
  const res = await fetch("https://hcaptcha.com/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `response=${encodeURIComponent(token)}&secret=${encodeURIComponent(secret)}`,
  });
  const data = await res.json<{ success: boolean }>();
  return data.success;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "https://sg-wiki.pages.dev",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const rateLimitKey = `rl:${ip}`;
    const currentCount = parseInt((await env.RATE_LIMIT.get(rateLimitKey)) ?? "0");

    if (currentCount >= RATE_LIMIT_MAX) {
      return json({ error: "rate_limit_exceeded" }, 429);
    }

    let body: SuggestionBody;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }

    if (!body.token || !body.content?.trim()) {
      return json({ error: "missing_fields" }, 400);
    }

    if (body.content.length > 2000) {
      return json({ error: "content_too_long" }, 400);
    }

    const valid = await verifyHcaptcha(body.token, env.HCAPTCHA_SECRET);
    if (!valid) {
      return json({ error: "captcha_failed" }, 403);
    }

    const id = crypto.randomUUID();
    const suggestion = {
      id,
      content: body.content.trim(),
      contact: body.contact?.trim() ?? null,
      created_at: new Date().toISOString(),
    };

    await env.SUGGESTIONS.put(`suggestions/${id}.json`, JSON.stringify(suggestion), {
      httpMetadata: { contentType: "application/json" },
    });

    await env.RATE_LIMIT.put(rateLimitKey, String(currentCount + 1), {
      expirationTtl: RATE_WINDOW_SECONDS,
    });

    return json({ ok: true, id });
  },
};
