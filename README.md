# DeFi Tracker (web)

BTC/ETH prices, Uniswap pools, an Aave wallet tracker, a liquidity calculator, paper (test-money) LP trading and an AI advisor.
It's a plain static web app (no build step, no server, no accounts) that installs on an iPad or phone as a Home Screen app.

## Install on an iPad / iPhone
1. Open the site's address in **Safari**.
2. Tap **Share** → **Add to Home Screen** → **Add**.
3. Open it from the new icon — it runs full-screen like an app.

## Your data stays on the device
Except on the hosted, signed-in site: there, wallet addresses, tracked pools and paper positions also sync to your own account (`worker/`, Cloudflare D1). AI keys never leave the device.

Everything you save (tracked pools, wallet addresses, paper positions, AI keys) lives in that browser's local storage on that device.
Nothing is sent to any server of ours — there isn't one. The app talks directly to CoinGecko, GeckoTerminal, the Aave API, public RPC nodes and your chosen AI provider.

- Wallet tracking is **read-only** and only needs a public address. Never enter a seed phrase or private key.
- AI keys are stored in the browser on that device and sent only to the provider you chose. Use a key you can revoke.
- Clearing Safari's website data for this site erases your saved data.

## Run locally
```
cd web && python3 -m http.server 8099
```
then open http://localhost:8099.

## Not financial advice
Estimates (APR, fees, liquidation prices) are simplified models, and paper trading is simulated.
