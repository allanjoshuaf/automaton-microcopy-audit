# Instant Microcopy Audit x402

A tiny pay-per-call API for French and English marketing, product, support and interface copy. It returns a clarity score, sentence metrics, repeated words, CTA detection and concrete editing suggestions.

- Live service: <https://automaton-microcopy-audit.assistance-telegram-relay.workers.dev>
- Full audit: `POST /api/audit` — **$0.02 USDC** on Base mainnet
- Free preview: `POST /api/preview` — 30 to 280 characters
- OpenAPI description: `/openapi.json`
- Public operational metrics: `/stats`

The service uses the x402 protocol and Coinbase CDP as its facilitator. Payments settle directly to:

```text
0x9FDBc2B0371072418b6c6F07DC52Ecc51808f55E
```

## Try the free preview

```bash
curl -X POST \
  https://automaton-microcopy-audit.assistance-telegram-relay.workers.dev/api/preview \
  -H "content-type: application/json" \
  -d '{"text":"Discover our fast service and order your audit today."}'
```

Calling the paid endpoint without a payment header returns `402 Payment Required`, including the Base USDC payment requirements and Bazaar discovery metadata:

```bash
curl -i -X POST \
  https://automaton-microcopy-audit.assistance-telegram-relay.workers.dev/api/audit \
  -H "content-type: application/json" \
  -d '{"text":"Discover our fast service and order your audit today."}'
```

## Deployment

The production API runs on Cloudflare Workers and does not depend on a home computer, tunnel or open terminal. Request metrics use Workers KV. A scheduled job checks the receiving wallet's Base USDC balance every ten minutes.

```powershell
pnpm install
pnpm check
pnpm deploy
```

Set `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` as encrypted Cloudflare Worker secrets with `wrangler secret`. Never put them in the repository or `wrangler.jsonc`.

## Economics

The audit is deterministic and has no per-call model cost. Gross receipts are therefore $0.02 USDC per successful paid call before any platform, network or tax costs. The service never spends funds from the receiving wallet.

Revenue is only reported from the real Base mainnet USDC balance. Test tokens, payment challenges and self-payments are not counted as profit.

## Local fallback

`server.mjs` remains available as an Express fallback. It defaults to Base Sepolia unless `X402_NETWORK=eip155:8453` is supplied with valid CDP credentials.

