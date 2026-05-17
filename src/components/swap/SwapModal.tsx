'use client';

import React, { useState } from 'react';
import type { TokenData } from '../../lib/types';
import SwapUI from './SwapUI';

interface SwapModalProps {
  token: TokenData | null;
  onClose: () => void;
}

export const SwapModal: React.FC<SwapModalProps> = ({ token, onClose }) => {
  // Jika token ada, tampilkan info di header modal
  const headerLabel = token
    ? `Swap SOL → ${token.simbol}`
    : 'Quick Swap';

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: '#1e1e1e', border: '1px solid #555',
        borderTop: '3px solid #f5a623',
        width: '100%', maxWidth: 480,
        display: 'flex', flexDirection: 'column',
        maxHeight: '92vh', overflow: 'hidden',
      }}>
        {/* Header - improved */}
        <div style={{ padding: '12px 16px', background: '#1a1a2a', borderBottom: '1px solid #333', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {token?.imageUrl && <img src={token.imageUrl} alt="" style={{ width: 26, height: 26, borderRadius: '50%', border: '1px solid #444' }} onError={e => (e.target as any).style.display = 'none'} />}
            <div>
              <div style={{ fontWeight: 'bold', fontSize: 13, color: '#e8e8e8' }}>
                {token ? `Swap → ${token.simbol}` : 'Quick Swap'}
              </div>
              {token && <div style={{ color: '#666', fontSize: 10, fontFamily: 'monospace' }}>{token.address.slice(0,10)}...{token.address.slice(-6)}</div>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#888', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {/* SwapUI — pass token sebagai initialToToken */}
        <div style={{ padding: '10px 14px', background: '#222', flex: 1, overflowY: 'auto' }}>
          <SwapUI initialToToken={token ?? undefined} />
        </div>

        {/* Footer */}
        <div style={{ padding: '4px 14px', background: '#1a1a1a', borderTop: '1px solid #2a2a2a', flexShrink: 0 }}>
          <span style={{ color: '#444', fontSize: 9, fontFamily: 'monospace', letterSpacing: '.08em' }}>
            POWERED BY OUR OWN IMPLEMENTATION • FEE 0.5%
          </span>
        </div>
      </div>
    </div>
  );
};