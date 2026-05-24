import { Connection, PublicKey } from '@solana/web3.js';
import { getMint } from '@solana/spl-token';

export interface RiskAnalysis {
  score: 'HIGH' | 'MEDIUM' | 'LOW';
  flags: string[];
  details: {
    mintAuthorityRevoked: boolean;
    freezeAuthorityRevoked: boolean;
    top10HolderPercent: number;
    liquidityUsd: number;
    poolAgeDays: number;
  };
}

export async function analyzeTokenRisk(
  connection: Connection,
  mint: string,
  tokenData: any
): Promise<RiskAnalysis> {
  const flags: string[] = [];
  const details = {
    mintAuthorityRevoked: false,
    freezeAuthorityRevoked: false,
    top10HolderPercent: tokenData.top10HolderPercent || 0,
    liquidityUsd: tokenData.liquidity || 0,
    poolAgeDays: (tokenData.ageHours || 0) / 24,
  };

  try {
    const mintInfo = await getMint(connection, new PublicKey(mint));
    details.mintAuthorityRevoked = mintInfo.mintAuthority === null;
    details.freezeAuthorityRevoked = mintInfo.freezeAuthority === null;

    if (!details.mintAuthorityRevoked) flags.push("[!] Mint authority aktif");
    else flags.push("[OK] Mint sudah direnounce");

    if (!details.freezeAuthorityRevoked) flags.push("[!] Freeze authority aktif");
    else flags.push("[OK] Freeze authority direnounce");

    // If we don't have top10HolderPercent from tokenData, try to estimate from largest accounts
    if (!details.top10HolderPercent) {
      try {
        const largest = await connection.getTokenLargestAccounts(new PublicKey(mint));
        const totalLargest = largest.value.reduce((sum, acc) => sum + BigInt(acc.amount), 0n);
        const supply = mintInfo.supply;
        if (supply > 0n) {
          details.top10HolderPercent = Number((totalLargest * 100n) / supply);
        }
      } catch (e) {
        console.error('Error fetching largest accounts:', e);
      }
    }
  } catch (e) {
    console.error('Risk analysis error (mint):', e);
    // Fallback to tokenData if RPC fails
    flags.push("[!] Gagal verifikasi on-chain");
  }

  // Holder concentration flags
  if (details.top10HolderPercent > 80) {
    flags.push(`[!] Top 10 holder: ${details.top10HolderPercent.toFixed(1)}% supply`);
  } else if (details.top10HolderPercent > 50) {
    flags.push(`[!] Top 10 holder: ${details.top10HolderPercent.toFixed(1)}% supply`);
  } else {
    flags.push(`[OK] Top 10 holder < 50% supply`);
  }

  // Liquidity flags
  if (details.liquidityUsd < 1000) {
    flags.push("[!] Liquidity sangat rendah (< $1000)");
  } else if (details.liquidityUsd < 5000) {
    flags.push("[!] Liquidity rendah ($1000-$5000)");
  } else {
    flags.push("[OK] Liquidity > $5000");
  }

  // Age flags
  if (details.poolAgeDays < 1) {
    flags.push("[!] Pool baru dibuat < 24 jam");
  } else if (details.poolAgeDays < 7) {
    flags.push("[!] Pool umur < 7 hari");
  } else {
    flags.push("[OK] Pool umur > 7 hari");
  }

  // Socials
  const hasSocials = tokenData.website || tokenData.twitter || tokenData.telegram;
  if (!hasSocials) {
    flags.push("[!] Tidak ada social links");
  }

  // Score calculation
  let score: 'HIGH' | 'MEDIUM' | 'LOW' = 'LOW';
  
  const isHigh = !details.mintAuthorityRevoked || 
                 !details.freezeAuthorityRevoked || 
                 details.top10HolderPercent > 80 || 
                 details.liquidityUsd < 1000 || 
                 details.poolAgeDays < 1;

  const isMedium = details.top10HolderPercent > 50 || 
                   details.liquidityUsd < 5000 || 
                   details.poolAgeDays < 7 ||
                   !hasSocials;

  if (isHigh) score = 'HIGH';
  else if (isMedium) score = 'MEDIUM';

  return { score, flags, details };
}
