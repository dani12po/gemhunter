export { raydiumAdapter } from './raydium';
export type { DexProvider, PoolConfig, DexResult, DexAdapter } from './types';

import { raydiumAdapter } from './raydium';
import type { DexProvider, PoolConfig, DexResult } from './types';

export const DEX_ADAPTERS = {
  raydium: raydiumAdapter,
};

export async function executeCreatePool(
  dex: DexProvider,
  config: PoolConfig
): Promise<DexResult> {
  const adapter = DEX_ADAPTERS[dex as keyof typeof DEX_ADAPTERS];
  if (!adapter) throw new Error(`DEX "${dex}" tidak didukung`);
  if (!adapter.isAvailable(config.network)) {
    throw new Error(`${adapter.label} tidak tersedia di ${config.network}`);
  }
  return adapter.createPool(config);
}

export async function executeAddLiquidity(
  dex: DexProvider,
  config: PoolConfig & { poolId: string }
): Promise<DexResult> {
  const adapter = DEX_ADAPTERS[dex as keyof typeof DEX_ADAPTERS];
  if (!adapter) throw new Error(`DEX "${dex}" tidak didukung`);
  return adapter.addLiquidity(config);
}

export async function executeRemoveLiquidity(
  dex: DexProvider,
  config: PoolConfig & { poolId: string; lpAmount: string }
): Promise<DexResult> {
  const adapter = DEX_ADAPTERS[dex as keyof typeof DEX_ADAPTERS];
  if (!adapter) throw new Error(`DEX "${dex}" tidak didukung`);
  if (!adapter.removeLiquidity) {
    throw new Error(`Fitur hapus likuiditas belum tersedia untuk ${adapter.label}`);
  }
  return adapter.removeLiquidity(config);
}
