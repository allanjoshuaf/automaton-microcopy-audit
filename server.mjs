import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { createCdpFacilitatorClient } from "@coinbase/cdp-sdk/x402";
import { declareDiscoveryExtension } from "@x402/extensions/bazaar";

const PORT = Number(process.env.PORT || 4020);
const PAY_TO = process.env.PAY_TO || "0x9FDBc2B0371072418b6c6F07DC52Ecc51808f55E";
const PRICE = process.env.PRICE || "$0.02";
const NETWORK = process.env.X402_NETWORK || "eip155:84532";
const FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";

if (!/^0x[a-fA-F0-9]{40}$/.test(PAY_TO)) {
  throw new Error("PAY_TO doit être une adresse EVM publique valide.");
}

const facilitator = NETWORK === "eip155:8453"
  ? createCdpFacilitatorClient()
  : new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitator)
  .register(NETWORK, new ExactEvmScheme());

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb", strict: true }));

app.get("/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "microcopy-audit",
    price: PRICE,
    network: NETWORK,
    payTo: PAY_TO,
    mode: NETWORK === "eip155:8453" ? "mainnet" : "testnet",
  });
});

app.get("/", (_request, response) => {
  response.json({
    service: "microcopy-audit",
    description: "Instant paid audit for short marketing, product and support copy.",
    protocol: "x402",
    price: PRICE,
    network: NETWORK,
    endpoint: "POST /api/audit",
    input: { text: "30 to 5000 characters" },
  });
});

app.use(paymentMiddleware({
  "POST /api/audit": {
    accepts: [{
      scheme: "exact",
      price: PRICE,
      network: NETWORK,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
    }],
    description: "Instant audit of short copy: readability, repetitions, score and concrete recommendations.",
    mimeType: "application/json",
    serviceName: "Microcopy Audit",
    tags: ["copywriting", "text-audit", "microcopy", "french", "english"],
    extensions: declareDiscoveryExtension({
      method: "POST",
      bodyType: "json",
      input: {
        text: "Paste a marketing, product, support or interface text between 30 and 5000 characters.",
      },
      inputSchema: {
        properties: {
          text: {
            type: "string",
            minLength: 30,
            maxLength: 5000,
            description: "Text to audit in French or English.",
          },
        },
        required: ["text"],
        additionalProperties: false,
      },
      output: {
        example: {
          service: "microcopy-audit",
          chargedPrice: "$0.02",
          result: {
            score: 84,
            metrics: {
              characters: 180,
              words: 31,
              sentences: 3,
              averageSentenceWords: 10.3,
              longSentences: 0,
              repeatedWords: [],
            },
            suggestions: ["The text is concise; test two variants with the target audience."],
          },
          generatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }),
  },
}, resourceServer));

const countWords = (text) => text.toLocaleLowerCase("fr")
  .match(/[\p{L}\p{N}'’-]+/gu) || [];

function auditText(text) {
  const words = countWords(text);
  const sentences = text.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean);
  const counts = new Map();
  for (const word of words.filter((value) => value.length >= 4)) {
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  const repeatedWords = [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word, count]) => ({ word, count }));
  const averageSentenceWords = sentences.length ? words.length / sentences.length : words.length;
  const longSentences = sentences.filter((sentence) => countWords(sentence).length > 24).length;
  const uppercaseRatio = text.length ? (text.match(/[A-ZÀ-ÖØ-Þ]/g) || []).length / text.length : 0;
  const suggestions = [];
  if (averageSentenceWords > 20) suggestions.push("Raccourcir les phrases pour rendre le texte plus direct.");
  if (longSentences) suggestions.push(`Découper ${longSentences} phrase(s) de plus de 24 mots.`);
  if (repeatedWords.length) suggestions.push(`Réduire les répétitions: ${repeatedWords.slice(0, 3).map((item) => item.word).join(", ")}.`);
  if (uppercaseRatio > 0.16) suggestions.push("Réduire les majuscules, qui donnent une impression agressive.");
  if (!/[.!?]$/.test(text.trim())) suggestions.push("Terminer le texte par une ponctuation claire.");
  if (!suggestions.length) suggestions.push("Le texte est déjà concis; tester maintenant deux variantes auprès du public cible.");
  const score = Math.max(0, Math.min(100,
    100 - Math.max(0, averageSentenceWords - 16) * 2 - longSentences * 8 - repeatedWords.length * 4 - (uppercaseRatio > 0.16 ? 12 : 0)
  ));
  return {
    score: Math.round(score),
    metrics: {
      characters: text.length,
      words: words.length,
      sentences: sentences.length,
      averageSentenceWords: Number(averageSentenceWords.toFixed(1)),
      longSentences,
      repeatedWords,
    },
    suggestions,
  };
}

app.post("/api/audit", (request, response) => {
  const text = typeof request.body?.text === "string" ? request.body.text.trim() : "";
  if (text.length < 30 || text.length > 5000) {
    response.status(400).json({ error: "Le champ text doit contenir entre 30 et 5000 caractères." });
    return;
  }
  response.json({
    service: "microcopy-audit",
    chargedPrice: PRICE,
    result: auditText(text),
    generatedAt: new Date().toISOString(),
  });
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "Erreur interne; aucun résultat commercial n'est comptabilisé." });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(JSON.stringify({ status: "listening", url: `http://127.0.0.1:${PORT}`, price: PRICE, network: NETWORK, payTo: PAY_TO }));
});
