#!/usr/bin/env node
// MCP stdio server exposing AgentKit Data's pay-per-call endpoints as tools.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { clientFromEnv } from "./client.js";

const api = clientFromEnv();
const server = new McpServer({ name: "agentkit-data-mcp", version: "0.1.0" });
const out = (r) => ({ content: [{ type: "text", text: JSON.stringify(r, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message || e) }] });
const run = (tool) => async (args) => { try { return out(await api.call(tool, args)); } catch (e) { return fail(e); } };
const evmAddr = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const solAddr = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const chain = z.enum(["base", "ethereum"]).optional();

server.tool("web_to_markdown", "Fetch a public web page and return clean Markdown of the main content plus title, byline, language, publish date and word count. $0.005 USDC per call.",
  { url: z.string().url(), maxChars: z.number().int().min(500).max(500000).optional(), links: z.boolean().optional() }, run("web_to_markdown"));
server.tool("solana_token_risk", "Solana SPL / Token-2022 mint safety check: authorities, risky extensions, holder concentration, liquidity, 0-100 score and flags. $0.02 USDC per call.",
  { mint: solAddr }, run("solana_token_risk"));
server.tool("solana_wallet", "Solana wallet snapshot: SOL plus every SPL/Token-2022 holding with USD values and portfolio total. $0.01 USDC per call.",
  { address: solAddr, limit: z.number().int().min(1).max(500).optional(), includeZero: z.boolean().optional() }, run("solana_wallet"));
server.tool("evm_token_risk", "Base / Ethereum ERC-20 safety check: owner renounced, proxy, privileged functions (mint, blacklist, pause, fee setters), liquidity, buys vs sells, 0-100 score. $0.02 USDC per call.",
  { address: evmAddr, chain }, run("evm_token_risk"));
server.tool("evm_balances", "Live Base / Ethereum wallet balances: ETH plus major tokens and up to 20 extra ERC-20s, with USD values and total. $0.003 USDC per call.",
  { address: evmAddr, chain, tokens: z.array(evmAddr).max(20).optional() }, run("evm_balances"));
server.tool("spot_prices", "Spot USD prices for up to 50 crypto and fiat tickers in one call (BTC, ETH, SOL, EUR, GBP, ...). $0.001 USDC per call.",
  { symbols: z.array(z.string().min(2).max(12)).min(1).max(50) }, run("spot_prices"));

await server.connect(new StdioServerTransport());
