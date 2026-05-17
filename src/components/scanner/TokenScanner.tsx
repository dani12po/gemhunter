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
}

const labelMap: Record<keyof FilterData, string> = {
  'liquidityMin': 'Liq min ($)',
  'volumeMin':    'Vol min ($)',
  'ageMaxJam':    'Umur maks (j)',
  'delta1jMin':   'Δ1j min (%)',
  'txnMin':       'Txn min',
  'mcapMax':      'MCap maks ($)',
  'liqMax':       'Liq maks ($)',
};

// FIX BUG #4: Header baru tingginya 48px (top) + ~38px (controls) = 86px.
// Gunakan paddingTop: 96px agar ada sedikit margin.
const HEADER_HEIGHT = 96;

export const TokenScanner: React.FC<TokenScannerProps> = ({
  tokens, loading, error, searchQuery, onSearchChange,
  filter, onFilterChange, onSwapOpen, swapToken, onSwapClose,
  stats, onExport, onRefresh,
}) => {
  const [currentPage, setCurrentPage] = React.useState(1);
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
    { label: 'Total',       value: stats.total,   color: '#e8e8e8', accent: '#555' },
     { label: 'Gems',      value: stats.gems,    color: '#f5a623', accent: '#f5a623' },
    { label: 'Mid',         value: stats.mid,     color: '#e8e8e8', accent: '#555' },
    { label: '▲ Boosted',   value: stats.boosted, color: '#5cb85c', accent: '#5cb85c' },
    { label: 'New (1h)',    value: stats.new,     color: '#5b9bd5', accent: '#5b9bd5' },
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
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(5, 1fr)', 
        gap: 8, 
        marginBottom: 20,
        padding: '0 8px',
      }}>
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
              placeholder="Cari nama, simbol, atau address..."
              value={searchQuery}
              onChange={e => onSearchChange(e.target.value)}
              style={{
                width: '100%',
                background: '#1e1e1e',
                border: '1px solid #444',
                color: '#e8e8e8',
                padding: '7px 10px 7px 34px',
                fontSize: 12,
                outline: 'none',
                fontFamily: 'Trebuchet MS, Verdana, sans-serif',
              }}
            />
            <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#555', fontSize: 14 }}>🔎</span>
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
          >📊 Export</button>
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
        <div style={{ color: '#777', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 10 }}>
          Quick Filters
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
          {(Object.entries(labelMap) as [keyof FilterData, string][]).map(([key, label]) => (
            <div key={key}>
              <div style={{ color: '#666', fontSize: 10, marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {label}
              </div>
              <input
                type="number"
                value={filter[key]}
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {[...Array(6)].map((_, i) => <TokenSkeleton key={i} />)}
        </div>
      )}

      {/* ── Empty state ── */}
      {!loading && tokens.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          background: '#1e1e1e', border: '1px dashed #3a3a3a',
        }}>
            <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>●</div>
          <h3 style={{ color: '#888', fontSize: 14, fontWeight: 'bold', marginBottom: 6 }}>Tidak ada gem ditemukan</h3>
          <p style={{ color: '#555', fontSize: 12 }}>Coba longgarkan filter atau ganti scan mode.</p>
        </div>
      )}

      {/* ── Token Grid ── */}
      {!loading && tokens.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 24 }}>
            {tokens
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