# VaultVest

Governance-gated token vesting on Stellar — funders lock tokens, signers approve releases, beneficiaries withdraw.

[![CI](https://github.com/Stellar-Mick/vaultvest-app/actions/workflows/ci.yml/badge.svg)](https://github.com/Stellar-Mick/vaultvest-app/actions/workflows/ci.yml)

**Maintainer:** [@Stellar-Mick](https://github.com/Stellar-Mick)

## Architecture

This monorepo is the frontend layer for the deployed [vaultvest-contract](https://stellar.expert/explorer/testnet/contract/CAAGQQVFJQ7UUPZ4PEBG77SEDAF4CLIYWKW544FUYMCW3QSHGULJMSR5). It contains no contract code — all vesting math, threshold checks, and schedule semantics live on-chain and are consumed via Soroban RPC. Signing happens exclusively in the browser through Freighter; no private keys or wallet sessions touch the server.

```
vaultvest-app/
├── packages/sdk/     # Typed Soroban RPC client + contract wrappers
├── apps/web/         # Next.js 14 (App Router) frontend
├── indexer/          # Lightweight event polling service
└── .github/workflows # CI: lint, typecheck, build
```

## Quick Start

```bash
git clone https://github.com/Stellar-Mick/vaultvest-app.git
cd vaultvest-app
npm install
cp apps/web/.env.example apps/web/.env.local
npm run dev -w @vaultvest/web
```

Requires [Freighter](https://www.freighter.app/) browser extension on testnet.

## Live Demo

- **App:** https://vaultvest-web.vercel.app
- **Contract:** [CAAGQQVFJQ7UUPZ4PEBG77SEDAF4CLIYWKW544FUYMCW3QSHGULJMSR5](https://stellar.expert/explorer/testnet/contract/CAAGQQVFJQ7UUPZ4PEBG77SEDAF4CLIYWKW544FUYMCW3QSHGULJMSR5) on Stellar testnet

## Environment Variables

| Variable | Description | Default (testnet) |
|---|---|---|
| `NEXT_PUBLIC_CONTRACT_ID` | VaultVest contract address | `CAAGQQVFJQ7UUPZ4PEBG77SEDAF4CLIYWKW544FUYMCW3QSHGULJMSR5` |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Network identifier | `Test SDF Network ; September 2015` |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID` | SEP-41 token for vesting | `CBD4XOY6GYB2BR52IOQG5LZH3H4UHIZ6YMTFREMWG3KW2JJQPLGSXSYA` |

See [`.env.example`](apps/web/.env.example) for the full list.

## SDK Usage

```ts
import { getSchedule, getVestedAmount, buildWithdrawTx } from '@vaultvest/sdk';

const schedule = await getSchedule(42n);
const vested = await getVestedAmount(42n);
const tx = await buildWithdrawTx(42n, beneficiaryAddress);
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for git workflow, coding standards, and how to add features.

## Contributors

<a href="https://github.com/Stellar-Mick/vaultvest-app/graphs/contributors">
  <img src="https://contrib.rocks/preview?repo=Stellar-Mick/vaultvest-app" />
</a>
