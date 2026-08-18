# Security Policy

## Scope

This repository is the **frontend and SDK layer** for VaultVest — a governance-gated token vesting dApp on Stellar. It is **not** the smart contract itself, and it is **not audited**. The contract it interacts with is deployed on **Stellar testnet** and should be treated as experimental.

This is testnet software. Do not use it with real assets.

## What We Do and Don't Handle

- **Signing happens entirely in your browser** via the [Freighter](https://www.freighter.app/) extension. Private keys, seed phrases, and wallet sessions **never** leave your machine and are never sent to any server.
- This frontend has **no database** and **stores no secrets**. All state is read directly from Soroban RPC.
- The `/api/tx` route builds unsigned transactions server-side but **never signs or submits** them — that happens in your browser.

## Reporting a Vulnerability

If you discover a security issue, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email the maintainer directly or use [GitHub's private vulnerability reporting](https://github.com/Stellar-Mick/vaultvest-app/security/advisories/new).
3. Include: steps to reproduce, potential impact, and any suggested fix.

We will acknowledge receipt within 48 hours and work with you to understand and address the issue.

## Known Limitations

- The VaultVest contract on testnet is **unaudited**.
- Error messages are best-effort translations of on-chain reverts — edge cases may surface raw error strings.
- The SEP-41 token trustline error handling depends on parsing raw `Error(Contract, #N)` strings from the token contract, which is fragile if the contract's error format changes.
