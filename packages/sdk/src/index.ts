/**
 * Public entrypoint for @vaultvest/sdk.
 *
 * Re-exports the spec'd modules (client, contract, xdr, types) so consumers can
 * `import { getSchedule } from '@vaultvest/sdk'`. The `xdr` and `contract` modules
 * are added to this barrel as they land in subsequent commits.
 */
export * from './client.js';
export * from './types.js';
