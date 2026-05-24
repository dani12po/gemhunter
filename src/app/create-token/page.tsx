'use client';

import React, { useState, useRef } from 'react';
import { Header } from '../../components/layout/Header';
import { SwapModal } from '../../components/swap/SwapModal';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import {
  Keypair, Transaction, SystemProgram, PublicKey as Web3PublicKey, LAMPORTS_PER_SOL
} from '@solana/web3.js';
import {
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createSetAuthorityInstruction,
  AuthorityType,
  MINT_SIZE,
} from '@solana/spl-token';
import { createMetadataAccountV3 } from '@metaplex-foundation/mpl-token-metadata';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import { publicKey as umiPublicKey, createNoopSigner } from '@metaplex-foundation/umi';

export default function CreateTokenPage() {
  const [formData, setFormData] = useState({
    name: '',
    symbol: '',
    totalSupply: '',
    decimals: '9',
    description: '',
    website: '',
    twitter: '',
    telegram: '',
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string>('');
  const [isCreated, setIsCreated] = useState(false);
  const [createdTokenAddress, setCreatedTokenAddress] = useState('');
  const [createdTokenATA, setCreatedTokenATA] = useState('');
  const [createdSignature, setCreatedSignature] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [isSwapOpen, setIsSwapOpen] = useState(false);

  const [revokeMint, setRevokeMint] = useState(true);
  const [revokeFreeze, setRevokeFreeze] = useState(true);
  const [makeImmutable, setMakeImmutable] = useState(true);

  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();

  // Dynamic fee calculator
  const hasCoreFields =
    formData.name.trim() !== '' &&
    formData.symbol.trim() !== '' &&
    formData.totalSupply.trim() !== '' &&
    formData.decimals.trim() !== '';

  const baseFee = hasCoreFields ? 0.1 : 0;

  let optionalFieldsFee = 0;
  if (formData.description?.trim()) optionalFieldsFee += 0.01;
  if (logoFile) optionalFieldsFee += 0.01;
  if (formData.website?.trim()) optionalFieldsFee += 0.01;
  if (formData.twitter?.trim()) optionalFieldsFee += 0.01;
  if (formData.telegram?.trim()) optionalFieldsFee += 0.01;

  const securityFee =
    (revokeMint ? 0.01 : 0) +
    (revokeFreeze ? 0.01 : 0) +
    (makeImmutable ? 0.01 : 0);

  const totalFee = baseFee + optionalFieldsFee + securityFee;
  const creationFee = totalFee.toFixed(2);

  const isFullySecure = revokeMint && revokeFreeze && makeImmutable;

  const PLATFORM_FEE_RECEIVER = 'GFK2JGbzQ8b3jusvNdSwbfdsuQEBP9KawPj6VwcLyyEx';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'symbol') {
      setFormData({ ...formData, [name]: value.slice(0, 8).toUpperCase() });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500 * 1024) {
        alert('Ukuran file terlalu besar! Maksimal 500KB.');
        return;
      }
      setLogoFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setLogoPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleCreate = async () => {
    if (!connected || !publicKey) { alert('Harap hubungkan wallet!'); return; }

    const name = formData.name.trim();
    const symbol = formData.symbol.trim();
    const supplyNum = parseFloat(formData.totalSupply);
    const decimalsNum = parseInt(formData.decimals);

    if (!name || !symbol || isNaN(supplyNum) || isNaN(decimalsNum)) {
      alert('Isi data dengan benar'); return;
    }

    setIsLoading(true);
    setStatusMsg('Mengunggah metadata ke IPFS...');

    try {
      // Step 1: Upload logo + metadata ke IPFS via API route
      let metadataUrl = '';
      if (logoFile) {
        const data = new FormData();
        data.append('logo', logoFile);
        data.append('name', name);
        data.append('symbol', symbol);
        data.append('description', formData.description);

        const uploadRes = await fetch('/api/upload', { method: 'POST', body: data });
        const uploadData = await uploadRes.json();
        if (!uploadData.success) throw new Error(uploadData.error || 'Gagal mengunggah ke IPFS');
        metadataUrl = uploadData.metadataUrl;
      }

      setStatusMsg('Membangun transaksi...');
      const mintKeypair = Keypair.generate();
      const mintLen = MINT_SIZE;
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

      const rawSupply = BigInt(Math.round(supplyNum)) * (10n ** BigInt(decimalsNum));

      const userATA = await getAssociatedTokenAddress(
        mintKeypair.publicKey, publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      const transaction = new Transaction();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // 1. Create mint account
      transaction.add(SystemProgram.createAccount({
        fromPubkey: publicKey,
        newAccountPubkey: mintKeypair.publicKey,
        space: mintLen,
        lamports: mintRentLamports,
        programId: TOKEN_PROGRAM_ID,
      }));

      // 2. Initialize mint
      transaction.add(createInitializeMintInstruction(
        mintKeypair.publicKey, decimalsNum, publicKey, publicKey, TOKEN_PROGRAM_ID
      ));

      // 3. Create ATA
      transaction.add(createAssociatedTokenAccountInstruction(
        publicKey, userATA, publicKey, mintKeypair.publicKey, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      ));

      // 4. Mint supply
      transaction.add(createMintToInstruction(
        mintKeypair.publicKey, userATA, publicKey, rawSupply, [], TOKEN_PROGRAM_ID
      ));

      // 5. Metaplex metadata on-chain
      if (metadataUrl) {
        const umi = createUmi(connection.rpcEndpoint);
        const METADATA_PROGRAM_ID_STR = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
        const metadataProgramId = new Web3PublicKey(METADATA_PROGRAM_ID_STR);
        const [metadataPDA] = Web3PublicKey.findProgramAddressSync(
          [Buffer.from('metadata'), metadataProgramId.toBuffer(), mintKeypair.publicKey.toBuffer()],
          metadataProgramId
        );
        const umiInstruction = (createMetadataAccountV3 as any)(umi, {
          metadata: umiPublicKey(metadataPDA.toBase58()),
          mint: umiPublicKey(mintKeypair.publicKey.toBase58()),
          mintAuthority: createNoopSigner(umiPublicKey(publicKey.toBase58())),
          payer: createNoopSigner(umiPublicKey(publicKey.toBase58())),
          updateAuthority: umiPublicKey(publicKey.toBase58()),
          data: { name, symbol, uri: metadataUrl, sellerFeeBasisPoints: 0, creators: null, collection: null, uses: null },
          isMutable: !makeImmutable,
          collectionDetails: null,
        }).getInstructions()[0];
        transaction.add(toWeb3JsInstruction(umiInstruction));
      }

      // 6. Revoke Freeze Authority
      if (revokeFreeze) {
        transaction.add(createSetAuthorityInstruction(
          mintKeypair.publicKey, publicKey, AuthorityType.FreezeAccount, null
        ));
      }

      // 7. Revoke Mint Authority
      if (revokeMint) {
        transaction.add(createSetAuthorityInstruction(
          mintKeypair.publicKey, publicKey, AuthorityType.MintTokens, null
        ));
      }

      // 8. Platform fee
      if (platformFeeLamports > 0) {
        transaction.add(SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new Web3PublicKey(PLATFORM_FEE_RECEIVER),
          lamports: platformFeeLamports,
        }));
      }

      setStatusMsg('Menunggu tanda tangan wallet...');
      transaction.sign(mintKeypair);
      const signature = await sendTransaction(transaction, connection);

      setStatusMsg('Menunggu konfirmasi blockchain...');
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

      setCreatedTokenAddress(mintKeypair.publicKey.toString());
      setCreatedTokenATA(userATA.toString());
      setCreatedSignature(signature);
      setIsCreated(true);
      setStatusMsg('');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      let friendlyMsg = msg;
      if (msg.includes('403') || msg.includes('Access forbidden'))
        friendlyMsg = 'RPC node memblokir request. Silakan ganti RPC endpoint di .env.local (gunakan Helius/Alchemy gratis).';
      else if (msg.includes('insufficient funds') || msg.includes('Insufficient'))
        friendlyMsg = 'Saldo SOL tidak cukup untuk membayar biaya transaksi.';
      else if (msg.includes('User rejected') || msg.includes('rejected'))
        friendlyMsg = 'Transaksi dibatalkan oleh user.';
      else if (msg.includes('Blockhash not found') || msg.includes('block height exceeded'))
        friendlyMsg = 'Transaksi expired karena terlalu lama. Silakan coba lagi.';
      alert(`Gagal membuat token:\n\n${friendlyMsg}`);
    } finally {
      setIsLoading(false);
      setStatusMsg('');
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#1a1a1a', color: '#e8e8e8', fontFamily: "'Trebuchet MS', Verdana, Geneva, sans-serif" }}>
      <Header onSwapOpen={() => setIsSwapOpen(true)} />

      <div style={{ paddingTop: 96, paddingBottom: 60, paddingLeft: 16, paddingRight: 16, maxWidth: 1280, margin: '0 auto' }}>
        <div className="mb-8">
          <h1 style={{ fontSize: 28, fontWeight: 'bold', color: '#e8e8e8', marginBottom: 8 }}>
            Create SPL Token{' '}
            <span style={{ fontSize: 10, background: '#333', padding: '2px 6px', borderRadius: 4, verticalAlign: 'middle', color: '#888' }}>v2.0</span>
          </h1>
          <p style={{ color: '#888', fontSize: 13 }}>
            Luncurkan token Solana kamu sendiri dengan Logo & Metadata IPFS
          </p>
        </div>

        {isCreated ? (
          <div style={{ background: '#1a2a1a', border: '1px solid #5cb85c44', borderRadius: 12, padding: 32 }}>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <h2 style={{ fontSize: 22, fontWeight: 'bold', color: '#e8e8e8', marginBottom: 8 }}>Token Berhasil Dibuat</h2>
              <p style={{ color: '#888', fontSize: 13 }}>Token SPL kamu sudah live dengan metadata on-chain.</p>
            </div>

            <div style={{ marginBottom: 12, background: '#111', border: '1px solid #333', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Mint Address (CA Token)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ flex: 1, color: '#f5a623', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{createdTokenAddress}</code>
                <button onClick={() => navigator.clipboard.writeText(createdTokenAddress)}
                  style={{ background: '#2a2a2a', border: '1px solid #444', color: '#888', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                  Copy
                </button>
              </div>
            </div>

            <div style={{ marginBottom: 12, background: '#111', border: '1px solid #333', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', marginBottom: 4 }}>Token Account (ATA)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ flex: 1, color: '#5cb85c', fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{createdTokenATA}</code>
                <button onClick={() => navigator.clipboard.writeText(createdTokenATA)}
                  style={{ background: '#2a2a2a', border: '1px solid #444', color: '#888', padding: '4px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                  Copy
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <a href={`https://solscan.io/token/${createdTokenAddress}`} target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, background: '#1a1a2a', border: '1px solid #444', color: '#5b9bd5', padding: '10px', borderRadius: 8, textAlign: 'center', textDecoration: 'none', fontSize: 13 }}>
                Lihat di Solscan
              </a>
              <a href={`https://explorer.solana.com/tx/${createdSignature}`} target="_blank" rel="noopener noreferrer"
                style={{ flex: 1, background: '#1a1a2a', border: '1px solid #444', color: '#888', padding: '10px', borderRadius: 8, textAlign: 'center', textDecoration: 'none', fontSize: 13 }}>
                Lihat Transaksi
              </a>
            </div>

            <div style={{ background: '#2a2200', border: '1px solid #5a4400', borderRadius: 8, padding: 12, marginBottom: 16 }}>
              <div style={{ color: '#f5a623', fontSize: 11, fontWeight: 'bold', marginBottom: 6 }}>Langkah Selanjutnya (Opsional)</div>
              <ul style={{ color: '#888', fontSize: 11, paddingLeft: 16, margin: 0, lineHeight: 1.8 }}>
                <li>Metadata sudah on-chain via Metaplex — nama, logo, deskripsi sudah tersimpan</li>
                <li>Tambah likuiditas di <strong style={{ color: '#e8e8e8' }}>Raydium</strong> atau <strong style={{ color: '#e8e8e8' }}>Meteora</strong></li>
                <li>Simpan Mint Address — ini adalah "CA" token kamu</li>
              </ul>
            </div>

            <button onClick={() => { setIsCreated(false); setCreatedTokenAddress(''); setCreatedTokenATA(''); setCreatedSignature(''); setLogoFile(null); setLogoPreview(''); }}
              style={{ width: '100%', background: 'none', border: 'none', color: '#555', fontSize: 13, cursor: 'pointer', padding: '8px 0' }}>
              Buat Token Lain
            </button>
          </div>
        ) : (
          <div className="create-token-grid">
            {/* Form */}
            <div style={{ background: '#242424', border: '1px solid #3a3a3a', borderTop: '3px solid #f5a623', borderRadius: 12, padding: 32 }}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Token Name *</label>
                  <input type="text" name="name" value={formData.name} onChange={handleChange} placeholder="e.g. Solana Gem"
                    style={{ width: '100%', background: '#111', border: '1px solid #444', color: '#e8e8e8', padding: '10px 14px', borderRadius: 8, fontSize: 14, outline: 'none' }} required />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Symbol * (Max 8)</label>
                  <input type="text" name="symbol" value={formData.symbol} onChange={handleChange} placeholder="GEM"
                    style={{ width: '100%', background: '#111', border: '1px solid #444', color: '#e8e8e8', padding: '10px 14px', borderRadius: 8, fontSize: 14, outline: 'none' }} required />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Total Supply *</label>
                  <input type="number" name="totalSupply" value={formData.totalSupply} onChange={handleChange} placeholder="1000000000"
                    style={{ width: '100%', background: '#111', border: '1px solid #444', color: '#e8e8e8', padding: '10px 14px', borderRadius: 8, fontSize: 14, outline: 'none' }} required />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Decimals</label>
                  <input type="number" name="decimals" value={formData.decimals} onChange={handleChange} min="0" max="9"
                    style={{ width: '100%', background: '#111', border: '1px solid #444', color: '#e8e8e8', padding: '10px 14px', borderRadius: 8, fontSize: 14, outline: 'none' }} />
                </div>
              </div>

              <div className="space-y-2 mb-6">
                <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Description</label>
                <textarea name="description" value={formData.description} onChange={handleChange}
                  placeholder="Tell the world about your token..." rows={3}
                  className="w-full bg-[#111] border border-[#444] text-white px-4 py-3 rounded-xl focus:outline-none focus:border-[#f5a623] transition-all resize-none text-sm" />
              </div>

              <div className="space-y-2 mb-6">
                <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Token Logo (PNG/JPG) *</label>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <input type="file" accept="image/*" onChange={handleLogoChange} style={{ display: 'none' }} id="logo-upload" />
                  <label htmlFor="logo-upload" style={{ flex: 1, background: '#111', border: '1px dashed #444', color: '#888', padding: '12px', borderRadius: 8, fontSize: 12, cursor: 'pointer', textAlign: 'center' }}>
                    {logoFile ? logoFile.name : 'Klik untuk pilih gambar logo'}
                  </label>
                  {logoPreview && <img src={logoPreview} alt="Preview" style={{ width: 44, height: 44, borderRadius: 8, objectFit: 'cover', border: '1px solid #444' }} />}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Website</label>
                  <input type="url" name="website" value={formData.website} onChange={handleChange} placeholder="https://..."
                    className="w-full bg-[#111] border border-[#444] text-white px-4 py-2 rounded-xl text-xs focus:outline-none focus:border-[#f5a623] transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Twitter</label>
                  <input type="text" name="twitter" value={formData.twitter} onChange={handleChange} placeholder="@handle"
                    className="w-full bg-[#111] border border-[#444] text-white px-4 py-2 rounded-xl text-xs focus:outline-none focus:border-[#f5a623] transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Telegram</label>
                  <input type="text" name="telegram" value={formData.telegram} onChange={handleChange} placeholder="t.me/..."
                    className="w-full bg-[#111] border border-[#444] text-white px-4 py-2 rounded-xl text-xs focus:outline-none focus:border-[#f5a623] transition-all" />
                </div>
              </div>

              {/* Security Options */}
              <div style={{ marginTop: 20, marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontWeight: 600, color: '#f5a623', fontSize: 14 }}>Security Options</div>
                  <div style={{ fontSize: 11, color: isFullySecure ? '#22c55e' : '#ef4444', fontWeight: 'bold', background: isFullySecure ? '#22c55e11' : '#ef444411', padding: '2px 8px', borderRadius: 4 }}>
                    {isFullySecure ? 'SAFE' : 'RISK'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#aaa' }}>
                    <input type="checkbox" checked={revokeMint} onChange={e => setRevokeMint(e.target.checked)} />
                    Revoke Mint (+0.01)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#aaa' }}>
                    <input type="checkbox" checked={revokeFreeze} onChange={e => setRevokeFreeze(e.target.checked)} />
                    Revoke Freeze (+0.01)
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#aaa' }}>
                    <input type="checkbox" checked={makeImmutable} onChange={e => setMakeImmutable(e.target.checked)} />
                    Immutable Metadata (+0.01)
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-[#333]">
                <div className="flex items-center justify-between mb-4 px-1">
                  <span className="text-sm font-bold text-gray-400">Biaya Pembuatan</span>
                  <span className="bg-[#f5a62322] text-[#f5a623] border border-[#f5a62344] px-3 py-1 rounded-full text-xs font-black">
                    {creationFee} SOL
                  </span>
                </div>
                <button
                  onClick={handleCreate}
                  disabled={!formData.name || !formData.symbol || !formData.totalSupply || !logoFile || !connected || isLoading}
                  style={{
                    width: '100%', padding: '16px',
                    background: (!formData.name || !formData.symbol || !formData.totalSupply || !logoFile || !connected || isLoading)
                      ? '#222' : 'linear-gradient(135deg, #f5a623, #d4891c)',
                    color: (!formData.name || !formData.symbol || !formData.totalSupply || !logoFile || !connected || isLoading) ? '#555' : '#1a1a1a',
                    borderRadius: 12, fontWeight: 'bold', fontSize: 16,
                    cursor: (!formData.name || !formData.symbol || !formData.totalSupply || !logoFile || !connected || isLoading) ? 'not-allowed' : 'pointer',
                    border: 'none', transition: 'all 0.2s',
                    boxShadow: isLoading ? 'none' : '0 4px 15px rgba(245, 166, 35, 0.2)',
                  }}
                >
                  {isLoading ? `${statusMsg || 'Memproses...'}` : connected ? 'Create Token with Logo' : 'Connect Wallet to Create'}
                </button>
                <p className="text-[10px] text-center text-gray-600 mt-4 font-medium">
                  Token akan dibuat di Solana Mainnet. Pastikan data sudah benar sebelum konfirmasi.
                </p>
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-6">
              <label className="text-[10px] uppercase font-black text-gray-500 tracking-widest px-1">Live Preview</label>
              <div style={{ background: 'linear-gradient(135deg, #242424 0%, #1e1e1e 100%)', border: '1px solid #3a3a3a', borderTop: '2px solid #f5a623', borderRadius: 16, padding: 32, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: 0, right: 0, width: 128, height: 128, background: '#f5a623', opacity: 0.06, filter: 'blur(60px)' }} />

                <div className="flex items-start justify-between mb-8">
                  <div className="flex items-center gap-5">
                    {logoPreview ? (
                      <img src={logoPreview} alt="Logo" className="w-20 h-20 rounded-2xl border-2 border-[#3a3a3a] shadow-2xl object-cover" />
                    ) : (
                      <div style={{ width: 80, height: 80, borderRadius: 12, background: '#1e1e1e', border: '2px solid #3a3a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, color: '#f5a623', fontWeight: 'bold', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
                        SPL
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
                    {formData.website && <div className="w-8 h-8 rounded-lg bg-[#1e1e1e] flex items-center justify-center text-[10px] font-bold text-gray-400">WEB</div>}
                    {formData.twitter && <div className="w-8 h-8 rounded-lg bg-[#1e1e1e] flex items-center justify-center text-[10px] font-bold text-gray-400">TWT</div>}
                    {formData.telegram && <div className="w-8 h-8 rounded-lg bg-[#1e1e1e] flex items-center justify-center text-[10px] font-bold text-gray-400">TG</div>}
                    {!formData.website && !formData.twitter && !formData.telegram && (
                      <span className="text-[10px] text-gray-600 font-bold italic">No social links</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-[#d2992211] border border-[#d2992233] p-6 rounded-2xl">
                <h4 className="text-[#d29922] font-black text-xs uppercase mb-2">Penting</h4>
                <ul className="text-[11px] text-gray-400 space-y-2 list-disc pl-4">
                  <li>Logo akan diunggah ke IPFS (Pinata) secara permanen.</li>
                  <li>Metadata token akan disimpan secara on-chain (Metaplex).</li>
                  <li>Biaya pembuatan mencakup biaya sewa akun Solana + Biaya Platform.</li>
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
