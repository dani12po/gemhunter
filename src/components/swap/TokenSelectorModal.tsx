'use client';

import React, { useState, useEffect, useRef } from 'react';

const POPULAR_TOKENS: Token[] = [
  { symbol: 'SOL',  mint: 'So11111111111111111111111111111111111111112',  decimals: 9,  name: 'Solana',      logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png' },
  { symbol: 'USDC', mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6,  name: 'USD Coin',    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png' },
  { symbol: 'USDT', mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',  decimals: 6,  name: 'Tether USD',  logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB/logo.png' },
  { symbol: 'RAY',  mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6,  name: 'Raydium',     logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/assets/4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R/logo.png' },
  { symbol: 'BONK', mint: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5,  name: 'Bonk',       logoURI: 'https://arweave.net/hQiPZOsRZXGXBJd_82PhVdlM_hACsT_q6wqwf5cSY7I' },
  { symbol: 'JUP',  mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',  decimals: 6,  name: 'Jupiter',    logoURI: 'https://static.jup.ag/jup/icon.png' },
];

function isValidSolanaAddress(addr: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr.trim());
}

async function fetchTokenByMint(mint: string): Promise<Token> {
  try {
    // 1. Coba Jupiter dulu
    const jup = await fetch(`https://tokens.jup.ag/token/${mint}`);
    if (jup.ok) {
      const data = await jup.json();
      return {
        symbol:   data.symbol || mint.slice(0, 4).toUpperCase(),
        mint:     data.address || mint,
        decimals: data.decimals ?? 6,
        name:     data.name || 'Unknown Token',
        logoURI:  data.logoURI || '',
      };
    }
  } catch {}

  // 2. Fallback ke DexScreener (banyak token Pump.fun ada di sini)
  try {
    const dex = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`);
    if (dex.ok) {
      const arr = await dex.json();
      if (arr?.[0]?.info?.imageUrl) {
        return {
          symbol: arr[0].baseToken?.symbol || mint.slice(0, 4).toUpperCase(),
          mint,
          decimals: 6,
          name: arr[0].baseToken?.name || 'Unknown Token',
          logoURI: arr[0].info.imageUrl,
        };
      }
    }
  } catch {}

  // 3. Last fallback - generic
  return {
    symbol: mint.slice(0, 4).toUpperCase(),
    mint,
    decimals: 6,
    name: 'Custom Token',
    logoURI: '',
  };
}

interface Token {
  symbol:   string;
  mint:     string;
  decimals: number;
  name:     string;
  logoURI?: string;
}

interface TokenSelectorModalProps {
  onSelect:       (token: Token) => void;
  onClose:        () => void;
  disabledMint?:  string;
  balances?:      Record<string, string>;
}

export const TokenSelectorModal: React.FC<TokenSelectorModalProps> = ({
  onSelect, onClose, disabledMint, balances = {}
}) => {
  const [search, setSearch]     = useState('');
  const [result, setResult]     = useState<Token | null>(null);
  const [loading, setLoading]   = useState(false);
  const [notFound, setNotFound] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    setResult(null);
    setNotFound(false);
    const q = search.trim();
    if (!q) return;

    if (isValidSolanaAddress(q)) {
      setLoading(true);
      fetchTokenByMint(q).then(async token => {
        if (token) {
          // Cek route di semua DEX via Jupiter (pastikan pair tersedia untuk swap)
          try {
            const res = await fetch(
              `https://api.jup.ag/swap/v1/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=${q}&amount=1000000000&slippageBps=100`
            );
            const data = await res.json();
            if (!data.error && data.outAmount) {
              setResult(token);
            } else {
              setNotFound(true);
            }
          } catch {
            setNotFound(true);
          }
        } else {
          setNotFound(true);
        }
        setLoading(false);
      });
    }
  }, [search]);

  const filteredPopular = search.trim()
    ? POPULAR_TOKENS.filter(t =>
        t.symbol.toLowerCase().includes(search.toLowerCase()) ||
        t.name.toLowerCase().includes(search.toLowerCase())
      )
    : POPULAR_TOKENS;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.85)',
        zIndex: 300,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        background: '#1e1e2e',
        border: '1px solid #444',
        borderRadius: 12,
        width: '100%', maxWidth: 420,
        maxHeight: '80vh',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #333' }}>
          <span style={{ fontWeight: 'bold', fontSize: 15, color: '#e8e8e8' }}>Search Token</span>
        </div>

        <div style={{ padding: '12px 16px', borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#666', fontSize: 14 }}>🔍</span>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search by name, symbol, or paste address"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#111', border: '1px solid #555',
                borderRadius: 8, padding: '10px 12px 10px 34px',
                color: '#e8e8e8', fontSize: 13, outline: 'none',
              }}
            />
          </div>
        </div>

        {!search.trim() && (
          <div style={{ padding: '10px 16px', borderBottom: '1px solid #2a2a2a' }}>
            <div style={{ color: '#666', fontSize: 10, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>Popular Tokens</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {POPULAR_TOKENS.map(t => (
                <button
                  key={t.mint}
                  disabled={t.mint === disabledMint}
                  onClick={() => onSelect(t)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 20,
                    background: t.mint === disabledMint ? '#1a1a1a' : '#2a2a3a',
                    border: '1px solid #444',
                    color: t.mint === disabledMint ? '#444' : '#e8e8e8',
                    fontSize: 12, cursor: t.mint === disabledMint ? 'not-allowed' : 'pointer',
                  }}
                >
                  {t.logoURI && <img src={t.logoURI} alt="" style={{ width: 14, height: 14, borderRadius: '50%' }} onError={e => (e.target as any).style.display = 'none'} />}
                  {t.symbol}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto', maxHeight: '55vh', minHeight: '120px', scrollbarWidth: 'none' }} className="hide-scrollbar">
          {search.trim() && isValidSolanaAddress(search.trim()) && (
            <div style={{ padding: '10px 16px' }}>
              {loading && (
                <div style={{ color: '#666', fontSize: 12, padding: '8px 0' }}>⟳ Mencari token...</div>
              )}
              {notFound && !loading && (
                <div style={{ color: '#d9534f', fontSize: 12, padding: '8px 0' }}>
                  ⚠ Token tidak ditemukan di Jupiter Token List.<br/>
                  <span style={{ color: '#888', fontSize: 10 }}>Pastikan mint address benar dan token ada di Solana.</span>
                </div>
              )}
              {result && !loading && (
                <div>
                  <div style={{ color: '#888', fontSize: 10, marginBottom: 6, textTransform: 'uppercase' }}>Token Ditemukan</div>
                  <button
                    disabled={result.mint === disabledMint}
                    onClick={() => onSelect(result)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 12px', background: '#1a2a1a',
                      border: '1px solid #5cb85c', borderRadius: 8,
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {result.logoURI ? (
                      <img src={result.logoURI} alt="" style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} onError={e => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        const parent = (e.target as HTMLImageElement).parentElement;
                        if (parent) {
                          const fb = document.createElement('div');
                          fb.style.cssText = 'width:32px;height:32px;border-radius:50%;background:#444;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:11px;font-weight:bold';
                          fb.textContent = result.symbol.slice(0,2);
                          parent.appendChild(fb);
                        }
                      }} />
                    ) : (
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#444', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 11, fontWeight: 'bold' }}>
                        {result.symbol.slice(0,2)}
                      </div>
                    )}
                    <div>
                      <div style={{ color: '#5cb85c', fontWeight: 'bold', fontSize: 13 }}>{result.symbol}</div>
                      <div style={{ color: '#888', fontSize: 10 }}>{result.name}</div>
                      <div style={{ color: '#555', fontSize: 9, fontFamily: 'monospace' }}>{result.mint.slice(0,12)}...{result.mint.slice(-6)}</div>
                    </div>
                    <div style={{ marginLeft: 'auto', color: '#5cb85c', fontSize: 11, fontFamily: 'monospace' }}>
                      {balances[result.mint] || '0'}
                    </div>
                  </button>
                </div>
              )}
            </div>
          )}

          {filteredPopular.length > 0 && (
            <div>
              <div style={{ padding: '8px 16px 4px', color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                {search.trim() ? 'Hasil pencarian' : 'Token'}
              </div>
              {filteredPopular.map(t => (
                <button
                  key={t.mint}
                  disabled={t.mint === disabledMint}
                  onClick={() => onSelect(t)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px', background: 'transparent',
                    border: 'none', borderBottom: '1px solid #1a1a1a',
                    cursor: t.mint === disabledMint ? 'not-allowed' : 'pointer',
                    opacity: t.mint === disabledMint ? 0.4 : 1,
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => { if (t.mint !== disabledMint) (e.currentTarget as HTMLElement).style.background = '#1a1a2a'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  {t.logoURI ? (
                    <img 
                      src={t.logoURI} 
                      alt="" 
                      style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} 
                      onError={e => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        const parent = (e.target as HTMLImageElement).parentElement;
                        if (parent) {
                          const fallback = document.createElement('div');
                          fallback.style.cssText = 'width:32px;height:32px;border-radius:50%;background:#444;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:11px;font-weight:bold';
                          fallback.textContent = t.symbol.slice(0,2);
                          parent.appendChild(fallback);
                        }
                      }} 
                    />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#444', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 11, fontWeight: 'bold' }}>
                      {t.symbol.slice(0,2)}
                    </div>
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#e8e8e8', fontWeight: 'bold', fontSize: 13 }}>{t.symbol}</div>
                    <div style={{ color: '#666', fontSize: 11 }}>{t.name}</div>
                  </div>
                  <div style={{ color: '#5cb85c', fontSize: 12, fontFamily: 'monospace' }}>
                    {balances[t.mint] || '0'}
                  </div>
                </button>
              ))}
            </div>
          )}

          <div style={{ padding: '12px 16px', margin: '8px 12px', background: '#111', borderRadius: 8, border: '1px solid #2a2a2a' }}>
            <div style={{ color: '#666', fontSize: 11 }}>
              💡 Mendukung token dari semua DEX (Raydium, Orca, Meteora, dll via Jupiter). Paste <strong style={{ color: '#f5a623' }}>mint address</strong> untuk token apapun.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
