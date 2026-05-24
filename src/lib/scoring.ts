import type { TokenData } from './types';

/**
 * Hitung skor utama 0-100 berdasarkan data token
 */
export function hitungSkor(token: TokenData): number {
  let skor = 0;

  // 1. Rasio Vol/Liq
  if (token.liquidity > 0) {
    const rasio = token.volume24h / token.liquidity;
    skor += Math.min(rasio / 5, 1) * 25;
  }

  // 2. Price Momentum
  const momentum =
    (token.priceChange5m || 0) * 0.3 +
    (token.priceChange1h || 0) * 0.4 +
    (token.priceChange6h || 0) * 0.2 +
    (token.priceChange24h || 0) * 0.1;
  skor += Math.min(Math.max(momentum / 50, 0), 1) * 30;

  // 3. Umur Token
  const umur = token.ageHours || 999;
  if (umur < 0.5) skor += 25;
  else if (umur < 1) skor += 22;
  else if (umur < 3) skor += 18;
  else if (umur < 6) skor += 14;
  else if (umur < 12) skor += 10;
  else if (umur < 24) skor += 6;
  else if (umur < 48) skor += 3;

  // 4. Txn 24j
  skor += Math.min(token.txCount24h / 5000, 1) * 10;

  // 5. MCap rendah
  const mcap = token.marketCap || 0;
  if (mcap > 0 && mcap <= 100_000) skor += 10;
  else if (mcap <= 250_000) skor += 8;
  else if (mcap <= 500_000) skor += 6;
  else if (mcap <= 1_000_000) skor += 3;
  else if (mcap <= 5_000_000) skor += 1;

  // Bonus buy pressure
  if (token.buys24h > 0 && token.txCount24h > 0) {
    const pctBuy = token.buys24h / token.txCount24h;
    if (pctBuy >= 0.7) skor += 8;
    else if (pctBuy >= 0.6) skor += 5;
    else if (pctBuy >= 0.5) skor += 2;
  }

  // Bonus boosted
  if (token.isBoosted) skor += 5;

  // Bonus volume 5m
  if (token.liquidity > 0 && token.volume5m > 0) {
    const rasio5m = token.volume5m / token.liquidity;
    if (rasio5m >= 0.1) skor += 5;
    else if (rasio5m >= 0.05) skor += 3;
  }

  return Math.round(Math.min(Math.max(skor, 0), 100));
}

/**
 * Gem Score label
 */
export function hitungGemScore(token: TokenData): string {
  let poin = 0;

  if (token.ageHours < 1) poin += 4;
  else if (token.ageHours < 3) poin += 3;
  else if (token.ageHours < 6) poin += 2;

  if (token.priceChange1h > 50) poin += 3;
  else if (token.priceChange1h > 20) poin += 2;
  else if (token.priceChange1h > 5) poin += 1;

  if (token.liquidity > 0) {
    const r = token.volume24h / token.liquidity;
    if (r > 10) poin += 3;
    else if (r > 5) poin += 2;
    else if (r > 2) poin += 1;
  }

  if (token.marketCap > 0 && token.marketCap < 100_000) poin += 3;
  else if (token.marketCap < 300_000) poin += 2;
  else if (token.marketCap < 500_000) poin += 1;

  if (token.txCount24h > 0 && token.buys24h / token.txCount24h > 0.65) poin += 2;
  if (token.isBoosted) poin += 2;

  if (poin >= 14) return 'ULTRA GEM';
  if (poin >= 10) return 'GEM';
  if (poin >= 7) return 'POTENTIAL';
  if (poin >= 4) return 'WATCH';
  return 'NORMAL';
}

/**
 * Deteksi red flag
 */
export function deteksiRedFlag(token: TokenData, snapshot: Record<string, number> | null): string[] {
  const flags: string[] = [];

  if (snapshot && snapshot.liquidity > 0) {
    const drop = (snapshot.liquidity - token.liquidity) / snapshot.liquidity;
    if (drop > 0.3) flags.push('Liquidity turun >30%');
    else if (drop > 0.2) flags.push('Liquidity turun >20%');
  }

  if (token.top10HolderPercent && token.top10HolderPercent > 80) flags.push('Top 10 holder >80%');
  else if (token.top10HolderPercent && token.top10HolderPercent > 60) flags.push('Top 10 holder >60%');

  if (!token.website && !token.twitter && !token.telegram && !token.discord) {
    flags.push('Tidak ada website/sosmed');
  }

  if (snapshot && snapshot.volume24h > 0) {
    const spike = (token.volume24h - snapshot.volume24h) / snapshot.volume24h;
    if (spike > 10) flags.push('Volume spike >1000%');
    else if (spike > 5) flags.push('Volume spike >500%');
  }

  if (token.txCount24h > 10) {
    const pctSell = token.sells24h / token.txCount24h;
    if (pctSell > 0.75) flags.push('Sell pressure >75%');
    else if (pctSell > 0.65) flags.push('Sell pressure >65%');
  }

  if (token.liquidity > 0 && token.liquidity < 3000) flags.push('Liquidity <$3K');
  else if (token.liquidity > 0 && token.liquidity < 8000) flags.push('Liquidity rendah');

  if (snapshot && snapshot.harga > 0) {
    const priceDrop = (snapshot.harga - token.harga) / snapshot.harga;
    if (priceDrop > 0.5) flags.push('Harga turun >50%');
  }

  return flags;
}

/**
 * Badge class berdasarkan skor
 */
export function getBadgeClass(skor: number): string {
  if (skor >= 80) return 'score-ultra';
  if (skor >= 70) return 'score-green';
  if (skor >= 50) return 'score-yellow';
  if (skor >= 30) return 'score-orange';
  return 'score-red';
}
