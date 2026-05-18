'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';

const WalletMultiButtonDynamic = dynamic(
  async () => (await import('@solana/wallet-adapter-react-ui')).WalletMultiButton,
  { ssr: false }
);

interface HeaderProps {
  scanMode?: 'latest' | 'boosted' | 'both';
  onScanModeChange?: (mode: 'latest' | 'boosted' | 'both') => void;
  preset?: string;
  onPresetChange?: (preset: string) => void;
  onSwapOpen: () => void;
}

const navItems = [
  { label: 'Scanner', href: '/', exact: true },
  { label: '🪙 Create Token', href: '/create-token', exact: false },
  { label: '💧 Liquidity', href: '/liquidity', exact: false },
  { label: '🔥 Burn Liquidity', href: '/burn-liquidity', exact: false } // BARU -> Menu Burn Liq.
];

// TAMBAHAN: MENU NARRATIVE (untuk menampilkan cerita atau analisis mendalam tentang token tertentu, bisa diisi dengan artikel, grafik, dll. Konten ini bisa dibuat secara manual untuk beberapa token populer atau berdasarkan template yang diisi otomatis jika data tersedia)
const presets = ['gem', 'safe', 'degen', 'custom', 'narrative'];

export const Header: React.FC<HeaderProps> = ({
  scanMode,
  onScanModeChange,
  preset,
  onPresetChange,
  onSwapOpen,
}) => {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isActive = (href: string, exact: boolean) => {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  };

  return (
    <header style={{
      background: '#1e1e1e',
      borderBottom: '2px solid #f5a623',
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px' }}>
        {/* Top bar */}
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', height: 48 }}>
          <Link href="/" style={{ display:'flex', alignItems:'center', gap:8, textDecoration:'none' }}>
            <span style={{ color:'#f5a623', fontSize:18, fontWeight:'bold' }}>●</span>
            <span style={{ color:'#e8e8e8', fontSize:16, fontWeight:'bold', fontFamily:'Trebuchet MS' }}>
              Solana Gem Hunter
            </span>
            <span style={{ 
              background:'#333', border:'1px solid #555', color:'#aaa',
              fontSize:10, padding:'1px 6px', marginLeft:4
            }}>BETA</span>
          </Link>

          <nav style={{ display:'flex', gap:0 }}>
            {navItems.map(item => (
              <Link key={item.href} href={item.href} style={{
                display:'block', padding:'14px 16px',
                borderRight: '1px solid #333',
                background: isActive(item.href, item.exact) ? '#2e2e2e' : 'transparent',
                borderBottom: isActive(item.href, item.exact) ? '2px solid #f5a623' : '2px solid transparent',
                color: isActive(item.href, item.exact) ? '#f5a623' : '#aaa',
                fontSize: 12, fontWeight:'bold', textDecoration:'none',
                transition: 'color 0.1s',
              }}>
                {item.label}
              </Link>
            ))}
          </nav>

          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            {mounted && <WalletMultiButtonDynamic className="btn-classic" />}
          </div>
        </div>

        {/* Controls bar (scanner only) */}
        {(pathname === '/' || pathname === '/dashboard/scanner') && (
          <div style={{
            display:'flex', alignItems:'center', gap:12,
            padding:'6px 0', borderTop:'1px solid #333',
          }}>
            <label style={{ color:'#aaa', fontSize:11 }}>Mode:</label>
            <select
              value={scanMode}
              onChange={e => onScanModeChange?.(e.target.value as any)}
              style={{
                background:'#2e2e2e', border:'1px solid #555', color:'#e8e8e8',
                padding:'3px 8px', fontSize:12, cursor:'pointer',
              }}
            >
              <option value="latest">Latest</option>
              <option value="boosted">Boosted</option>
              <option value="both">Both</option>
            </select>

            <div style={{ display:'flex', gap:1, marginLeft:8 }}>
              {presets.map(p => (
                <button
                  key={p}
                  onClick={() => onPresetChange?.(p)}
                  className={preset === p ? 'btn-classic btn-accent' : 'btn-classic'}
                  style={{ fontSize:11 }}
                >
                  {p === 'gem' && 'Gem'}
                  {p === 'safe' && '■ Safe'}
                  {p === 'degen' && '▲ Degen'}
                  {p === 'custom' && 'Custom'}

                  {/* TAMBAHAN: Button untuk menampilkan cerita atau analisis mendalam tentang token */}
                  {p === 'narrative' && '📖 Narrative'}
                </button>
              ))}
            </div>

            <div style={{ marginLeft:'auto' }}>
              <button onClick={onSwapOpen} className="btn-classic btn-accent" style={{ fontSize:12 }}>
                 Quick Swap
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};