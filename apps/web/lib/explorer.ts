/**
 * explorer.ts — stellar.expert links and network labelling.
 *
 * The explorer path segment (`testnet` / `public`) is derived from the same
 * `NEXT_PUBLIC_NETWORK_PASSPHRASE` the app builds and signs against, so links
 * always point at the network the transaction actually landed on. An
 * unrecognised passphrase yields no link rather than a wrong one.
 */

const PASSPHRASE = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? '';

const NETWORKS: Record<string, { slug: string; label: string }> = {
  'Public Global Stellar Network ; September 2015': {
    slug: 'public',
    label: 'Mainnet',
  },
  'Test SDF Network ; September 2015': { slug: 'testnet', label: 'Testnet' },
  'Test SDF Future Network ; October 2022': {
    slug: 'futurenet',
    label: 'Futurenet',
  },
};

const network = NETWORKS[PASSPHRASE];

/** Human label for the configured network, e.g. "Testnet". */
export const NETWORK_LABEL = network?.label ?? 'Unknown network';

/** True when the configured network is mainnet — used to warn, never to gate. */
export const IS_MAINNET = network?.slug === 'public';

function explorerUrl(kind: 'tx' | 'account' | 'contract', id: string): string | null {
  if (!network) return null;
  return `https://stellar.expert/explorer/${network.slug}/${kind}/${encodeURIComponent(id)}`;
}

/** Explorer page for a transaction hash, or `null` if the network is unknown. */
export function explorerTxUrl(hash: string): string | null {
  return explorerUrl('tx', hash);
}

/**
 * Explorer page for a G... account or C... contract, chosen by prefix, or `null`
 * if the network is unknown.
 */
export function explorerAddressUrl(address: string): string | null {
  return explorerUrl(address.startsWith('C') ? 'contract' : 'account', address);
}

/** Truncate a long identifier for display, e.g. `GBXD…AB12`. */
export function shorten(value: string, head = 4, tail = 4): string {
  return value.length > head + tail + 1
    ? `${value.slice(0, head)}…${value.slice(-tail)}`
    : value;
}
