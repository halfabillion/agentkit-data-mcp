import { test } from "node:test";
import assert from "node:assert/strict";
import { createClient, ENDPOINTS, parseQuote, USDC_BASE } from "../src/client.js";

const quoteHeader = (amount) => Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", asset: USDC_BASE, amount: String(amount), payTo: "0xd9784f8122af988E51b3183F725b0b53BCb8278A" }] })).toString("base64");
const res402 = (amount) => new Response("{}", { status: 402, headers: { "payment-required": quoteHeader(amount) } });

test("parseQuote reads the Base USDC requirement", () => {
  const q = parseQuote(quoteHeader(5000));
  assert.equal(q.usd, 0.005);
  assert.equal(q.amountAtomic, 5000n);
});

test("parseQuote rejects sellers without Base USDC", () => {
  const h = Buffer.from(JSON.stringify({ accepts: [{ network: "eip155:1", asset: "0x0", amount: "1" }] })).toString("base64");
  assert.throws(() => parseQuote(h), /does not accept USDC on Base/);
});

test("validators reject bad input before any network call", () => {
  assert.throws(() => ENDPOINTS.web_to_markdown.build({ url: "ftp://x" }), /http/);
  assert.throws(() => ENDPOINTS.solana_token_risk.build({ mint: "0xabc" }), /base58/);
  assert.throws(() => ENDPOINTS.evm_token_risk.build({ address: "0x12", chain: "base" }), /20-byte/);
  assert.throws(() => ENDPOINTS.evm_balances.build({ address: "0x" + "1".repeat(40), chain: "polygon" }), /chain/);
  assert.throws(() => ENDPOINTS.spot_prices.build({ symbols: [] }), /required/);
  assert.deepEqual(ENDPOINTS.spot_prices.build({ symbols: ["btc", " eth "] }), { symbols: "BTC,ETH" });
});

test("price above the cap is refused and nothing is signed", async () => {
  let calls = 0;
  const c = createClient({ maxUsdPerCall: 0.01, fetchImpl: async () => { calls++; return res402(20000); } });
  await assert.rejects(c.call("evm_token_risk", { address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed" }), /exceeds cap/);
  assert.equal(calls, 1);
});

test("missing payer key is reported clearly when under the cap", async () => {
  const c = createClient({ maxUsdPerCall: 0.05, fetchImpl: async () => res402(1000) });
  await assert.rejects(c.call("spot_prices", { symbols: ["BTC"] }), /AGENTKIT_PAYER_KEY/);
});

test("free (non-402) responses are returned unpaid", async () => {
  const c = createClient({ fetchImpl: async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }) });
  assert.deepEqual(await c.call("spot_prices", { symbols: ["BTC"] }), { result: { ok: 1 }, paid: false });
});

test("query string is built from validated params", async () => {
  let seen;
  const c = createClient({ baseUrl: "https://h.example/", fetchImpl: async (u) => { seen = u; return res402(3000); } });
  const q = await c.quote("evm_balances", { address: "0x" + "a".repeat(40), tokens: ["0x" + "b".repeat(40)] });
  assert.equal(q.usd, 0.003);
  assert.match(seen, /^https:\/\/h\.example\/v1\/evm\/balances\?address=0xa{40}&chain=base&tokens=0xb{40}$/);
});
