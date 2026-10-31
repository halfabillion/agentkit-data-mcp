import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP server lists all six tools over stdio and rejects bad args without paying", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["src/server.js"], env: { PATH: process.env.PATH } });
  const client = new Client({ name: "t", version: "0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ["evm_balances", "evm_token_risk", "solana_token_risk", "solana_wallet", "spot_prices", "web_to_markdown"]);
  const r = await client.callTool({ name: "solana_token_risk", arguments: { mint: "not-an-address!" } });
  assert.equal(r.isError, true);
  await client.close();
});
