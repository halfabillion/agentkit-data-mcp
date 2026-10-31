# agentkit-data-mcp

MCP server for **AgentKit Data**, six pay-per-call data tools. Each call is paid in USDC on Base over [x402](https://x402.org). There's no signup and no API key.

| Tool | What it returns | Price |
|---|---|---|
| `web_to_markdown` | Clean Markdown of a public page's main content plus title, byline, language, publish date and word count | $0.005 |
| `solana_token_risk` | SPL / Token-2022 safety check: authorities, risky extensions, holder concentration, liquidity, 0-100 score | $0.02 |
| `solana_wallet` | SOL plus every SPL holding with USD values and total | $0.01 |
| `evm_token_risk` | Base/Ethereum ERC-20 check: owner, proxy, mint/blacklist/pause/fee functions, liquidity, buys vs sells, score | $0.02 |
| `evm_balances` | ETH plus major tokens and up to 20 extra ERC-20s with USD values | $0.003 |
| `spot_prices` | USD spot prices for up to 50 crypto and fiat tickers | $0.001 |

Before anything is signed, the server reads the live price from the API's 402 quote. It refuses any call that costs more than `AGENTKIT_MAX_USD` (default $0.05).

## Setup

```json
{
  "mcpServers": {
    "agentkit-data": {
      "command": "npx",
      "args": ["-y", "agentkit-data-mcp"],
      "env": { "AGENTKIT_PAYER_KEY": "0x<base wallet key holding a little USDC>", "AGENTKIT_MAX_USD": "0.05" }
    }
  }
}
```

Use a dedicated hot wallet with only a few dollars of USDC on Base. Gas isn't needed, because payments are EIP-3009 signatures that the facilitator settles.

| Env var | Default | Purpose |
|---|---|---|
| `AGENTKIT_PAYER_KEY` | (required for paid calls) | Base wallet private key used to sign payments |
| `AGENTKIT_MAX_USD` | `0.05` | Hard per-call spend cap |
| `AGENTKIT_BASE_URL` | `https://x402-apis-production.up.railway.app` | API host |

## HTTP API

You can also call the endpoints directly with any x402 client. See `/.well-known/x402`, `/openapi.json` and `/llms.txt` on the API host.

## Tests

`npm test` covers 8 tests: input validation, the cap being enforced before signing, and the MCP stdio tool listing.

MIT licensed.

## Docker

```bash
docker build -t agentkit-data-mcp .
docker run -i --rm -e AGENTKIT_PAYER_KEY=0x... -e AGENTKIT_MAX_USD=0.05 agentkit-data-mcp
```

Tools are listed without a key; the key is only needed for paid calls.
