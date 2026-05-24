'use client';
/**
 * LIQUIDITY PAGE — Raydium CPMM Support
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from '../../components/layout/Header';
import { SwapModal } from '../../components/swap/SwapModal';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Transaction,
  Connection,
  LAMPORTS_PER_SOL,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getMint,
} from '@solana/spl-token';
import {
  Raydium,
  CpmmPoolInfoLayout,
  CREATE_CPMM_POOL_FEE_ACC,
  CREATE_CPMM_POOL_PROGRAM,
  DEVNET_PROGRAM_ID,
  getCpmmPdaAmmConfigId,
  getCpmmPdaPoolId,
} from '@raydium-io/raydium-sdk-v2';
import type { DexProvider } from '../../lib/dex';
import { DEX_ADAPTERS, executeCreatePool, executeAddLiquidity, executeRemoveLiquidity } from '../../lib/dex';
import Decimal from 'decimal.js';

// Set high precision for financial calculations
Decimal.set({ precision: 30 });

// ─── CONSTANTS ────────────────────────────────────────────────
const SOL_MINT    = 'So11111111111111111111111111111111111111112';
const DEVNET_RPC  = process.env.NEXT_PUBLIC_DEVNET_RPC_URL  || 'https://api.devnet.solana.com';
const MAINNET_RPC = process.env.NEXT_PUBLIC_RPC_URL         || 'https://api.mainnet-beta.solana.com';

const CPMM_FEE_CONFIGS = [
  { index: 0, tradeFeeRate: 2500, label: '0.25%', description: 'Standard — cocok untuk pair umum' },
  { index: 1, tradeFeeRate: 500,  label: '0.05%', description: 'Stable — cocok untuk stablecoin' },
  { index: 2, tradeFeeRate: 100,  label: '0.01%', description: 'Ultra-low — untuk pair sangat stabil' },
];

type NetworkMode = 'devnet' | 'mainnet';
type TxStatus    = 'idle' | 'building' | 'signing' | 'confirming' | 'success' | 'error';
type PageTab     = 'add' | 'remove';

interface TokenMeta {
  mint:     string;
  symbol:   string;
  name:     string;
  decimals: number;
  logoURI?: string;
  created_at?: number; // timestamp
  supply?: bigint;
}

interface PoolInfo {
  exists:         boolean;
  poolId:         string;
  lpMint:         string;
  lpDecimals:     number;
  feeConfigIndex: number;
  tradeFeeRate:   number;
  reserveA:       bigint;
  reserveB:       bigint;
  lpSupply:       bigint;
}

interface UserPoolPosition {
  lpBalance:    string;
  lpBalanceRaw: bigint;
  sharePercent: string;
  valueA:       string;
  valueB:       string;
}

interface DetectedLpPool {
  poolId: string;
  lpMint: string;
  lpDecimals: number;
  lpBalanceRaw: bigint;
  lpBalance: string;
  mintA: string;
  mintB: string;
  symbolA: string;
  symbolB: string;
  decimalsA: number;
  decimalsB: number;
  reserveA: bigint;
  reserveB: bigint;
  lpSupply: bigint;
  tradeFeeRate: number;
  sharePercent: string;
  poolName: string; // e.g. "SOL / PEPE"
}

// ─── HELPERS ──────────────────────────────────────────────────
function isValidSolanaAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

function shortAddr(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function formatAmount(raw: bigint, decimals: number, dp = 4): string {
  if (raw === 0n) return '0';
  const divisor = BigInt(10 ** decimals);
  const whole   = raw / divisor;
  const frac    = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, dp);
  return `${whole}.${fracStr}`;
}

function formatSmallPrice(num: number): string {
  if (num === 0) return '0';
  if (num < 1e-18) return num.toExponential(4);
  const decimals = Math.min(18, Math.max(6, Math.ceil(-Math.log10(num)) + 2));
  return num.toFixed(decimals).replace(/\.?0+$/, '');
}

function toRaw(amount: string, decimals: number): bigint {
  if (!amount || isNaN(parseFloat(amount))) return 0n;
  try {
    const d = new Decimal(amount).mul(new Decimal(10).pow(decimals));
    return BigInt(d.toFixed(0));
  } catch {
    return 0n;
  }
}

async function fetchTokenMeta(mint: string, conn: Connection): Promise<TokenMeta | null> {
  if (mint === SOL_MINT) {
    return { mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, supply: 0n };
  }
  try {
    const info = await getMint(conn, new PublicKey(mint));
    return {
      mint,
      symbol: shortAddr(mint),
      name: `Token (${shortAddr(mint)})`,
      decimals: info.decimals,
      supply: info.supply,
    };
  } catch {
    return null;
  }
}

async function getTokenBalance(
  conn: Connection, wallet: PublicKey, mint: string, decimals: number
): Promise<{ formatted: string; raw: bigint }> {
  try {
    if (mint === SOL_MINT) {
      const bal = await conn.getBalance(wallet);
      return { formatted: (bal / LAMPORTS_PER_SOL).toFixed(4), raw: BigInt(bal) };
    }
    const ata  = await getAssociatedTokenAddress(new PublicKey(mint), wallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const info = await conn.getTokenAccountBalance(ata);
    return { formatted: info.value.uiAmountString ?? '0', raw: BigInt(info.value.amount) };
  } catch {
    return { formatted: '0', raw: 0n };
  }
}

function calcLpReceived(pool: PoolInfo, rawA: bigint, rawB: bigint): bigint {
  const MINIMUM_LIQUIDITY = 1000n;
  if (pool.lpSupply === 0n || pool.reserveA === 0n || pool.reserveB === 0n) {
    const product = rawA * rawB;
    const sqrt    = BigInt(Math.floor(Math.sqrt(Number(product))));
    return sqrt > MINIMUM_LIQUIDITY ? sqrt - MINIMUM_LIQUIDITY : 0n;
  }
  const lpFromA = (rawA * pool.lpSupply) / pool.reserveA;
  const lpFromB = (rawB * pool.lpSupply) / pool.reserveB;
  return lpFromA < lpFromB ? lpFromA : lpFromB;
}

function calcRemoveOutput(pool: PoolInfo, lpBurned: bigint): { outA: bigint; outB: bigint } {
  if (pool.lpSupply === 0n) return { outA: 0n, outB: 0n };
  return {
    outA: (lpBurned * pool.reserveA) / pool.lpSupply,
    outB: (lpBurned * pool.reserveB) / pool.lpSupply,
  };
}

async function scanWalletLpPools(
  connection: Connection,
  owner: PublicKey,
  network: NetworkMode
): Promise<DetectedLpPool[]> {
  try {
    const { CpmmPoolInfoLayout, DEVNET_PROGRAM_ID, CREATE_CPMM_POOL_PROGRAM } =
      await import('@raydium-io/raydium-sdk-v2');

    const CPMM_PROGRAM_MAINNET = CREATE_CPMM_POOL_PROGRAM.toBase58();
    const CPMM_PROGRAM_DEVNET  = DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM.toBase58();
    const CPMM_PROGRAM_ID      = network === 'devnet' ? CPMM_PROGRAM_DEVNET : CPMM_PROGRAM_MAINNET;

    // Helper: decode field name yang benar dari SDK (mintLp, bukan lpMint)
    const getLpMint = (state: any): string =>
      (state.mintLp ?? state.lpMint)?.toBase58?.() ?? '';

    // Step 1: Ambil semua token accounts wallet dengan balance > 0
    const allTokenAccounts = await connection.getParsedTokenAccountsByOwner(
      owner, { programId: TOKEN_PROGRAM_ID }
    );
    const candidates = allTokenAccounts.value.filter(({ account }) => {
      const amount = account.data.parsed?.info?.tokenAmount?.amount;
      return amount && BigInt(amount) > 0n;
    });
    if (candidates.length === 0) return [];

    const lpMintSet = new Set(candidates.map(c => c.account.data.parsed.info.mint as string));

    // Step 2: Batch fetch mint accounts untuk cek mintAuthority
    const mintPubkeys = candidates.map(({ account }) =>
      new PublicKey(account.data.parsed.info.mint)
    );
    const mintAccountInfos = await connection.getMultipleAccountsInfo(mintPubkeys);

    const validEntries: Array<{
      lpMint: string;
      rawAmount: bigint;
      poolId: PublicKey;
      poolData: Buffer;
    }> = [];

    // Step 3: Untuk setiap token, cek apakah mintAuthority-nya adalah pool CPMM
    // Layout SPL Mint: [36 bytes header] [4: hasAuthority flag] [5-36: authority pubkey]
    // Raydium CPMM: mintAuthority LP token = pool account address itu sendiri
    const authorityPubkeys: (PublicKey | null)[] = mintAccountInfos.map((info) => {
      if (!info || info.data.length < 82) return null;
      if (info.data[4] !== 1) return null; // no authority
      try { return new PublicKey(info.data.slice(5, 37)); }
      catch { return null; }
    });

    // Batch fetch semua authority accounts sekaligus
    const authorityKeys = authorityPubkeys.map(p => p ?? PublicKey.default);
    const authorityAccountInfos = await connection.getMultipleAccountsInfo(authorityKeys);

    for (let i = 0; i < candidates.length; i++) {
      const authPubkey = authorityPubkeys[i];
      const authAccount = authorityAccountInfos[i];
      if (!authPubkey || !authAccount) continue;

      const lpMintStr = candidates[i].account.data.parsed.info.mint as string;
      const rawAmount = BigInt(candidates[i].account.data.parsed.info.tokenAmount.amount);
      const ownerStr  = authAccount.owner.toBase58();
      const isCpmm    = ownerStr === CPMM_PROGRAM_MAINNET || ownerStr === CPMM_PROGRAM_DEVNET;

      if (!isCpmm || authAccount.data.length < 300) continue;

      try {
        const poolState = CpmmPoolInfoLayout.decode(authAccount.data) as any;
        if (getLpMint(poolState) === lpMintStr) {
          validEntries.push({
            lpMint: lpMintStr,
            rawAmount,
            poolId: authPubkey,
            poolData: Buffer.from(authAccount.data),
          });
        }
      } catch { /* not a valid CPMM pool */ }
    }

    // Step 4: Fallback — query program accounts dengan memcmp filter pada offset mintLp = 136
    // Hanya untuk token yang belum ditemukan di step 3
    const foundMints = new Set(validEntries.map(e => e.lpMint));
    const missing = candidates.filter(c =>
      !foundMints.has(c.account.data.parsed.info.mint as string)
    );

    if (missing.length > 0) {
      for (const candidate of missing) {
        const lpMintStr = candidate.account.data.parsed.info.mint as string;
        const rawAmount = BigInt(candidate.account.data.parsed.info.tokenAmount.amount);
        try {
          // Offset 136 = mintLp field dalam CpmmPoolInfoLayout
          // Layout: discriminator(8) + configId(32) + poolCreator(32) + vaultA(32) + vaultB(32) + mintLp(32)
          const pools = await connection.getProgramAccounts(
            new PublicKey(CPMM_PROGRAM_ID),
            {
              filters: [
                { memcmp: { offset: 136, bytes: lpMintStr } }
              ]
            }
          ).catch(() => []);

          if (pools.length > 0) {
            const p = pools[0];
            try {
              const poolState = CpmmPoolInfoLayout.decode(p.account.data) as any;
              if (getLpMint(poolState) === lpMintStr) {
                validEntries.push({
                  lpMint: lpMintStr,
                  rawAmount,
                  poolId: p.pubkey,
                  poolData: Buffer.from(p.account.data),
                });
              }
            } catch { /* skip */ }
          }
        } catch { /* skip */ }
      }
    }

    if (validEntries.length === 0) return [];

    // Step 5: Decode pool data dan ambil reserve info
    const results = await Promise.all(
      validEntries.map(async (entry): Promise<DetectedLpPool | null> => {
        try {
          const poolState = CpmmPoolInfoLayout.decode(entry.poolData) as any;
          const mintAStr: string = poolState.mintA?.toBase58?.() ?? '';
          const mintBStr: string = poolState.mintB?.toBase58?.() ?? '';
          if (!mintAStr || !mintBStr) return null;

          const [vaultA, vaultB, metaA, metaB] = await Promise.all([
            connection.getTokenAccountBalance(poolState.vaultA).catch(() => null),
            connection.getTokenAccountBalance(poolState.vaultB).catch(() => null),
            fetchTokenMeta(mintAStr, connection),
            fetchTokenMeta(mintBStr, connection),
          ]);

          if (!vaultA || !vaultB) return null;

          const reserveA    = BigInt(vaultA.value.amount);
          const reserveB    = BigInt(vaultB.value.amount);
          // SDK field: lpAmount (bukan lpSupply)
          const lpSupply    = BigInt(poolState.lpAmount?.toString() ?? '0');
          // SDK field: lpDecimals
          const lpDecimals  = Number(poolState.lpDecimals ?? 9);
          const sharePercent = lpSupply > 0n
            ? ((Number(entry.rawAmount) / Number(lpSupply)) * 100).toFixed(4)
            : '0';

          return {
            poolId:       entry.poolId.toBase58(),
            lpMint:       entry.lpMint,
            lpDecimals,
            lpBalanceRaw: entry.rawAmount,
            lpBalance:    formatAmount(entry.rawAmount, lpDecimals),
            mintA:        mintAStr,
            mintB:        mintBStr,
            symbolA:      metaA?.symbol ?? shortAddr(mintAStr),
            symbolB:      metaB?.symbol ?? shortAddr(mintBStr),
            decimalsA:    metaA?.decimals ?? 9,
            decimalsB:    metaB?.decimals ?? 9,
            reserveA,
            reserveB,
            lpSupply,
            tradeFeeRate: 2500,
            sharePercent,
            poolName: `${metaA?.symbol ?? shortAddr(mintAStr)} / ${metaB?.symbol ?? shortAddr(mintBStr)}`,
          };
        } catch { return null; }
      })
    );

    return results.filter((r): r is DetectedLpPool => r !== null);
  } catch (e) {
    console.error('scanWalletLpPools error:', e);
    return [];
  }
}

// ─── MAIN COMPONENT ───────────────────────────────────────────
export default function LiquidityPage() {
  const { connection }                            = useConnection();
  const { publicKey, sendTransaction, signTransaction, connected } = useWallet();

  const [network, setNetwork]       = useState<NetworkMode>('devnet');
  const [activeTab, setActiveTab]   = useState<PageTab>('add');
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [selectedDex, setSelectedDex] = useState<DexProvider>('raydium');
  const [isLoading, setIsLoading]   = useState(false);

  const activeConn = React.useMemo(() => network === 'devnet'
    ? new Connection(DEVNET_RPC,  'confirmed')
    : new Connection(MAINNET_RPC, 'confirmed'), [network]);

  // Token A
  const [mintAInput, setMintAInput] = useState(SOL_MINT);
  const [tokenA, setTokenA]         = useState<TokenMeta | null>({ mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9, supply: 0n });
  const [loadingA, setLoadingA]     = useState(false);
  const [errorA, setErrorA]         = useState('');
  const [balanceA, setBalanceA]     = useState('—');

  // Token B
  const [mintBInput, setMintBInput] = useState('');
  const [tokenB, setTokenB]         = useState<TokenMeta | null>(null);
  const [loadingB, setLoadingB]     = useState(false);
  const [errorB, setErrorB]         = useState('');
  const [balanceB, setBalanceB]     = useState('—');

  // Amounts
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [targetPriceUsd, setTargetPriceUsd] = useState('');
  const [solPrice, setSolPrice] = useState(150); // Default fallback

  // Fee config
  const [feeConfigIndex, setFeeConfigIndex] = useState(0);

  // Pool
  const [pool, setPool]               = useState<PoolInfo | null>(null);
  const [checkingPool, setCheckingPool] = useState(false);
  const [lpPreview, setLpPreview]     = useState('');

  // User position
  const [userPosition, setUserPosition]   = useState<UserPoolPosition | null>(null);
  const [removePercent, setRemovePercent] = useState(100);
  const [removePreview, setRemovePreview] = useState<{ outA: string; outB: string } | null>(null);

  // TX
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [txMsg, setTxMsg]       = useState('');
  const [txSig, setTxSig]       = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Remove Liquidity Overhaul States
  const [detectedPools, setDetectedPools] = useState<DetectedLpPool[]>([]);
  const [scanningPools, setScanningPools] = useState(false);
  const [selectedLpPool, setSelectedLpPool] = useState<DetectedLpPool | null>(null);

  const [feeEarned, setFeeEarned] = useState<{tokenA: string, tokenB: string} | null>(null);
  const [lockMonths, setLockMonths] = useState(0);
  const [lockInfo, setLockInfo] = useState<{
    lockedUntil: number;
    lockTx: string;
    lpAmount: string;
  } | null>(null);

  // Prefill state — set when "Tambah Liquidity" clicked from Remove tab
  const [prefillAddLiquidity, setPrefillAddLiquidity] = useState<{
    tokenBMint: string;
    poolId: string;
    poolName: string;
  } | null>(null);

  // Toast state
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const showToast = (msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    clearTimeout(toastTimerRef.current);
    setToast({ msg, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  };

  const isTxLoading    = ['building', 'signing', 'confirming'].includes(txStatus);
  const explorerSuffix = network === 'devnet' ? '?cluster=devnet' : '';

  const timerA = useRef<ReturnType<typeof setTimeout>>();
  const timerB = useRef<ReturnType<typeof setTimeout>>();
  const timerPool = useRef<ReturnType<typeof setTimeout>>();
  const timerPos = useRef<ReturnType<typeof setTimeout>>();
  const timerBal = useRef<ReturnType<typeof setTimeout>>();

  // Lookup Token A
  useEffect(() => {
    clearTimeout(timerA.current);
    const raw = mintAInput.trim();
    if (!raw) { setTokenA(null); setErrorA(''); return; }
    if (!isValidSolanaAddress(raw)) { setTokenA(null); setErrorA('Format address tidak valid'); return; }
    setLoadingA(true); setErrorA('');
    timerA.current = setTimeout(() => {
      fetchTokenMeta(raw, activeConn).then(meta => {
        setLoadingA(false);
        if (meta) { setTokenA(meta); setErrorA(''); }
        else { setTokenA(null); setErrorA('Token tidak ditemukan'); }
      });
    }, 400);
  }, [mintAInput, network, activeConn]);

  // Lookup Token B
  useEffect(() => {
    clearTimeout(timerB.current);
    const raw = mintBInput.trim();
    if (!raw) { setTokenB(null); setErrorB(''); setPool(null); return; }
    if (!isValidSolanaAddress(raw)) { setTokenB(null); setErrorB('Format address tidak valid'); return; }
    setLoadingB(true); setErrorB('');
    timerB.current = setTimeout(() => {
      fetchTokenMeta(raw, activeConn).then(meta => {
        setLoadingB(false);
        if (meta) { setTokenB(meta); setErrorB(''); }
        else { setTokenB(null); setErrorB('Token tidak ditemukan — pastikan mint address benar'); }
      });
    }, 400);
  }, [mintBInput, network, activeConn]);

  // Check pool existence
  useEffect(() => {
    clearTimeout(timerPool.current);
    if (!tokenA || !tokenB) { setPool(null); return; }
    
    setCheckingPool(true);
    timerPool.current = setTimeout(() => {
      const adapter = DEX_ADAPTERS[selectedDex];
      if (adapter && adapter.findPool) {
        adapter.findPool(activeConn, tokenA.mint, tokenB.mint, network).then(info => {
          setCheckingPool(false);
          setPool(info as any);
        }).catch(() => {
          setCheckingPool(false);
          setPool(null);
        });
      } else {
        setCheckingPool(false);
        setPool(null);
      }
    }, 500);
  }, [tokenA?.mint, tokenB?.mint, network, selectedDex, activeConn]);

  // Balances & SOL Price
  useEffect(() => {
    fetch('https://api.jup.ag/price/v2?ids=So11111111111111111111111111111111111111112')
      .then(res => res.json())
      .then(data => {
        const price = data?.data?.So11111111111111111111111111111111111111112?.price;
        if (price) setSolPrice(parseFloat(price));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    clearTimeout(timerBal.current);
    if (!publicKey) { setBalanceA('—'); setBalanceB('—'); return; }

    timerBal.current = setTimeout(() => {
      if (tokenA) {
        getTokenBalance(activeConn, publicKey, tokenA.mint, tokenA.decimals).then(r => setBalanceA(r.formatted));
      }
      if (tokenB) {
        getTokenBalance(activeConn, publicKey, tokenB.mint, tokenB.decimals).then(r => setBalanceB(r.formatted));
      }
    }, 700);
  }, [publicKey, tokenA?.mint, tokenB?.mint, network, txStatus, activeConn]);

  // LP preview
  useEffect(() => {
    if (!pool || !tokenA || !tokenB || !amountA || !amountB) { setLpPreview(''); return; }
    try {
      const lp = calcLpReceived(pool, toRaw(amountA, tokenA.decimals), toRaw(amountB, tokenB.decimals));
      setLpPreview(formatAmount(lp, pool.lpDecimals));
    } catch { setLpPreview(''); }
  }, [amountA, amountB, pool]);

  // User LP position
  useEffect(() => {
    clearTimeout(timerPos.current);
    if (!publicKey || !pool || activeTab === 'remove') {
      return;
    }
    
    timerPos.current = setTimeout(() => {
      const adapter = DEX_ADAPTERS[selectedDex];
      if (!adapter || !adapter.fetchPosition) { setUserPosition(null); return; }

      adapter.fetchPosition(activeConn, publicKey, pool as any).then(pos => {
        if (!pos) {
          setUserPosition(null);
          return;
        }
        
        // Format values if they are raw strings from adapter
        const formattedPos = { ...pos };
        if (tokenA && tokenB && pool.lpDecimals) {
          formattedPos.lpBalance = formatAmount(pos.lpBalanceRaw, pool.lpDecimals);
          formattedPos.valueA = formatAmount(BigInt(pos.valueA), tokenA.decimals);
          formattedPos.valueB = formatAmount(BigInt(pos.valueB), tokenB.decimals);
        }

        setUserPosition(formattedPos);

        // Calculate Fee Earned
        if (formattedPos && pool && tokenA && tokenB) {
          const feeRateDecimal = pool.tradeFeeRate / 1_000_000;
          const shareDecimal = parseFloat(formattedPos.sharePercent) / 100;
          const earnedA = (Number(pool.reserveA) * feeRateDecimal * shareDecimal);
          const earnedB = (Number(pool.reserveB) * feeRateDecimal * shareDecimal);
          
          setFeeEarned({
            tokenA: (earnedA / Math.pow(10, tokenA.decimals)).toFixed(6),
            tokenB: (earnedB / Math.pow(10, tokenB.decimals)).toFixed(6),
          });
        } else {
          setFeeEarned(null);
        }
      }).catch(() => {
        setUserPosition(null);
        setFeeEarned(null);
      });
    }, 600);
  }, [publicKey, pool, network, txStatus, selectedDex, activeConn, tokenA, tokenB]);

  // Auto-scan LP pools when switching to Remove tab
  useEffect(() => {
    if (activeTab === 'remove' && publicKey && connected) {
      setScanningPools(true);
      setSelectedLpPool(null);
      scanWalletLpPools(activeConn, publicKey, network)
        .then(pools => {
          setDetectedPools(pools);
          if (pools.length > 0) setSelectedLpPool(pools[0]);
        })
        .finally(() => setScanningPools(false));
    }
  }, [activeTab, publicKey, connected, network, activeConn]);

  // Consume prefill when Add tab becomes active
  useEffect(() => {
    if (activeTab === 'add' && prefillAddLiquidity) {
      setMintAInput(SOL_MINT);
      setMintBInput(prefillAddLiquidity.tokenBMint);
      setPrefillAddLiquidity(null);
    }
  }, [activeTab, prefillAddLiquidity]);

  // Sync selectedLpPool to existing states for compatibility
  useEffect(() => {
    if (selectedLpPool && activeTab === 'remove') {
      const p: PoolInfo = {
        exists: true,
        poolId: selectedLpPool.poolId,
        lpMint: selectedLpPool.lpMint,
        lpDecimals: selectedLpPool.lpDecimals,
        feeConfigIndex: 0,
        tradeFeeRate: selectedLpPool.tradeFeeRate,
        reserveA: selectedLpPool.reserveA,
        reserveB: selectedLpPool.reserveB,
        lpSupply: selectedLpPool.lpSupply,
      };
      setPool(p);
      setTokenA({
        mint: selectedLpPool.mintA,
        symbol: selectedLpPool.symbolA,
        name: selectedLpPool.symbolA,
        decimals: selectedLpPool.decimalsA,
        supply: 0n
      });
      setTokenB({
        mint: selectedLpPool.mintB,
        symbol: selectedLpPool.symbolB,
        name: selectedLpPool.symbolB,
        decimals: selectedLpPool.decimalsB,
        supply: 0n
      });
      
      const shareDecimal = parseFloat(selectedLpPool.sharePercent) / 100;
      
      const pos = {
        lpBalance: selectedLpPool.lpBalance,
        lpBalanceRaw: selectedLpPool.lpBalanceRaw,
        sharePercent: selectedLpPool.sharePercent,
        valueA: p.lpSupply > 0n ? formatAmount((selectedLpPool.lpBalanceRaw * p.reserveA) / p.lpSupply, selectedLpPool.decimalsA) : '0',
        valueB: p.lpSupply > 0n ? formatAmount((selectedLpPool.lpBalanceRaw * p.reserveB) / p.lpSupply, selectedLpPool.decimalsB) : '0',
      };
      setUserPosition(pos);

      // Calculate Fee Earned (Estimated)
      const feeRateDecimal = selectedLpPool.tradeFeeRate / 1_000_000;
      const earnedA = (Number(p.reserveA) * feeRateDecimal * shareDecimal);
      const earnedB = (Number(p.reserveB) * feeRateDecimal * shareDecimal);
      setFeeEarned({
        tokenA: (earnedA / Math.pow(10, selectedLpPool.decimalsA)).toFixed(6),
        tokenB: (earnedB / Math.pow(10, selectedLpPool.decimalsB)).toFixed(6),
      });
    }
  }, [selectedLpPool, activeTab]);

  // Remove preview
  useEffect(() => {
    if (!userPosition || !pool) { setRemovePreview(null); return; }
    const lpToBurn = (userPosition.lpBalanceRaw * BigInt(removePercent)) / 100n;
    const { outA, outB } = calcRemoveOutput(pool, lpToBurn);
    setRemovePreview({
      outA: tokenA ? formatAmount(outA, tokenA.decimals) : '—',
      outB: tokenB ? formatAmount(outB, tokenB.decimals) : '—',
    });
  }, [removePercent, userPosition, pool, tokenA, tokenB]);

  // ─── TX ERROR HANDLER ─────────────────────────────────────
  function handleTxError(err: unknown) {
    console.error('[Liquidity Error Full Object]', err);
    let friendly = 'Terjadi kesalahan tidak terduga.';
    
    if (err instanceof Error) {
      friendly = err.message;
    } else if (typeof err === 'string') {
      friendly = err;
    } else if (typeof err === 'object' && err !== null) {
      const anyErr = err as any;
      // Try to extract from various common Solana error structures
      friendly = anyErr.message || anyErr.reason || anyErr.error?.message || anyErr.err?.message || JSON.stringify(err);
      
      // Extract logs if available
      if (anyErr.logs && Array.isArray(anyErr.logs)) {
        console.log('[Transaction Logs]', anyErr.logs);
        const errorLog = anyErr.logs.find((l: string) => l.includes('Error:'));
        if (errorLog) {
          friendly = `Blockchain Error: ${errorLog.split('Error:')[1].trim()}`;
        } else {
          // Check for custom program errors in logs
          const customErr = anyErr.logs.find((l: string) => l.includes('custom program error:'));
          if (customErr) {
            const code = customErr.split('custom program error:')[1].trim();
            if (code === '0x11') friendly = 'Slippage Error: Harga berubah terlalu cepat.';
            else if (code === '0x1') friendly = 'Saldo tidak cukup untuk biaya transaksi.';
            else friendly = `Program Error: ${code}`;
          }
        }
      }
    }

    const lowerFriendly = friendly.toLowerCase();
    if (friendly.includes('403')) friendly = 'RPC error 403 — Gunakan RPC private.';
    else if (lowerFriendly.includes('insufficient') || lowerFriendly.includes('0x1')) {
      friendly = 'Saldo tidak cukup! Pastikan saldo SOL dan Token mencukupi.';
    }
    else if (friendly.includes('rejected')) friendly = 'Transaksi dibatalkan.';
    else if (friendly.includes('User rejected')) friendly = 'Transaksi ditolak di wallet.';
    else if (friendly.includes('0x1771')) friendly = 'Slippage Error (0x1771).';
    else if (lowerFriendly.includes('bounds')) friendly = 'Harga di luar jangkauan (Price out of bounds).';
    else if (lowerFriendly.includes('blockhash not found')) friendly = 'Blockhash kadaluarsa, silakan coba lagi.';
    else if (lowerFriendly.includes('too many requests')) friendly = 'RPC Rate Limit — Tunggu sebentar atau ganti RPC.';

    setErrorMsg(friendly);
    setTxStatus('error');
    setTxMsg('');
  }

  const handleAddLiquidity = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction) {
      setErrorMsg('Hubungkan wallet terlebih dahulu!');
      return;
    }
    setIsLoading(true);
    if (!tokenA) { setErrorMsg('Token A tidak valid!'); setIsLoading(false); return; }
    if (!tokenB) { setErrorMsg('Token B tidak valid!'); setIsLoading(false); return; }
    
    const valA = parseFloat(amountA);
    const valB = parseFloat(amountB);

    if (!amountA || isNaN(valA) || valA <= 0) { setErrorMsg('Masukkan jumlah Token A!'); setIsLoading(false); return; }
    if (!amountB || isNaN(valB) || valB <= 0) { setErrorMsg('Masukkan jumlah Token B!'); setIsLoading(false); return; }

    // Balance Check
    const balA = parseFloat(balanceA.replace('—', '0'));
    const balB = parseFloat(balanceB.replace('—', '0'));

    if (valA > balA) {
      setErrorMsg(`Saldo ${tokenA.symbol} tidak cukup! (Punya: ${balanceA})`);
      setIsLoading(false);
      return;
    }
    if (valB > balB) {
      setErrorMsg(`Saldo ${tokenB.symbol} tidak cukup! (Punya: ${balanceB})`);
      setIsLoading(false);
      return;
    }

    // Supply Check for Token B (prevent adding more than exists)
    if (tokenB.supply && tokenB.supply > 0n) {
      const rawB = toRaw(amountB, tokenB.decimals);
      if (rawB > tokenB.supply) {
        setErrorMsg(`Jumlah ${tokenB.symbol} melebihi total supply (${formatAmount(tokenB.supply, tokenB.decimals)})!`);
        setIsLoading(false);
        return;
      }
    }

    setErrorMsg(''); setTxStatus('building'); setTxSig('');

    try {
      const config = {
        connection: activeConn,
        publicKey,
        sendTransaction,
        signTransaction,
        tokenAMint: tokenA.mint,
        tokenBMint: tokenB.mint,
        tokenADecimals: tokenA.decimals,
        tokenBDecimals: tokenB.decimals,
        amountA,
        amountB,
        feeTierIndex: feeConfigIndex,
        network,
      };

      let result;
      if (pool && pool.exists) {
        setTxMsg(`Menambahkan likuiditas ke Raydium...`);
        result = await executeAddLiquidity(selectedDex, { ...config, poolId: pool.poolId });
      } else {
        setTxMsg(`Membuat pool baru di Raydium...`);
        result = await executeCreatePool(selectedDex, config);
      }

      setTxSig(result.signature);
      setTxStatus('success');
      setTxMsg('');
      setAmountA('');
      setAmountB('');
      showToast('Likuiditas berhasil ditambahkan!', 'success');

      // Lock Liquidity Logic
      if (lockMonths > 0 && pool) {
        try {
          const lockUntilMs = Date.now() + lockMonths * 30 * 24 * 60 * 60 * 1000;
          // Fetch LP balance yang baru diterima
          const lpAta = await getAssociatedTokenAddress(
            new PublicKey(pool.lpMint), publicKey!
          );
          const lpInfo = await activeConn.getTokenAccountBalance(lpAta);
          const lpRaw = BigInt(lpInfo.value.amount);
          
          setTxMsg('🔒 Mengunci LP token...');
          const adapter = DEX_ADAPTERS[selectedDex];
          if (adapter && adapter.lockLpTokens) {
            const lockSig = await adapter.lockLpTokens(
              activeConn, publicKey!, signTransaction!,
              pool.lpMint, lpRaw, lockUntilMs
            );
            setLockInfo({
              lockedUntil: lockUntilMs,
              lockTx: lockSig,
              lpAmount: lpInfo.value.uiAmountString || '0',
            });
          }
          setTxMsg('');
        } catch (e) {
          console.error('Lock LP error (non-fatal):', e);
          // Lock gagal tidak batalkan add liquidity
        }
      }
    } catch (err) {
      handleTxError(err);
    } finally {
      setIsLoading(false);
    }
  }, [connected, publicKey, signTransaction, tokenA, tokenB, amountA, amountB, pool, feeConfigIndex, network, selectedDex, activeConn, sendTransaction, lockMonths]);

  // ─── REMOVE LIQUIDITY ─────────────────────────────────────
  const handleRemoveLiquidity = useCallback(async () => {
    if (!connected || !publicKey || !signTransaction) {
      setErrorMsg('Hubungkan wallet terlebih dahulu!');
      return;
    }
    
    const targetPool = pool;
    const targetPos = userPosition;

    if (!targetPool || !targetPool.exists) { setErrorMsg('Pool tidak ditemukan!'); return; }
    if (!targetPos) { setErrorMsg('Kamu tidak punya LP token!'); return; }

    if (lockInfo && lockInfo.lockedUntil > Date.now()) {
      const unlockDate = new Date(lockInfo.lockedUntil)
        .toLocaleDateString('id-ID');
      setErrorMsg(`🔒 LP masih terkunci hingga ${unlockDate}!`);
      return;
    }

    const lpToBurn = (targetPos.lpBalanceRaw * BigInt(removePercent)) / 100n;
    if (lpToBurn <= 0n) { setErrorMsg('Jumlah LP token tidak valid!'); return; }

    setErrorMsg(''); setTxStatus('building'); setTxSig('');

    try {
      setTxMsg(`Menghapus likuiditas dari Raydium...`);
      
      const config = {
        connection: activeConn,
        publicKey,
        sendTransaction,
        signTransaction,
        tokenAMint: tokenA?.mint || '',
        tokenBMint: tokenB?.mint || '',
        tokenADecimals: tokenA?.decimals || 9,
        tokenBDecimals: tokenB?.decimals || 9,
        amountA: '0',
        amountB: '0',
        feeTierIndex: targetPool.feeConfigIndex || 0,
        network,
        poolId: targetPool.poolId || '',
        lpAmount: lpToBurn.toString()
      };

      const result = await executeRemoveLiquidity(selectedDex, config);
      setTxSig(result.signature);
      setTxStatus('success');
      setTxMsg('');
      showToast('Likuiditas berhasil dicabut!', 'success');
      // Refresh LP positions after successful remove
      if (publicKey && connected) {
        setScanningPools(true);
        scanWalletLpPools(activeConn, publicKey, network)
          .then(pools => { setDetectedPools(pools); setSelectedLpPool(pools[0] ?? null); })
          .finally(() => setScanningPools(false));
      }
    } catch (err) { handleTxError(err); showToast('Gagal mencabut likuiditas.', 'error'); }
  }, [connected, publicKey, signTransaction, pool, userPosition, removePercent, network, selectedDex, activeConn, sendTransaction, tokenA, tokenB, feeConfigIndex, selectedLpPool, lockInfo]);

  // ─── BIDIRECTIONAL LIQUIDITY CALCULATOR ─────────────────────
  const handleAmountAChange = (val: string) => {
    setAmountA(val);
    if (val && !isNaN(parseFloat(val)) && parseFloat(val) > 0) {
      if (targetPriceUsd && parseFloat(targetPriceUsd) > 0) {
        try {
          const sol = new Decimal(val);
          const priceUsd = new Decimal(targetPriceUsd);
          const neededToken = sol.mul(solPrice).div(priceUsd);
          setAmountB(neededToken.toFixed(0));
        } catch {}
      } else if (amountB && parseFloat(amountB) > 0) {
        // Calculate target price based on ratio
        const price = (parseFloat(val) * solPrice) / parseFloat(amountB);
        setTargetPriceUsd(price.toFixed(10).replace(/\.?0+$/, ''));
      }
    }
  };

  const handleAmountBChange = (val: string) => {
    setAmountB(val);
    if (val && !isNaN(parseFloat(val)) && parseFloat(val) > 0) {
      if (targetPriceUsd && parseFloat(targetPriceUsd) > 0) {
        try {
          const token = new Decimal(val);
          const priceUsd = new Decimal(targetPriceUsd);
          const neededSol = token.mul(priceUsd).div(solPrice);
          setAmountA(neededSol.toFixed(9).replace(/\.?0+$/, ''));
        } catch {}
      } else if (amountA && parseFloat(amountA) > 0) {
        // Calculate target price based on ratio
        const price = (parseFloat(amountA) * solPrice) / parseFloat(val);
        setTargetPriceUsd(price.toFixed(10).replace(/\.?0+$/, ''));
      }
    }
  };

  const handleTargetPriceChange = (val: string) => {
    const cleanVal = val.replace(',', '.');
    setTargetPriceUsd(cleanVal);
    if (cleanVal && !isNaN(parseFloat(cleanVal)) && parseFloat(cleanVal) > 0) {
      if (amountB && parseFloat(amountB) > 0) {
        try {
          const tokenBAmount = new Decimal(amountB);
          const tokenPriceInSol = new Decimal(cleanVal).div(solPrice);
          const totalSolRequired = tokenBAmount.mul(tokenPriceInSol);
          setAmountA(totalSolRequired.toFixed(9).replace(/\.?0+$/, ''));
        } catch {}
      } else if (amountA && parseFloat(amountA) > 0) {
        try {
          const solAmount = new Decimal(amountA);
          const priceUsd = new Decimal(cleanVal);
          const neededToken = solAmount.mul(solPrice).div(priceUsd);
          setAmountB(neededToken.toFixed(0));
        } catch {}
      }
    }
  };

  // ─── RENDER ───────────────────────────────────────────────
  const S = {
    card:    { background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: 16 } as React.CSSProperties,
    label:   { color: '#888', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '.06em' },
    input:   { width: '100%', boxSizing: 'border-box' as const, background: '#111', border: '1px solid #333', color: '#e8e8e8', padding: '10px 12px', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', outline: 'none' },
    amtInput:{ width: '100%', boxSizing: 'border-box' as const, background: '#0d0d0d', border: '1px solid #333', color: '#e8e8e8', padding: '10px 50px 10px 12px', borderRadius: 8, fontSize: 18, fontFamily: 'monospace', outline: 'none' },
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#e8e8e8', fontFamily: "'Inter', sans-serif" }}>
      <Header onSwapOpen={() => setIsSwapOpen(true)} />

      <div style={{ maxWidth: 840, margin: '0 auto', padding: '80px 20px 60px' }}>

        {/* Title + Network */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 'bold', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#f5a623' }}>💧</span> Liquidity Pool
              <span style={{ fontSize: 10, background: '#222', padding: '2px 6px', borderRadius: 4, color: '#666', fontWeight: 'normal' }}>v2.1</span>
            </h1>
            <p style={{ color: '#666', fontSize: 12, margin: '2px 0 0' }}>Raydium CPMM Manager • {network.toUpperCase()}</p>
          </div>
          <button
            onClick={() => setNetwork(n => n === 'devnet' ? 'mainnet' : 'devnet')}
            style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #333', background: '#1a1a1a', color: network === 'devnet' ? '#5cb85c' : '#f5a623', fontSize: 11, cursor: 'pointer', fontWeight: 'bold' }}
          >
            {network === 'devnet' ? '● DEVNET' : '● MAINNET'}
          </button>
        </div>

        {/* TAB BUTTONS */}
        <div style={{ display: 'flex', flexDirection: 'row', gap: '12px', marginBottom: '16px', position: 'relative', zIndex: 10 }}>
          <button
            onClick={() => { setActiveTab('add'); setErrorMsg(''); setTxStatus('idle'); setTxSig(''); }}
            style={{
              backgroundColor: activeTab === 'add' ? '#f59e0b' : 'transparent',
              color: activeTab === 'add' ? '#000' : '#f59e0b',
              border: '2px solid #f59e0b',
              borderRadius: '8px',
              padding: '8px 20px',
              fontWeight: '700',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'inline-block',
              minWidth: '140px'
            }}
          >
            Add Liquidity
          </button>

          <button
            onClick={() => { setActiveTab('remove'); setErrorMsg(''); setTxStatus('idle'); setTxSig(''); }}
            style={{
              backgroundColor: activeTab === 'remove' ? '#f59e0b' : 'transparent',
              color: activeTab === 'remove' ? '#000' : '#f59e0b',
              border: '2px solid #f59e0b',
              borderRadius: '8px',
              padding: '8px 20px',
              fontWeight: '700',
              fontSize: '14px',
              cursor: 'pointer',
              display: 'inline-block',
              minWidth: '140px'
            }}
          >
            Remove Liquidity
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {activeTab === 'add' ? (
              <>
                {/* Token A */}
                <div style={S.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <label style={S.label}>Token A (Base)</label>
                    {tokenA && publicKey && <span style={{ color: '#5cb85c', fontSize: 11 }}>Balance: {balanceA}</span>}
                  </div>
                  <input type="text" value={mintAInput} onChange={e => setMintAInput(e.target.value)}
                    placeholder="Mint address Token A (default: SOL)"
                    style={{ ...S.input, marginBottom: 12 }}
                  />
                  {tokenA && (
                    <div style={{ position: 'relative' }}>
                      <input type="number" value={amountA} onChange={e => handleAmountAChange(e.target.value)}
                        placeholder="0.00" style={S.amtInput} />
                      <button onClick={() => setAmountA(balanceA !== '—' ? balanceA : '')}
                        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#f5a623', fontSize: 11, cursor: 'pointer', fontWeight: 'bold' }}>
                        MAX
                      </button>
                    </div>
                  )}
                </div>

                {/* Token B */}
                <div style={S.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <label style={S.label}>Token B (Quote)</label>
                    {tokenB && publicKey && <span style={{ color: '#5cb85c', fontSize: 11 }}>Balance: {balanceB}</span>}
                  </div>
                  <input type="text" value={mintBInput} onChange={e => setMintBInput(e.target.value)}
                    placeholder="Paste mint address / CA token..."
                    style={{ ...S.input, marginBottom: 12 }}
                  />
                  {tokenB && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      <div style={{ position: 'relative' }}>
                        <input type="number" value={amountB} onChange={e => handleAmountBChange(e.target.value)}
                          placeholder="0.00" style={S.amtInput} />
                        <button onClick={() => setAmountB(balanceB !== '—' ? balanceB : '')}
                          style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#f5a623', fontSize: 11, cursor: 'pointer', fontWeight: 'bold' }}>
                          MAX
                        </button>
                      </div>
                      <div>
                        <label style={{ ...S.label, color: '#f59e0b', display: 'block', marginBottom: 6 }}>Target Price (USD)</label>
                        <input type="number" step="any" value={targetPriceUsd} onChange={e => handleTargetPriceChange(e.target.value)}
                          placeholder="0.00" style={S.amtInput} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Lock Duration Card - hanya tampil di tab add */}
                {activeTab === 'add' && (
                  <div style={S.card}>
                    <label style={{ ...S.label, display: 'block', marginBottom: 10 }}>
                      🔒 LOCK LIKUIDITAS
                    </label>
                    <div style={{ fontSize: 11, color: '#888', marginBottom: 12 }}>
                      LP token dikunci di escrow — tidak bisa dicabut sebelum waktu berakhir
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {[
                        { label: 'Fleksibel', months: 0 },
                        { label: '1 Bulan',   months: 1 },
                        { label: '3 Bulan',   months: 3 },
                        { label: '6 Bulan',   months: 6 },
                        { label: '1 Tahun',   months: 12 },
                        { label: '3 Tahun',   months: 36 },
                        { label: '5 Tahun',   months: 60 },
                      ].map(opt => (
                        <button
                          key={opt.months}
                          onClick={() => setLockMonths(opt.months)}
                          style={{
                            padding: '6px 14px',
                            borderRadius: 6,
                            border: lockMonths === opt.months ? 'none' : '1px solid #f59e0b',
                            background: lockMonths === opt.months ? '#f59e0b' : 'transparent',
                            color: lockMonths === opt.months ? '#000' : '#f59e0b',
                            fontSize: 11,
                            fontWeight: 'bold',
                            cursor: 'pointer',
                          }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {lockMonths > 0 && (
                      <div style={{ marginTop: 10, color: '#5cb85c', fontSize: 11 }}>
                        ✅ LP akan dikunci hingga:{' '}
                        {new Date(Date.now() + lockMonths * 30 * 24 * 60 * 60 * 1000)
                          .toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </div>
                    )}
                    {lockMonths === 0 && (
                      <div style={{ marginTop: 10, color: '#888', fontSize: 11 }}>
                        ⚠ Fleksibel — LP dapat dicabut kapan saja
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={S.card}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <label style={S.label}>DETECTED LP POSITIONS</label>
                    <button
                      onClick={() => {
                        if (!publicKey || !connected) return;
                        setScanningPools(true);
                        setSelectedLpPool(null);
                        scanWalletLpPools(activeConn, publicKey, network)
                          .then(pools => { setDetectedPools(pools); if (pools.length > 0) setSelectedLpPool(pools[0]); })
                          .finally(() => setScanningPools(false));
                      }}
                      disabled={scanningPools || !connected}
                      style={{ background: 'none', border: '1px solid #333', color: '#888', fontSize: 10, padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}
                    >
                      {scanningPools ? '...' : 'Refresh'}
                    </button>
                  </div>

                  {/* Skeleton loaders */}
                  {scanningPools ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {[1, 2].map(i => (
                        <div key={i} style={{ padding: 12, borderRadius: 8, background: '#111', border: '1px solid #222' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <div style={{ width: 120, height: 14, borderRadius: 4, background: '#222', animation: 'pulse 1.5s infinite' }} />
                            <div style={{ width: 60, height: 14, borderRadius: 4, background: '#222', animation: 'pulse 1.5s infinite' }} />
                          </div>
                          <div style={{ width: 160, height: 10, borderRadius: 4, background: '#1a1a1a', animation: 'pulse 1.5s infinite' }} />
                        </div>
                      ))}
                    </div>

                  /* Empty state */
                  ) : detectedPools.length === 0 ? (
                    <div style={{ padding: '32px 20px', textAlign: 'center' }}>
                      <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>💧</div>
                      <div style={{ color: '#888', fontSize: 13, marginBottom: 4 }}>Belum ada posisi likuiditas.</div>
                      <div style={{ color: '#555', fontSize: 11, marginBottom: 16 }}>Tambah likuiditas untuk memulai.</div>
                      <button
                        onClick={() => { setActiveTab('add'); setErrorMsg(''); setTxStatus('idle'); setTxSig(''); }}
                        style={{ padding: '8px 20px', borderRadius: 8, border: '2px solid #f59e0b', background: 'transparent', color: '#f59e0b', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Add Liquidity
                      </button>
                    </div>

                  /* Pool cards */
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {detectedPools.map(lp => (
                        <div
                          key={lp.poolId}
                          onClick={() => setSelectedLpPool(lp)}
                          style={{
                            padding: 12, borderRadius: 8,
                            background: selectedLpPool?.poolId === lp.poolId ? '#222' : '#111',
                            border: `1px solid ${selectedLpPool?.poolId === lp.poolId ? '#f59e0b' : '#333'}`,
                            cursor: 'pointer', transition: 'all 0.15s'
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontWeight: 'bold', color: '#e8e8e8', fontSize: 13 }}>{lp.poolName}</span>
                              <span style={{ fontSize: 9, color: '#888', background: '#1a1a1a', border: '1px solid #333', padding: '1px 5px', borderRadius: 4 }}>CPMM</span>
                            </div>
                            <span style={{ color: '#5cb85c', fontSize: 12, fontWeight: 'bold' }}>{lp.lpBalance} LP</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <button
                              onClick={e => { e.stopPropagation(); copyToClipboard(lp.poolId); showToast('Pool ID disalin!', 'info'); }}
                              style={{ background: 'none', border: 'none', color: '#555', fontSize: 10, cursor: 'pointer', padding: 0, fontFamily: 'monospace' }}
                            >
                              {shortAddr(lp.poolId)} ⎘
                            </button>
                            <span style={{ color: '#888', fontSize: 10 }}>Share: {lp.sharePercent}%</span>
                          </div>
                          {/* Estimated values */}
                          {lp.lpSupply > 0n && (
                            <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 10, color: '#666' }}>
                              <span>{lp.symbolA}: {formatAmount((lp.lpBalanceRaw * lp.reserveA) / lp.lpSupply, lp.decimalsA)}</span>
                              <span>{lp.symbolB}: {formatAmount((lp.lpBalanceRaw * lp.reserveB) / lp.lpSupply, lp.decimalsB)}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {selectedLpPool && (
                  <div style={S.card}>
                    <label style={{ ...S.label, display: 'block', marginBottom: 10 }}>JUMLAH PENARIKAN</label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        {[25, 50, 75, 100].map(p => (
                          <button key={p} onClick={() => setRemovePercent(p)}
                            style={{
                              flex: 1, padding: '8px', borderRadius: 6, cursor: 'pointer',
                              border: removePercent === p ? 'none' : '1px solid #f59e0b',
                              background: removePercent === p ? '#f59e0b' : 'transparent',
                              color: removePercent === p ? '#000' : '#f59e0b',
                              fontSize: 11, fontWeight: 'bold'
                            }}>
                            {p}%
                          </button>
                        ))}
                      </div>

                      <div style={{ position: 'relative' }}>
                        <input
                          type="text"
                          value={formatAmount((selectedLpPool.lpBalanceRaw * BigInt(removePercent)) / 100n, selectedLpPool.lpDecimals)}
                          readOnly
                          style={S.amtInput}
                        />
                        <button
                          onClick={() => setRemovePercent(100)}
                          style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#f5a623', fontSize: 11, cursor: 'pointer', fontWeight: 'bold' }}
                        >
                          MAX
                        </button>
                      </div>

                      {removePreview && (
                        <div style={{ background: '#0d0d0d', padding: '12px', borderRadius: 8, border: '1px solid #222' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                            <span style={{ color: '#888', fontSize: 12 }}>You will receive:</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                            <span>{selectedLpPool.symbolA}</span>
                            <span style={{ color: '#5cb85c' }}>+{removePreview.outA}</span>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                            <span>{selectedLpPool.symbolB}</span>
                            <span style={{ color: '#5cb85c' }}>+{removePreview.outB}</span>
                          </div>

                          {feeEarned && (
                            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #222' }}>
                              <div style={{ color: '#f59e0b', fontSize: 11, fontWeight: 'bold', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                📈 ESTIMATED EARNED FEES
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                                <span style={{ color: '#888' }}>{selectedLpPool.symbolA}:</span>
                                <span style={{ color: '#f59e0b' }}>+{feeEarned.tokenA}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                                <span style={{ color: '#888' }}>{selectedLpPool.symbolB}:</span>
                                <span style={{ color: '#f59e0b' }}>+{feeEarned.tokenB}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Status & Action */}
            {errorMsg && <div style={{ color: '#d9534f', fontSize: 12, marginBottom: 12 }}>⚠ {errorMsg}</div>}
            {txMsg && <div style={{ color: '#5b9bd5', fontSize: 12, marginBottom: 12 }}>⟳ {txMsg}</div>}

            {txStatus !== 'success' ? (
              activeTab === 'remove' && selectedLpPool ? (
                /* Two buttons side by side for Remove tab */
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={handleRemoveLiquidity}
                    disabled={!connected || isTxLoading}
                    style={{
                      flex: 1, padding: '14px', borderRadius: 12, border: 'none',
                      fontSize: 14, fontWeight: 'bold', cursor: isTxLoading || !connected ? 'not-allowed' : 'pointer',
                      background: isTxLoading || !connected ? '#222' : '#d9534f',
                      color: isTxLoading || !connected ? '#555' : '#fff',
                      transition: 'all 0.2s',
                    }}
                  >
                    {!connected ? 'Connect Wallet' : isTxLoading ? 'Processing...' : 'Cabut Liquidity'}
                  </button>
                  <button
                    onClick={() => {
                      if (!selectedLpPool) return;
                      setPrefillAddLiquidity({
                        tokenBMint: selectedLpPool.mintB,
                        poolId: selectedLpPool.poolId,
                        poolName: selectedLpPool.poolName,
                      });
                      setActiveTab('add');
                      setErrorMsg('');
                      setTxStatus('idle');
                      setTxSig('');
                    }}
                    disabled={isTxLoading}
                    style={{
                      flex: 1, padding: '14px', borderRadius: 12,
                      border: '2px solid #f59e0b', background: 'transparent',
                      fontSize: 14, fontWeight: 'bold', cursor: isTxLoading ? 'not-allowed' : 'pointer',
                      color: isTxLoading ? '#555' : '#f59e0b',
                      transition: 'all 0.2s',
                    }}
                  >
                    Tambah Liquidity
                  </button>
                </div>
              ) : (
                <button
                  onClick={activeTab === 'add' ? handleAddLiquidity : handleRemoveLiquidity}
                  disabled={!connected || isTxLoading}
                  style={{
                    width: '100%', padding: '16px', borderRadius: 12, border: 'none',
                    fontSize: 16, fontWeight: 'bold', cursor: 'pointer',
                    background: isTxLoading || !connected ? '#222' : '#f59e0b',
                    color: isTxLoading || !connected ? '#555' : '#000',
                    transition: 'all 0.2s',
                    boxShadow: !isTxLoading && connected ? `0 4px 20px rgba(245,158,11,0.2)` : 'none'
                  }}
                >
                  {!connected ? 'Connect Wallet' : isTxLoading ? 'Processing...' : activeTab === 'add' ? 'Add Liquidity' : 'Remove Liquidity'}
                </button>
              )
            ) : (
              <div style={{ background: '#0a1a0a', border: '1px solid #5cb85c', borderRadius: 12, padding: 20, textAlign: 'center' }}>
                <div style={{ color: '#5cb85c', fontWeight: 'bold', marginBottom: 10 }}>✅ Transaksi Berhasil!</div>
                <a href={`https://explorer.solana.com/tx/${txSig}${explorerSuffix}`} target="_blank" rel="noopener noreferrer" style={{ color: '#5b9bd5', fontSize: 12 }}>Lihat di Explorer</a>
                
                {lockInfo && (
                  <div style={{ marginTop: 12, padding: 10, background: '#0a1a0a',
                    border: '1px solid #5cb85c', borderRadius: 8 }}>
                    <div style={{ color: '#5cb85c', fontSize: 11, fontWeight: 'bold' }}>
                      🔒 LP Dikunci
                    </div>
                    <div style={{ color: '#888', fontSize: 10, marginTop: 4 }}>
                      Unlock: {new Date(lockInfo.lockedUntil)
                        .toLocaleDateString('id-ID', {
                          day: 'numeric', month: 'long', year: 'numeric'
                        })}
                    </div>
                    <a href={`https://explorer.solana.com/tx/${lockInfo.lockTx}?cluster=devnet`}
                      target="_blank" style={{ color: '#5b9bd5', fontSize: 10 }}>
                      Lihat Lock TX
                    </a>
                  </div>
                )}

                <button onClick={() => setTxStatus('idle')} style={{ display: 'block', width: '100%', marginTop: 10, background: 'none', border: 'none', color: '#555', cursor: 'pointer' }}>Kembali</button>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ ...S.card, fontSize: 11 }}>
              <div style={{ fontWeight: 'bold', marginBottom: 8 }}>ℹ Info DEX</div>
              <div style={{ color: '#888', lineHeight: 1.6 }}>
                <strong>Raydium:</strong> Standar AMM, biaya rendah. Cocok untuk token baru dan likuiditas luas.
              </div>
            </div>
            <div style={{ ...S.card, fontSize: 11, borderColor: userPosition ? '#5b9bd544' : '#2a2a2a' }}>
              <div style={{ fontWeight: 'bold', color: userPosition ? '#5b9bd5' : '#888', marginBottom: 12 }}>
                👤 Posisi Likuiditas Kamu
              </div>
              {!userPosition ? (
                <div style={{ color: '#555', fontSize: 10 }}>Masukkan Token B untuk melihat posisi kamu</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>LP Balance:</span>
                    <span style={{ color: '#5b9bd5' }}>{userPosition.lpBalance}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Share:</span>
                    <span style={{ color: '#5b9bd5' }}>{userPosition.sharePercent}%</span>
                  </div>
                  <div style={{ height: '1px', background: '#333', margin: '4px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Value {tokenA?.symbol}:</span>
                    <span>{userPosition.valueA}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Value {tokenB?.symbol}:</span>
                    <span>{userPosition.valueB}</span>
                  </div>

                  {feeEarned && (
                    <>
                      <div style={{ height: '1px', background: '#333', margin: '4px 0' }} />
                      <div style={{ color: '#f59e0b', fontSize: 10, fontWeight: 'bold', marginBottom: 4 }}>
                        📈 Estimasi Fee Earned
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Fee {tokenA?.symbol}:</span>
                        <span style={{ color: '#5cb85c' }}>+{feeEarned.tokenA}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Fee {tokenB?.symbol}:</span>
                        <span style={{ color: '#5cb85c' }}>+{feeEarned.tokenB}</span>
                      </div>
                      <div style={{ color: '#555', fontSize: 9, marginTop: 4 }}>
                        * Estimasi berdasarkan pool fee rate ({pool ? pool.tradeFeeRate / 10000 : 0}%)
                      </div>
                    </>
                  )}

                  <button
                    onClick={() => setActiveTab('remove')}
                    style={{ marginTop: 8, padding: '8px', borderRadius: 6, border: 'none', background: '#5b9bd5', color: '#1a1a1a', fontWeight: 'bold', cursor: 'pointer' }}
                  >
                    🔴 Cabut Liquidity
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {isSwapOpen && <SwapModal token={null} onClose={() => setIsSwapOpen(false)} />}

      {/* Toast notification */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          padding: '12px 18px', borderRadius: 10, fontSize: 13, fontWeight: 'bold',
          background: toast.type === 'success' ? '#0a1a0a' : toast.type === 'error' ? '#1a0a0a' : '#0a0a1a',
          border: `1px solid ${toast.type === 'success' ? '#5cb85c' : toast.type === 'error' ? '#d9534f' : '#5b9bd5'}`,
          color: toast.type === 'success' ? '#5cb85c' : toast.type === 'error' ? '#d9534f' : '#5b9bd5',
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          maxWidth: 320,
        }}>
          {toast.type === 'success' ? '✓ ' : toast.type === 'error' ? '✕ ' : 'i '}{toast.msg}
        </div>
      )}

      {/* Pulse animation for skeleton */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
      `}</style>
    </div>
  );
}
