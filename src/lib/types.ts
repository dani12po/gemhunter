// Token data from Dexscreener API
export interface TokenData {
  nama: string;
  simbol: string;
  address: string;
  chainId: string;
  pairAddress: string;
  isBoosted: boolean;
  harga: number;
  priceChange5m: number;
  priceChange1h: number;
  priceChange6h: number;
  priceChange24h: number;
  volume5m: number;
  volume1h: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  ageHours: number;
  txCount24h: number;
  buys24h: number;
  sells24h: number;
  holders: number | null;
  website: string;
  twitter: string;
  telegram: string;
  discord: string;
  top10HolderPercent: number | null;
  imageUrl: string;
  boostAmount: number;
  skor: number;
  gemScore: string;
  redFlags: string[];
  risk?: {
    score: 'HIGH' | 'MEDIUM' | 'LOW';
    flags: string[];
    details: {
      mintAuthorityRevoked: boolean;
      freezeAuthorityRevoked: boolean;
      top10HolderPercent: number;
      liquidityUsd: number;
      poolAgeDays: number;
    }
  };
}

// Scanner filter
export interface FilterData {
  liquidityMin: number;
  volumeMin: number;
  ageMaxJam: number;
  delta1jMin: number;
  txnMin: number;
  mcapMax: number;
  liqMax: number;
  riskLevel: 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH';
}

// Preset filters
export interface PresetData {
  liquidityMin: number;
  volumeMin: number;
  ageMaxJam: number;
  delta1jMin: number;
  txnMin: number;
  mcapMax: number;
  liqMax: number;
  riskLevel?: 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH';
}

// Swap transaction
export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  slippage: number;
  priceImpact: number;
}

export interface SwapResult {
  txid: string;
  signature: string;
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  fee: number;
}
