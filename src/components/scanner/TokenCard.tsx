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

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(token.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // TAMBAHAN: Fungsi untuk membuka pump.fun dengan token address
  const handleOpenPumpFun = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `https://pump.fun/coin/${token.address}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div style={{
      background:'#242424',
      border:'1px solid #444',
      borderTop: `2px solid ${token.skor >= 70 ? '#f5a623' : token.skor >= 50 ? '#5b9bd5' : '#555'}`,
      marginBottom:0,
    }}>
      {/* Card header */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'8px 12px',
        background:'#2e2e2e',
        borderBottom:'1px solid #3a3a3a',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
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

          {/*---------------------------------------------------  */}
          {/* TAMBAHAN: Badge untuk menandai token yang baru listing (umur < 6 jam) */}
          {(() => {
            const name = token.nama?.toLowerCase() || '';
            const symbol = token.simbol?.toLowerCase() || '';
            let narrative = '';
            let color = '';
            
            if (name.includes('ai') || name.includes('agent')) { narrative = '🤖 AI'; color = '#9b59b6'; }
            else if (name.includes('cat') || name.includes('dog') || name.includes('pepe')) { narrative = '🐱 Meme'; color = '#f39c12'; }
            else if (name.includes('depin') || name.includes('network')) { narrative = '🏗️ DePIN'; color = '#3498db'; }
            else if (name.includes('game') || name.includes('play')) { narrative = '🎮 Game'; color = '#e74c3c'; }
            else if (name.includes('defi')) { narrative = '💱 DeFi'; color = '#1abc9c'; }
            else { narrative = '🆕 New'; color = '#888'; }
            
            return (
              <span style={{
                background: `${color}22`,
                border: `1px solid ${color}`,
                borderRadius: 12,
                color: color,
                padding: '2px 8px',
                fontSize: 9,
                fontWeight: 'bold',
                marginLeft: 8,
              }}>
                {narrative}
              </span>
            );
          })()}
          {/* ------------------------------------------------------- */}
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{
            background: token.skor >= 70 ? '#2a3a0a' : token.skor >= 50 ? '#1a2a3a' : '#2a1a1a',
            border: `1px solid ${token.skor >= 70 ? '#5cb85c' : token.skor >= 50 ? '#5b9bd5' : '#d9534f'}`,
            color: token.skor >= 70 ? '#5cb85c' : token.skor >= 50 ? '#5b9bd5' : '#d9534f',
            fontSize:10, padding:'2px 7px', fontWeight:'bold',
          }}>SCORE {token.skor}</span>
          <button onClick={() => onSwap(token)} className="btn-classic btn-accent" style={{ fontSize:11, padding:'4px 10px' }}>
            ⚡ SWAP
          </button>
        </div>
      </div>

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
        <div style={{ display:'flex', alignItems:'center', gap: 8 }}>
          <button
            onClick={handleCopy}
            style={{
              background:'none', border:'none', color:'#666', fontFamily:'monospace',
              fontSize:10, cursor:'pointer', padding:0,
            }}
          >
            {copied ? '✓ COPIED' : `${token.address.slice(0,8)}...${token.address.slice(-6)}`}
          </button>

          {/* TAMBAHAN: Button untuk membuka pump.fun */}
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
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f5a623';
              e.currentTarget.style.color = '#1a1a1a';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#2a1a0a';
              e.currentTarget.style.color = '#f5a623';
            }}
          >
            🚀 Pump
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