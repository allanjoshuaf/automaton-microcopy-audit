import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const statePath = path.join(root, "automaton-data", "economy", "x402-revenue.json");
const wallet = "0x9FDBc2B0371072418b6c6F07DC52Ecc51808f55E";
const targetUsd = 0.10;
const networks = {
  base: {
    rpc: "https://mainnet.base.org",
    chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    realMoney: true,
  },
  "base-sepolia": {
    rpc: "https://sepolia.base.org",
    chainId: 84532,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    realMoney: false,
  },
};

async function rpc(url, method, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || "RPC error");
  return payload.result;
}

async function usdcBalance(network) {
  const config = networks[network];
  const paddedAddress = wallet.slice(2).toLowerCase().padStart(64, "0");
  const result = await rpc(config.rpc, "eth_call", [{
    to: config.usdc,
    data: `0x70a08231${paddedAddress}`,
  }, "latest"]);
  return Number(BigInt(result)) / 1_000_000;
}

const previous = await fs.readFile(statePath, "utf8").then(JSON.parse).catch(() => null);
const balances = {};
for (const network of Object.keys(networks)) {
  try {
    balances[network] = await usdcBalance(network);
  } catch (error) {
    balances[network] = { error: error.message };
  }
}

const priorMainnet = typeof previous?.balances?.base === "number" ? previous.balances.base : balances.base;
const increaseUsd = typeof balances.base === "number" && typeof priorMainnet === "number"
  ? Number((balances.base - priorMainnet).toFixed(6))
  : 0;
const verifiedSuccessfulLoops = increaseUsd > 0 ? Math.floor((increaseUsd + 0.000001) / targetUsd) : 0;
const state = {
  schemaVersion: "1.0",
  checkedAt: new Date().toISOString(),
  wallet,
  targetUsdPerLoop: targetUsd,
  balances,
  previousMainnetUsdc: priorMainnet,
  verifiedIncreaseUsd: increaseUsd,
  verifiedSuccessfulLoops,
  note: "Seules les augmentations Base mainnet comptent comme revenu réel. Base Sepolia reste un test sans valeur.",
};
await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
console.log(JSON.stringify(state));
