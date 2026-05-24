// Platform fee configuration
export const PLATFORM_FEE_BPS = 50; // 0.5%
export const PLATFORM_FEE_WALLET = 'GFK2JGbzQ8b3jusvNdSwbfdsuQEBP9KawPj6VwcLyyEx';
export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// API endpoints
export const API_LATEST_PROFILES = 'https://api.dexscreener.com/token-profiles/latest/v1';
export const API_BOOSTED_LATEST = 'https://api.dexscreener.com/token-boosts/latest/v1';
export const API_TOKEN_PAIRS = 'https://api.dexscreener.com/latest/dex/tokens/';
// Pump.fun graduated tokens — token yang baru lulus dari bonding curve
export const API_PUMPFUN_GRADUATED = 'https://api.dexscreener.com/token-profiles/latest/v1';
// Dexscreener search by CA
export const API_DEXSCREENER_SEARCH = 'https://api.dexscreener.com/latest/dex/search?q=';

// Presets
export const PRESETS: Record<string, any> = {
  gem: { liquidityMin: 3000, volumeMin: 1000, ageMaxJam: 24, delta1jMin: 0, txnMin: 10, mcapMax: 2000000, liqMax: 2000000, riskLevel: 'ALL' },
  safe: { liquidityMin: 30000, volumeMin: 10000, ageMaxJam: 72, delta1jMin: 3, txnMin: 100, mcapMax: 10000000, liqMax: 10000000, riskLevel: 'LOW' },
  degen: { liquidityMin: 500, volumeMin: 100, ageMaxJam: 1, delta1jMin: 0, txnMin: 0, mcapMax: 500000, liqMax: 500000, riskLevel: 'ALL' },
  narrative: { liquidityMin: 1000, volumeMin: 500, ageMaxJam: 48, delta1jMin: 0, txnMin: 5, mcapMax: 5000000, liqMax: 5000000, riskLevel: 'ALL' },
  custom: { liquidityMin: 0, volumeMin: 0, ageMaxJam: 168, delta1jMin: -100, txnMin: 0, mcapMax: 0, liqMax: 0, riskLevel: 'ALL' },
};

// Slippage options
export const SLIPPAGE_OPTIONS = [0.5, 1, 2, 3, 5];

// Burn liquidity constants
export const BURN_LIQUIDITY_CONFIG = {
  SUPPORTED_DEXES: ['Raydium', 'Meteora', 'Orca', 'Jupiter'],
  BURN_WARNINGS: [
    'THIS ACTION IS IRREVERSIBLE',
    'You will lose all LP tokens permanently',
    'Future fees cannot be claimed',
    'Token supply will become more scarce'
  ],
  MIN_BURN_AMOUNT: 0.000001,
  EXPLORER_BASE_URL: process.env.NEXT_PUBLIC_NETWORK === 'devnet'
    ? 'https://explorer.solana.com/tx/'
    : 'https://solscan.io/tx/'
};

// Color constants
export const COLORS = {
  primary: '#9945ff',
  success: '#14f195',
  warning: '#d29922',
  danger: '#f85149',
  background: '#0a0a0f',
  surface: '#0f0d1a',
  cardBg: '#1a1625',
};
