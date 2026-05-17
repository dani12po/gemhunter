'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { VersionedTransaction, PublicKey } from '@solana/web3.js';
import { PLATFORM_FEE_BPS, PLATFORM_FEE_WALLET } from '../../lib/constants';
import type { TokenData } from '../../lib/types';
import { TokenSelectorModal } from './TokenSelectorModal';

// API
const QUOTE_API = 'https://api.jup.ag/swap/v1/quote';
const SWAP_API  = 'https://api.jup.ag/swap/v1/swap';
const API_KEY   = process.env.NEXT_PUBLIC_JUPITER_API_KEY || '';

// Token with logo & name
interface Token {
  symbol:   string;
  mint:     string;
  decimals: number;
  name:     string;
  logoURI?: string;
}

const TOKENS: Token[] = [
  { symbol: 'SOL',  mint: 'So11111111111111111111111111111111111111112',  decimals: 9,  name: 'Solana',   logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png' },
  { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6,  name: 'USD Coin', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  decimals: 6,  name: 'Tether USD', logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5,  name: 'Bonk',       logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  { symbol: 'JUP',  mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  decimals: 6,  name: 'Jupiter',    logoURI: 'https://static.jup.ag/jup/icon.png' },
  { symbol: 'RAY',  mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6,  name: 'Raydium',    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png' },
];

interface QuoteResponse {
  inputMint: string; inAmount: string; outputMint: string; outAmount: string;
  otherAmountThreshold: string; swapMode: string; slippageBps: number;
  priceImpactPct: string; routePlan: any[]; contextSlot?: number; timeTaken?: number;
}

interface ToastMsg { id: number; msg: string; type: 'success'|'error'|'info'; }
interface TxRecord { sig: string; from: string; to: string; amt: string; time: string; }

function fmt(raw: string | number, decimals: number): string {
  const n = typeof raw === 'string' ? parseInt(raw) : raw;
  if (isNaN(n)) return '—';
  return (n / Math.pow(10, decimals)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function toRaw(amount: string, decimals: number): string {
  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0) return '';
  return Math.floor(n * Math.pow(10, decimals)).toString();
}

interface SwapUIProps {
  initialToToken?: TokenData;
}

const SwapUI: React.FC<SwapUIProps> = ({ initialToToken }) => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  // Initial TO token from prop (from TokenCard)
  const initialTo: Token = initialToToken
    ? {
        symbol: initialToToken.simbol || '???',
        mint: initialToToken.address,
        decimals: 6,
        name: initialToToken.nama || initialToToken.simbol || 'Unknown',
        logoURI: initialToToken.imageUrl || '',
      }
    : TOKENS[1];

  // States
  const [fromToken, setFromToken] = useState<Token>(TOKENS[0]);
  const [toToken, setToToken] = useState<Token>(initialTo);
  const [amount, setAmount] = useState('');

  const [slippage, setSlippage] = useState(50);
  const [customSlip, setCustomSlip] = useState('');
  const [showCustomSlip, setShowCustomSlip] = useState(false);
  const [slippageMode, setSlippageMode] = useState<'auto' | 'manual'>('auto');

  const [quote, setQuote] = useState<QuoteResponse | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [loadingSilent, setLoadingSilent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [swapping, setSwapping] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [txList, setTxList] = useState<TxRecord[]>([]);
  const [showTx, setShowTx] = useState(false);
  const [countdown, setCountdown] = useState(30);

  // Balances
  const [fromBalance, setFromBalance] = useState('—');
  const [toBalance, setToBalance] = useState('—');
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});

  // Modals
  const [showFromSelector, setShowFromSelector] = useState(false);
  const [showToSelector, setShowToSelector] = useState(false);

  // Refs
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const refreshRef = useRef<NodeJS.Timeout | null>(null);
  const toastIdRef = useRef(0);

  const addToast = useCallback((msg: string, type: ToastMsg['type'] = 'info') => {
    const id = ++toastIdRef.current;
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4000);
  }, []);

  // Fetch single balance
  const fetchSingleBalance = useCallback(async (token: Token, setter: (v: string) => void) => {
    if (!publicKey || !connection) { setter('—'); return; }
    try {
      if (token.symbol === 'SOL') {
        const lam = await connection.getBalance(publicKey);
        setter(fmt(lam, 9));
      } else {
        const accs = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(token.mint) });
        if (accs.value.length) {
          const amt = accs.value[0].account.data.parsed.info.tokenAmount;
          setter(fmt(amt.amount, parseInt(amt.decimals)));
        } else setter('0');
      }
    } catch { setter('—'); }
  }, [publicKey, connection]);

  // Fetch all balances for modal
  const fetchAllBalances = useCallback(async () => {
    if (!publicKey || !connection) return;
    const bals: Record<string, string> = {};
    for (const t of TOKENS) {
      try {
        if (t.symbol === 'SOL') {
          const lam = await connection.getBalance(publicKey);
          bals[t.mint] = fmt(lam, 9);
        } else {
          const accs = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(t.mint) });
          if (accs.value.length) {
            const amt = accs.value[0].account.data.parsed.info.tokenAmount;
            bals[t.mint] = fmt(amt.amount, parseInt(amt.decimals));
          } else bals[t.mint] = '0';
        }
      } catch { bals[t.mint] = '—'; }
    }
    setTokenBalances(bals);
  }, [publicKey, connection]);

  // Update balances when tokens change
  useEffect(() => { fetchSingleBalance(fromToken, setFromBalance); }, [fromToken, fetchSingleBalance]);
  useEffect(() => { fetchSingleBalance(toToken, setToBalance); }, [toToken, fetchSingleBalance]);
  useEffect(() => { fetchAllBalances(); }, [fetchAllBalances]);

  // fetchQuote
  const fetchQuote = useCallback(async (silent = false) => {
    const raw = toRaw(amount, fromToken.decimals);
    if (!raw) { setQuote(null); setError(null); return; }

    try {
      if (silent) setLoadingSilent(true);
      else { setLoadingFull(true); setError(null); }

      const slip = slippageMode === 'auto'
        ? undefined
        : showCustomSlip && customSlip ? Math.round(parseFloat(customSlip) * 100) : slippage;

      const outputMint = toToken.mint;
      let url = `${QUOTE_API}?inputMint=${fromToken.mint}&outputMint=${outputMint}&amount=${raw}`;
      if (slip !== undefined) url += `&slippageBps=${slip}`;
      url += `&platformFeeBps=${PLATFORM_FEE_BPS}`;

      const headers: Record<string, string> = {};
      if (API_KEY) headers['x-api-key'] = API_KEY;

      const res = await fetch(url, { headers });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      setQuote(data);
      setError(null);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      let friendly = errMsg;
      if (errMsg.includes('No route') || errMsg.includes('no route')) friendly = 'Rute swap tidak ditemukan. Coba tambah slippage.';
      else if (errMsg.includes('insufficient') || errMsg.includes('Insufficient')) friendly = 'Likuiditas tidak cukup.';
      else if (errMsg.includes('400')) friendly = 'Token tidak valid.';
      else if (errMsg.includes('429')) friendly = 'Terlalu banyak request.';

      if (!silent) { setError(friendly); setQuote(null); }
    } finally {
      if (silent) setLoadingSilent(false);
      else setLoadingFull(false);
    }
  }, [amount, fromToken, toToken, slippage, customSlip, showCustomSlip, slippageMode]);

  // Debounce + auto quote
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!amount || parseFloat(amount) <= 0) { setQuote(null); setError(null); return; }
    debounceRef.current = setTimeout(() => fetchQuote(false), 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [amount, fromToken, toToken, slippage, customSlip, slippageMode, fetchQuote]);

  // Auto refresh
  useEffect(() => {
    if (refreshRef.current) clearInterval(refreshRef.current);
    if (quote && amount && parseFloat(amount) > 0) {
      refreshRef.current = setInterval(() => fetchQuote(true), 30000);
    }
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [quote, amount, fetchQuote]);

  // Countdown
  useEffect(() => {
    if (!quote) return;
    setCountdown(30);
    const tick = setInterval(() => setCountdown(p => p <= 1 ? 30 : p - 1), 1000);
    return () => clearInterval(tick);
  }, [quote]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, []);

  const flipTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setQuote(null);
    setAmount('');
  };

  const executeSwap = async () => {
    if (!quote || !publicKey || !connected) {
      addToast('Hubungkan wallet terlebih dahulu', 'error');
      return;
    }
    try {
      setSwapping(true);
      addToast('Memproses swap...', 'info');

      const body = {
        quoteResponse: quote,
        userPublicKey: publicKey.toString(),
        wrapAndUnwrapSol: true,
        feeAccount: PLATFORM_FEE_WALLET,
        platformFeeBps: PLATFORM_FEE_BPS,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 'auto',
      };

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (API_KEY) headers['x-api-key'] = API_KEY;

      const res = await fetch(SWAP_API, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Swap API error: ${res.status}`);
      const { swapTransaction } = await res.json();

      const txBuf = Buffer.from(swapTransaction, 'base64');
      const tx = VersionedTransaction.deserialize(txBuf);
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, 'confirmed');

      const outAmt = fmt(quote.outAmount, toToken.decimals);
      addToast(`✅ Swap berhasil! ${outAmt} ${toToken.symbol}`, 'success');

      setTxList(p => [{ sig, from: fromToken.symbol, to: toToken.symbol, amt: outAmt, time: new Date().toLocaleTimeString('id-ID') }, ...p.slice(0, 9)]);
      setQuote(null);
      setAmount('');
      fetchSingleBalance(fromToken, setFromBalance);
      fetchSingleBalance(toToken, setToBalance);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      addToast(`❌ Swap gagal: ${msg}`, 'error');
    } finally {
      setSwapping(false);
    }
  };

  // Derived
  const outAmt = quote ? parseInt(quote.outAmount) : null;
  const impact = quote ? parseFloat(quote.priceImpactPct) : 0;
  const impactColor = impact > 5 ? '#d9534f' : impact > 2 ? '#f5a623' : '#5cb85c';
  const routeLabel = quote?.routePlan?.[0]?.swapInfo?.label || '—';
  const activeSlip = showCustomSlip && customSlip ? parseFloat(customSlip) : slippage / 100;

  const toSymLabel = toToken.symbol;
  const toDecimals = toToken.decimals;

  // Rate
  const exchangeRate = quote && amount ? (parseInt(quote.outAmount) / Math.pow(10, toDecimals) / parseFloat(amount)).toFixed(6) : '—';



  return (
    <div style={{ width: '100%', fontFamily: "'Trebuchet MS', Verdana, Geneva, sans-serif", position: 'relative' }}>
      {/* Toasts */}
      <div style={{ position: 'absolute', top: -8, right: 0, zIndex: 50, display: 'flex', flexDirection: 'column', gap: 4, pointerEvents: 'none' }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '5px 10px', fontSize: 11, fontWeight: 'bold',
            background: t.type === 'success' ? '#1a3a1a' : t.type === 'error' ? '#3a1a1a' : '#1a2a3a',
            border: `1px solid ${t.type === 'success' ? '#336633' : t.type === 'error' ? '#663333' : '#334466'}`,
            color: t.type === 'success' ? '#5cb85c' : t.type === 'error' ? '#d9534f' : '#5b9bd5',
            maxWidth: 280, wordBreak: 'break-word',
          }}>{t.msg}</div>
        ))}
      </div>

      {/* FROM Panel (Raydium style) */}
      <div style={{ background: '#111', border: '1px solid #333', borderRadius: 8, padding: '12px 14px', marginBottom: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#888', fontSize: 11 }}>From</span>
          <span style={{ color: '#5cb85c', fontSize: 11, fontFamily: 'monospace', cursor: 'pointer' }} onClick={() => setAmount(fromBalance !== '—' ? fromBalance : '')}>
            Balance: {fromBalance}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setShowFromSelector(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1a1a2a', border: '1px solid #555', borderRadius: 20, padding: '6px 12px', cursor: 'pointer', flexShrink: 0, minWidth: 100 }}>
            {fromToken.logoURI && <img src={fromToken.logoURI} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} onError={e => (e.target as any).style.display = 'none'} />}
            <span style={{ color: '#e8e8e8', fontWeight: 'bold', fontSize: 13 }}>{fromToken.symbol}</span>
            <span style={{ color: '#888', fontSize: 10 }}>▼</span>
          </button>
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" style={{ flex: 1, background: 'transparent', border: 'none', color: '#e8e8e8', fontSize: 22, fontFamily: 'monospace', textAlign: 'right', outline: 'none' }} />
        </div>
        <div style={{ textAlign: 'right', color: '#555', fontSize: 11, marginTop: 4 }}>~$0</div>
      </div>

      {/* Flip Button */}
      <div style={{ display: 'flex', justifyContent: 'center', margin: '-4px 0', zIndex: 10, position: 'relative' }}>
        <button onClick={flipTokens} style={{ width: 32, height: 32, borderRadius: '50%', background: '#1a1a2a', border: '2px solid #333', color: '#f5a623', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.2s' }} onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'rotate(180deg)'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'rotate(0)'; }}>↕</button>
      </div>

      {/* TO Panel (Raydium style) */}
      <div style={{ background: '#111', border: '1px solid #333', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ color: '#888', fontSize: 11 }}>To (estimated)</span>
          <span style={{ color: '#555', fontSize: 11, fontFamily: 'monospace' }}>Balance: {toBalance}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setShowToSelector(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1a1a2a', border: '1px solid #555', borderRadius: 20, padding: '6px 12px', cursor: 'pointer', flexShrink: 0, minWidth: 100 }}>
            {(toToken.logoURI || initialToToken?.imageUrl) && <img src={toToken.logoURI || initialToToken?.imageUrl} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} onError={e => (e.target as any).style.display = 'none'} />}
            <span style={{ color: '#e8e8e8', fontWeight: 'bold', fontSize: 13 }}>{toToken.symbol}</span>
            <span style={{ color: '#888', fontSize: 10 }}>▼</span>
          </button>
          <div style={{ flex: 1, textAlign: 'right' }}>
            {loadingFull ? (
              <span style={{ color: '#555', fontSize: 14, animation: 'pulse 1s infinite' }}>Menghitung...</span>
            ) : outAmt != null ? (
              <span style={{ color: '#e8e8e8', fontSize: 22, fontFamily: 'monospace' }}>{fmt(quote!.outAmount, toDecimals)}{loadingSilent && <span style={{ color: '#444', fontSize: 10, marginLeft: 4 }}>⟳</span>}</span>
            ) : <span style={{ color: '#555', fontSize: 22, fontFamily: 'monospace' }}>—</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right', color: '#555', fontSize: 11, marginTop: 4 }}>~$0</div>
      </div>

      {/* Slippage compact */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ color: '#666', fontSize: 11 }}>Slippage:</span>
        {['auto', '0.1', '0.5', '1'].map(val => {
          const isAuto = val === 'auto';
          const bps = isAuto ? 0 : Math.round(parseFloat(val) * 100);
          const active = !showCustomSlip && (isAuto ? slippageMode === 'auto' : slippage === bps);
          return (
            <button key={val} onClick={() => { if (isAuto) { setSlippageMode('auto'); setShowCustomSlip(false); } else { setSlippage(bps); setSlippageMode('manual'); setShowCustomSlip(false); } }} style={{ padding: '3px 8px', fontSize: 11, borderRadius: 6, background: active ? '#1a2a3a' : 'transparent', border: `1px solid ${active ? '#5b9bd5' : '#444'}`, color: active ? '#5b9bd5' : '#666', cursor: 'pointer' }}>
              {isAuto ? 'Auto' : `${val}%`}
            </button>
          );
        })}
        <button onClick={() => setShowCustomSlip(p => !p)} style={{ padding: '3px 8px', fontSize: 11, borderRadius: 6, background: showCustomSlip ? '#2a1a0a' : 'transparent', border: `1px solid ${showCustomSlip ? '#f5a623' : '#444'}`, color: showCustomSlip ? '#f5a623' : '#666', cursor: 'pointer' }}>
          {showCustomSlip ? `${customSlip || '?'}%` : 'Custom'}
        </button>
        {showCustomSlip && <input type="number" value={customSlip} onChange={e => setCustomSlip(e.target.value)} placeholder="%" min="0.01" max="50" step="0.1" style={{ width: 50, background: '#111', border: '1px solid #555', color: '#e8e8e8', padding: '3px 6px', fontSize: 11, fontFamily: 'monospace', borderRadius: 4, outline: 'none' }} />}
        {activeSlip > 5 && <span style={{ color: '#d9534f', fontSize: 10 }}>⚠ Tinggi!</span>}
      </div>

      {/* Quote panel with rate */}
      {quote && !loadingFull && (
        <div style={{ marginBottom: 10, padding: '10px 12px', background: '#0d0d0d', border: '1px solid #222', borderRadius: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid #1a1a1a' }}>
            <span style={{ color: '#888' }}>Rate</span>
            <span style={{ color: '#e8e8e8', fontFamily: 'monospace' }}>1 {fromToken.symbol} ≈ {exchangeRate} {toSymLabel}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: '#666' }}>Price Impact</span>
            <span style={{ color: impactColor, fontFamily: 'monospace', fontWeight: 'bold' }}>{impact < 0.01 ? '< 0.01%' : `${impact.toFixed(3)}%`}{impact > 5 && ' ⚠'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: '#666' }}>Min. Diterima</span>
            <span style={{ color: '#888', fontFamily: 'monospace' }}>{fmt(quote.otherAmountThreshold, toDecimals)} {toSymLabel}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: '#666' }}>Route (Best)</span>
            <span style={{ color: '#5b9bd5', fontFamily: 'monospace' }}>
              {quote?.routePlan?.map((r: any, i: number) => r.swapInfo?.label).join(' → ') || routeLabel}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ color: '#666' }}>Platform Fee</span>
            <span style={{ color: '#555', fontFamily: 'monospace' }}>0.5%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#444', fontSize: 9, fontFamily: 'monospace', marginTop: 8, paddingTop: 6, borderTop: '1px solid #1a1a1a' }}>
            <span>Quote otomatis refresh</span>
            <span style={{ color: countdown <= 5 ? '#d9534f' : '#555' }}>⟳ {countdown}s</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && <div style={{ marginBottom: 8, padding: '6px 10px', background: '#2a1111', border: '1px solid #663333', color: '#d9534f', fontSize: 11 }}>⚠ {error}</div>}

      {/* Swap Button */}
      <button 
        onClick={executeSwap} 
        disabled={!connected || !quote || swapping || loadingFull} 
        style={{ width: '100%', padding: '14px', fontSize: 15, fontWeight: 'bold', borderRadius: 10, border: 'none', cursor: (!connected || !quote || swapping || loadingFull) ? 'not-allowed' : 'pointer', background: !connected ? '#1a1a2a' : (!quote || loadingFull) ? '#222' : swapping ? '#1a3a1a' : '#f5a623', color: (!connected || !quote || loadingFull) ? '#555' : '#1a1a1a' }}
      >
        {!connected ? 'Connect Wallet' : swapping ? 'Processing...' : loadingFull ? 'Fetching price...' : !quote ? 'Enter amount' : `Swap ${fromToken.symbol} → ${toSymLabel}`}
      </button>

      {/* Token Selector Modals */}
      {showFromSelector && (
        <TokenSelectorModal onSelect={token => { setFromToken(token); setShowFromSelector(false); setQuote(null); }} onClose={() => setShowFromSelector(false)} disabledMint={toToken.mint} balances={tokenBalances} />
      )}
      {showToSelector && (
        <TokenSelectorModal onSelect={token => { setToToken(token); setShowToSelector(false); setQuote(null); }} onClose={() => setShowToSelector(false)} disabledMint={fromToken.mint} balances={tokenBalances} />
      )}

      {/* TX History */}
      {txList.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button onClick={() => setShowTx(p => !p)} style={{ background: 'none', border: 'none', color: '#555', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace' }}>
            {showTx ? '▲' : '▼'} Riwayat ({txList.length})
          </button>
          {showTx && (
            <div style={{ marginTop: 4, maxHeight: 120, overflowY: 'auto' }}>
              {txList.map((tx, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 6px', fontSize: 10, fontFamily: 'monospace', background: i % 2 === 0 ? '#111' : '#0d0d0d', borderBottom: '1px solid #1a1a1a' }}>
                  <span style={{ color: '#5cb85c' }}>{tx.from}→{tx.to}</span>
                  <span style={{ color: '#888' }}>{tx.amt}</span>
                  <a href={`https://solscan.io/tx/${tx.sig}`} target="_blank" rel="noopener noreferrer" style={{ color: '#5b9bd5', textDecoration: 'none' }}>{tx.sig.slice(0,8)}... ↗</a>
                  <span style={{ color: '#444' }}>{tx.time}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SwapUI;
