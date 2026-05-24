'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useWalletNetwork } from '../../hooks/useWalletNetwork';

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
  { label: 'Scanner',      href: '/',              exact: true  },
  { label: 'Create Token', href: '/create-token',  exact: false },
  { label: 'Liquidity',    href: '/liquidity',     exact: false },
  { label: 'Burn LP',      href: '/burn-liquidity',exact: false },
];

const presets = ['gem', 'safe', 'degen', 'narrative', 'custom'];

export const Header: React.FC<HeaderProps> = ({
  scanMode, onScanModeChange, preset, onPresetChange, onSwapOpen,
}) => {
  const pathname = usePathname();
  const [mounted, setMounted]       = useState(false);
  const [menuOpen, setMenuOpen]     = useState(false);
  const { network, label }          = useWalletNetwork();

  useEffect(() => { setMounted(true); }, []);
  // Close menu on route change
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const isScanner = pathname === '/' || pathname === '/dashboard/scanner';

  const netColor = network === 'mainnet-beta' ? '#5cb85c'
                 : network === 'devnet'       ? '#5b9bd5'
                 : '#f5a623';
  const netBg    = network === 'mainnet-beta' ? '#1a2a0a'
                 : network === 'devnet'       ? '#1a1a2a'
                 : '#2a1a0a';

  return (
    <header style={{
      background: '#1e1e1e',
      borderBottom: '2px solid #f5a623',
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 12px' }}>

        {/* ── Top bar ── */}
        <div style={{ display: 'flex', alignItems: 'center', height: 48, gap: 8 }}>

          {/* Logo */}
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none', flexShrink: 0 }}>
            <span style={{ color: '#f5a623', fontSize: 16, fontWeight: 'bold', lineHeight: 1 }}>●</span>
            <span style={{ color: '#e8e8e8', fontSize: 14, fontWeight: 'bold', fontFamily: 'Trebuchet MS', whiteSpace: 'nowrap' }}>
              Gem Hunter
            </span>
            <span style={{ background: '#333', border: '1px solid #555', color: '#aaa', fontSize: 9, padding: '1px 5px' }}>
              BETA
            </span>
          </Link>

          {/* Desktop nav — hidden on mobile via CSS */}
          <nav className="desktop-nav" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {navItems.map(item => (
              <Link key={item.href} href={item.href} style={{
                display: 'block', padding: '14px 12px',
                borderRight: '1px solid #333',
                background: isActive(item.href, item.exact) ? '#2e2e2e' : 'transparent',
                borderBottom: isActive(item.href, item.exact) ? '2px solid #f5a623' : '2px solid transparent',
                color: isActive(item.href, item.exact) ? '#f5a623' : '#aaa',
                fontSize: 11, fontWeight: 'bold', textDecoration: 'none',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}>
                {item.label}
              </Link>
            ))}
          </nav>

          {/* Right side */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0 }}>
            {/* Network badge */}
            {mounted && label && (
              <span style={{
                fontSize: 9, fontWeight: 'bold', padding: '2px 6px', borderRadius: 3,
                background: netBg, border: `1px solid ${netColor}`, color: netColor,
                whiteSpace: 'nowrap',
              }}>
                {label}
              </span>
            )}
            {/* Wallet button */}
            {mounted && <WalletMultiButtonDynamic className="btn-classic" />}
            {/* Hamburger — shown on mobile via CSS */}
            <button
              className="hamburger-btn"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Menu"
              style={{
                display: 'none', // shown via CSS on mobile
                background: 'none', border: '1px solid #444',
                color: '#e8e8e8', padding: '6px 8px', cursor: 'pointer',
                fontSize: 16, lineHeight: 1, borderRadius: 4,
              }}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
          </div>
        </div>

        {/* ── Mobile dropdown menu ── */}
        {menuOpen && (
          <div className="mobile-menu" style={{
            borderTop: '1px solid #333', background: '#1a1a1a',
            display: 'flex', flexDirection: 'column',
          }}>
            {navItems.map(item => (
              <Link key={item.href} href={item.href} style={{
                padding: '12px 16px',
                borderBottom: '1px solid #2a2a2a',
                color: isActive(item.href, item.exact) ? '#f5a623' : '#aaa',
                fontSize: 13, fontWeight: 'bold', textDecoration: 'none',
                background: isActive(item.href, item.exact) ? '#2e2e2e' : 'transparent',
              }}>
                {item.label}
              </Link>
            ))}
          </div>
        )}

        {/* ── Scanner controls bar ── */}
        {isScanner && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 0', borderTop: '1px solid #333',
            flexWrap: 'wrap',
          }}>
            {/* Mode select */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <label style={{ color: '#aaa', fontSize: 11 }}>Mode:</label>
              <select
                value={scanMode}
                onChange={e => onScanModeChange?.(e.target.value as any)}
                style={{
                  background: '#2e2e2e', border: '1px solid #555', color: '#e8e8e8',
                  padding: '3px 6px', fontSize: 11, cursor: 'pointer', borderRadius: 3,
                }}
              >
                <option value="latest">Latest</option>
                <option value="boosted">Boosted</option>
                <option value="both">Both</option>
              </select>
            </div>

            {/* Preset buttons */}
            <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {presets.map(p => (
                <button
                  key={p}
                  onClick={() => onPresetChange?.(p)}
                  className={preset === p ? 'btn-classic btn-accent' : 'btn-classic'}
                  style={{ fontSize: 10, padding: '3px 8px' }}
                >
                  {p === 'gem'       && 'Gem'}
                  {p === 'safe'      && 'Safe'}
                  {p === 'degen'     && 'Degen'}
                  {p === 'narrative' && 'Narrative'}
                  {p === 'custom'    && 'Custom'}
                </button>
              ))}
            </div>

            {/* Quick Swap */}
            <button
              onClick={onSwapOpen}
              className="btn-classic btn-accent"
              style={{ fontSize: 11, marginLeft: 'auto', flexShrink: 0 }}
            >
              Quick Swap
            </button>
          </div>
        )}
      </div>
    </header>
  );
};
