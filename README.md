# VaultVest App

Frontend and supporting services for **VaultVest** — a governance-gated token vesting dApp on Stellar. This monorepo consumes the already-deployed `vaultvest-contract` (via Soroban RPC); it contains **no contract code**. Vesting math, threshold checks, and all other schedule semantics live on-chain and are only reflected in the UI.

## What it does

- **Funder** — creates vesting schedules: escrow tokens, pick a beneficiary, define the signer set and approval threshold.
- **Signer** — reviews schedules and approves releases; withdrawals unlock once approvals meet the threshold.
- **Beneficiary** — tracks vested amounts (from `vested_amount()`, never recomputed client-side) and withdraws tokens.

Signing happens exclusively in the browser via the Freighter extension. No private keys, seed phrases, or wallet sessions are stored server-side, and there is no database — all state is read directly from Soroban RPC.

## Monorepo layout

```
vaultvest-app/
├── packages/sdk/     # Typed Soroban RPC client + contract wrappers (7 contract fns)
├── apps/web/         # Next.js 14 (App Router) frontend + /api/tx unsigned-tx builder
├── indexer/          # Lightweight event polling service (JSON-lines logs)
└── .github/workflows # CI: lint, typecheck, build
```

## Prerequisites

- Node.js 20+ (npm workspaces)
- [Freighter](https://www.freighter.app/) browser extension (testnet)

## Quickstart

```bash
npm install        # installs all workspaces; postinstall builds @vaultvest/sdk
cp apps/web/.env.example apps/web/.env.local   # then edit if needed
npm run dev -w @vaultvest/web                  # start the app at http://localhost:3000
```

Run the indexer (optional, in a second terminal):

```bash
npm run start -w @vaultvest/indexer
```

## Environment variables

| Variable | Purpose | Value |
|---|---|---|
| `NEXT_PUBLIC_CONTRACT_ID` | Deployed VaultVest contract address | `CAAGQQVFJQ7UUPZ4PEBG77SEDAF4CLIYWKW544FUYMCW3QSHGULJMSR5` |
| `NEXT_PUBLIC_SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Network identifier for tx building | `Test SDF Network ; September 2015` |
| `NEXT_PUBLIC_TOKEN_CONTRACT_ID` | SEP-41 token used for demo vesting schedules | `CBD4XOY6GYB2BR52IOQG5LZH3H4UHIZ6YMTFREMWG3KW2JJQPLGSXSYA` |

Indexer extras: `INDEXER_POLL_INTERVAL_MS` (default `5000`) and `INDEXER_START_LEDGER` (ledger to start from on first run; default: latest).

Nothing is hardcoded in source — all values are read from `process.env`.

## How the pieces fit together

```
Browser (Freighter signs)          Server / API                     Soroban RPC
──────────────────────             ──────────────                   ───────────
Read-only calls ────────────────────────────────────────────────►  get_schedule,
(getSchedule, getVestedAmount,                                     vested_amount,
 getApprovalCount)                                                 get_approval_count

Write flows:
CreateScheduleForm ── POST /api/tx ──► buildCreateScheduleTx ───►  simulate/prepare
ApprovePage          (unsigned XDR)   (SDK builders)               (typed errors
DashboardPage ── signAndSubmit ──────► Freighter signs ─────────►  submit
```

- **Read-only** contract calls go directly from the client — no signature needed.
- **Write calls** are built server-side (`POST /api/tx`), signed in the browser by Freighter, and submitted from the client.
- Every contract revert is mapped to a typed `VaultVestError` code and surfaced as a friendly message — never a raw XDR error string.

## Using the SDK

```ts
import { getSchedule, getVestedAmount, buildWithdrawTx } from '@vaultvest/sdk';

// Read-only (no signature needed)
const schedule = await getSchedule(42n);
const vested = await getVestedAmount(42n);

// Write builder — returns a prepared unsigned tx for Freighter to sign
const tx = await buildWithdrawTx(42n, beneficiaryAddress);
```

The SDK was verified against the live testnet contract: every read-only wrapper and write builder was exercised against the deployed bytecode, and `Error(Contract, #N)` reverts map to the correct `VaultVestError` member.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev -w @vaultvest/web` | Start the Next.js dev server |
| `npm run start -w @vaultvest/indexer` | Run the event poller |
| `npm run lint` | Lint all workspaces |
| `npm run typecheck` | Typecheck all workspaces (strict) |
| `npm run build` | Build all workspaces |

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development workflow and standards.
