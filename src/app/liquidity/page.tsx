// placeholder
'use client';
/**
 * LIQUIDITY PAGE — CPMM Raydium SDK v2 (0.2.45-alpha)
 * Add Liquidity + Remove Liquidity + Pool Stats + User Position
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
  getAccount,
} from '@solana/spl-token';
import {
  Raydium,
  CpmmPoolInfoLayout,
  CREATE_CPMM_POOL_FEE_ACC,
  CREATE_CPMM_POOL_PROGRAM,
  DEVNET_PROGRAM_ID,
  getCpmmPdaAmmConfigId,
  getCpmmPdaPoolId,
  Percent,
} from '@raydium-io/raydium-sdk-v2';
import type { DexProvider } from '../../lib/dex';
import { DEX_ADAPTERS } from '../../lib/dex';
import BN from 'bn.js';
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

// ─── HELPERS ──────────────────────────────────────────────────
function isValidSolanaAddress(s: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

function shortAddr(s: string): string {
  return s.length > 12 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

function formatAmount(raw: bigint, decimals: number, dp = 4): string {
  if (raw === 0n) return '0';
  const divisor = BigInt(10 ** decimals);
  const whole   = raw / divisor;
  const frac    = raw % divisor;
  const fracStr = frac.toString().padStart(decimals, '0').slice(0, dp);
  return `${whole}.${fracStr}`;
}

// Helper untuk menampilkan harga sangat kecil (bisa sampai 18 desimal)
function formatSmallPrice(num: number): string {
  if (num === 0) return '0';
  if (num < 1e-18) return num.toExponential(4);
  const decimals = Math.min(18, Math.max(6, Math.ceil(-Math.log10(num)) + 2));
  return num.toFixed(decimals).replace(/\.?0+$/, '');
}

// Gemini-recommended precise calculation function
function calculatePoolAmounts(tokenBAmountStr: string, targetPriceUsdStr: string, solPriceUsd: number = 150) {
  try {
    const tokenBAmount = new Decimal(tokenBAmountStr);
    const tokenPriceInSol = new Decimal(targetPriceUsdStr).div(solPriceUsd);
    const totalSolRequired = tokenBAmount.mul(tokenPriceInSol);

    // Always return clean decimal strings (no scientific notation)
    return {
      solAmount: totalSolRequired.toFixed(9),
      tokenBAmount: tokenBAmount.toFixed(9),
    };
  } catch (err) {
    console.error("Gagal menghitung rasio pool:", err);
    return null;
  }
}

function toRaw(amount: string, decimals: number): bigint {
  if (!amount || isNaN(parseFloat(amount))) return 0n;

  // Handle scientific notation (e.g. 1.5e-7)
  const num = parseFloat(amount);
  if (num < 1e-10) {
    // Use Decimal-like precision for very small numbers
    const [base, exp] = amount.toLowerCase().split('e');
    if (exp) {
      const decimalPlaces = Math.abs(parseInt(exp));
      const clean = base.replace('.', '');
      const padded = clean.padEnd(clean.length + decimalPlaces, '0');
      return BigInt(padded);
    }
  }

  const [intPart, fracPart = ''] = amount.split('.');
  const fracs = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(intPart || '0') * BigInt(10 ** decimals) + BigInt(fracs || '0');
}

async function fetchTokenMeta(mint: string, conn: Connection): Promise<TokenMeta | null> {
  if (mint === SOL_MINT) {
    return { mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9 };
  }

  try {
    const info = await getMint(conn, new PublicKey(mint));
    return {
      mint,
      symbol: shortAddr(mint),
      name: `Token (${shortAddr(mint)})`,
      decimals: info.decimals,
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

async function initRaydium(conn: Connection, owner: PublicKey, network: NetworkMode): Promise<Raydium> {
  return Raydium.load({
    connection:          conn,
    owner,
    cluster:             network === 'devnet' ? 'devnet' : 'mainnet',
    disableFeatureCheck: true,
    blockhashCommitment: 'confirmed',
  });
}

async function findCpmmPool(
  conn: Connection, mintA: string, mintB: string, network: NetworkMode
): Promise<PoolInfo | null> {
  const programId = network === 'devnet'
    ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
    : CREATE_CPMM_POOL_PROGRAM;

  for (const cfg of CPMM_FEE_CONFIGS) {
    for (const [mA, mB] of [[mintA, mintB], [mintB, mintA]]) {
      try {
        const configPda = getCpmmPdaAmmConfigId(programId, cfg.index);
        const poolPda   = getCpmmPdaPoolId(
          programId,
          configPda.publicKey,
          new PublicKey(mA),
          new PublicKey(mB)
        );
        const accountInfo = await conn.getAccountInfo(poolPda.publicKey);
        if (!accountInfo) continue;

        const poolState = CpmmPoolInfoLayout.decode(accountInfo.data);

        // Ambil reserve dari vault token accounts
        let reserveA = 0n;
        let reserveB = 0n;
        try {
          const vaultAInfo = await conn.getTokenAccountBalance(poolState.vaultA);
          const vaultBInfo = await conn.getTokenAccountBalance(poolState.vaultB);
          reserveA = BigInt(vaultAInfo.value.amount);
          reserveB = BigInt(vaultBInfo.value.amount);
        } catch { /* vault fetch gagal, gunakan 0 */ }

        return {
          exists:         true,
          poolId:         poolPda.publicKey.toString(),
          lpMint:         poolState.mintLp.toString(),
          lpDecimals:     poolState.lpDecimals,
          feeConfigIndex: cfg.index,
          tradeFeeRate:   cfg.tradeFeeRate,
          reserveA,
          reserveB,
          lpSupply:       BigInt(poolState.lpAmount?.toString() ?? '0'),
        };
      } catch { continue; }
    }
  }
  return null;
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

// ─── MAIN COMPONENT ───────────────────────────────────────────
export default function LiquidityPage() {
  const { connection }                            = useConnection();
  const { publicKey, sendTransaction, signTransaction, connected } = useWallet();

  const [network, setNetwork]       = useState<NetworkMode>('devnet');
  const [tab, setTab]               = useState<PageTab>('add');
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [selectedDex, setSelectedDex] = useState<DexProvider>('raydium');
  const [isLoading, setIsLoading]   = useState(false);

  const activeConn = network === 'devnet'
    ? new Connection(DEVNET_RPC,  'confirmed')
    : new Connection(MAINNET_RPC, 'confirmed');

  // Token A
  const [mintAInput, setMintAInput] = useState(SOL_MINT);
  const [tokenA, setTokenA]         = useState<TokenMeta | null>({ mint: SOL_MINT, symbol: 'SOL', name: 'Solana', decimals: 9 });
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

  const isTxLoading    = ['building', 'signing', 'confirming'].includes(txStatus);
  const explorerSuffix = network === 'devnet' ? '?cluster=devnet' : '';

  const timerA = useRef<ReturnType<typeof setTimeout>>();
  const timerB = useRef<ReturnType<typeof setTimeout>>();

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
  }, [mintAInput, network]);

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
  }, [mintBInput, network]);

  // Check pool
  useEffect(() => {
    if (!tokenA || !tokenB) { setPool(null); return; }
    setCheckingPool(true);
    findCpmmPool(activeConn, tokenA.mint, tokenB.mint, network).then(info => {
      setCheckingPool(false);
      setPool(info);
    });
  }, [tokenA?.mint, tokenB?.mint, network]);

  // Balances
  useEffect(() => {
    if (!publicKey || !tokenA) { setBalanceA('—'); return; }
    getTokenBalance(activeConn, publicKey, tokenA.mint, tokenA.decimals).then(r => setBalanceA(r.formatted));
  }, [publicKey, tokenA?.mint, network, txStatus]);

  useEffect(() => {
    if (!publicKey || !tokenB) { setBalanceB('—'); return; }
    getTokenBalance(activeConn, publicKey, tokenB.mint, tokenB.decimals).then(r => setBalanceB(r.formatted));
  }, [publicKey, tokenB?.mint, network, txStatus]);

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
    if (!publicKey || !pool) { setUserPosition(null); return; }
    (async () => {
      try {
        const lpAta     = await getAssociatedTokenAddress(new PublicKey(pool.lpMint), publicKey);
        const lpAccount = await getAccount(activeConn, lpAta).catch(() => null);
        if (!lpAccount) { setUserPosition(null); return; }
        const raw    = BigInt(lpAccount.amount.toString());
        const share  = pool.lpSupply > 0n ? ((Number(raw) / Number(pool.lpSupply)) * 100).toFixed(4) : '0';
        const { outA, outB } = calcRemoveOutput(pool, raw);
        setUserPosition({
          lpBalance:    formatAmount(raw, pool.lpDecimals),
          lpBalanceRaw: raw,
          sharePercent: share,
          valueA:       tokenA ? formatAmount(outA, tokenA.decimals) : '—',
          valueB:       tokenB ? formatAmount(outB, tokenB.decimals) : '—',
        });
      } catch { setUserPosition(null); }
    })();
  }, [publicKey, pool, network, txStatus]);

  // Remove preview
  useEffect(() => {
    if (!userPosition || !pool) { setRemovePreview(null); return; }
    const lpToBurn = (userPosition.lpBalanceRaw * BigInt(removePercent)) / 100n;
    const { outA, outB } = calcRemoveOutput(pool, lpToBurn);
    setRemovePreview({
      outA: tokenA ? formatAmount(outA, tokenA.decimals) : '—',
      outB: tokenB ? formatAmount(outB, tokenB.decimals) : '—',
    });
  }, [removePercent, userPosition, pool]);

  // ─── TX ERROR HANDLER ─────────────────────────────────────
  function handleTxError(err: unknown) {
    // Log full error ke console untuk debugging
    console.error('[Liquidity Error]', err);

    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? (err.stack ?? '') : '';

    let friendly = msg;

    if (msg.includes('403') || msg.includes('Access forbidden'))
      friendly = 'RPC error 403 — Set NEXT_PUBLIC_DEVNET_RPC_URL di .env.local (gunakan Helius/Alchemy).';
    else if (msg.includes('insufficient') || msg.includes('Insufficient'))
      friendly = 'Saldo tidak cukup — butuh SOL untuk rent (~0.2–0.4 SOL untuk pool baru) + gas fee.';
    else if (msg.includes('User rejected') || msg.includes('rejected'))
      friendly = 'Transaksi dibatalkan oleh user.';
    else if (msg.includes('already in use'))
      friendly = 'Pool sudah exist untuk pair ini.';
    else if (msg.includes('0x1'))
      friendly = 'Program error 0x1 — cek saldo token dan validitas mint address.';
    else if (msg.includes('0x') && msg.match(/0x[0-9a-f]+/i))
      friendly = `Program error: ${msg.match(/0x[0-9a-f]+/i)?.[0]} — lihat console untuk detail.`;
    else if (msg.toLowerCase().includes('simulation'))
      friendly = `Simulasi transaksi gagal: ${msg}`;
    else if (msg === 'Unexpected error' || msg.includes('Unexpected error'))
      friendly = `Error tidak dikenal — lihat browser console (F12) untuk detail lengkap. Raw: ${stack.split('\n')[1] ?? msg}`;

    setErrorMsg(friendly);
    setTxStatus('error');
    setTxMsg('');
  }

  // ─── SEND TX HELPER — handle versioned + legacy + array ──
  async function sendTx(tx: Transaction | VersionedTransaction | (Transaction | VersionedTransaction)[]): Promise<string> {
    if (Array.isArray(tx)) {
      let lastSig = '';
      for (const t of tx) {
        lastSig = await sendTx(t);
        // Konfirmasi setiap tx sebelum kirim tx berikutnya (penting untuk array)
        const { blockhash: bh, lastValidBlockHeight: lvbh } = await activeConn.getLatestBlockhash('confirmed');
        await activeConn.confirmTransaction({ signature: lastSig, blockhash: bh, lastValidBlockHeight: lvbh }, 'confirmed');
      }
      return lastSig;
    }

    // Robust detection untuk VersionedTransaction dari Raydium SDK
    // (instanceof tidak reliable karena bundling SDK)
    const isVersionedTx = 
      (tx as any).version !== undefined || 
      ((tx as any).message && (tx as any).message.header);

    if (isVersionedTx) {
      // VersionedTransaction path — harus pakai signTransaction, bukan sendTransaction
      if (!signTransaction) {
        throw new Error('Wallet tidak mendukung signTransaction. Gunakan Phantom atau Solflare.');
      }
      console.log('[sendTx] Detected VersionedTransaction via duck-typing, menggunakan signTransaction...');
      const signedTx = await signTransaction(tx as VersionedTransaction);
      const sig = await activeConn.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries:    3,
      });
      console.log('[sendTx] VersionedTransaction sent, sig:', sig);
      return sig;
    }

    // Legacy Transaction path
    console.log('[sendTx] Detected Legacy Transaction, menggunakan sendTransaction...');
    const legacyTx = tx as Transaction;
    const { blockhash } = await activeConn.getLatestBlockhash('confirmed');
    legacyTx.recentBlockhash = blockhash;
    legacyTx.feePayer        = publicKey!;
    const sig = await sendTransaction(legacyTx, activeConn);
    console.log('[sendTx] Legacy Transaction sent, sig:', sig);
    return sig;
  }

  // ─── BIDIRECTIONAL LIQUIDITY CALCULATOR ─────────────────────
  const handleAmountAChange = (val: string) => {
    setAmountA(val);
    const sol = parseFloat(val);
    const token = parseFloat(amountB);
    const target = parseFloat(targetPriceUsd);

    if (sol > 0 && token > 0) {
      const priceSol = sol / token;
      const priceUsd = priceSol * 150;
      setTargetPriceUsd(priceUsd < 1e-6 ? priceUsd.toExponential(6) : priceUsd.toFixed(8));
    } else if (sol > 0 && target > 0) {
      const priceSol = target / 150;
      const neededToken = sol / priceSol;
      setAmountB(neededToken.toFixed(0));
    }
  };

  const handleAmountBChange = (val: string) => {
    setAmountB(val);
    const token = parseFloat(val);
    const sol = parseFloat(amountA);
    const target = parseFloat(targetPriceUsd);

    if (token > 0 && sol > 0) {
      const priceSol = sol / token;
      const priceUsd = priceSol * 150;
      setTargetPriceUsd(priceUsd < 1e-6 ? priceUsd.toExponential(6) : priceUsd.toFixed(8));
    } else if (token > 0 && target > 0) {
      const priceSol = target / 150;
      const neededSol = token * priceSol;
      setAmountA(neededSol.toFixed(4));
    }
  };

  const handleTargetPriceChange = (val: string) => {
    // Bersihkan koma menjadi titik (karena Decimal tidak terima koma)
    const cleanVal = val.replace(',', '.');
    setTargetPriceUsd(cleanVal);

    if (!cleanVal || !amountB) return;

    try {
      const tokenBAmount = new Decimal(amountB);
      const tokenPriceInSol = new Decimal(cleanVal).div(150);
      const totalSolRequired = tokenBAmount.mul(tokenPriceInSol);

      const cleanSolAmount = totalSolRequired.toFixed(9);
      setAmountA(cleanSolAmount);
    } catch (err) {
      console.error("Gagal menghitung SOL dari target harga:", err);
    }
  };

  // ─── ADD LIQUIDITY ────────────────────────────────────────
  const handleAddLiquidity = useCallback(async () => {
    if (!connected || !publicKey) { setErrorMsg('Hubungkan wallet terlebih dahulu!'); return; }
    setIsLoading(true);
    if (!tokenA) { setErrorMsg('Token A tidak valid!'); return; }
    if (!tokenB) { setErrorMsg('Token B tidak valid! Paste CA token di kolom Token B.'); return; }
    if (!amountA || parseFloat(amountA) <= 0) { setErrorMsg('Masukkan jumlah Token A!'); return; }
    if (!amountB || parseFloat(amountB) <= 0) { setErrorMsg('Masukkan jumlah Token B!'); return; }

    setErrorMsg(''); setTxStatus('building'); setTxSig('');

    try {
      const raydium = await initRaydium(activeConn, publicKey, network);
      // Use precise calculation from Gemini recommendation
      // Gunakan Decimal untuk konversi ke raw amount (9 decimals)
      const decimalA = new Decimal(amountA || '0');
      const decimalB = new Decimal(amountB || '0');

      const rawA = BigInt(decimalA.mul(new Decimal(10).pow(tokenA.decimals)).toFixed(0));
      const rawB = BigInt(decimalB.mul(new Decimal(10).pow(tokenB.decimals)).toFixed(0));

      console.log('[CreatePool] Final values before Raydium:', {
        amountA,
        amountB,
        targetPriceUsd,
        rawA: rawA.toString(),
        rawB: rawB.toString(),
      });

      if (rawA === 0n || rawB === 0n) {
        alert('Jumlah token terlalu kecil. Naikkan jumlahnya.');
        setIsLoading(false);
        return;
      }

      // Validasi minimum pool size (Raydium CPMM biasanya butuh minimal ~1 SOL)
      const solAmountNum = parseFloat(amountA);
      if (solAmountNum < 1) {
        alert('Minimum 1 SOL diperlukan untuk membuat pool baru di Raydium CPMM.');
        setIsLoading(false);
        return;
      }

      const bnA = new BN(rawA.toString());
      const bnB = new BN(rawB.toString());

      let tx: Transaction | VersionedTransaction;

      if (pool && pool.exists) {
        setTxMsg('Menghitung optimal liquidity ratio...');
        console.log('[AddLiquidity] fetching pool info from RPC:', pool.poolId);
        let poolInfoFull;
        try {
          poolInfoFull = await raydium.cpmm.getPoolInfoFromRpc(pool.poolId);
        } catch (rpcErr) {
          console.warn('[AddLiquidity] getPoolInfoFromRpc failed, trying fetchPoolById...', rpcErr);
          // Fallback: fetch via API
          const pools = await raydium.api.fetchPoolById({ ids: pool.poolId });
          if (!pools || pools.length === 0) throw new Error('Pool tidak ditemukan via API. Coba refresh halaman.');
          poolInfoFull = { poolInfo: pools[0] as any, poolKeys: undefined };
        }
        console.log('[AddLiquidity] pool info fetched, building tx...');
        const result = await raydium.cpmm.addLiquidity({
          poolInfo:            poolInfoFull.poolInfo,
          poolKeys:            poolInfoFull.poolKeys,
          inputAmount:         bnA,
          slippage:            new Percent(1, 100),
          baseIn:              true,
          computeBudgetConfig: { units: 600000, microLamports: 100000 },
        });
        // SDK v2 bisa return transaction (single) atau transactions (array)
        const txToSend = (result as any).transactions ?? (result as any).transaction;
        console.log('[AddLiquidity] addLiquidity tx built, type:', Array.isArray(txToSend) ? `array[${txToSend.length}]` : (txToSend instanceof VersionedTransaction ? 'versioned' : 'legacy'));

        setTxStatus('signing');
        setTxMsg('Menunggu tanda tangan wallet...');
        const sig = await sendTx(txToSend);

        setTxStatus('confirming');
        setTxMsg('Menunggu konfirmasi blockchain...');
        const { blockhash: bh, lastValidBlockHeight: lvbh } = await activeConn.getLatestBlockhash('confirmed');
        await activeConn.confirmTransaction({ signature: sig, blockhash: bh, lastValidBlockHeight: lvbh }, 'confirmed');

        setTxSig(sig);
        setTxStatus('success');
        setTxMsg('');
        setAmountA(''); setAmountB('');
        return;
      } else {
        setTxMsg('Menyiapkan pool baru (CPMM)...');
        console.log('[AddLiquidity] creating new pool...');
        const programId = network === 'devnet'
          ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
          : CREATE_CPMM_POOL_PROGRAM;
        const feeConfig = CPMM_FEE_CONFIGS[feeConfigIndex];
        const configPda = getCpmmPdaAmmConfigId(programId, feeConfig.index);

        const result = await raydium.cpmm.createPool({
          programId,
          poolFeeAccount: CREATE_CPMM_POOL_FEE_ACC,
          mintA: { address: tokenA.mint, decimals: tokenA.decimals, programId: TOKEN_PROGRAM_ID.toString() },
          mintB: { address: tokenB.mint, decimals: tokenB.decimals, programId: TOKEN_PROGRAM_ID.toString() },
          mintAAmount:  bnA,
          mintBAmount:  bnB,
          startTime:    new BN(0),
          feeConfig: {
            id:              configPda.publicKey.toString(),
            index:           feeConfig.index,
            protocolFeeRate: 120000,
            tradeFeeRate:    feeConfig.tradeFeeRate,
            fundFeeRate:     40000,
            createPoolFee:   '150000000',
            creatorFeeRate:  0,
          },
          associatedOnly:      false,
          ownerInfo:           { useSOLBalance: tokenA.mint === SOL_MINT || tokenB.mint === SOL_MINT },
          computeBudgetConfig: { units: 600000, microLamports: 100000 },
        });
        const txToSend = (result as any).transactions ?? (result as any).transaction;
        console.log('[AddLiquidity] tx built, type:', Array.isArray(txToSend) ? `array[${txToSend.length}]` : (txToSend instanceof VersionedTransaction ? 'versioned' : 'legacy'));

        setTxStatus('signing');
        setTxMsg('Menunggu tanda tangan wallet...');
        const sig = await sendTx(txToSend);

        setTxStatus('confirming');
        setTxMsg('Menunggu konfirmasi blockchain...');
        const { blockhash: bh2, lastValidBlockHeight: lvbh2 } = await activeConn.getLatestBlockhash('confirmed');
        await activeConn.confirmTransaction({ signature: sig, blockhash: bh2, lastValidBlockHeight: lvbh2 }, 'confirmed');

        setTxSig(sig);
        setTxStatus('success');
        setTxMsg('');
        setAmountA(''); setAmountB('');
      }

    } catch (err) { 
      handleTxError(err); 
    } finally {
      setIsLoading(false);
    }
  }, [connected, publicKey, tokenA, tokenB, amountA, amountB, pool, feeConfigIndex, network]);

  // ─── REMOVE LIQUIDITY ─────────────────────────────────────
  const handleRemoveLiquidity = useCallback(async () => {
    if (!connected || !publicKey) { setErrorMsg('Hubungkan wallet terlebih dahulu!'); return; }
    if (!pool?.exists)            { setErrorMsg('Pool tidak ditemukan!'); return; }
    if (!userPosition)            { setErrorMsg('Kamu tidak punya LP token di pool ini!'); return; }

    const lpToBurn = (userPosition.lpBalanceRaw * BigInt(removePercent)) / 100n;
    if (lpToBurn <= 0n) { setErrorMsg('Jumlah LP token tidak valid!'); return; }

    setErrorMsg(''); setTxStatus('building'); setTxSig('');

    try {
      setTxMsg('Menyiapkan transaksi remove liquidity...');
      const raydium      = await initRaydium(activeConn, publicKey, network);
      console.log('[RemoveLiquidity] fetching pool info:', pool.poolId);
      let poolInfoFull;
      try {
        poolInfoFull = await raydium.cpmm.getPoolInfoFromRpc(pool.poolId);
      } catch (rpcErr) {
        console.warn('[RemoveLiquidity] getPoolInfoFromRpc failed, trying API...', rpcErr);
        const pools = await raydium.api.fetchPoolById({ ids: pool.poolId });
        if (!pools || pools.length === 0) throw new Error('Pool tidak ditemukan. Coba refresh halaman.');
        poolInfoFull = { poolInfo: pools[0] as any, poolKeys: undefined };
      }

      const result = await raydium.cpmm.withdrawLiquidity({
        poolInfo:            poolInfoFull.poolInfo,
        poolKeys:            poolInfoFull.poolKeys,
        lpAmount:            new BN(lpToBurn.toString()),
        slippage:            new Percent(1, 100),
        computeBudgetConfig: { units: 400000, microLamports: 100000 },
      });

      setTxStatus('signing');
      setTxMsg('Menunggu tanda tangan wallet...');
      const sig = await sendTx(result.transaction);

      setTxStatus('confirming');
      setTxMsg('Menunggu konfirmasi blockchain...');
      const { blockhash, lastValidBlockHeight } = await activeConn.getLatestBlockhash('confirmed');
      await activeConn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

      setTxSig(sig);
      setTxStatus('success');
      setTxMsg('');
    } catch (err) { handleTxError(err); }
  }, [connected, publicKey, pool, userPosition, removePercent, network]);

  // ─── RENDER ───────────────────────────────────────────────
  const S = {
    card:    { background: '#1e1e1e', border: '1px solid #2a2a2a', borderRadius: 12, padding: 18 } as React.CSSProperties,
    label:   { color: '#888', fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '.06em' },
    input:   { width: '100%', boxSizing: 'border-box' as const, background: '#111', border: '1px solid #444', color: '#e8e8e8', padding: '10px 12px', borderRadius: 8, fontSize: 12, fontFamily: 'monospace', outline: 'none' },
    amtInput:{ width: '100%', boxSizing: 'border-box' as const, background: '#0d0d0d', border: '1px solid #444', color: '#e8e8e8', padding: '10px 50px 10px 12px', borderRadius: 8, fontSize: 18, fontFamily: 'monospace', outline: 'none' },
  };

  return (
    <div style={{ minHeight: '100vh', background: '#1a1a1a', color: '#e8e8e8', fontFamily: "'Trebuchet MS', Verdana, sans-serif" }}>
      <Header onSwapOpen={() => setIsSwapOpen(true)} />

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '100px 20px 60px' }}>

        {/* Title + Network */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 'bold', margin: 0 }}>
              💧 Liquidity Pool
              <span style={{ color: '#f5a623', fontSize: 13, marginLeft: 10 }}>
                ({network === 'devnet' ? 'Devnet' : 'Mainnet'})
              </span>
            </h1>
            <p style={{ color: '#555', fontSize: 12, margin: '4px 0 0' }}>CPMM · Powered by Raydium SDK v2</p>
          </div>
          <button
            onClick={() => setNetwork(n => n === 'devnet' ? 'mainnet' : 'devnet')}
            style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #444', background: network === 'devnet' ? '#1a2a1a' : '#2a1a0a', color: network === 'devnet' ? '#5cb85c' : '#f5a623', fontSize: 12, cursor: 'pointer', fontWeight: 'bold' }}
          >
            {network === 'devnet' ? '🌿 DEVNET' : '🌐 MAINNET'}
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 24, background: '#111', borderRadius: 10, padding: 4 }}>
          {(['add', 'remove'] as PageTab[]).map(t => (
            <button key={t}
              onClick={() => { setTab(t); setErrorMsg(''); setTxStatus('idle'); setTxSig(''); }}
              style={{
                flex: 1, padding: '10px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: tab === t
                  ? t === 'add' ? 'linear-gradient(135deg,#f5a623,#d4891c)' : 'linear-gradient(135deg,#5b9bd5,#3a7bc8)'
                  : 'transparent',
                color: tab === t ? '#1a1a1a' : '#555',
                fontWeight: 'bold', fontSize: 13, transition: 'all 0.2s',
              }}
            >
              {t === 'add' ? '➕ Add Liquidity' : '➖ Remove Liquidity'}
            </button>
          ))}
        </div>

        {/* DEX Selector */}
        {tab === 'add' && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Pilih DEX Protocol
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(Object.values(DEX_ADAPTERS) as any[]).map((adapter) => {
                const available = adapter.isAvailable(network);
                return (
                  <button
                    key={adapter.name}
                    onClick={() => available && setSelectedDex(adapter.name)}
                    disabled={!available}
                    title={!available ? `${adapter.label} tidak tersedia di ${network}` : adapter.description}
                    style={{
                      flex: 1, padding: '10px 8px', borderRadius: 8, cursor: available ? 'pointer' : 'not-allowed',
                      border: selectedDex === adapter.name ? '1px solid #f5a623' : '1px solid #333',
                      background: selectedDex === adapter.name ? '#2a1a0a' : '#111',
                      color: !available ? '#444' : selectedDex === adapter.name ? '#f5a623' : '#888',
                      fontSize: 11, fontWeight: 'bold', transition: 'all .2s',
                    }}
                  >
                    <div>{adapter.label}</div>
                    <div style={{ fontSize: 9, fontWeight: 'normal', marginTop: 2 }}>
                      {available ? adapter.description.split('—')[0] : 'Mainnet only'}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20 }}>

          {/* ── MAIN PANEL ── */}
          <div>

            {/* Token A */}
            <div style={{ ...S.card, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={S.label}>Token A</label>
                {tokenA && publicKey && <span style={{ color: '#5cb85c', fontSize: 11, fontFamily: 'monospace' }}>Balance: {balanceA} {tokenA.symbol}</span>}
              </div>
              <input type="text" value={mintAInput} onChange={e => setMintAInput(e.target.value)}
                placeholder="Mint address Token A (default: SOL)"
                style={{ ...S.input, borderColor: errorA ? '#d9534f' : tokenA ? '#5cb85c44' : '#444' }}
              />
              {tokenA && !errorA && <div style={{ color: '#5cb85c', fontSize: 11, marginTop: 4 }}>✓ {tokenA.name} ({tokenA.symbol}) · {tokenA.decimals} decimals</div>}
              {errorA && <div style={{ color: '#d9534f', fontSize: 11, marginTop: 4 }}>⚠ {errorA}</div>}
              {loadingA && <div style={{ color: '#555', fontSize: 11, marginTop: 4 }}>⟳ Mencari token...</div>}
              {tab === 'add' && tokenA && (
                <div style={{ position: 'relative', marginTop: 10 }}>
                  <input type="number" value={amountA} onChange={e => handleAmountAChange(e.target.value)}
                    placeholder="0.00" min="0" style={S.amtInput} />
                  <button onClick={() => setAmountA(balanceA !== '—' ? balanceA : '')}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#f5a623', fontSize: 10, cursor: 'pointer', fontWeight: 'bold' }}>
                    MAX
                  </button>
                </div>
              )}
            </div>

            {/* Divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1, height: 1, background: '#2a2a2a' }} />
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#1a1a1a', border: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 14 }}>+</div>
              <div style={{ flex: 1, height: 1, background: '#2a2a2a' }} />
            </div>

            {/* Token B */}
            <div style={{ ...S.card, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={S.label}>Token B — Paste CA</label>
                {tokenB && publicKey && <span style={{ color: '#5cb85c', fontSize: 11, fontFamily: 'monospace' }}>Balance: {balanceB} {tokenB.symbol}</span>}
              </div>
              <div style={{ position: 'relative' }}>
                <input type="text" value={mintBInput} onChange={e => setMintBInput(e.target.value)}
                  placeholder="Paste mint address / CA token kamu..."
                  style={{ ...S.input, borderColor: errorB ? '#d9534f' : tokenB ? '#5cb85c44' : '#444', paddingRight: 60 }}
                />
                <button
                  onClick={async () => { try { setMintBInput((await navigator.clipboard.readText()).trim()); } catch {} }}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: '#0a1a2a', border: '1px solid #5b9bd544', color: '#5b9bd5', padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 10, fontWeight: 'bold' }}
                >PASTE</button>
              </div>
              {loadingB && <div style={{ color: '#555', fontSize: 11, marginTop: 4 }}>⟳ Mencari token...</div>}
              {tokenB && !errorB && <div style={{ color: '#5cb85c', fontSize: 11, marginTop: 4 }}>✓ {tokenB.name} ({tokenB.symbol}) · {tokenB.decimals} decimals</div>}
              {errorB && <div style={{ color: '#d9534f', fontSize: 11, marginTop: 4 }}>⚠ {errorB}</div>}
              {!mintBInput && (
                <div style={{ marginTop: 6, padding: '8px 10px', background: '#1a1a0a', border: '1px solid #f5a62322', borderRadius: 6, color: '#777', fontSize: 11 }}>
                  💡 Buat token di <strong style={{ color: '#f5a623' }}>Create Token</strong>, copy mint address-nya, paste di sini
                </div>
              )}
              {tab === 'add' && tokenB && (
                <div style={{ position: 'relative', marginTop: 10 }}>
                  <input type="number" value={amountB} onChange={e => handleAmountBChange(e.target.value)}
                    placeholder="0.00" min="0" style={S.amtInput} />
                  <button onClick={() => setAmountB(balanceB !== '—' ? balanceB : '')}
                    style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#f5a623', fontSize: 10, cursor: 'pointer', fontWeight: 'bold' }}>
                    MAX
                  </button>
                </div>
              )}

              {/* Target Harga Awal (Bidirectional Calculator) */}
              {tab === 'add' && tokenB && (
                <div style={{ marginTop: 14 }}>
                  <label style={{ ...S.label, color: '#f59e0b' }}>Target Harga Awal (USD)</label>
                  <input
                    type="number"
                    step="any"
                    value={targetPriceUsd}
                    onChange={e => handleTargetPriceChange(e.target.value)}
                    placeholder="0.00"
                    style={{ ...S.amtInput, borderColor: '#f59e0b44' }}
                  />
                  <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                    Sistem akan otomatis menghitung balik jumlah SOL / Token B
                  </div>
                </div>
              )}
            </div>

            {/* Pool status */}
            {tokenA && tokenB && (
              <div style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 11,
                background: checkingPool ? '#111' : pool ? '#0a1a0a' : '#1a1500',
                border: `1px solid ${checkingPool ? '#333' : pool ? '#5cb85c44' : '#f5a62344'}`,
                color: checkingPool ? '#555' : pool ? '#5cb85c' : '#f5a623',
              }}>
                {checkingPool
                  ? '⟳ Mengecek pool di Raydium CPMM...'
                  : pool
                    ? `✓ Pool ditemukan (${shortAddr(pool.poolId)}) · Fee: ${CPMM_FEE_CONFIGS.find(c => c.index === pool.feeConfigIndex)?.label ?? '—'}`
                    : '⚡ Pool belum ada → akan membuat pool baru CPMM'}
              </div>
            )}

            {/* Fee tier — hanya saat buat pool baru */}
            {tab === 'add' && tokenA && tokenB && !pool && !checkingPool && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ ...S.label, display: 'block', marginBottom: 8 }}>Fee Tier Pool</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
                  {CPMM_FEE_CONFIGS.map(cfg => (
                    <button key={cfg.index} onClick={() => setFeeConfigIndex(cfg.index)}
                      style={{
                        padding: '10px 6px', borderRadius: 8, cursor: 'pointer', textAlign: 'center',
                        border: `1px solid ${feeConfigIndex === cfg.index ? '#f5a623' : '#333'}`,
                        background: feeConfigIndex === cfg.index ? '#2a1a00' : '#111',
                        color: feeConfigIndex === cfg.index ? '#f5a623' : '#666',
                      }}>
                      <div style={{ fontSize: 15, fontWeight: 'bold' }}>{cfg.label}</div>
                      <div style={{ fontSize: 10, marginTop: 2 }}>{cfg.description}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Price preview */}
            {tab === 'add' && tokenA && tokenB && amountA && amountB && parseFloat(amountA) > 0 && parseFloat(amountB) > 0 && (
              <div style={{ padding: '8px 14px', background: '#0a0a1a', border: '1px solid #5b9bd522', borderRadius: 8, marginBottom: 14, fontSize: 11 }}>
                <div style={{ color: '#666', marginBottom: 2 }}>📊 Preview harga initial pool:</div>
                <span style={{ color: '#5b9bd5', fontFamily: 'monospace' }}>
                  1 {tokenA.symbol} = {formatSmallPrice(parseFloat(amountB) / parseFloat(amountA))} {tokenB.symbol}
                </span>
                {lpPreview && <span style={{ color: '#888', marginLeft: 16 }}>LP diterima: ~{lpPreview} LP</span>}
              </div>
            )}

            {/* Remove slider */}
            {tab === 'remove' && (
              <div style={{ ...S.card, marginBottom: 16 }}>
                {userPosition ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ color: '#888', fontSize: 11, textTransform: 'uppercase' }}>LP Token Kamu</span>
                      <span style={{ color: '#5b9bd5', fontSize: 12, fontFamily: 'monospace', fontWeight: 'bold' }}>{userPosition.lpBalance} LP</span>
                    </div>
                    <div style={{ color: '#666', fontSize: 11, marginBottom: 14 }}>
                      Share pool: {userPosition.sharePercent}%
                    </div>
                    <label style={{ ...S.label, display: 'block', marginBottom: 8 }}>
                      Remove: <strong style={{ color: '#e8e8e8' }}>{removePercent}%</strong>
                    </label>
                    <input type="range" min={1} max={100} value={removePercent}
                      onChange={e => setRemovePercent(Number(e.target.value))}
                      style={{ width: '100%', marginBottom: 10, accentColor: '#5b9bd5' }}
                    />
                    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                      {[25, 50, 75, 100].map(p => (
                        <button key={p} onClick={() => setRemovePercent(p)}
                          style={{ flex: 1, padding: '6px', borderRadius: 6, border: `1px solid ${removePercent === p ? '#5b9bd5' : '#333'}`, background: removePercent === p ? '#0a1a2a' : '#111', color: removePercent === p ? '#5b9bd5' : '#555', fontSize: 11, cursor: 'pointer' }}>
                          {p}%
                        </button>
                      ))}
                    </div>
                    {removePreview && (
                      <div style={{ padding: '10px 12px', background: '#0a1a0a', border: '1px solid #5cb85c22', borderRadius: 8, fontSize: 11 }}>
                        <div style={{ color: '#666', marginBottom: 4 }}>📤 Estimasi yang diterima:</div>
                        <div style={{ color: '#5cb85c', fontFamily: 'monospace' }}>
                          {removePreview.outA} {tokenA?.symbol ?? '—'}
                          <span style={{ color: '#444', margin: '0 8px' }}>+</span>
                          {removePreview.outB} {tokenB?.symbol ?? '—'}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ textAlign: 'center', color: '#555', padding: '20px 0', fontSize: 13 }}>
                    {!publicKey ? '🔌 Connect wallet untuk melihat posisi LP kamu'
                      : !pool ? '⚠ Pilih token pair yang valid terlebih dahulu'
                      : '💧 Kamu belum punya LP token di pool ini'}
                  </div>
                )}
              </div>
            )}

            {/* Error / status */}
            {/* Error message display removed as per request */}
            {txMsg && !errorMsg && (
              <div style={{ background: '#0a1a2a', border: '1px solid #5b9bd544', borderRadius: 8, padding: '10px 14px', marginBottom: 12, color: '#5b9bd5', fontSize: 12 }}>
                ⟳ {txMsg}
              </div>
            )}

            {/* Submit button */}
            {txStatus !== 'success' && (
              <button
                onClick={tab === 'add' ? handleAddLiquidity : handleRemoveLiquidity}
                disabled={!connected || isTxLoading
                  || (tab === 'add' && (!tokenA || !tokenB || !amountA || !amountB))
                  || (tab === 'remove' && (!pool || !userPosition))}
                style={{
                  width: '100%', padding: '14px', borderRadius: 10, border: 'none',
                  fontSize: 15, fontWeight: 'bold', cursor: 'pointer', transition: 'all 0.2s',
                  background: isTxLoading || !connected ? '#1a1a1a'
                    : tab === 'add' ? 'linear-gradient(135deg,#f5a623,#d4891c)'
                    : 'linear-gradient(135deg,#5b9bd5,#3a7bc8)',
                  color: (isTxLoading || !connected) ? '#444' : '#1a1a1a',
                  boxShadow: (!isTxLoading && connected)
                    ? tab === 'add' ? '0 4px 16px rgba(245,166,35,.25)' : '0 4px 16px rgba(91,155,213,.25)'
                    : 'none',
                }}
              >
                {!connected ? '🔌 Connect Wallet'
                  : isTxLoading ? `⟳ ${txMsg || 'Memproses...'}`
                  : tab === 'add'
                    ? pool ? '💧 Add Liquidity ke Pool' : '🆕 Buat Pool Baru + Add Liquidity'
                    : `🔴 Remove ${removePercent}% Liquidity`}
              </button>
            )}

            {/* Success */}
            {txStatus === 'success' && txSig && (
              <div style={{ background: '#0a1a0a', border: '1px solid #5cb85c', borderRadius: 12, padding: 20 }}>
                <div style={{ fontSize: 17, fontWeight: 'bold', color: '#5cb85c', marginBottom: 8 }}>
                  {tab === 'add' ? '✅ Liquidity berhasil ditambahkan!' : '✅ Liquidity berhasil di-remove!'}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#666', wordBreak: 'break-all', background: '#111', padding: 8, borderRadius: 6, marginBottom: 12 }}>
                  {txSig}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <a href={`https://explorer.solana.com/tx/${txSig}${explorerSuffix}`} target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '8px', background: '#0a2a0a', border: '1px solid #5cb85c44', borderRadius: 8, color: '#5cb85c', textDecoration: 'none', fontSize: 12 }}>
                    🔍 Explorer
                  </a>
                  <a href={`https://solscan.io/tx/${txSig}${explorerSuffix}`} target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, textAlign: 'center', padding: '8px', background: '#0a1a2a', border: '1px solid #5b9bd544', borderRadius: 8, color: '#5b9bd5', textDecoration: 'none', fontSize: 12 }}>
                    📊 Solscan
                  </a>
                </div>
                <button onClick={() => { setTxStatus('idle'); setTxSig(''); }}
                  style={{ width: '100%', marginTop: 10, background: 'none', border: 'none', color: '#555', fontSize: 12, cursor: 'pointer' }}>
                  ← Kembali
                </button>
              </div>
            )}
          </div>

          {/* ── SIDEBAR ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Pool Stats */}
            {pool && tokenA && tokenB && (
              <div style={{ background: '#1a2a1a', border: '1px solid #5cb85c22', borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 10, color: '#5cb85c' }}>📊 Pool Stats</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
                  <div style={{ color: '#666' }}>Reserve {tokenA.symbol}</div>
                  <div style={{ color: '#e8e8e8', textAlign: 'right', fontFamily: 'monospace' }}>{formatAmount(pool.reserveA, tokenA.decimals)}</div>
                  <div style={{ color: '#666' }}>Reserve {tokenB.symbol}</div>
                  <div style={{ color: '#e8e8e8', textAlign: 'right', fontFamily: 'monospace' }}>{formatAmount(pool.reserveB, tokenB.decimals)}</div>
                  <div style={{ color: '#666' }}>Trade Fee</div>
                  <div style={{ color: '#f5a623', textAlign: 'right' }}>{CPMM_FEE_CONFIGS.find(c => c.index === pool.feeConfigIndex)?.label ?? '—'}</div>
                  <div style={{ color: '#666' }}>LP Supply</div>
                  <div style={{ color: '#e8e8e8', textAlign: 'right', fontFamily: 'monospace', fontSize: 10 }}>{formatAmount(pool.lpSupply, pool.lpDecimals)}</div>
                </div>
              </div>
            )}

            {/* User Position */}
            {userPosition && tokenA && tokenB && (
              <div style={{ background: '#1a1a2a', border: '1px solid #5b9bd533', borderRadius: 12, padding: 16 }}>
                <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 10, color: '#5b9bd5' }}>👤 Posisi Kamu</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11 }}>
                  <div style={{ color: '#666' }}>LP Token</div>
                  <div style={{ color: '#e8e8e8', textAlign: 'right', fontFamily: 'monospace' }}>{userPosition.lpBalance}</div>
                  <div style={{ color: '#666' }}>Pool Share</div>
                  <div style={{ color: '#f5a623', textAlign: 'right' }}>{userPosition.sharePercent}%</div>
                  <div style={{ color: '#666' }}>{tokenA.symbol} (est.)</div>
                  <div style={{ color: '#5cb85c', textAlign: 'right', fontFamily: 'monospace' }}>{userPosition.valueA}</div>
                  <div style={{ color: '#666' }}>{tokenB.symbol} (est.)</div>
                  <div style={{ color: '#5cb85c', textAlign: 'right', fontFamily: 'monospace' }}>{userPosition.valueB}</div>
                </div>
              </div>
            )}

            {/* How To */}
            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 'bold', fontSize: 12, marginBottom: 8, color: '#888' }}>ℹ Cara Penggunaan</div>
              <ol style={{ color: '#666', fontSize: 11, paddingLeft: 16, margin: 0, lineHeight: 2 }}>
                <li>Buat token di <strong style={{ color: '#f5a623' }}>Create Token</strong></li>
                <li>Copy mint address token</li>
                <li>Paste di kolom <strong style={{ color: '#e8e8e8' }}>Token B</strong></li>
                <li>Set jumlah SOL + token</li>
                <li>Pilih fee tier (0.25% default)</li>
                <li>Klik <strong style={{ color: '#f5a623' }}>Buat Pool + Add Liquidity</strong></li>
              </ol>
            </div>

            {/* Risk */}
            <div style={{ background: '#2a1500', border: '1px solid #d2992222', borderRadius: 12, padding: 16 }}>
              <div style={{ color: '#d29922', fontSize: 11, fontWeight: 'bold', marginBottom: 8 }}>⚠ Risk</div>
              <ul style={{ color: '#666', fontSize: 10, paddingLeft: 14, margin: 0, lineHeight: 1.9 }}>
                <li><strong style={{ color: '#e8e8e8' }}>Impermanent Loss</strong> — nilai LP bisa lebih kecil dari hold</li>
                <li>Pool baru butuh <strong style={{ color: '#f5a623' }}>~0.2–0.4 SOL</strong> untuk rent</li>
                <li>Initial price ditentukan oleh rasio kamu</li>
                <li>Test Devnet dulu sebelum Mainnet</li>
              </ul>
            </div>

            {/* Links */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <a href="https://faucet.solana.com" target="_blank" rel="noopener noreferrer"
                style={{ padding: '8px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#555', textDecoration: 'none', fontSize: 10, textAlign: 'center' }}>
                🚿 Solana Devnet Faucet ↗
              </a>
              <a href="https://docs.raydium.io" target="_blank" rel="noopener noreferrer"
                style={{ padding: '8px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#555', textDecoration: 'none', fontSize: 10, textAlign: 'center' }}>
                📖 Raydium Docs ↗
              </a>
            </div>
          </div>
        </div>
      </div>

      {isSwapOpen && <SwapModal token={null} onClose={() => setIsSwapOpen(false)} />}
    </div>
  );
}
