# Security Policy

## Scope

This repository is the **frontend and SDK layer** for VaultVest — a governance-gated token vesting dApp on Stellar. It is **not** the smart contract itself, and it is **not audited**. The contract it interacts with is deployed on **Stellar testnet** and should be treated as experimental.

This is testnet software. Do not use it with real assets.

## What We Do and Don't Handle

- **Signing happens entirely in your browser** via the [Freighter](https://www.freighter.app/) extension. Private keys, seed phrases, and wallet sessions **never** leave your machine and are never sent to any server.
- This frontend has **no database** and **stores no secrets**. All state is read directly from Soroban RPC.
- The `/api/tx` route builds unsigned transactions server-side but **never signs or submits** them — that happens in your browser.
- **The server is not trusted for signing.** The browser re-parses every transaction `/api/tx` returns and refuses to pass it to your wallet unless it is a single call to the configured VaultVest contract, invoking the function the flow asked for, sourced from your connected account, and authorizing no contract other than VaultVest and the schedule's own token (`apps/web/lib/tx-guard.ts`). A tampered or spoofed response cannot become a signature over someone else's transaction.
- **Network mismatches are refused, not signed.** Transactions are built for the network this deployment is configured for. If your wallet is on a different one, the app stops and says so rather than producing a signature for the wrong chain.

## Hardening in This Repo

| Control | Where |
|---|---|
| Runtime validation of every `/api/tx` field (types, strkey addresses, integer ranges, signer-set cap) | `apps/web/lib/tx-request.ts` |
| Client-side verification of server-built transactions before signing | `apps/web/lib/tx-guard.ts` |
| Rate limiting on `/api/tx`, which fans out into Soroban RPC | `apps/web/lib/rate-limit.ts` |
| Redacted API errors — contract reverts return a numeric code, never raw RPC diagnostics | `apps/web/app/api/tx/route.ts` |
| CSP, `frame-ancestors 'none'`, HSTS, nosniff, referrer and permissions policy | `apps/web/next.config.js` |

The `/api/tx` rate limiter keeps its counters in process memory. On a serverless
deployment each instance enforces its own window, so treat it as a speed bump
against a single flooding client rather than a hard guarantee; put a
platform-level limit in front of the route if you need one.

## Reporting a Vulnerability

If you discover a security issue, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email the maintainer directly or use [GitHub's private vulnerability reporting](https://github.com/Stellar-Mick/vaultvest-app/security/advisories/new).
3. Include: steps to reproduce, potential impact, and any suggested fix.

We will acknowledge receipt within 48 hours and work with you to understand and address the issue.

## Known Limitations

- The VaultVest contract on testnet is **unaudited**.
- Error messages are best-effort translations of on-chain reverts — edge cases may surface raw error strings.
- The SEP-41 token trustline error handling depends on parsing raw `Error(Contract, #N)` strings from the token contract, which is fragile if the contract's error format changes. `/api/tx` now extracts the numeric code server-side and returns only that, so the raw string no longer crosses the API boundary; direct browser-to-RPC read calls still parse it.
- The signing guard verifies *what* a transaction invokes, not whether its arguments are what you intended. It stops a substituted transaction; it does not replace reading the wallet prompt.
- `npm audit` reports one outstanding advisory: **postcss `<=8.5.22`**, pinned as an exact dependency by `next@15.5.25`. The root `overrides` block asks for a patched postcss, but npm declines to apply it while `apps/web` also depends on postcss directly; clearing it outright requires `next@16`, which removes `next lint` and would break CI. The advisories (XSS in CSS stringify output, arbitrary `.map` file disclosure via `sourceMappingURL`) are **build-time only** and are reached only by processing untrusted CSS. All CSS in this repo is first-party (`globals.css` plus Tailwind output), so the path is not reachable — and postcss ships no code to the browser. Revisit when Next bumps its own postcss.
