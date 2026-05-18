'use client';

import React, { useState, useEffect } from 'react';
import { Header } from '../../components/layout/Header';
import { SwapModal } from '../../components/swap/SwapModal';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { 
  PublicKey, 
  Transaction, 
  Keypair,
  SystemProgram,
  LAMPORTS_PER_SOL,
  VersionedTransaction
} from '@solana/web3.js';
import { 
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
  getAccount,
  getMint,
  createBurnInstruction,
  createInitializeMintInstruction,
  getMintLen,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from '@solana/spl-token';

// DEX Program IDs
const RAYDIUM_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const RAYDIUM_CPMM = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');
const METEORA_DLMM = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const ORCA_WHIRLPOOL = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');

interface LiquidityPosition {
  poolAddress: string;
  poolName: string;
  dex: string;
  tokenASymbol: string;
  tokenAMint: string;
  tokenAAmount: number;
  tokenBSymbol: string;
  tokenBMint: string;
  tokenBAmount: number;
  lpTokenMint: string;
  lpTokenBalance: number;
  valueUSD: number;
  poolType: 'standard' | 'concentrated';
}

interface BurnResult {
  success: boolean;
  txSignature?: string;
  burnedLpTokens: number;
  message: string;
}

export default function BurnLiquidityPage() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  
  const [isSwapOpen, setIsSwapOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [positions, setPositions] = useState<LiquidityPosition[]>([]);
  const [selectedPosition, setSelectedPosition] = useState<LiquidityPosition | null>(null);
  const [burnPercentage, setBurnPercentage] = useState(100);
  const [burnAmount, setBurnAmount] = useState(0);
  const [burnResult, setBurnResult] = useState<BurnResult | null>(null);
  const [statusMsg, setStatusMsg] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [confirmedBurn, setConfirmedBurn] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Load liquidity positions
  const scanLiquidityPositions = async () => {
    if (!publicKey || !connected) {
      alert('Please connect your wallet first!');
      return;
    }

    setIsScanning(true);
    setStatusMsg('Scanning for liquidity positions...');
    setPositions([]);

    try {
      // Get all token accounts owned by user
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );

      const lpPositions: LiquidityPosition[] = [];

      for (const account of tokenAccounts.value) {
        const parsedInfo = account.account.data.parsed.info;
        const tokenMint = new PublicKey(parsedInfo.mint);
        const balance = parsedInfo.tokenAmount.uiAmount;
        
        if (balance <= 0) continue;

        // Check if this token is an LP token (by checking mint decimals and supply)
        try {
          const mintInfo = await getMint(connection, tokenMint);
          
          // LP tokens typically have decimals 6 or 9 and are from known DEXes
          if (await isLPToken(tokenMint, mintInfo.decimals)) {
            const position = await getLiquidityPositionInfo(tokenMint, balance, parsedInfo.amount);
            if (position) {
              lpPositions.push(position);
            }
          }
        } catch (err) {
          console.error('Error checking token:', tokenMint.toString(), err);
        }
      }

      setPositions(lpPositions);
      setStatusMsg(lpPositions.length > 0 ? `Found ${lpPositions.length} LP position(s)` : 'No LP positions found');
    } catch (err) {
      console.error('Error scanning positions:', err);
      setStatusMsg('Error scanning liquidity positions');
    } finally {
      setIsScanning(false);
    }
  };

  // CREATE MOCK LP TOKEN FOR TESTING
    const createMockLPToken = async () => {
    if (!publicKey || !connected) {
        alert('Connect wallet first!');
        return;
    }

    setIsScanning(true);
    setStatusMsg('Creating mock LP token for testing...');

    try {
        const mintKeypair = Keypair.generate();
        const mintLen = getMintLen([]);
        const mintRent = await connection.getMinimumBalanceForRentExemption(mintLen);
        
        const userATA = await getAssociatedTokenAddress(
        mintKeypair.publicKey,
        publicKey,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
        );

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const transaction = new Transaction();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        // 1. Create mint account (LP Token)
        transaction.add(
        SystemProgram.createAccount({
            fromPubkey: publicKey,
            newAccountPubkey: mintKeypair.publicKey,
            space: mintLen,
            lamports: mintRent,
            programId: TOKEN_PROGRAM_ID,
        })
        );

        // 2. Initialize mint (decimals 6 like typical LP token)
        transaction.add(
        createInitializeMintInstruction(
            mintKeypair.publicKey,
            6,
            publicKey,
            null,
            TOKEN_PROGRAM_ID
        )
        );

        // 3. Create ATA for user
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

        // 4. Mint 1000 LP tokens to user
        const mintAmount = 1000 * 10 ** 6;
        transaction.add(
        createMintToInstruction(
            mintKeypair.publicKey,
            userATA,
            publicKey,
            BigInt(mintAmount),
            [],
            TOKEN_PROGRAM_ID
        )
        );

        transaction.sign(mintKeypair);
        const signature = await sendTransaction(transaction, connection);

        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

        setStatusMsg(`✅ Mock LP Token created! Mint: ${mintKeypair.publicKey.toString().slice(0, 20)}...`);
        setTimeout(() => scanLiquidityPositions(), 2000);
        
    } catch (err) {
        console.error('Error creating mock LP:', err);
        setStatusMsg(`❌ Failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
        setIsScanning(false);
    }
    };

    // Ganti fungsi isLPToken dengan ini (agar semua token terdeteksi untuk testing)
    const isLPToken = async (mint: PublicKey, decimals: number): Promise<boolean> => {
    // FOR TESTING: treat ALL tokens as LP tokens
    // Hapus atau comment pengecekan DEX program
    return true; // <- SEMUA TOKEN AKAN TERDETEKSI
    
    /* 
    // Original code (commented for testing)
    const tokenAccounts = await connection.getTokenLargestAccounts(mint);
    if (tokenAccounts.value.length === 0) return false;
    
    try {
        const mintInfo = await getMint(connection, mint);
        const mintAuthority = mintInfo.mintAuthority;
        
        if (mintAuthority) {
        const authString = mintAuthority.toString();
        const dexPrograms = [
            RAYDIUM_V4.toString(),
            RAYDIUM_CPMM.toString(),
            METEORA_DLMM.toString(),
            ORCA_WHIRLPOOL.toString()
        ];
        
        if (dexPrograms.includes(authString)) return true;
        }
    } catch (err) {}
    
    return false;
    */
    };

  // Get detailed liquidity position info
  const getLiquidityPositionInfo = async (
    lpMint: PublicKey, 
    balance: number,
    rawBalance: string
  ): Promise<LiquidityPosition | null> => {
    try {
      // Try to get pool info from various DEXes
      // For now, return basic info
      return {
        poolAddress: lpMint.toString(),
        poolName: `LP Token ${lpMint.toString().slice(0, 8)}`,
        dex: 'Raydium',
        tokenASymbol: 'TOKEN A',
        tokenAMint: lpMint.toString(),
        tokenAAmount: balance,
        tokenBSymbol: 'TOKEN B',
        tokenBMint: lpMint.toString(),
        tokenBAmount: 0,
        lpTokenMint: lpMint.toString(),
        lpTokenBalance: balance,
        valueUSD: balance * 0.1, // Estimate
        poolType: 'standard'
      };
    } catch (err) {
      return null;
    }
  };

  // Handle position selection
  const handleSelectPosition = (position: LiquidityPosition) => {
    setSelectedPosition(position);
    setBurnPercentage(100);
    setBurnAmount(position.lpTokenBalance);
    setBurnResult(null);
    setConfirmedBurn(false);
  };

  // Update burn amount when percentage changes
  useEffect(() => {
    if (selectedPosition) {
      const amount = (selectedPosition.lpTokenBalance * burnPercentage) / 100;
      setBurnAmount(amount);
    }
  }, [burnPercentage, selectedPosition]);

  // Execute burn liquidity
  const executeBurnLiquidity = async () => {
    if (!selectedPosition || !publicKey || !connected) {
      alert('Please select a position and connect wallet');
      return;
    }

    if (burnAmount <= 0) {
      alert('Please enter a valid burn amount');
      return;
    }

    setIsLoading(true);
    setStatusMsg('Preparing burn transaction...');

    try {
      // Note: Actual burn logic depends on the DEX
      // This is a simplified version that burns the LP tokens directly
      
      const lpMint = new PublicKey(selectedPosition.lpTokenMint);
      const userLPAccount = await getAssociatedTokenAddress(
        lpMint,
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      // Calculate burn amount in raw units
      const burnRawAmount = Math.floor(burnAmount * Math.pow(10, 6)); // Assuming 6 decimals
      
      const transaction = new Transaction();
      
      // Burn the LP tokens
      transaction.add(
        createBurnInstruction(
          userLPAccount,
          lpMint,
          publicKey,
          BigInt(burnRawAmount),
          [],
          TOKEN_PROGRAM_ID
        )
      );
      
      // Close the token account if burning all tokens
      if (burnPercentage === 100) {
        transaction.add(
          createCloseAccountInstruction(
            userLPAccount,
            publicKey,
            publicKey,
            [],
            TOKEN_PROGRAM_ID
          )
        );
      }

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      setStatusMsg('Waiting for wallet signature...');
      const signature = await sendTransaction(transaction, connection);

      setStatusMsg('Confirming transaction...');
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');

      setBurnResult({
        success: true,
        txSignature: signature,
        burnedLpTokens: burnAmount,
        message: `Successfully burned ${burnAmount.toFixed(4)} LP tokens`
      });
      
      setStatusMsg('');
      setConfirmedBurn(true);
      
      // Refresh positions
      setTimeout(() => scanLiquidityPositions(), 2000);
      
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBurnResult({
        success: false,
        burnedLpTokens: 0,
        message: `Burn failed: ${msg}`
      });
      setStatusMsg('');
    } finally {
      setIsLoading(false);
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
      
      <div style={{ paddingTop: 96, paddingBottom: 60, paddingLeft: 16, paddingRight: 16, maxWidth: 1400, margin: '0 auto' }}>
        
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 28, fontWeight: 'bold', color: '#e8e8e8', marginBottom: 8 }}>
            🔥 Burn Liquidity
            <span style={{ fontSize: 14, color: '#d9534f', marginLeft: 12, fontWeight: 'normal' }}>
              PERMANENTLY REMOVE LIQUIDITY
            </span>
          </h1>
          <p style={{ color: '#888', fontSize: 13 }}>
            Burn LP tokens to permanently remove liquidity from pools • ⚠️ This action is IRREVERSIBLE!
          </p>
        </div>

        {/* Warning Banner */}
        <div style={{ 
          background: '#3a1a1a', 
          border: '1px solid #d9534f', 
          borderRadius: 12, 
          padding: '16px 20px', 
          marginBottom: 24,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start'
        }}>
          <span style={{ fontSize: 28 }}>⚠️</span>
          <div>
            <strong style={{ color: '#d9534f', fontSize: 14 }}>IRREVERSIBLE ACTION</strong>
            <p style={{ color: '#aaa', fontSize: 12, marginTop: 4, marginBottom: 0 }}>
              Burning liquidity permanently removes your LP tokens from circulation. 
              You will NOT be able to recover the liquidity or claim any future fees.
              Make sure you understand the consequences before proceeding.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          
          {/* Left Panel - Liquidity Positions */}
          <div style={{ 
            background: '#242424', 
            border: '1px solid #3a3a3a', 
            borderRadius: 12, 
            padding: 24 
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 'bold', color: '#f5a623' }}>
                📊 Your Liquidity Positions
              </h2>
              <button
                onClick={scanLiquidityPositions}
                disabled={isScanning || !connected}
                style={{
                  background: '#1a1a2a',
                  border: '1px solid #444',
                  color: '#e8e8e8',
                  padding: '6px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  cursor: isScanning || !connected ? 'not-allowed' : 'pointer'
                }}
              >
                {isScanning ? '⟳ Scanning...' : '🔄 Scan Now'}
              </button>
              {/* Tombol Create Mock LP Token - Tambahkan di sini */}
            <div style={{ marginTop: 16 }}>
            <button
                onClick={createMockLPToken}
                disabled={isScanning || !connected}
                style={{
                width: '100%',
                background: '#f5a623',
                border: 'none',
                color: '#1a1a1a',
                padding: '10px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 'bold',
                cursor: isScanning || !connected ? 'not-allowed' : 'pointer',
                }}
            >
                🧪 Create Mock LP Token (Testing)
            </button>
            <p style={{ fontSize: 10, color: '#666', textAlign: 'center', marginTop: 8 }}>
                Klik untuk membuat LP token palsu dan test burn liquidity
            </p>
            </div>
            </div>

            {!connected && (
              <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>
                Connect wallet to view your liquidity positions
              </div>
            )}

            {connected && isScanning && (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div style={{ color: '#f5a623', marginBottom: 8 }}>⟳</div>
                <div style={{ color: '#888', fontSize: 13 }}>{statusMsg}</div>
              </div>
            )}

            {connected && !isScanning && positions.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>💧</div>
                <div style={{ color: '#888', fontSize: 13 }}>No LP tokens found in your wallet</div>
                <div style={{ color: '#666', fontSize: 11, marginTop: 8 }}>
                  Add liquidity on Raydium, Meteora, or Orca first
                </div>
              </div>
            )}

            {connected && positions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {positions.map((pos, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleSelectPosition(pos)}
                    style={{
                      background: selectedPosition?.lpTokenMint === pos.lpTokenMint ? '#1a2a3a' : '#1a1a1a',
                      border: `1px solid ${selectedPosition?.lpTokenMint === pos.lpTokenMint ? '#f5a623' : '#333'}`,
                      borderRadius: 10,
                      padding: 16,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div>
                        <span style={{ fontSize: 13, fontWeight: 'bold', color: '#f5a623' }}>{pos.dex}</span>
                        <span style={{ fontSize: 11, color: '#666', marginLeft: 8 }}>{pos.poolType}</span>
                      </div>
                      <span style={{ fontSize: 12, color: '#5cb85c' }}>≈ ${pos.valueUSD.toFixed(2)}</span>
                    </div>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 8 }}>
                      <span style={{ color: '#aaa' }}>LP Tokens:</span>
                      <span style={{ color: '#e8e8e8', fontWeight: 'bold' }}>{pos.lpTokenBalance.toFixed(6)}</span>
                    </div>
                    
                    <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#888' }}>
                      <span>Pool: {pos.poolAddress.slice(0, 8)}...{pos.poolAddress.slice(-6)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Panel - Burn Interface */}
          <div style={{ 
            background: '#242424', 
            border: '1px solid #3a3a3a', 
            borderRadius: 12, 
            padding: 24 
          }}>
            <h2 style={{ fontSize: 16, fontWeight: 'bold', color: '#d9534f', marginBottom: 20 }}>
              🔥 Burn Configuration
            </h2>

            {!selectedPosition ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#666' }}>
                Select a liquidity position from the left panel
              </div>
            ) : (
              <>
                {/* Selected Position Info */}
                <div style={{ background: '#1a1a1a', borderRadius: 10, padding: 16, marginBottom: 24 }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>SELECTED POSITION</div>
                  <div style={{ fontSize: 14, fontWeight: 'bold', color: '#f5a623', marginBottom: 4 }}>{selectedPosition.dex}</div>
                  <div style={{ fontSize: 12, color: '#aaa' }}>LP Tokens: {selectedPosition.lpTokenBalance.toFixed(6)}</div>
                  <div style={{ fontSize: 11, color: '#666', fontFamily: 'monospace', marginTop: 8 }}>
                    {selectedPosition.lpTokenMint.slice(0, 20)}...
                  </div>
                </div>

                {/* Burn Amount Slider */}
                <div style={{ marginBottom: 24 }}>
                  <label style={{ fontSize: 12, color: '#888', marginBottom: 8, display: 'block' }}>
                    Burn Percentage
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={burnPercentage}
                    onChange={(e) => setBurnPercentage(parseInt(e.target.value))}
                    style={{
                      width: '100%',
                      height: 6,
                      borderRadius: 3,
                      background: '#333',
                      accentColor: '#d9534f'
                    }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                    {[0, 25, 50, 75, 100].map(p => (
                      <button
                        key={p}
                        onClick={() => setBurnPercentage(p)}
                        style={{
                          background: burnPercentage === p ? '#d9534f' : '#1a1a2a',
                          border: '1px solid #444',
                          color: burnPercentage === p ? '#fff' : '#888',
                          padding: '4px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          cursor: 'pointer'
                        }}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Burn Amount */}
                <div style={{ 
                  background: '#1a1a1a', 
                  borderRadius: 10, 
                  padding: 16, 
                  marginBottom: 24,
                  border: '1px solid #d9534f33'
                }}>
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>AMOUNT TO BURN</div>
                  <div style={{ fontSize: 24, fontWeight: 'bold', color: '#d9534f', fontFamily: 'monospace' }}>
                    {burnAmount.toFixed(6)} LP
                  </div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                    {burnPercentage === 100 ? '(Full position - account will be closed)' : `(${burnPercentage}% of position)`}
                  </div>
                </div>

                {/* Warning & Confirmation */}
                <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <input
                    type="checkbox"
                    checked={confirmedBurn}  // ← GANTI showConfirmModal menjadi confirmedBurn
                    onChange={(e) => setConfirmedBurn(e.target.checked)}  // ← GANTI setShowConfirmModal menjadi setConfirmedBurn
                    style={{ width: 16, height: 16 }}
                    />
                    <span style={{ fontSize: 12, color: '#d9534f' }}>
                    I understand that burning liquidity is IRREVERSIBLE
                    </span>
                </label>
                </div>

                {/* Burn Result */}
                {burnResult && (
                  <div style={{
                    background: burnResult.success ? '#1a3a1a' : '#3a1a1a',
                    border: `1px solid ${burnResult.success ? '#5cb85c' : '#d9534f'}`,
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 16
                  }}>
                    <div style={{ fontSize: 12, color: burnResult.success ? '#5cb85c' : '#d9534f' }}>
                      {burnResult.success ? '✅ ' : '❌ '}{burnResult.message}
                    </div>
                    {burnResult.txSignature && (
                      <a
                        href={`https://solscan.io/tx/${burnResult.txSignature}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, color: '#5b9bd5', marginTop: 8, display: 'inline-block' }}
                      >
                        View on Explorer →
                      </a>
                    )}
                  </div>
                )}

                {/* Burn Button */}
                <button
                  onClick={() => {
                    if (confirmedBurn) {
                      executeBurnLiquidity();
                    } else {
                      alert('Please confirm that you understand the risks by checking the box above');
                    }
                  }}
                  disabled={isLoading || burnAmount <= 0}
                  style={{
                    width: '100%',
                    padding: '14px',
                    background: (isLoading || burnAmount <= 0 || !confirmedBurn) ? '#333' : '#d9534f',
                    color: (isLoading || burnAmount <= 0 || !confirmedBurn) ? '#666' : '#fff',
                    borderRadius: 8,
                    fontWeight: 'bold',
                    fontSize: 15,
                    border: 'none',
                    cursor: (isLoading || burnAmount <= 0 || !confirmedBurn) ? 'not-allowed' : 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {isLoading ? `⟳ ${statusMsg || 'Processing...'}` : '🔥 Burn Liquidity'}
                </button>

                {/* Status Message */}
                {statusMsg && !isLoading && (
                  <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 12 }}>
                    {statusMsg}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Information Section */}
        <div style={{ 
          marginTop: 32,
          background: '#1a1a2a', 
          border: '1px solid #2a2a2a', 
          borderRadius: 12, 
          padding: 20 
        }}>
          <h3 style={{ fontSize: 13, fontWeight: 'bold', color: '#f5a623', marginBottom: 12 }}>
            📖 What happens when you burn liquidity?
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: '#e8e8e8', marginBottom: 4 }}>✅ Good for:</div>
              <ul style={{ fontSize: 11, color: '#888', paddingLeft: 16, margin: 0 }}>
                <li>Increasing token scarcity</li>
                <li>Building holder trust</li>
                <li>Reducing circulating supply</li>
                <li>Creating deflationary mechanics</li>
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: '#e8e8e8', marginBottom: 4 }}>⚠️ You lose:</div>
              <ul style={{ fontSize: 11, color: '#888', paddingLeft: 16, margin: 0 }}>
                <li>Ability to remove liquidity</li>
                <li>Future fee earnings</li>
                <li>Trading flexibility</li>
                <li>LP tokens permanently</li>
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 'bold', color: '#e8e8e8', marginBottom: 4 }}>🔍 Use cases:</div>
              <ul style={{ fontSize: 11, color: '#888', paddingLeft: 16, margin: 0 }}>
                <li>Meme coin launch locks</li>
                <li>Community trust building</li>
                <li>Deflationary tokenomics</li>
                <li>Liquidity commitment proofs</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {isSwapOpen && (
        <SwapModal token={null} onClose={() => setIsSwapOpen(false)} />
      )}
    </div>
  );
}