'use client';

import React from 'react';
import type { TokenData, FilterData } from '../../lib/types';
import { TokenCard } from './TokenCard';
import { TokenSkeleton } from './TokenSkeleton';
import { SwapModal } from '../swap/SwapModal';

interface TokenScannerProps {
  tokens: TokenData[];
  loading: boolean;
  error: string | null;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filter: FilterData;
  onFilterChange: (f: FilterData) => void;
  onSwapOpen: (token: TokenData | null) => void;
  swapToken: TokenData | null | undefined;
  onSwapClose: () => void;
  stats: { total: number; gems: number; mid: number; boosted: number; new: number };
  onExport: () => void;
  onRefresh: () => void;
  preset?: string;
  caLoading?: boolean;
}

const labelMap: Partial<Record<keyof FilterData, string>> = {
  'liquidityMin': 'Liq min ($)',
  'volumeMin':    'Vol min ($)',
  'ageMaxJam':    'Umur maks (j)',
  'delta1jMin':   'Δ1j min (%)',
  'txnMin':       'Txn min',
  'mcapMax':      'MCap maks ($)',
  'liqMax':       'Liq maks ($)',
};

// Deteksi narrative berdasarkan nama/simbol token
function detectNarrative(token: TokenData): string {
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
}

function getTrendingNarrative(tokenList: TokenData[]): string {
  const counts: Record<string, number> = {};
  tokenList.forEach(t => {
    const n = detectNarrative(t);
    counts[n] = (counts[n] || 0) + 1;
  });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'New Token';
}

function getUniqueNarratives(tokenList: TokenData[]): { narrative: string; count: number }[] {
  const counts: Record<string, number> = {};
  tokenList.forEach(t => {
    const n = detectNarrative(t);
    counts[n] = (counts[n] || 0) + 1;
  });
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([narrative, count]) => ({ narrative, count }));
  return [{ narrative: 'all', count: tokenList.length }, ...sorted];
}

// FIX BUG #4: Header baru tingginya 48px (top) + ~38px (controls) = 86px.
// Gunakan paddingTop: 96px agar ada sedikit margin.
const HEADER_HEIGHT = 96;

export const TokenScanner: React.FC<TokenScannerProps> = ({
  tokens, loading, error, searchQuery, onSearchChange,
  filter, onFilterChange, onSwapOpen, swapToken, onSwapClose,
  stats, onExport, onRefresh, preset, caLoading,
}) => {
  const [currentPage, setCurrentPage] = React.useState(1);
  const [selectedNarrative, setSelectedNarrative] = React.useState<string>('all');
  const tokensPerPage = 21;
  const totalPages    = Math.ceil(tokens.length / tokensPerPage);

  // Reset to first page when token list changes (fixes "data exists but not displayed")
  React.useEffect(() => {
    setCurrentPage(1);
  }, [tokens.length]);

  const updateFilter = (key: keyof FilterData, value: number) => {
    onFilterChange({ ...filter, [key]: value });
  };

  const statItems = [
    { label: 'Total',     value: stats.total,   color: '#e8e8e8', accent: '#555' },
    { label: 'Gems',      value: stats.gems,    color: '#f5a623', accent: '#f5a623' },
    { label: 'Mid',       value: stats.mid,     color: '#e8e8e8', accent: '#555' },
    { label: 'Boosted',   value: stats.boosted, color: '#5cb85c', accent: '#5cb85c' },
    { label: 'New (1h)',  value: stats.new,     color: '#5b9bd5', accent: '#5b9bd5' },
  ];

  return (
    <div style={{ 
      paddingTop: HEADER_HEIGHT, 
      paddingBottom: 60, 
      maxWidth: 1280, 
      margin: '0 auto', 
      padding: `${HEADER_HEIGHT}px 16px 60px`,
      background: '#1a1a1a',
      color: '#e8e8e8',
      fontFamily: 'Trebuchet MS, Verdana, sans-serif',
      fontSize: 13,
    }}>

      {/* ── Stats Bar ── */}
      <div className="stats-bar" style={{ padding: '0 8px', marginBottom: 20 }}>
        {statItems.map(s => (
          <div key={s.label} style={{
            background: '#242424',
            border: `1px solid #3a3a3a`,
            borderTop: `2px solid ${s.accent}`,
            padding: '10px 14px',
          }}>
            <div style={{ color: '#777', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ color: s.color, fontSize: 22, fontWeight: 'bold', fontFamily: 'monospace' }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* ── Search + Export ── */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ color: '#777', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 5 }}>
          Search Token
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              type="text"
              placeholder="Cari nama, simbol, address, atau paste CA..."
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              style={{
                width: '100%',
                background: '#1e1e1e',
                border: `1px solid ${caLoading ? '#f5a623' : '#444'}`,
                color: '#e8e8e8',
                padding: '7px 10px 7px 34px',
                fontSize: 12,
                outline: 'none',
                fontFamily: 'Trebuchet MS, Verdana, sans-serif',
                transition: 'border-color 0.2s',
              }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: caLoading ? '#f5a623' : '#555', fontSize: 12 }}>
              {caLoading ? '...' : 'S'}
            </span>
            {caLoading && (
              <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: '#f5a623', fontSize: 10 }}>
                Fetching CA...
              </span>
            )}
          </div>
          <button
            onClick={onExport}
            style={{
              background: '#2e2e2e', border: '1px solid #555',
              borderTopColor: '#666', borderBottomColor: '#333',
              color: '#e8e8e8', padding: '7px 16px',
              fontSize: 12, fontWeight: 'bold', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >Export</button>
          <button
            onClick={onRefresh}
            style={{
              background: '#2e2e2e', border: '1px solid #555',
              borderTopColor: '#666', borderBottomColor: '#333',
              color: '#e8e8e8', padding: '7px 14px',
              fontSize: 12, fontWeight: 'bold', cursor: 'pointer',
            }}
            title="Refresh"
          >↻</button>
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div style={{
          background: '#2a1515', border: '1px solid #661111',
          borderLeft: '3px solid #d9534f',
          color: '#d9534f', padding: '8px 12px',
          fontSize: 12, marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
            {error}
        </div>
      )}

      {/* ── Filter Panel ── */}
      <div style={{
        background: '#1e1e1e',
        border: '1px solid #3a3a3a',
        borderTop: '2px solid #555',
        padding: '12px 14px',
        marginBottom: 16,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, borderBottom: '1px solid #2a2a2a', paddingBottom: 8 }}>
          <div style={{ color: '#777', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Anti-Rug Risk Filter
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {(['ALL', 'LOW', 'MEDIUM', 'HIGH'] as const).map((level) => (
              <button
                key={level}
                onClick={() => onFilterChange({ ...filter, riskLevel: level })}
                style={{
                  background: filter.riskLevel === level ? '#333' : '#1a1a1a',
                  border: `1px solid ${filter.riskLevel === level ? '#555' : '#333'}`,
                  color: filter.riskLevel === level 
                    ? (level === 'HIGH' ? '#ef4444' : level === 'MEDIUM' ? '#f59e0b' : level === 'LOW' ? '#22c55e' : '#fff')
                    : '#777',
                  padding: '4px 10px',
                  fontSize: 10,
                  fontWeight: 'bold',
                  cursor: 'pointer',
                  borderRadius: 2,
                  transition: 'all 0.2s'
                }}
              >
                {level === 'ALL' ? 'SEMUA' : level}
              </button>
            ))}
          </div>
        </div>

        <div style={{ color: '#777', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
          Numeric Filters
        </div>
        <div className="filter-inputs">
          {(Object.entries(labelMap) as [keyof FilterData, string][]).map(([key, label]) => (
            <div key={key}>
              <div style={{ color: '#666', fontSize: 10, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {label}
              </div>
              <input
                type="number"
                value={filter[key] as number}
                onChange={e => updateFilter(key, parseFloat(e.target.value) || 0)}
                style={{
                  width: '100%',
                  background: '#111',
                  border: '1px solid #444',
                  color: '#e8e8e8',
                  padding: '4px 6px',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  outline: 'none',
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── Narrative Panel (hanya tampil saat preset 'narrative') ── */}
      {preset === 'narrative' && tokens.length > 0 && (
        <div style={{
          background: '#1e1e1e',
          border: '1px solid #3a3a3a',
          borderTop: '2px solid #f5a623',
          padding: '12px 14px',
          marginBottom: 16,
        }}>
          <div style={{ color: '#777', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
            Narrative Detection
          </div>

          {/* Trending Narrative */}
          <div style={{
            background: '#2a1a0a', border: '1px solid #f5a623', borderRadius: 8,
            padding: '8px 12px', marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <span style={{ color: '#f5a623', fontSize: 12, fontWeight: 'bold' }}>Trending:</span>
            <span style={{ color: '#e8e8e8', fontSize: 13, fontFamily: 'monospace' }}>
              {getTrendingNarrative(tokens)}
            </span>
            <span style={{ color: '#666', fontSize: 10 }}>
              {tokens.filter(t => detectNarrative(t) === getTrendingNarrative(tokens)).length} tokens
            </span>
          </div>

          {/* Filter by Narrative Buttons */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: '#666', fontSize: 10, marginBottom: 8 }}>Filter by Narrative:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {getUniqueNarratives(tokens).map(({ narrative, count }) => (
                <button
                  key={narrative}
                  onClick={() => { setSelectedNarrative(narrative); setCurrentPage(1); }}
                  style={{
                    background: selectedNarrative === narrative ? '#f5a623' : '#2a2a2a',
                    border: `1px solid ${selectedNarrative === narrative ? '#f5a623' : '#444'}`,
                    color: selectedNarrative === narrative ? '#1a1a1a' : '#e8e8e8',
                    padding: '4px 12px', borderRadius: 20,
                    fontSize: 11, fontWeight: 'bold', cursor: 'pointer',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {narrative === 'all' ? 'All' : narrative}
                  <span style={{
                    background: selectedNarrative === narrative ? '#1a1a1a' : '#444',
                    color: selectedNarrative === narrative ? '#f5a623' : '#aaa',
                    borderRadius: 10, padding: '1px 6px', fontSize: 9,
                  }}>{count}</span>
                </button>
              ))}
            </div>
          </div>

          {/* New Born Alert */}
          <div style={{
            background: '#0a2a1a', border: '1px solid #22c55e44',
            borderRadius: 6, padding: '8px 12px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 16, color: '#22c55e' }}>[!]</span>
            <div>
              <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 'bold' }}>NEW BORN DETECTED!</span>
              <span style={{ color: '#888', fontSize: 10, marginLeft: 8 }}>
                {tokens.filter(t => t.ageHours < 1).length} tokens launched in last hour
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Result summary ── */}
      {!loading && tokens.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <span style={{ color: '#777', fontSize: 12 }}>
            Ditemukan&nbsp;
            <strong style={{ color: '#5cb85c' }}>{tokens.length}</strong>
            &nbsp;token potensial
          </span>
          <div style={{ flex: 1, height: 1, background: '#2e2e2e' }} />
        </div>
      )}

      {/* ── Loading skeletons ── */}
      {loading && (
        <div className="token-grid">
          {[...Array(6)].map((_, i) => <TokenSkeleton key={i} />)}
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && tokens.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: '#1e1e1e', border: '1px dashed #3a3a3a',
        }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#2a2a2a', margin: '0 auto 16px', opacity: 0.4 }} />
          <h3 style={{ color: '#888', fontSize: 14, fontWeight: 'bold', marginBottom: 6 }}>Tidak ada gem ditemukan</h3>
          <p style={{ color: '#555', fontSize: 12 }}>Coba longgarkan filter atau ganti scan mode.</p>
        </div>
      )}

      {/* ── Token Grid ── */}
      {!loading && tokens.length > 0 && (
        <>
          <div className="token-grid">
            {(preset === 'narrative' && selectedNarrative !== 'all'
              ? tokens.filter(t => detectNarrative(t) === selectedNarrative)
              : tokens
            )
              .slice((currentPage - 1) * tokensPerPage, currentPage * tokensPerPage)
              .map(token => (
                <TokenCard key={token.address} token={token} onSwap={() => onSwapOpen(token)} />
              ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                style={{
                  background: '#2e2e2e', border: '1px solid #555',
                  color: currentPage === 1 ? '#444' : '#e8e8e8',
                  padding: '6px 18px', fontSize: 12, fontWeight: 'bold',
                  cursor: currentPage === 1 ? 'default' : 'pointer',
                }}
              >← Prev</button>
              <span style={{ color: '#777', fontSize: 12 }}>
                {currentPage} / {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                style={{
                  background: '#2e2e2e', border: '1px solid #555',
                  color: currentPage === totalPages ? '#444' : '#e8e8e8',
                  padding: '6px 18px', fontSize: 12, fontWeight: 'bold',
                  cursor: currentPage === totalPages ? 'default' : 'pointer',
                }}
              >Next →</button>
            </div>
          )}
        </>
      )}

      {/* ── Swap Modal ── */}
      {swapToken !== undefined && (
        <SwapModal
          key={swapToken?.address || 'general'}
          token={swapToken}
          onClose={onSwapClose}
        />
      )}
    </div>
  );
};
