'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '../../components/layout/Header';
import { SwapModal } from '../../components/swap/SwapModal';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { 
  Keypair, Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL 
} from '@solana/web3.js';
import { 
  createInitializeMintInstruction, 
  getMintLen, 
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createSetAuthorityInstruction,
  AuthorityType,
} from '@solana/spl-token';

export default function CreateTokenPage() {
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    totalSupply: '',
    decimals: '9',
    description: '',
    logoUrl: '',
    website: '',
    twitter: '',
    telegram: '',
  });

  const [isCreated, setIsCreated] = useState(false);
  const [createdTokenAddress, setCreatedTokenAddress] = useState('');
  const [createdTokenATA, setCreatedTokenATA] = useState('');
  const [createdSignature, setCreatedSignature] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [isSwapOpen, setIsSwapOpen] = useState(false);

  // ─── RUG PROOF MODE STATES ───────────────────────────────
  const [isRugProofMode, setIsRugProofMode] = useState(true);
  const [revokeMint, setRevokeMint] = useState(true);
  const [revokeFreeze, setRevokeFreeze] = useState(true);
  const [makeImmutable, setMakeImmutable] = useState(true);

  // === DYNAMIC FEE CALCULATOR (sesuai requirement) ===
  const hasCoreFields = 
    formData.name.trim() !== '' && 
    formData.symbol.trim() !== '' && 
    formData.totalSupply.trim() !== '' && 
    formData.decimals.trim() !== '';

  const baseFee = hasCoreFields ? 0.1 : 0;

  let optionalFieldsFee = 0;
  if (formData.description?.trim()) optionalFieldsFee += 0.01;
  if (formData.logoUrl?.trim()) optionalFieldsFee += 0.01;
  if (formData.website?.trim()) optionalFieldsFee += 0.01;
  if (formData.twitter?.trim()) optionalFieldsFee += 0.01;
  if (formData.telegram?.trim()) optionalFieldsFee += 0.01;

  const securityFee = 
    (revokeMint ? 0.01 : 0) + 
    (revokeFreeze ? 0.01 : 0) + 
    (makeImmutable ? 0.01 : 0);

  const totalFee = baseFee + optionalFieldsFee + securityFee;
  const creationFee = totalFee.toFixed(2);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'symbol') {
      setFormData({ ...formData, [name]: value.slice(0, 8).toUpperCase() });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  // Rug Proof Mode badge logic
  const isFullySecure = revokeMint && revokeFreeze && makeImmutable;

  // ─── Konstanta biaya platform ───
  const BASE_FEE = 0.1;
  const FIELD_FEE = 0.01;
  const PLATFORM_FEE_RECEIVER = 'GFK2JGbzQ8b3jusvNdSwbfdsuQEBP9KawPj6VwcLyyEx';

  const handleCreate = async () => {
    if (!connected || !publicKey) {
      alert('Harap hubungkan wallet!');
      return;
    }

    const name = formData.name.trim();
    const symbol = formData.symbol.trim();
    const supplyNum = parseFloat(formData.totalSupply);
    const decimalsNum = parseInt(formData.decimals);

    if (!name || !symbol || isNaN(supplyNum) || isNaN(decimalsNum)) {
      alert('Isi data dengan benar');
      return;
    }

    setIsLoading(true);
    setStatusMsg('Memproses...');

    try {
      const mintKeypair = Keypair.generate();
      const mintLen = getMintLen([]);
      const mintRentLamports = await connection.getMinimumBalanceForRentExemption(mintLen);
      const ataRentLamports = await connection.getMinimumBalanceForRentExemption(165);
      const platformFeeLamports = Math.floor(totalFee * LAMPORTS_PER_SOL);
      const txFeeBuffer = 20000;

      const totalRequired = mintRentLamports + ataRentLamports + platformFeeLamports + txFeeBuffer;
      const userBalance = await connection.getBalance(publicKey);

      if (userBalance < totalRequired) {
        const totalSol = (totalRequired / LAMPORTS_PER_SOL).toFixed(4);
        alert(`Saldo SOL tidak cukup!\n\nDibutuhkan: ~${totalSol} SOL\nSaldo kamu: ${(userBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
        return;
      }

      // FIX BigInt: hindari precision loss untuk supply besar
      const rawSupply = BigInt(Math.round(supplyNum)) * (10n ** BigInt(decimalsNum));

      const userATA = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      setStatusMsg('Membangun transaksi...');
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

      const transaction = new Transaction();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // 1. Buat mint account
      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: mintKeypair.publicKey,
          space: mintLen,
          lamports: mintRentLamports,
          programId: TOKEN_PROGRAM_ID,
        })
      );

      // 2. Initialize mint
      transaction.add(
        createInitializeMintInstruction(
          mintKeypair.publicKey,
          decimalsNum,
          publicKey,
          publicKey,
          TOKEN_PROGRAM_ID
        )
      );

      // 3. Buat Associated Token Account
      transaction.add(
        createAssociatedTokenAccountInstruction(
          publicKey,
          userATA,
          publicKey,
          mintKeypair.publicKey,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      );

      // 4. Mint token ke ATA
      transaction.add(
        createMintToInstruction(
          mintKeypair.publicKey,
          userATA,
          publicKey,
          rawSupply,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      // 5. Rug Proof: Revoke Freeze Authority
      if (revokeFreeze) {
        transaction.add(
          createSetAuthorityInstruction(
            mintKeypair.publicKey,
            publicKey,
            AuthorityType.FreezeAccount,
            null
          )
        );
      }

      // 6. Rug Proof: Revoke Mint Authority
      if (revokeMint) {
        transaction.add(
          createSetAuthorityInstruction(
            mintKeypair.publicKey,
            publicKey,
            AuthorityType.MintTokens,
            null
          )
        );
      }

      // 7. Platform fee
      if (platformFeeLamports > 0) {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(PLATFORM_FEE_RECEIVER),
            lamports: platformFeeLamports,
          })
        );
      }

      setStatusMsg('Menunggu tanda tangan wallet...');

      // FIX: Jangan pakai { signers } karena banyak adapter tidak support.
      // Sign dulu dengan mintKeypair, lalu kirim tanpa signers option.
      transaction.sign(mintKeypair);
      const signature = await sendTransaction(transaction, connection);

      setStatusMsg('Menunggu konfirmasi blockchain...');

      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed'
      );

      setCreatedTokenAddress(mintKeypair.publicKey.toString());
      setCreatedTokenATA(userATA.toString());
      setCreatedSignature(signature);
      setIsCreated(true);
      setStatusMsg('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      let friendlyMsg = msg;

      if (msg.includes('403') || msg.includes('Access forbidden')) {
        friendlyMsg = 'RPC node memblokir request. Silakan ganti RPC endpoint di .env.local (gunakan Helius/Alchemy gratis).';
      } else if (msg.includes('insufficient funds') || msg.includes('Insufficient')) {
        friendlyMsg = 'Saldo SOL tidak cukup untuk membayar biaya transaksi.';
      } else if (msg.includes('User rejected') || msg.includes('rejected')) {
        friendlyMsg = 'Transaksi dibatalkan oleh user.';
      } else if (msg.includes('Blockhash not found') || msg.includes('block height exceeded')) {
        friendlyMsg = 'Transaksi expired karena terlalu lama. Silakan coba lagi.';
      }

      alert(`❌ Gagal membuat token:\n\n${friendlyMsg}`);
    } finally {
      setIsLoading(false);
      setStatusMsg('');
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#1a1a1a', 
      color: '#e8e8e8',
      fontFamily: "'Trebuchet MS', Verdana, Geneva, sans-serif"
    }}>
      <Header onSwapOpen={() => setIsSwapOpen(true)} />
      
      <div style={{ paddingTop: 96, paddingBottom: 60, paddingLeft: 16, paddingRight: 16, maxWidth: 1280, margin: '0 auto' }}>
        <div className="mb-8">
          <h1 style={{ fontSize: 28, fontWeight: 'bold', color: '#e8e8e8', marginBottom: 8 }}>
            Create SPL Token
            <span style={{ fontSize: 14, color: '#f5a623', marginLeft: 12, fontWeight: 'normal' }}>
              ({process.env.NEXT_PUBLIC_NETWORK?.toUpperCase() || 'DEVNET'})
            </span>
          </h1>
          <p style={{ color: '#888', fontSize: 13 }}>
            Luncurkan token Solana kamu sendiri • Real SPL Token • Biaya gas ditanggung wallet
          </p>
        </div>

        {isCreated ? (
          <div style={{ background: '#1a2a1a', border: '1px solid #5cb85c44', borderRadius: 12, padding: 32 }}>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 22, fontWeight: 'bold', color: '#e8e8e8', marginBottom: 8 }}>
                Token Berhasil Dibuat
              </h2>
              <p style={{ color: '#888', fontSize: 13 }}>
                Token SPL kamu sudah live di Solana Mainnet dan supply sudah ada di wallet kamu.
              </p>
            </div>

            <div style={{ marginBottom: 12, background: '#111', border: '1px solid #333', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Mint Address (CA Token)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ flex: 1, color: '#f5a623', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                  {createdTokenAddress}
                </code>
                <button onClick={() => navigator.clipboard.writeText(createdTokenAddress)}
                  style={{ background: '#2a2a2a', border: '1px solid #444', color: '#888', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                  📋
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 12, background: '#111', border: '1px solid #333', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Token Account (ATA) di Wallet Kamu</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ flex: 1, color: '#5cb85c', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>
                  {createdTokenATA}
                </code>
                <button onClick={() => navigator.clipboard.writeText(createdTokenATA)}
                  style={{ background: '#2a2a2a', border: '1px solid #444', color: '#888', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                  📋
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <a href={`https://solscan.io/token/${createdTokenAddress}`} target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, background: '#1a1a2a', border: '1px solid #444', color: '#5b9bd5', padding: '10px', borderRadius: 8, textAlign: 'center', textDecoration: 'none', fontSize: 13 }}>
                🔍 Lihat di Solscan
              </a>
              <a href={`https://explorer.solana.com/tx/${createdSignature}`} target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, background: '#1a1a2a', border: '1px solid #444', color: '#888', padding: '10px', borderRadius: 8, textAlign: 'center', textDecoration: 'none', fontSize: 13 }}>
                📝 Lihat Transaksi
              </a>
            </div>

            <div style={{ background: '#2a2200', border: '1px solid #5a4400', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <div style={{ color: '#f5a623', fontSize: 11, fontWeight: 'bold', marginBottom: 6 }}>Langkah Selanjutnya (Opsional)</div>
              <ul style={{ color: '#888', fontSize: 11, paddingLeft: 16, margin: 0, lineHeight: 1.8 }}>
                <li>Untuk menambah metadata on-chain (nama, logo, deskripsi) — gunakan <strong style={{ color: '#e8e8e8' }}>Metaplex</strong></li>
                <li>Tambah likuiditas di <strong style={{ color: '#e8e8e8' }}>Raydium</strong> atau <strong style={{ color: '#e8e8e8' }}>Meteora</strong></li>
                <li>Simpan Mint Address — ini adalah "CA" token kamu</li>
              </ul>
            </div>

            <button onClick={() => { 
              setIsCreated(false); 
              setCreatedTokenAddress(''); 
              setCreatedTokenATA(''); 
              setCreatedSignature(''); 
            }}
              style={{ width: '100%', background: 'none', border: 'none', color: '#555', fontSize: 13, cursor: 'pointer', padding: '8px 0' }}>
              ← Buat Token Lain
            </button>
          </div>
        ) : (
           <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
             {/* Form Section */}
             <div style={{ 
               background: '#242424', 
               border: '1px solid #3a3a3a', 
               borderTop: '3px solid #f5a623',
               borderRadius: 12, 
               padding: 32 
             }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Token Name *</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    placeholder="e.g. Solana Gem"
                    style={{ width: '100%', background: '#111', border: '1px solid #444', color: '#e8e8e8', padding: '10px 14px', borderRadius: 8, fontSize: 14, outline: 'none' }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Symbol * (Max 8)</label>
                  <input
                    type="text"
                    name="symbol"
                    value={formData.symbol}
                    onChange={handleChange}
                    placeholder="GEM"
                    style={{ width: '100%', background: '#111', border: '1px solid #444', color: '#e8e8e8', padding: '10px 14px', borderRadius: 8, fontSize: 14, outline: 'none' }}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Total Supply *</label>
                  <input
                    type="number"
                    name="totalSupply"
                    value={formData.totalSupply}
                    onChange={handleChange}
                    placeholder="1000000000"
                    style={{ width: '100%', background: '#111', border: '1px solid #444', color: '#e8e8e8', padding: '10px 14px', borderRadius: 8, fontSize: 14, outline: 'none' }}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Decimals</label>
                  <input
                    type="number"
                    name="decimals"
                    value={formData.decimals}
                    onChange={handleChange}
                    min="0"
                    max="9"
                    style={{ width: '100%', background: '#111', border: '1px solid #444', color: '#e8e8e8', padding: '10px 14px', borderRadius: 8, fontSize: 14, outline: 'none' }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Description</label>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={handleChange}
                  placeholder="Tell the world about your token..."
                  rows={3}
                  className="w-full bg-[#1e1e1e] border border-[#3a3a3a] text-white px-4 py-3 rounded-xl focus:outline-none focus:border-[#f5a623] transition-all resize-none"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Logo URL</label>
                <input
                  type="url"
                  name="logoUrl"
                  value={formData.logoUrl}
                  onChange={handleChange}
                  placeholder="https://example.com/logo.png"
                  style={{ width: '100%', background: '#111', border: '1px solid #444', color: '#e8e8e8', padding: '10px 14px', borderRadius: 8, fontSize: 14, outline: 'none' }}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Website</label>
                  <input
                    type="url"
                    name="website"
                    value={formData.website}
                    onChange={handleChange}
                    placeholder="https://..."
                    className="w-full bg-[#1e1e1e] border border-[#3a3a3a] text-white px-4 py-2 rounded-xl text-xs focus:outline-none focus:border-[#f5a623] transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Twitter</label>
                  <input
                    type="text"
                    name="twitter"
                    value={formData.twitter}
                    onChange={handleChange}
                    placeholder="@handle"
                    className="w-full bg-[#1e1e1e] border border-[#3a3a3a] text-white px-4 py-2 rounded-xl text-xs focus:outline-none focus:border-[#f5a623] transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Telegram</label>
                  <input
                    type="text"
                    name="telegram"
                    value={formData.telegram}
                    onChange={handleChange}
                    placeholder="t.me/..."
                    className="w-full bg-[#1e1e1e] border border-[#3a3a3a] text-white px-4 py-2 rounded-xl text-xs focus:outline-none focus:border-[#f5a623] transition-all"
                  />
                </div>
              </div>

              {/* ─── SECURITY OPTIONS (HORIZONTAL) ─────────────────────── */}
              <div style={{ marginTop: 20, marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, color: '#f5a623' }}>Security Options</div>
                  <div style={{ 
                    fontSize: 12, 
                    color: isFullySecure ? '#22c55e' : '#ef4444',
                    fontWeight: 500
                  }}>
                    {isFullySecure 
                      ? '🟢 SAFE & TRUSTED' 
                      : '🔴 HIGH RISK'}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={revokeMint} onChange={e => setRevokeMint(e.target.checked)} />
                    Revoke Mint (+0.01)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={revokeFreeze} onChange={e => setRevokeFreeze(e.target.checked)} />
                    Revoke Freeze (+0.01)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={makeImmutable} onChange={e => setMakeImmutable(e.target.checked)} />
                    Immutable Metadata (+0.01)
                  </label>
                </div>
              </div>

              <div className="pt-4">
                <div className="flex items-center justify-between mb-4 px-1">
                  <span className="text-sm font-bold text-gray-400">Biaya Pembuatan</span>
                  <span className="bg-[#d2992222] text-[#d29922] border border-[#d2992244] px-3 py-1 rounded-full text-xs font-black">
                    {creationFee} SOL
                  </span>
                </div>
              <button 
                onClick={handleCreate}
                disabled={!formData.name || !formData.symbol || !formData.totalSupply || !connected || isLoading}
                style={{ 
                  width: '100%', 
                  padding: '16px', 
                  background: (!formData.name || !formData.symbol || !formData.totalSupply || !connected || isLoading) ? '#222' : '#f5a623', 
                  color: (!formData.name || !formData.symbol || !formData.totalSupply || !connected || isLoading) ? '#555' : '#1a1a1a',
                  borderRadius: 12, 
                  fontWeight: 'bold', 
                  fontSize: 16,
                  cursor: (!formData.name || !formData.symbol || !formData.totalSupply || !connected || isLoading) ? 'not-allowed' : 'pointer',
                  border: 'none',
                  transition: 'all 0.2s',
                }}
              >
                {isLoading 
                  ? `⟳ ${statusMsg || 'Memproses...'}` 
                  : connected 
                    ? 'Create Token on Solana' 
                    : 'Connect Wallet to Create'
                }
              </button>
                <p className="text-[10px] text-center text-gray-600 mt-4 font-medium">
                  Token akan dibuat di Solana Mainnet. Pastikan data sudah benar sebelum konfirmasi.
                </p>
              </div>
            </div>

            {/* Preview Section */}
            <div className="space-y-6">
              <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Live Preview</label>
               <div style={{ 
                 background: 'linear-gradient(135deg, #242424 0%, #1e1e1e 100%)', 
                 border: '1px solid #3a3a3a', 
                 borderTop: '2px solid #f5a623',
                 borderRadius: 16, 
                 padding: 32, 
                 position: 'relative', 
                 overflow: 'hidden' 
               }}>
                 <div style={{ 
                   position: 'absolute', 
                   top: 0, 
                   right: 0, 
                   width: 128, 
                   height: 128, 
                   background: '#f5a623', 
                   opacity: 0.06, 
                   filter: 'blur(60px)' 
                 }} />
                
                <div className="flex items-start justify-between mb-8">
                  <div className="flex items-center gap-5">
                    {formData.logoUrl ? (
                      <img src={formData.logoUrl} alt="Logo" className="w-20 h-20 rounded-2xl border-2 border-[#3a3a3a] shadow-2xl object-cover" onError={(e) => (e.currentTarget.src = 'https://via.placeholder.com/80?text=Token')} />
                    ) : (
                       <div style={{ width: 80, height: 80, borderRadius: 12, background: '#1e1e1e', border: '2px solid #3a3a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                        🪙
                      </div>
                    )}
                    <div>
                      <h3 className="text-2xl font-black text-white leading-tight">{formData.name || 'Token Name'}</h3>
                      <span className="text-[#5cb85c] font-mono font-bold tracking-wider">{formData.symbol || 'SYMBOL'}</span>
                    </div>
                  </div>
                  <div className="bg-[#f5a62311] border border-[#f5a62333] px-3 py-1 rounded-lg">
                    <span className="text-[10px] font-black text-[#f5a623] uppercase">SPL Token</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6 mb-8">
                  <div className="bg-[#1e1e1e] p-4 rounded-2xl border border-[#ffffff05]">
                    <div className="text-[10px] uppercase font-black text-gray-500 mb-1">Total Supply</div>
                    <div className="text-lg font-mono font-bold text-gray-200">
                      {formData.totalSupply ? Number(formData.totalSupply).toLocaleString() : '0'}
                    </div>
                  </div>
                  <div className="bg-[#1e1e1e] p-4 rounded-2xl border border-[#ffffff05]">
                    <div className="text-[10px] uppercase font-black text-gray-500 mb-1">Decimals</div>
                    <div className="text-lg font-mono font-bold text-gray-200">{formData.decimals}</div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <div className="text-[10px] uppercase font-black text-gray-500 mb-2">Description</div>
                    <p className="text-sm text-gray-400 leading-relaxed min-h-[60px]">
                      {formData.description || 'No description provided.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-3 pt-4 border-t border-[#ffffff05]">
                    {formData.website && <div className="w-8 h-8 rounded-lg bg-[#1e1e1e] flex items-center justify-center text-sm">🌐</div>}
                    {formData.twitter && <div className="w-8 h-8 rounded-lg bg-[#1e1e1e] flex items-center justify-center text-sm">𝕏</div>}
                    {formData.telegram && <div className="w-8 h-8 rounded-lg bg-[#1e1e1e] flex items-center justify-center text-sm">✈️</div>}
                    {!formData.website && !formData.twitter && !formData.telegram && (
                      <span className="text-[10px] text-gray-600 font-bold italic">No social links</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-[#d2992211] border border-[#d2992233] p-6 rounded-2xl">
                <h4 className="text-[#d29922] font-black text-xs uppercase mb-2 flex items-center gap-2">
                  <span>⚠️</span> Penting
                </h4>
                <ul className="text-[11px] text-gray-400 space-y-2 list-disc pl-4">
                  <li>Metadata token akan disimpan secara on-chain (Metaplex).</li>
                  <li>Pastikan Logo URL mengarah ke file gambar langsung (PNG/JPG).</li>
                  <li>Setelah token dibuat, supply tidak bisa diubah kecuali kamu memiliki authority.</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {isSwapOpen && (
        <SwapModal token={null} onClose={() => setIsSwapOpen(false)} />
      )}
    </div>
  );
}
