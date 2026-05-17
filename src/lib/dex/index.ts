export { raydiumAdapter } from './raydium';
export { meteoraAdapter } from './meteora';
export { orcaAdapter    } from './orca';
export type { DexProvider, PoolConfig, DexResult, DexAdapter } from './types';

import { raydiumAdapter } from './raydium';
import { meteoraAdapter } from './meteora';
import { orcaAdapter    } from './orca';
import type { DexProvider, PoolConfig, DexResult } from './types';

export const DEX_ADAPTERS = {
  raydium: raydiumAdapter,
  meteora: meteoraAdapter,
  orca:    orcaAdapter,
};

export async function executeCreatePool(
  dex: DexProvider,
  config: PoolConfig
): Promise<DexResult> {
  const adapter = DEX_ADAPTERS[dex];
  if (!adapter) throw new Error(`DEX "${dex}" tidak didukung`);
  if (!adapter.isAvailable(config.network)) {
    throw new Error(`${adapter.label} tidak tersedia di ${config.network}`);
  }
  return adapter.createPool(config);
}
