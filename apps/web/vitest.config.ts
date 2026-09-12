import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirror the `@/*` path alias from tsconfig.json.
    alias: { '@': path.resolve(__dirname) },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    // Security modules read NEXT_PUBLIC_* at import time; set them before any
    // test file loads so the guard has a contract and network to check against.
    env: {
      NEXT_PUBLIC_CONTRACT_ID:
        'CAAGQQVFJQ7UUPZ4PEBG77SEDAF4CLIYWKW544FUYMCW3QSHGULJMSR5',
      NEXT_PUBLIC_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
      NEXT_PUBLIC_SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
    },
  },
});
