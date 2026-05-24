import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';
import type { TokenData, FilterData } from '../lib/types';
import { hitungSkor, hitungGemScore, deteksiRedFlag } from '../lib/scoring';
import { analyzeTokenRisk } from '../lib/scanner/riskAnalyzer';
import { formatAngka, formatHarga } from '../lib/format';
import { PRESETS, API_LATEST_PROFILES, API_BOOSTED_LATEST, API_TOKEN_PAIRS, API_DEXSCREENER_SEARCH } from '../lib/constants';

// Solana address regex — support standard (32-44) dan pump.fun format (44+pump suffix)
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,48}(pump)?$/i;

export function useScanner() {
  const { connection } = useConnection();
  const [tokens, setTokens] = useState<TokenData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterData>(PRESETS.gem);
  const [preset, setPreset] = useState<string>('gem');
  const [scanMode, setScanMode] = useState<'latest' | 'boosted' | 'both'>('both');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotRef = useRef<Record<string, { liquidity: number; volume24h: number; harga: number }>>({});
  const tokensRef = useRef<TokenData[]>([]);
  // CA search state — token yang di-fetch langsung dari CA input
  const [caToken, setCaToken] = useState<TokenData | null>(null);
  const [caLoading, setCaLoading] = useState(false);
  const caTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Deteksi narrative berdasarkan nama/simbol token
  const detectNarrative = (token: TokenData): string => {
    const name = token.nama?.toLowerCase() || '';
    const symbol = token.simbol?.toLowerCase() || '';
    if (name.includes('ai') || name.includes('agent') || symbol.includes('ai')) return 'AI Agent';
    if (name.includes('cat') || name.includes('dog') || name.includes('pepe') || name.includes('meme') || name.includes('frog')) return 'Meme Coin';
    if (name.includes('depin') || name.includes('network') || name.includes('node')) return 'DePIN';
    if (name.includes('real') || name.includes('asset') || symbol.includes('rwa')) return 'RWA';
    if (name.includes('game') || name.includes('play') || name.includes('p2e')) return 'Gaming';
    if (name.includes('defi') || name.includes('swap') || name.includes('yield')) return 'DeFi';
    if (name.includes('social') || name.includes('friend')) return 'Social';
    if (name.includes('layer') || name.includes('l2') || name.includes('rollup')) return 'Layer 2';
    if (name.includes('launch') || name.includes('presale') || name.includes('seed')) return 'Launchpad';
    return 'New Token';
  };

  // Load persisted state on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Load Filter
      const savedFilter = localStorage.getItem('scanner_filter');
      if (savedFilter) {
        try {
          setFilter(JSON.parse(savedFilter));
        } catch (e) {}
      }

      // Load Tokens
      const savedTokens = localStorage.getItem('scanner_persisted_tokens');
      if (savedTokens) {
        try {
          const parsed = JSON.parse(savedTokens);
          setTokens(parsed);
          tokensRef.current = parsed;
        } catch (e) {
          console.error('Failed to load persisted tokens');
        }
      }
    }
  }, []);

  // Save filter to localStorage
  useEffect(() => {
    localStorage.setItem('scanner_filter', JSON.stringify(filter));
  }, [filter]);

  // Save tokens to localStorage when they change
  useEffect(() => {
    if (tokens.length > 0) {
      localStorage.setItem('scanner_persisted_tokens', JSON.stringify(tokens.slice(0, 200))); // Limit storage
    }
  }, [tokens]);

  const fetchJSON = async (url: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const separator = url.includes('?') ? '&' : '?';
      const cacheBuster = `${separator}t=${Date.now()}`;
      
      const res = await fetch(url + cacheBuster, { 
        signal: controller.signal,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      
      clearTimeout(timeout);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  };

  const fetchDataToken = async (profil: { tokenAddress: string; name?: string; symbol?: string; holders?: number | null; links?: Array<{ type: string; url: string }>; top10HolderPercent?: number | null; icon?: string; amount?: number; totalAmount?: number }) => {
    try {
      const data = await fetchJSON(API_TOKEN_PAIRS + profil.tokenAddress);
      const pairs = (data.pairs || []).filter((p: { chainId: string }) => p.chainId === 'solana');
      if (pairs.length === 0) return null;

      pairs.sort((a: { volume?: { h24?: number } }, b: { volume?: { h24?: number } }) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
      const pair = pairs[0];
      const now = Date.now();
      const umurJam = (now - (pair.pairCreatedAt || now)) / 3600000;

      const token = {
        nama: profil.name || pair.baseToken?.name || 'Unknown',
        simbol: profil.symbol || pair.baseToken?.symbol || '???',
        address: profil.tokenAddress,
        chainId: 'solana',
        pairAddress: pair.pairAddress,
        isBoosted: false,
        harga: parseFloat(pair.priceUsd) || 0,
        priceChange5m: pair.priceChange?.m5 || 0,
        priceChange1h: pair.priceChange?.h1 || 0,
        priceChange6h: pair.priceChange?.h6 || 0,
        priceChange24h: pair.priceChange?.h24 || 0,
        volume5m: pair.volume?.m5 || 0,
        volume1h: pair.volume?.h1 || 0,
        volume24h: pair.volume?.h24 || 0,
        liquidity: pair.liquidity?.usd || 0,
        marketCap: pair.marketCap || pair.fdv || 0,
        ageHours: Math.max(0, umurJam),
        txCount24h: (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0),
        buys24h: pair.txns?.h24?.buys || 0,
        sells24h: pair.txns?.h24?.sells || 0,
        holders: profil.holders || null,
        website: profil.links?.find((l: { type: string }) => l.type === 'website')?.url || '',
        twitter: profil.links?.find((l: { type: string }) => l.type === 'twitter')?.url || '',
        telegram: profil.links?.find((l: { type: string }) => l.type === 'telegram')?.url || '',
        discord: profil.links?.find((l: { type: string }) => l.type === 'discord')?.url || '',
        top10HolderPercent: profil.top10HolderPercent || null,
        imageUrl: (profil.icon && profil.icon.startsWith('http')) ? profil.icon : '',
        boostAmount: profil.amount || profil.totalAmount || 0,
      } as TokenData;

      token.skor = hitungSkor(token);
      token.gemScore = hitungGemScore(token);
      
      const snap = snapshotRef.current[token.address] || null;
      token.redFlags = deteksiRedFlag(token, snap);

      // Anti-rug analysis
      try {
        token.risk = await analyzeTokenRisk(connection, token.address, token);
      } catch (e) {
        console.error('Risk analysis failed for', token.address, e);
      }

      return token;
    } catch {
      return null;
    }
  };

  // Fetch token by CA address directly from Dexscreener
  const fetchTokenByCA = useCallback(async (ca: string) => {
    // Normalize CA — strip whitespace, handle pump.fun format
    const normalized = ca.trim();
    // Pump.fun addresses end with "pump" — the actual mint is the base58 part
    // Try both the full address and without "pump" suffix
    const addresses = [normalized];
    if (normalized.toLowerCase().endsWith('pump') && normalized.length > 44) {
      addresses.push(normalized.slice(0, -4)); // try without "pump"
    }

    setCaLoading(true);
    setCaToken(null);

    for (const addr of addresses) {
      try {
        const token = await fetchDataToken({ tokenAddress: addr });
        if (token) {
          setCaToken(token);
          setCaLoading(false);
          return;
        }
      } catch { /* try next */ }
    }

    // Fallback: try Dexscreener search API
    try {
      const data = await fetchJSON(API_DEXSCREENER_SEARCH + encodeURIComponent(normalized));
      const pairs = (data.pairs || []).filter((p: any) => p.chainId === 'solana');
      if (pairs.length > 0) {
        const pair = pairs[0];
        const addr = pair.baseToken?.address || normalized;
        const token = await fetchDataToken({ tokenAddress: addr });
        if (token) {
          setCaToken(token);
          setCaLoading(false);
          return;
        }
      }
    } catch { /* ignore */ }

    setCaToken(null);
    setCaLoading(false);
  }, []);

  // Auto-detect CA in search query and fetch it
  useEffect(() => {
    clearTimeout(caTimerRef.current);
    const q = searchQuery.trim();
    if (!q) { setCaToken(null); setCaLoading(false); return; }

    if (SOLANA_ADDRESS_RE.test(q)) {
      // Check if already in list (with or without pump suffix)
      const qLower = q.toLowerCase();
      const existing = tokensRef.current.find(t =>
        t.address.toLowerCase() === qLower ||
        t.address.toLowerCase() === qLower.replace(/pump$/i, '')
      );
      if (existing) {
        setCaToken(existing);
        setCaLoading(false);
      } else {
        setCaLoading(true);
        caTimerRef.current = setTimeout(() => fetchTokenByCA(q), 600);
      }
    } else {
      setCaToken(null);
      setCaLoading(false);
    }
  }, [searchQuery, fetchTokenByCA]);

  const scanToken = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setError(null);

    try {
      // Fetch latest profiles, boosted, dan pump.fun graduated secara paralel
      const [profilRes, boostedRes, pumpRes] = await Promise.allSettled([
        scanMode === 'latest' || scanMode === 'both' ? fetchJSON(API_LATEST_PROFILES) : Promise.resolve([]),
        scanMode === 'boosted' || scanMode === 'both' ? fetchJSON(API_BOOSTED_LATEST) : Promise.resolve([]),
        // Pump.fun graduated: cari token Solana terbaru dengan volume tinggi
        fetchJSON('https://api.dexscreener.com/token-profiles/latest/v1').catch(() => []),
      ]);

      const profilMap = new Map<string, TokenData>();

      const latestArr = (profilRes.status === 'fulfilled' ? profilRes.value : [])
        .filter((p: { chainId: string }) => p.chainId === 'solana');
      const boostedArr = (boostedRes.status === 'fulfilled' ? boostedRes.value : [])
        .filter((p: { chainId: string }) => p.chainId === 'solana');
      // Pump.fun graduated — ambil yang belum ada di latestArr
      const pumpArr = (pumpRes.status === 'fulfilled' ? pumpRes.value : [])
        .filter((p: { chainId: string; tokenAddress: string }) =>
          p.chainId === 'solana' &&
          !latestArr.find((l: { tokenAddress: string }) => l.tokenAddress === p.tokenAddress)
        );

      // Fetch semua token secara paralel dengan batching
      const allProfiles = [...latestArr, ...pumpArr];
      const BATCH = 10; // fetch 10 sekaligus untuk hindari rate limit

      const fetchBatch = async (arr: any[], isBoosted: boolean) => {
        for (let i = 0; i < arr.length; i += BATCH) {
          const batch = arr.slice(i, i + BATCH);
          const results = await Promise.allSettled(batch.map((p: any) => fetchDataToken(p)));
          results.forEach((r, j) => {
            if (r.status === 'fulfilled' && r.value) {
              const token = r.value;
              token.isBoosted = isBoosted;
              profilMap.set(batch[j].tokenAddress, token);
            }
          });
        }
      };

      await fetchBatch(allProfiles, false);
      await fetchBatch(boostedArr, true);

      const tokensList = Array.from(profilMap.values());

      if (tokensRef.current.length > 0 && typeof window !== 'undefined' && Notification.permission === 'granted') {
        tokensList.forEach(newToken => {
          const exists = tokensRef.current.find(t => t.address === newToken.address);
          if (!exists && newToken.skor >= 80) {
            new Notification(`Gem Baru: ${newToken.nama}`, {
              body: `Score: ${newToken.skor} | Liq: ${formatAngka(newToken.liquidity)}`,
              icon: newToken.imageUrl || '/favicon.ico'
            });
          }
        });
      }

      const newSnapshot: Record<string, { liquidity: number; volume24h: number; harga: number }> = {};
      tokensList.forEach(t => {
        newSnapshot[t.address] = {
          liquidity: t.liquidity,
          volume24h: t.volume24h,
          harga: t.harga
        };
      });
      snapshotRef.current = newSnapshot;

      setTokens(prev => {
        const existingMap = new Map(prev.map(t => [t.address, t]));
        tokensList.forEach(t => {
          existingMap.set(t.address, t);
        });

        const merged = Array.from(existingMap.values())
          // Sort: boosted dulu, lalu by score desc, lalu by age asc
          .sort((a, b) => {
            if (a.isBoosted !== b.isBoosted) return a.isBoosted ? -1 : 1;
            if (b.skor !== a.skor) return b.skor - a.skor;
            return a.ageHours - b.ageHours;
          })
          .slice(0, 300); // simpan lebih banyak

        tokensRef.current = merged;
        return merged;
      });
    } catch (err) {
      setError('Gagal mengambil data: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setLoading(false);
    }
  }, [scanMode]);

  useEffect(() => {
    if (typeof window !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    scanToken();
    // Scan setiap 15 detik — lebih cepat untuk catch pump.fun graduates
    intervalRef.current = setInterval(() => scanToken(true), 15000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [scanToken]);

  const applyFilter = useCallback((tokenList: TokenData[]) => {
    const cari = searchQuery.trim();
    const cariLower = cari.toLowerCase();
    const isCA = SOLANA_ADDRESS_RE.test(cari);

    // CA search — bypass semua filter, tampilkan token dari CA langsung
    if (isCA) {
      // Cek di list yang sudah ada dulu (case-insensitive)
      const fromList = tokenList.filter(t =>
        t.address.toLowerCase() === cariLower ||
        t.address.toLowerCase().startsWith(cariLower.replace(/pump$/i, ''))
      );
      if (fromList.length > 0) return fromList;
      // Tampilkan caToken yang di-fetch
      if (caToken) return [caToken];
      return [];
    }

    // Normal search — filter by name/symbol/address
    return tokenList.filter((t) => {
      if (cariLower && !t.nama.toLowerCase().includes(cariLower) &&
          !t.simbol.toLowerCase().includes(cariLower) &&
          !t.address.toLowerCase().includes(cariLower)) return false;

      // Risk Filter
      if (filter.riskLevel && filter.riskLevel !== 'ALL') {
        if (!t.risk || t.risk.score !== filter.riskLevel) return false;
      }

      if (t.liquidity < filter.liquidityMin) return false;
      if (filter.liqMax > 0 && t.liquidity > filter.liqMax) return false;
      if (t.volume24h < filter.volumeMin) return false;
      if (t.ageHours > filter.ageMaxJam) return false;
      if (t.priceChange1h < filter.delta1jMin) return false;
      if (t.txCount24h < filter.txnMin) return false;
      if (filter.mcapMax > 0 && t.marketCap > filter.mcapMax && t.marketCap > 0) return false;
      return true;
    });
  }, [searchQuery, filter, caToken]);

  const filteredTokens = applyFilter(tokens);

  const stats = {
    total: tokens.length,
    gems: tokens.filter(t => t.skor >= 80).length,
    mid: tokens.filter(t => t.skor >= 50 && t.skor < 80).length,
    boosted: tokens.filter(t => t.isBoosted).length,
    new: tokens.filter(t => t.ageHours < 1).length,
  };

  const exportCSV = () => {
    if (filteredTokens.length === 0) return;
    
    const headers = ['Nama', 'Simbol', 'Address', 'Harga', 'Liq', 'Vol24h', 'MCap', 'Age(h)', 'Score'];
    const rows = filteredTokens.map(t => [
      t.nama,
      t.simbol,
      t.address,
      t.harga,
      t.liquidity,
      t.volume24h,
      t.marketCap,
      t.ageHours.toFixed(1),
      t.skor
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join(String.fromCharCode(10));

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `gem-hunter-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const setPresetValue = (p: string) => {
    setPreset(p);
    setFilter({ ...PRESETS[p as keyof typeof PRESETS] });
  };

  return {
    tokens: filteredTokens,
    allTokens: tokens,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    filter,
    setFilter,
    preset,
    setPresetValue,
    scanMode,
    setScanMode,
    scanToken,
    stats,
    exportCSV,
    caLoading,
    caToken,
  };
}
