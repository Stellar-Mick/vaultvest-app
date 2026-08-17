/** @type {import('next').NextConfig} */
const nextConfig = {
  // The workspace SDK (@vaultvest/sdk) is a TS package in this monorepo. Its
  // exports point at built dist/ (built on postinstall), but transpiling it here
  // keeps dev edits to the SDK from requiring a manual rebuild.
  transpilePackages: ['@vaultvest/sdk'],
};

module.exports = nextConfig;
