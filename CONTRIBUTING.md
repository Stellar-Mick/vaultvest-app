# Contributing to VaultVest App

Thanks for contributing! This repo is the frontend + SDK layer for the deployed
`vaultvest-contract`. Keep contract logic on-chain — this repo only calls it.

## Git workflow (non-negotiable)

- **Never `git add .`** — stage named files only.
- **One commit per logical unit.**
- **Push immediately after every commit.**
- **Conventional commits:** `type(scope): description`, e.g.
  `feat(sdk): implement xdr.ts arg encoding/decoding helpers`. Types: `feat`,
  `fix`, `chore`, `docs`, `refactor`, `test`, `ci`.

```bash
git add packages/sdk/src/types.ts
git commit -m "feat(sdk): add types.ts mirroring contract Schedule and VaultVestError"
git push
```

## Coding standards

### TypeScript (all workspaces)

- `strict: true` everywhere — no exceptions.
- No `any` without an inline comment justifying it; same for `// @ts-ignore`.
- Prefer `bigint` for on-chain integers (u64/i128 can exceed `Number.MAX_SAFE_INTEGER`).

### SDK package (`packages/sdk`)

- Every exported function has a JSDoc comment stating params, return type, and
  which `VaultVestError` variants it can surface.
- Mirror `Schedule` and `VaultVestError` in `types.ts` from the contract repo's
  `types.rs` — keep them in sync manually.
- Do not re-derive contract logic (vesting math, threshold checks) — display only
  what the contract computed.
- Before using a `@stellar/stellar-sdk` API, verify the method exists in the
  installed version — the SDK's API changes across majors (check
  `node_modules/@stellar/stellar-sdk/lib/esm/**/*.d.ts` or the changelog).

### Web app (`apps/web`)

- Function components only; hooks for state; no class components.
- Server components by default; `"use client"` only where wallet interaction or
  browser APIs are required.
- No state management library — React state + server components.
- All wallet signing happens in the browser via Freighter. Never send private
  keys or seed phrases anywhere.

### Indexer (`indexer`)

- Structured logging only: JSON lines (`{"level":"info","ts":...,"message":...}`),
  never `console.log` string interpolation.
- Retry RPC failures with exponential backoff; a single failed poll must not
  crash the process.

## Adding a feature

1. If it touches the contract interface, restate the function from Section 3 of
   the spec — do not guess signatures or error codes.
2. Add/update the SDK wrapper in `packages/sdk/src/contract.ts` with full JSDoc.
3. Wire the UI in `apps/web`, reusing the shadcn/ui components in
   `apps/web/components/ui`.
4. Map any new `VaultVestError` code to user-facing copy in
   `apps/web/lib/errors.ts` — raw XDR error strings must never reach the user.
5. Run `npm run lint && npm run typecheck && npm run build` before committing.

## Verifying changes

- `npm run typecheck` — strict typecheck across all workspaces.
- `npm run build` — production build (also compiles the SDK to `dist/`).
- For SDK changes, exercise the wrappers against the live testnet contract (see
  the verification notes in the README); a nonexistent schedule must surface
  `VaultVestError.ScheduleNotFound`, not a raw error string.
