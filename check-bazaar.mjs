import { generateJwt } from "@coinbase/cdp-sdk/auth";

const apiKeyId = process.env.CDP_API_KEY_ID;
const apiKeySecret = process.env.CDP_API_KEY_SECRET;
const payTo = process.env.PAY_TO || "0x9FDBc2B0371072418b6c6F07DC52Ecc51808f55E";

if (!apiKeyId || !apiKeySecret) {
  throw new Error("Missing CDP credentials.");
}

const path = "/platform/v2/x402/discovery/merchant";
const token = await generateJwt({
  apiKeyId,
  apiKeySecret,
  requestMethod: "GET",
  requestHost: "api.cdp.coinbase.com",
  requestPath: path,
});

const url = new URL(`https://api.cdp.coinbase.com${path}`);
url.searchParams.set("payTo", payTo);
url.searchParams.set("limit", "20");

const response = await fetch(url, {
  headers: { Authorization: `Bearer ${token}` },
});
const body = await response.json().catch(() => null);

console.log(JSON.stringify({
  status: response.status,
  payTo,
  total: body?.pagination?.total ?? body?.resources?.length ?? null,
  resources: (body?.resources ?? []).map((resource) => ({
    resource: resource.resource,
    serviceName: resource.serviceName,
    lastUpdated: resource.lastUpdated,
  })),
}));
