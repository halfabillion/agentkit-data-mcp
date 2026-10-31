// AgentKit Data client: unpaid preflight reads the 402 quote, a hard per-call cap is enforced
// before anything is signed, then the call is paid with x402 (USDC on Base).
import { wrapFetchWithPayment, x402Client, decodePaymentResponseHeader } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

export const DEFAULT_BASE_URL = "https://x402-apis-production.up.railway.app";
export const BASE_MAINNET = "eip155:8453";
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX20 = /^0x[0-9a-fA-F]{40}$/;
const CHAINS = ["base", "ethereum"];

/** Endpoint table: tool name -> path, list price, and a validator that returns query params. */
export const ENDPOINTS = {
  web_to_markdown: {
    path: "/v1/markdown", listUsd: 0.005,
    build(a) {
      let u; try { u = new URL(a.url); } catch { throw new Error(`not a URL: ${a.url}`); }
      if (!/^https?:$/.test(u.protocol)) throw new Error("only http(s) URLs are supported");
      const q = { url: u.toString() };
      if (a.maxChars != null) { const n = Number(a.maxChars); if (!Number.isInteger(n) || n < 500 || n > 500000) throw new Error("maxChars must be an integer 500-500000"); q.maxChars = String(n); }
      if (a.links != null) q.links = a.links ? "true" : "false";
      return q;
    },
  },
  solana_token_risk: {
    path: "/v1/solana/token-risk", listUsd: 0.02,
    build(a) { if (!B58.test(a.mint || "")) throw new Error("mint must be a base58 Solana address"); return { mint: a.mint }; },
  },
  solana_wallet: {
    path: "/v1/solana/wallet", listUsd: 0.01,
    build(a) {
      if (!B58.test(a.address || "")) throw new Error("address must be a base58 Solana address");
      const q = { address: a.address };
      if (a.limit != null) { const n = Number(a.limit); if (!Number.isInteger(n) || n < 1 || n > 500) throw new Error("limit must be 1-500"); q.limit = String(n); }
      if (a.includeZero != null) q.includeZero = a.includeZero ? "true" : "false";
      return q;
    },
  },
  evm_token_risk: {
    path: "/v1/evm/token-risk", listUsd: 0.02,
    build(a) {
      if (!HEX20.test(a.address || "")) throw new Error("address must be a 0x-prefixed 20-byte hex address");
      const chain = a.chain || "base"; if (!CHAINS.includes(chain)) throw new Error("chain must be base or ethereum");
      return { address: a.address, chain };
    },
  },
  evm_balances: {
    path: "/v1/evm/balances", listUsd: 0.003,
    build(a) {
      if (!HEX20.test(a.address || "")) throw new Error("address must be a 0x-prefixed 20-byte hex address");
      const chain = a.chain || "base"; if (!CHAINS.includes(chain)) throw new Error("chain must be base or ethereum");
      const q = { address: a.address, chain };
      if (a.tokens && a.tokens.length) {
        if (a.tokens.length > 20) throw new Error("at most 20 extra tokens");
        for (const t of a.tokens) if (!HEX20.test(t)) throw new Error(`bad token address: ${t}`);
        q.tokens = a.tokens.join(",");
      }
      return q;
    },
  },
  spot_prices: {
    path: "/v1/price", listUsd: 0.001,
    build(a) {
      const syms = (Array.isArray(a.symbols) ? a.symbols : String(a.symbols || "").split(",")).map((s) => s.trim().toUpperCase()).filter(Boolean);
      if (!syms.length) throw new Error("symbols is required");
      if (syms.length > 50) throw new Error("at most 50 symbols");
      for (const s of syms) if (!/^[A-Z0-9]{2,12}$/.test(s)) throw new Error(`bad symbol: ${s}`);
      return { symbols: syms.join(",") };
    },
  },
};

/** Decode a PAYMENT-REQUIRED header (base64 JSON) and return the Base USDC requirement. */
export function parseQuote(header) {
  if (!header) throw new Error("402 response had no PAYMENT-REQUIRED header");
  const req = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  const acc = (req.accepts || []).find((x) => x.network === BASE_MAINNET && x.asset?.toLowerCase() === USDC_BASE.toLowerCase());
  if (!acc) throw new Error("seller does not accept USDC on Base mainnet");
  return { amountAtomic: BigInt(acc.amount), usd: Number(acc.amount) / 1e6, payTo: acc.payTo };
}

/** opts: { privateKey, baseUrl, maxUsdPerCall, fetchImpl } — the cap is checked before signing. */
export function createClient(opts = {}) {
  const baseUrl = (opts.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  const maxUsd = Number(opts.maxUsdPerCall ?? 0.05);
  const fetchImpl = opts.fetchImpl || fetch;
  let paidFetch = null;
  const getPaidFetch = () => {
    if (paidFetch) return paidFetch;
    if (!opts.privateKey) throw new Error("AGENTKIT_PAYER_KEY is not set: a Base wallet key holding a little USDC is required for paid calls");
    const client = new x402Client().register(BASE_MAINNET, new ExactEvmScheme(privateKeyToAccount(opts.privateKey)));
    paidFetch = wrapFetchWithPayment(fetchImpl, client);
    return paidFetch;
  };

  async function call(tool, args = {}) {
    const ep = ENDPOINTS[tool];
    if (!ep) throw new Error(`unknown tool: ${tool}`);
    const url = `${baseUrl}${ep.path}?${new URLSearchParams(ep.build(args))}`;
    const pre = await fetchImpl(url);
    if (pre.status !== 402) {
      if (pre.ok) return { result: await pre.json(), paid: false };
      throw new Error(`preflight HTTP ${pre.status}: ${(await pre.text()).slice(0, 300)}`);
    }
    const quote = parseQuote(pre.headers.get("payment-required"));
    if (quote.usd > maxUsd) throw new Error(`price $${quote.usd} exceeds cap $${maxUsd}; raise AGENTKIT_MAX_USD to allow it`);
    const res = await getPaidFetch()(url);
    const text = await res.text();
    if (!res.ok) throw new Error(`paid call HTTP ${res.status}: ${text.slice(0, 300)}`);
    const pr = res.headers.get("payment-response");
    const settlement = pr ? decodePaymentResponseHeader(pr) : null;
    return { result: JSON.parse(text), paid: true, priceUsd: quote.usd, txHash: settlement?.transaction || null };
  }

  /** Read the live price of a tool without paying. */
  async function quote(tool, args = {}) {
    const ep = ENDPOINTS[tool];
    if (!ep) throw new Error(`unknown tool: ${tool}`);
    const pre = await fetchImpl(`${baseUrl}${ep.path}?${new URLSearchParams(ep.build(args))}`);
    if (pre.status !== 402) return { usd: 0, free: true };
    return parseQuote(pre.headers.get("payment-required"));
  }
  return { call, quote };
}

export function clientFromEnv(env = process.env) {
  return createClient({ privateKey: env.AGENTKIT_PAYER_KEY, baseUrl: env.AGENTKIT_BASE_URL, maxUsdPerCall: env.AGENTKIT_MAX_USD ?? 0.05 });
}
