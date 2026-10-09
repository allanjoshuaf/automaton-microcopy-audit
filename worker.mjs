import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";
import { SignJWT, importPKCS8 } from "jose";

const PAY_TO = "0x9FDBc2B0371072418b6c6F07DC52Ecc51808f55E";
const PRICE = "$0.02";
const NETWORK = "eip155:8453";
const SERVICE_NAME = "Instant Microcopy Audit";
const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";
const PUBLIC_URL = "https://automaton-microcopy-audit.assistance-telegram-relay.workers.dev";
const BASE_RPC_URL = "https://mainnet.base.org";
const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const INDEXNOW_KEY = "07a695b35ae34bd8bd808cb8d4646f1f";

function nonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

async function cdpJwt(apiKeyId, apiKeySecret, method, path) {
  const now = Math.floor(Date.now() / 1000);
  const key = await importPKCS8(apiKeySecret, "ES256");
  return new SignJWT({
    sub: apiKeyId,
    iss: "cdp",
    uris: [`${method} api.cdp.coinbase.com${path}`],
  })
    .setProtectedHeader({ alg: "ES256", kid: apiKeyId, typ: "JWT", nonce: nonce() })
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(now + 120)
    .sign(key);
}

function createWorkerFacilitator(env) {
  const auth = async (method, path) => ({
    Authorization: `Bearer ${await cdpJwt(env.CDP_API_KEY_ID, env.CDP_API_KEY_SECRET, method, path)}`,
    "Correlation-Context": "sdkLanguage=typescript,source=automaton-worker,sourceVersion=1.0.0",
  });
  return new HTTPFacilitatorClient({
    url: CDP_FACILITATOR_URL,
    createAuthHeaders: async () => ({
      verify: await auth("POST", "/platform/v2/x402/verify"),
      settle: await auth("POST", "/platform/v2/x402/settle"),
      supported: await auth("GET", "/platform/v2/x402/supported"),
    }),
  });
}

function words(text) {
  return text.toLocaleLowerCase("fr").match(/[\p{L}\p{N}'’-]+/gu) || [];
}

function auditText(text) {
  const allWords = words(text);
  const sentences = text.split(/[.!?]+/).map(value => value.trim()).filter(Boolean);
  const counts = new Map();
  for (const word of allWords.filter(value => value.length >= 4)) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  const repeatedWords = [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word, count]) => ({ word, count }));
  const averageSentenceWords = sentences.length ? allWords.length / sentences.length : allWords.length;
  const longSentences = sentences.filter(sentence => words(sentence).length > 24).length;
  const uppercaseRatio = text.length ? (text.match(/[A-ZÀ-ÖØ-Þ]/g) || []).length / text.length : 0;
  const hasCallToAction = /\b(acheter|commander|essayer|découvrir|réserver|contacter|commencer|télécharger|buy|order|try|discover|book|contact|start|download)\b/iu.test(text);
  const suggestions = [];
  if (averageSentenceWords > 20) suggestions.push("Raccourcir les phrases pour rendre le texte plus direct.");
  if (longSentences) suggestions.push(`Découper ${longSentences} phrase(s) de plus de 24 mots.`);
  if (repeatedWords.length) suggestions.push(`Réduire les répétitions: ${repeatedWords.slice(0, 3).map(item => item.word).join(", ")}.`);
  if (uppercaseRatio > 0.16) suggestions.push("Réduire les majuscules, qui donnent une impression agressive.");
  if (!/[.!?]$/.test(text.trim())) suggestions.push("Terminer le texte par une ponctuation claire.");
  if (!hasCallToAction) suggestions.push("Ajouter un appel à l’action concret si le texte doit convertir.");
  if (!suggestions.length) suggestions.push("Le texte est concis; tester deux variantes auprès du public cible.");
  const score = Math.max(0, Math.min(100,
    100 - Math.max(0, averageSentenceWords - 16) * 2 - longSentences * 8 - repeatedWords.length * 4
      - (uppercaseRatio > 0.16 ? 12 : 0) - (!hasCallToAction ? 4 : 0),
  ));
  return {
    score: Math.round(score),
    metrics: {
      characters: text.length,
      words: allWords.length,
      sentences: sentences.length,
      averageSentenceWords: Number(averageSentenceWords.toFixed(1)),
      longSentences,
      repeatedWords,
      hasCallToAction,
    },
    suggestions,
  };
}

async function recordMetric(env, type) {
  if (!env.AUTOMATON_METRICS) return;
  const key = `event:${type}:${Date.now()}:${crypto.randomUUID()}`;
  await env.AUTOMATON_METRICS.put(key, "1", { expirationTtl: 60 * 60 * 24 * 90 });
}

async function metricCount(env, type) {
  if (!env.AUTOMATON_METRICS) return 0;
  let cursor;
  let count = 0;
  do {
    const page = await env.AUTOMATON_METRICS.list({ prefix: `event:${type}:`, cursor, limit: 1000 });
    count += page.keys.length;
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return count;
}

async function refreshRevenue(env) {
  const address = PAY_TO.slice(2).toLowerCase().padStart(64, "0");
  const response = await fetch(BASE_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: USDC_CONTRACT, data: `0x70a08231${address}` }, "latest"],
    }),
  });
  if (!response.ok) throw new Error(`Base RPC returned ${response.status}`);
  const payload = await response.json();
  if (!payload.result || payload.error) throw new Error(payload.error?.message || "Invalid Base RPC response");
  const atomic = BigInt(payload.result);
  const whole = atomic / 1_000_000n;
  const fraction = atomic % 1_000_000n;
  const balanceUsdc = Number(whole) + Number(fraction) / 1_000_000;
  const state = {
    checkedAt: new Date().toISOString(),
    wallet: PAY_TO,
    network: NETWORK,
    asset: USDC_CONTRACT,
    balanceUsdc,
  };
  await env.AUTOMATON_METRICS.put("revenue:latest", JSON.stringify(state));
  return state;
}

function paymentRoutes() {
  return {
    "POST /api/audit": {
      accepts: [{
        scheme: "exact",
        price: PRICE,
        network: NETWORK,
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
      }],
      description: "Analyze French or English marketing and interface copy. Returns a clarity score, repetition data, sentence metrics, CTA detection and concrete fixes.",
      mimeType: "application/json",
      serviceName: SERVICE_NAME,
      tags: ["copywriting", "text-audit", "microcopy", "marketing", "french", "english", "conversion"],
      extensions: declareDiscoveryExtension({
        method: "POST",
        bodyType: "json",
        input: {
          text: "Marketing, product, support or interface text between 30 and 5000 characters.",
        },
        inputSchema: {
          properties: {
            text: {
              type: "string",
              minLength: 30,
              maxLength: 5000,
              description: "French or English copy to audit.",
            },
          },
          required: ["text"],
          additionalProperties: false,
        },
        output: {
          example: {
            service: "microcopy-audit",
            chargedPrice: PRICE,
            result: {
              score: 84,
              metrics: { words: 31, sentences: 3, averageSentenceWords: 10.3, hasCallToAction: true },
              suggestions: ["The text is concise; test two variants with the target audience."],
            },
          },
        },
      }),
    },
  };
}

function buildApp(env) {
  const facilitator = createWorkerFacilitator(env);
  const resourceServer = new x402ResourceServer(facilitator)
    .register(NETWORK, new ExactEvmScheme());
  const app = new Hono();

  app.use("*", async (context, next) => {
    await next();
    const path = new URL(context.req.url).pathname;
    let type;
    if (path === "/") type = "landing";
    if (path === "/api/preview") type = "preview";
    if (path === "/api/audit" && context.res.status === 402) type = "payment-challenge";
    if (path === "/api/audit" && context.res.status === 200) type = "paid-audit";
    if (type) context.executionCtx.waitUntil(recordMetric(env, type));
  });

  app.get("/health", context => context.json({
    status: "ok",
    service: "microcopy-audit",
    price: PRICE,
    network: NETWORK,
    payTo: PAY_TO,
    mode: "mainnet",
    hosting: "cloudflare-workers",
  }));

  app.get("/stats", async context => {
    const [landing, preview, challenges, paid, revenueText] = await Promise.all([
      metricCount(env, "landing"),
      metricCount(env, "preview"),
      metricCount(env, "payment-challenge"),
      metricCount(env, "paid-audit"),
      env.AUTOMATON_METRICS.get("revenue:latest"),
    ]);
    let revenue = revenueText ? JSON.parse(revenueText) : null;
    if (!revenue || Date.now() - Date.parse(revenue.checkedAt) > 15 * 60 * 1000) {
      revenue = await refreshRevenue(env);
    }
    return context.json({
      landing,
      preview,
      paymentChallenges: challenges,
      paidAudits: paid,
      revenue,
    });
  });

  app.get("/openapi.json", context => context.json({
    openapi: "3.1.0",
    info: { title: SERVICE_NAME, version: "1.0.0", description: "Two-cent x402 microcopy audit on Base.", license: { name: "MIT", identifier: "MIT" } },
    servers: [{ url: PUBLIC_URL }],
    paths: {
      "/api/preview": {
        post: {
          summary: "Free short preview",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["text"], properties: { text: { type: "string", minLength: 30, maxLength: 280 } } } } } },
          responses: { "200": { description: "Preview metrics" } },
        },
      },
      "/api/audit": {
        post: {
          summary: "Full paid microcopy audit",
          description: "Requires an x402 payment of $0.02 USDC on Base mainnet.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["text"], properties: { text: { type: "string", minLength: 30, maxLength: 5000 } } } } } },
          responses: { "200": { description: "Full audit" }, "402": { description: "x402 payment required" } },
        },
      },
    },
  }));

  app.get("/robots.txt", context => context.text(`User-agent: *\nAllow: /\nSitemap: ${PUBLIC_URL}/sitemap.xml\n`));
  app.get("/sitemap.xml", context => context.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${PUBLIC_URL}/</loc></url><url><loc>${PUBLIC_URL}/openapi.json</loc></url></urlset>`, 200, { "content-type": "application/xml; charset=utf-8" }));
  app.get(`/${INDEXNOW_KEY}.txt`, context => context.text(INDEXNOW_KEY));
  app.get("/llms.txt", context => context.text(`# ${SERVICE_NAME}\n\nPaid x402 endpoint: POST ${PUBLIC_URL}/api/audit\nPrice: ${PRICE} USDC on Base mainnet (${NETWORK})\nInput JSON: {"text":"30 to 5000 characters of French or English copy"}\nFree preview: POST ${PUBLIC_URL}/api/preview\nOpenAPI: ${PUBLIC_URL}/openapi.json\n`));

  app.get("/", context => context.html(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Instant Microcopy Audit — $0.02 USDC</title><style>
body{font:16px/1.55 system-ui,sans-serif;max-width:760px;margin:64px auto;padding:0 24px;color:#14213d;background:#f8fafc}main{background:white;padding:36px;border-radius:18px;box-shadow:0 18px 50px #16213e18}code,pre{background:#eef2ff;border-radius:8px}code{padding:2px 6px}pre{padding:16px;overflow:auto}.price{font-size:2.5rem;font-weight:800;color:#2457d6;margin:.2em 0}.ok{color:#087f5b;font-weight:700}</style></head>
<body><main><p class="ok">● Online on Base mainnet</p><h1>Instant Microcopy Audit</h1><p>Clarity score, repetition analysis, sentence metrics, CTA detection and concrete fixes for French or English copy.</p><p class="price">$0.02 USDC / audit</p><p>Machine endpoint: <code>POST /api/audit</code> using the x402 protocol.</p><pre>{"text":"Paste 30 to 5000 characters of marketing or interface copy here."}</pre><p>A free short preview is available at <code>POST /api/preview</code>.</p><p>Payments settle directly to <code>${PAY_TO}</code>.</p><p><a href="https://github.com/allanjoshuaf/automaton-microcopy-audit">Source code and integration examples</a></p></main></body></html>`));

  app.post("/api/preview", async context => {
    const body = await context.req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (text.length < 30 || text.length > 280) {
      return context.json({ error: "text must contain between 30 and 280 characters" }, 400);
    }
    const result = auditText(text);
    return context.json({
      service: "microcopy-audit-preview",
      free: true,
      result: { score: result.score, metrics: result.metrics },
      paidEndpoint: "/api/audit",
      paidPrice: PRICE,
    });
  });

  app.use(paymentMiddleware(paymentRoutes(), resourceServer));

  app.post("/api/audit", async context => {
    const body = await context.req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (text.length < 30 || text.length > 5000) {
      return context.json({ error: "text must contain between 30 and 5000 characters" }, 400);
    }
    return context.json({
      service: "microcopy-audit",
      chargedPrice: PRICE,
      result: auditText(text),
      generatedAt: new Date().toISOString(),
    });
  });

  app.notFound(context => context.json({ error: "Not found" }, 404));
  app.onError((error, context) => {
    console.error(error);
    return context.json({ error: "Internal error" }, 500);
  });
  return app;
}

let cachedApp;

export default {
  fetch(request, env, executionContext) {
    cachedApp ??= buildApp(env);
    return cachedApp.fetch(request, env, executionContext);
  },
  async scheduled(_event, env, context) {
    context.waitUntil(refreshRevenue(env));
  },
};
