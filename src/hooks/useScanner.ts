import { useState, useEffect, useCallback, useRef } from 'react';
import type { TokenData, FilterData } from '../lib/types';
import { hitungSkor, hitungGemScore, deteksiRedFlag } from '../lib/scoring';
import { formatAngka, formatHarga } from '../lib/format';
import { PRESETS, API_LATEST_PROFILES, API_BOOSTED_LATEST, API_TOKEN_PAIRS } from '../lib/constants';

export function useScanner() {
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

      return token;
    } catch {
      return null;
    }
  };

  const scanToken = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    setError(null);

    try {
      const [profilRes, boostedRes] = await Promise.allSettled([
        scanMode === 'latest' || scanMode === 'both' ? fetchJSON(API_LATEST_PROFILES) : Promise.resolve([]),
        scanMode === 'boosted' || scanMode === 'both' ? fetchJSON(API_BOOSTED_LATEST) : Promise.resolve([]),
      ]);

      const profilMap = new Map<string, TokenData>();

      const latestArr = (profilRes.status === 'fulfilled' ? profilRes.value : []).filter((p: { chainId: string }) => p.chainId === 'solana');
      const boostedArr = (boostedRes.status === 'fulfilled' ? boostedRes.value : []).filter((p: { chainId: string }) => p.chainId === 'solana');

      const latestResults = await Promise.allSettled(
        latestArr.map((p: any) => fetchDataToken(p))
      );

      latestResults.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          const token = r.value;
          token.isBoosted = false;
          profilMap.set(latestArr[i].tokenAddress, token);
        }
      });

      const boostedResults = await Promise.allSettled(
        boostedArr.map((p: any) => fetchDataToken(p))
      );

      boostedResults.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          const token = r.value;
          token.isBoosted = true;
          profilMap.set(boostedArr[i].tokenAddress, token);
        }
      });

      const tokensList = Array.from(profilMap.values());

      if (tokensRef.current.length > 0 && typeof window !== 'undefined' && Notification.permission === 'granted') {
        tokensList.forEach(newToken => {
          const exists = tokensRef.current.find(t => t.address === newToken.address);
          if (!exists && newToken.skor >= 80) {
            new Notification(`💎 Gem Baru: ${newToken.nama}`, {
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
          .sort((a, b) => a.ageHours - b.ageHours)
          .slice(0, 200);

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
    // Update every 30 seconds to avoid rate limits and allow new tokens to appear
    intervalRef.current = setInterval(() => scanToken(true), 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [scanToken]);

  const applyFilter = useCallback((tokenList: TokenData[]) => {
    const cari = searchQuery.toLowerCase().trim();
    return tokenList.filter((t) => {
      if (cari && !t.nama.toLowerCase().includes(cari) && !t.simbol.toLowerCase().includes(cari) && !t.address.toLowerCase().includes(cari)) return false;
      if (t.liquidity < filter.liquidityMin) return false;
      if (t.liquidity > filter.liqMax) return false;
      if (t.volume24h < filter.volumeMin) return false;
      if (t.ageHours > filter.ageMaxJam) return false;
      if (t.priceChange1h < filter.delta1jMin) return false;
      if (t.txCount24h < filter.txnMin) return false;
      if (t.marketCap > filter.mcapMax && t.marketCap > 0) return false;
      return true;
    });
  }, [searchQuery, filter]);

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
    exportCSV
  };
}
