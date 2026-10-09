import { generateJwt } from "@coinbase/cdp-sdk/auth";

const secret = process.env.CDP_API_KEY_SECRET ?? "";
const ids = [
  process.env.CDP_API_KEY_ID,
  process.env.CDP_API_KEY_ID_FULL,
].filter(Boolean);

const secretShape = {
  length: secret.length,
  hasWhitespace: /\s/.test(secret),
  isBase64Like: /^[A-Za-z0-9+/=_-]+$/.test(secret),
  decodedBytes: (() => {
    try {
      return Buffer.from(secret, "base64").length;
    } catch {
      return null;
    }
  })(),
};

console.log(JSON.stringify({ secretShape }));

for (const apiKeyId of ids) {
  try {
    const token = await generateJwt({
      apiKeyId,
      apiKeySecret: secret,
      requestMethod: "GET",
      requestHost: "api.cdp.coinbase.com",
      requestPath: "/platform/v2/x402/supported",
    });
    const response = await fetch("https://api.cdp.coinbase.com/platform/v2/x402/supported", {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(JSON.stringify({
      idFormat: apiKeyId.includes("/") ? "full-resource-name" : "uuid",
      status: response.status,
      ok: response.ok,
      body: (await response.text()).slice(0, 300),
    }));
  } catch (error) {
    console.log(JSON.stringify({
      idFormat: apiKeyId.includes("/") ? "full-resource-name" : "uuid",
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}
