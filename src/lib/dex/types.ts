export type DexProvider = 'raydium' | 'meteora' | 'orca';

export interface PoolConfig {
  connection:  import('@solana/web3.js').Connection;
  publicKey:   import('@solana/web3.js').PublicKey;
  sendTransaction: any;
  signTransaction: any;
  tokenAMint:  string;
  tokenBMint:  string;
  tokenADecimals: number;
  tokenBDecimals: number;
  amountA:     string;
  amountB:     string;
  feeTierIndex: number;
  network:     'devnet' | 'mainnet';
}

export interface DexResult {
  signature: string;
  poolId?:   string;
  lpMint?:   string;
}

export interface DexAdapter {
  name:        string;
  label:       string;
  description: string;
  isAvailable: (network: 'devnet' | 'mainnet') => boolean;
  createPool:  (config: PoolConfig) => Promise<DexResult>;
  addLiquidity:(config: PoolConfig & { poolId: string }) => Promise<DexResult>;
}
