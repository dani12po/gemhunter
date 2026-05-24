'use client';

import React, { useState } from 'react';
import type { TokenData } from '../../lib/types';
import { formatAngka, formatHarga, formatUmur, fmtNum } from '../../lib/format';
import { getBadgeClass } from '../../lib/scoring';

interface TokenCardProps {
  token: TokenData;
  onSwap: (token: TokenData) => void;
}

export const TokenCard: React.FC<TokenCardProps> = ({ token, onSwap }) => {
  const [copied, setCopied] = useState(false);
  const [showRisk, setShowRisk] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(token.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenPumpFun = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(`https://pump.fun/coin/${token.address}`, '_blank', 'noopener,noreferrer');
  };

  // Deteksi narrative berdasarkan nama/simbol token
  const getNarrativeBadge = (): { label: string; color: string } => {
    const name = token.nama?.toLowerCase() || '';
    const symbol = token.simbol?.toLowerCase() || '';
    if (name.includes('ai') || name.includes('agent') || symbol.includes('ai'))
      return { label: 'AI', color: '#9b59b6' };
    if (name.includes('cat') || name.includes('dog') || name.includes('pepe') || name.includes('meme') || name.includes('frog'))
      return { label: 'Meme', color: '#f39c12' };
    if (name.includes('depin') || name.includes('network') || name.includes('node'))
      return { label: 'DePIN', color: '#3498db' };
    if (name.includes('real') || name.includes('asset') || symbol.includes('rwa'))
      return { label: 'RWA', color: '#27ae60' };
    if (name.includes('game') || name.includes('play') || name.includes('p2e'))
      return { label: 'Game', color: '#e74c3c' };
    if (name.includes('defi') || name.includes('swap') || name.includes('yield'))
      return { label: 'DeFi', color: '#1abc9c' };
    if (name.includes('social') || name.includes('friend'))
      return { label: 'Social', color: '#e67e22' };
    if (name.includes('launch') || name.includes('presale'))
      return { label: 'Launch', color: '#8e44ad' };
    return { label: 'New', color: '#888' };
  };

  const narrativeBadge = getNarrativeBadge();

  return (
    <div style={{
      background:'#242424',
      border:'1px solid #444',
      borderTop: `2px solid ${token.skor >= 70 ? '#f5a623' : token.skor >= 50 ? '#5b9bd5' : '#555'}`,
      marginBottom:0,
    }}>
      {/* Card header */}
      <div className="token-card-header">
        <div className="token-card-left">
          {token.imageUrl && (
            <img src={token.imageUrl} alt={token.nama}
              style={{ width:28, height:28, border:'1px solid #555' }}
              onError={e => { (e.target as HTMLImageElement).style.display='none'; }}
            />
          )}
          <div>
            <span style={{ fontWeight:'bold', color:'#e8e8e8', fontSize:13 }}>{token.nama}</span>
            <span style={{ color:'#888', fontSize:11, marginLeft:6 }}>{token.simbol}</span>
          </div>
          {token.isBoosted && (
            <span style={{
              background:'#4a3000', border:'1px solid #f5a623',
              color:'#f5a623', fontSize:9, padding:'1px 5px', fontWeight:'bold',
            }}>BOOSTED</span>
          )}
          {/* Narrative badge */}
          <span style={{
            background: `${narrativeBadge.color}22`,
            border: `1px solid ${narrativeBadge.color}`,
            borderRadius: 12,
            color: narrativeBadge.color,
            padding: '2px 8px',
            fontSize: 9,
            fontWeight: 'bold',
          }}>
            {narrativeBadge.label}
          </span>
        </div>
        <div className="token-card-right">
          <span style={{
            background: token.skor >= 70 ? '#2a3a0a' : token.skor >= 50 ? '#1a2a3a' : '#2a1a1a',
            border: `1px solid ${token.skor >= 70 ? '#5cb85c' : token.skor >= 50 ? '#5b9bd5' : '#d9534f'}`,
            color: token.skor >= 70 ? '#5cb85c' : token.skor >= 50 ? '#5b9bd5' : '#d9534f',
            fontSize:10, padding:'2px 7px', fontWeight:'bold',
          }}>SCORE {token.skor}</span>
          <button onClick={() => onSwap(token)} className="btn-classic btn-accent" style={{ fontSize:11, padding:'4px 10px' }}>
            SWAP
          </button>
        </div>
      </div>

      {/* Risk Badge */}
      {token.risk && (
        <div
          onClick={() => setShowRisk(!showRisk)}
          style={{
            padding: '4px 12px',
            background: token.risk.score === 'HIGH' ? '#450a0a' : token.risk.score === 'MEDIUM' ? '#451a03' : '#064e3b',
            borderBottom: '1px solid #333',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            cursor: 'pointer'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: token.risk.score === 'HIGH' ? '#ef4444' : token.risk.score === 'MEDIUM' ? '#f59e0b' : '#22c55e'
            }} />
            <span style={{
              fontSize: 10, fontWeight: 'bold',
              color: token.risk.score === 'HIGH' ? '#fca5a5' : token.risk.score === 'MEDIUM' ? '#fcd34d' : '#6ee7b7'
            }}>
              {token.risk.score} RISK
            </span>
          </div>
          <span style={{ fontSize: 10, color: '#888' }}>{showRisk ? '▲ Hide' : '▼ Details'}</span>
        </div>
      )}

      {/* Risk Details */}
      {showRisk && token.risk && (
        <div style={{
          padding: '8px 12px',
          background: '#1a1a1a',
          borderBottom: '1px solid #333',
          fontSize: 10,
          display: 'flex',
          flexDirection: 'column',
          gap: 4
        }}>
          {token.risk.flags.map((flag, i) => (
            <div key={i} style={{
              color: flag.startsWith('[OK]') ? '#22c55e' : '#ef4444',
              display: 'flex',
              alignItems: 'center',
              gap: 4
            }}>
              {flag}
            </div>
          ))}
        </div>
      )}

      {/* Data grid */}
      <div style={{
        display:'grid', gridTemplateColumns:'1fr 1fr 1fr',
        gap:0,
        borderBottom:'1px solid #333',
      }}>
        {[
          { label:'Price', value:`$${formatHarga(token.harga)}` },
          { label:'1h Change', value:`${token.priceChange1h>=0?'▲':'▼'} ${Math.abs(token.priceChange1h).toFixed(2)}%`, color: token.priceChange1h>=0?'#5cb85c':'#d9534f' },
          { label:'Liquidity', value:`$${formatAngka(token.liquidity)}` },
          { label:'Volume 24h', value:`$${formatAngka(token.volume24h)}` },
          { label:'Age', value:formatUmur(token.ageHours) },
          { label:'Buy/Sell', value:`${fmtNum(token.buys24h)}/${fmtNum(token.sells24h)}` },
        ].map(({label,value,color}) => (
          <div key={label} style={{
            padding:'6px 10px',
            borderRight:'1px solid #333',
            borderBottom:'1px solid #2a2a2a',
          }}>
            <div style={{ color:'#777', fontSize:10, textTransform:'uppercase', letterSpacing:'.04em', marginBottom:2 }}>{label}</div>
            <div style={{ color: color || '#e8e8e8', fontFamily:'monospace', fontSize:12, fontWeight:'bold' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Address + links */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'5px 10px', background:'#1e1e1e' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button
            onClick={handleCopy}
            style={{
              background:'none', border:'none', color:'#666', fontFamily:'monospace',
              fontSize:10, cursor:'pointer', padding:0,
            }}
          >
            {copied ? 'COPIED' : `${token.address.slice(0,8)}...${token.address.slice(-6)}`}
          </button>
          {/* Pump.fun button */}
          <button
            onClick={handleOpenPumpFun}
            style={{
              background: '#2a1a0a',
              border: '1px solid #f5a623',
              borderRadius: 4,
              color: '#f5a623',
              padding: '2px 8px',
              fontSize: 10,
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'all 0.2s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f5a623'; e.currentTarget.style.color = '#1a1a1a'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#2a1a0a'; e.currentTarget.style.color = '#f5a623'; }}
          >
            Pump.fun
          </button>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          {token.website && <a href={token.website} target="_blank" rel="noopener noreferrer" style={{ color:'#888', fontSize:10 }}>WEB</a>}
          {token.twitter && <a href={token.twitter} target="_blank" rel="noopener noreferrer" style={{ color:'#888', fontSize:10 }}>TWT</a>}
          {token.telegram && <a href={token.telegram} target="_blank" rel="noopener noreferrer" style={{ color:'#888', fontSize:10 }}>TG</a>}
        </div>
      </div>

      {/* Red flags */}
      {token.redFlags.length > 0 && (
        <div style={{
          background:'#2a1515', border:'none', borderTop:'1px solid #551111',
          padding:'4px 10px',
          color:'#d9534f', fontSize:10,
        }}>
           {token.redFlags.join(' • ')}
        </div>
      )}
    </div>
  );
};