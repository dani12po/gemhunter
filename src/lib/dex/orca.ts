import type { DexAdapter, PoolConfig, DexResult } from './types';

export const orcaAdapter: DexAdapter = {
  name:        'orca',
  label:       'Orca Whirlpool',
  description: 'Concentrated Liquidity — efisiensi kapital tinggi, cocok untuk pair besar',
  isAvailable: () => true,

  async createPool(config: PoolConfig): Promise<DexResult> {
    throw new Error('Orca Whirlpool belum diimplementasikan. Install: npm install @orca-so/whirlpools');
  },

  async addLiquidity(config): Promise<DexResult> {
    throw new Error('Orca addLiquidity belum diimplementasikan.');
  },
};
