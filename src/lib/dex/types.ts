export type DexProvider = 'raydium';

export interface PoolInfo {
  exists:         boolean;
  poolId:         string;
  lpMint?:        string;
  lpDecimals?:    number;
  feeConfigIndex: number;
  tradeFeeRate?:  number;
  reserveA?:      bigint;
  reserveB?:      bigint;
  lpSupply?:      bigint;
}

export interface UserPoolPosition {
  lpBalance:    string;
  lpBalanceRaw: bigint;
  sharePercent: string;
  valueA:       string;
  valueB:       string;
}

export interface PoolConfig {
  connection:      import('@solana/web3.js').Connection;
  publicKey:       import('@solana/web3.js').PublicKey;
  sendTransaction: any;
  signTransaction: any;
  tokenAMint:      string;
  tokenBMint:      string;
  tokenADecimals:  number;
  tokenBDecimals:  number;
  amountA:         string;
  amountB:         string;
  feeTierIndex:    number;
  network:         'devnet' | 'mainnet';
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
  removeLiquidity?: (config: PoolConfig & { poolId: string; lpAmount: string }) => Promise<DexResult>;
  findPool:    (connection: any, tokenA: string, tokenB: string, network: 'devnet' | 'mainnet') => Promise<PoolInfo | null>;
  fetchPosition: (connection: any, owner: any, pool: PoolInfo) => Promise<UserPoolPosition | null>;
  lockLpTokens?: (
    connection: any,
    owner: any,
    signTransaction: any,
    lpMint: string,
    lpAmount: bigint,
    lockUntilMs: number
  ) => Promise<string>;
}
