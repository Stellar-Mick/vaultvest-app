/**
 * Next.js configuration.
 *
 * Beyond transpiling the workspace SDK, this file attaches the app's security
 * response headers. VaultVest asks users to sign blockchain transactions with a
 * browser wallet, so the headers below are load-bearing rather than cosmetic:
 * a framed or script-injected copy of this UI can trick a user into signing a
 * transaction they never intended.
 */

/**
 * Origins the browser is allowed to open network connections to. Soroban RPC is
 * read from the same `NEXT_PUBLIC_*` var the app uses at runtime so the CSP
 * tracks whichever network the deployment is configured for. Friendbot is
 * included because the SDK falls back to it when the read-only simulation
 * source account is missing (see packages/sdk/src/client.ts).
 *
 * When the RPC URL is absent or unparseable at build time we omit `connect-src`
 * entirely rather than ship a policy that would break the app.
 */
function connectSrc() {
  const origins = new Set(["'self'"]);
  const rpcUrl = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL;
  if (!rpcUrl) return null;
  try {
    origins.add(new URL(rpcUrl).origin);
  } catch {
    return null;
  }
  origins.add('https://friendbot.stellar.org');
  origins.add('https://friendbot-testnet.stellar.org');
  return `connect-src ${[...origins].join(' ')}`;
}

/**
 * Content-Security-Policy.
 *
 * `'unsafe-inline'` is required for script-src because the App Router emits
 * inline bootstrap and flight-data scripts without a nonce (a nonce would need
 * middleware, which this app does not run). `'unsafe-eval'` is added in
 * development only — the dev server's React refresh runtime needs it, the
 * production bundle does not.
 */
function contentSecurityPolicy(isDev) {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    scriptSrc,
    // Tailwind's generated stylesheet plus Next's inline style injection.
    "style-src 'self' 'unsafe-inline'",
    // next/font/google self-hosts Inter under /_next, so 'self' is enough.
    "font-src 'self' data:",
    "img-src 'self' data: blob:",
    connectSrc(),
    // No plugins, no framing, no <base> hijacking, no off-site form posts.
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    'upgrade-insecure-requests',
  ]
    .filter(Boolean)
    .join('; ');
}

const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace SDK (@vaultvest/sdk) is a TS package in this monorepo. Its
  // exports point at built dist/ (built on postinstall), but transpiling it here
  // keeps dev edits to the SDK from requiring a manual rebuild.
  transpilePackages: ['@vaultvest/sdk'],

  // Pin file tracing to this monorepo. Next infers the root from the nearest
  // lockfile and will happily walk *above* the repo when an unrelated lockfile
  // exists further up the tree, which makes builds depend on the machine they
  // run on.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),

  // Do not advertise the framework version to scanners.
  poweredByHeader: false,

  async headers() {
    const isDev = process.env.NODE_ENV !== 'production';
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: contentSecurityPolicy(isDev),
          },
          // Defence in depth for browsers that honour XFO over frame-ancestors.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value:
              'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
      {
        // Transaction building is per-request and must never be cached by a CDN
        // or shared proxy.
        source: '/api/:path*',
        headers: [
          { key: 'Cache-Control', value: 'no-store' },
          { key: 'Vary', value: 'Origin' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
