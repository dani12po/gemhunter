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
  VersionedTransaction,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createCloseAccountInstruction,
  getMint,
  createBurnInstruction,
  createInitializeMintInstruction,
  getMintLen,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from '@solana/spl-token';

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

  // Scan LP positions dari wallet
  const scanLiquidityPositions = async () => {
    if (!publicKey || !connected) {
      alert('Please connect your wallet first!');
      return;
    }

    setIsScanning(true);
    setStatusMsg('Scanning for liquidity positions...');
    setPositions([]);

    try {
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

        try {
          const mintInfo = await getMint(connection, tokenMint);
          if (await isLPToken(tokenMint, mintInfo.decimals)) {
            const position = await getLiquidityPositionInfo(tokenMint, balance, parsedInfo.amount);
            if (position) lpPositions.push(position);
          }
        } catch (err) {
          console.error('Error checking token:', tokenMint.toString(), err);
        }
      }

      setPositions(lpPositions);
      setStatusMsg(
        lpPositions.length > 0
          ? `Found ${lpPositions.length} LP position(s)`
          : 'No LP positions found'
      );
    } catch (err) {
      console.error('Error scanning positions:', err);
      setStatusMsg('Error scanning liquidity positions');
    } finally {
      setIsScanning(false);
    }
  };

  // Buat mock LP token untuk testing
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

      transaction.add(
        SystemProgram.createAccount({
          fromPubkey: publicKey,
          newAccountPubkey: mintKeypair.publicKey,
          space: mintLen,
          lamports: mintRent,
          programId: TOKEN_PROGRAM_ID,
        })
      );

      transaction.add(
        createInitializeMintInstruction(
          mintKeypair.publicKey,
          6,
          publicKey,
          null,
          TOKEN_PROGRAM_ID
        )
      );

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

  // Untuk testing: semua token dianggap LP token
  const isLPToken = async (_mint: PublicKey, _decimals: number): Promise<boolean> => {
    return true;
  };

  const getLiquidityPositionInfo = async (
    lpMint: PublicKey,
    balance: number,
    _rawBalance: string
  ): Promise<LiquidityPosition | null> => {
    try {
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
        valueUSD: balance * 0.1,
        poolType: 'standard',
      };
    } catch {
      return null;
    }
  };

  const handleSelectPosition = (position: LiquidityPosition) => {
    setSelectedPosition(position);
    setBurnPercentage(100);
    setBurnAmount(position.lpTokenBalance);
    setBurnResult(null);
    setConfirmedBurn(false);
  };

  useEffect(() => {
    if (selectedPosition) {
      setBurnAmount((selectedPosition.lpTokenBalance * burnPercentage) / 100);
    }
  }, [burnPercentage, selectedPosition]);

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
      const lpMint = new PublicKey(selectedPosition.lpTokenMint);
      const userLPAccount = await getAssociatedTokenAddress(
        lpMint,
        publicKey,
        false,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      const burnRawAmount = Math.floor(burnAmount * Math.pow(10, 6));
      const transaction = new Transaction();

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
        message: `Successfully burned ${burnAmount.toFixed(4)} LP tokens`,
      });
      setStatusMsg('');
      setConfirmedBurn(true);
      setTimeout(() => scanLiquidityPositions(), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBurnResult({ success: false, burnedLpTokens: 0, message: `Burn failed: ${msg}` });
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
      fontFamily: "'Trebuchet MS', Verdana, Geneva, sans-serif",
    }}>
      <Header onSwapOpen={() => setIsSwapOpen(true)} />

      <div style={{ paddingTop: 96, paddingBottom: 60, paddingLeft: 16, paddingRight: 16, maxWidth: 1280, margin: '0 auto' }}>

        {/* Page Header */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 24, fontWeight: 'bold', color: '#e8e8e8', marginBottom: 6 }}>
            Burn Liquidity
            <span style={{ fontSize: 13, color: '#d9534f', marginLeft: 12, fontWeight: 'normal' }}>
              PERMANENTLY REMOVE LIQUIDITY
            </span>
          </h1>
          <p style={{ color: '#888', fontSize: 12, margin: 0 }}>
            Burn LP tokens to permanently remove liquidity from pools. This action is IRREVERSIBLE.
          </p>
        </div>

        {/* Warning Banner */}
        <div style={{
          background: '#3a1a1a',
          border: '1px solid #d9534f',
          borderRadius: 8,
          padding: '14px 18px',
          marginBottom: 24,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}>
          <div style={{ color: '#d9534f', fontSize: 13, fontWeight: 'bold', flexShrink: 0 }}>WARNING</div>
          <div>
            <strong style={{ color: '#d9534f', fontSize: 13 }}>IRREVERSIBLE ACTION</strong>
            <p style={{ color: '#aaa', fontSize: 12, marginTop: 4, marginBottom: 0 }}>
              Burning liquidity permanently removes your LP tokens from circulation.
              You will NOT be able to recover the liquidity or claim any future fees.
              Make sure you understand the consequences before proceeding.
            </p>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

          {/* Left — Liquidity Positions */}
          <div style={{ background: '#242424', border: '1px solid #3a3a3a', borderRadius: 8, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <h2 style={{ fontSize: 14, fontWeight: 'bold', color: '#f5a623', margin: 0 }}>
                LP Positions
              </h2>
              <button
                onClick={scanLiquidityPositions}
                disabled={isScanning || !connected}
                style={{
                  background: '#1a1a2a', border: '1px solid #444', color: '#e8e8e8',
                  padding: '5px 10px', borderRadius: 4, fontSize: 11,
                  cursor: isScanning || !connected ? 'not-allowed' : 'pointer',
                }}
              >
                {isScanning ? 'Scanning...' : 'Scan Now'}
              </button>
            </div>

            {/* Mock LP Token button */}
            <div style={{ marginBottom: 16 }}>
              <button
                onClick={createMockLPToken}
                disabled={isScanning || !connected}
                style={{
                  width: '100%', background: '#f5a623', border: 'none',
                  color: '#1a1a1a', padding: '9px', borderRadius: 6,
                  fontSize: 12, fontWeight: 'bold',
                  cursor: isScanning || !connected ? 'not-allowed' : 'pointer',
                }}
              >
                Create Mock LP Token (Testing)
              </button>
              <p style={{ fontSize: 10, color: '#666', textAlign: 'center', marginTop: 6, marginBottom: 0 }}>
                Klik untuk membuat LP token palsu dan test burn liquidity
              </p>
            </div>

            {!connected && (
              <div style={{ textAlign: 'center', padding: 40, color: '#666', fontSize: 12 }}>
                Connect wallet to view your liquidity positions
              </div>
            )}

            {connected && isScanning && (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div style={{ color: '#f5a623', fontSize: 20, marginBottom: 8 }}>...</div>
                <div style={{ color: '#888', fontSize: 12 }}>{statusMsg}</div>
              </div>
            )}

            {connected && !isScanning && positions.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40 }}>
                <div style={{ fontSize: 13, color: '#555', marginBottom: 10 }}>No positions</div>
                <div style={{ color: '#888', fontSize: 12 }}>No LP tokens found in your wallet</div>
                <div style={{ color: '#666', fontSize: 11, marginTop: 6 }}>
                  Add liquidity on Raydium, Meteora, or Orca first
                </div>
              </div>
            )}

            {connected && positions.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {positions.map((pos, idx) => (
                  <div
                    key={idx}
                    onClick={() => handleSelectPosition(pos)}
                    style={{
                      background: selectedPosition?.lpTokenMint === pos.lpTokenMint ? '#1a2a3a' : '#1a1a1a',
                      border: `1px solid ${selectedPosition?.lpTokenMint === pos.lpTokenMint ? '#f5a623' : '#333'}`,
                      borderRadius: 8,
                      padding: 14,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 'bold', color: '#f5a623' }}>{pos.dex}</span>
                        <span style={{ fontSize: 10, color: '#666', marginLeft: 6 }}>{pos.poolType}</span>
                      </div>
                      <span style={{ fontSize: 11, color: '#5cb85c' }}>≈ ${pos.valueUSD.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 6 }}>
                      <span style={{ color: '#aaa' }}>LP Tokens:</span>
                      <span style={{ color: '#e8e8e8', fontWeight: 'bold', fontFamily: 'monospace' }}>{pos.lpTokenBalance.toFixed(6)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
                      {pos.poolAddress.slice(0, 12)}...{pos.poolAddress.slice(-8)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {statusMsg && !isScanning && (
              <div style={{ marginTop: 12, fontSize: 11, color: '#888', textAlign: 'center' }}>{statusMsg}</div>
            )}
          </div>

          {/* Right — Burn Configuration */}
          <div style={{ background: '#242424', border: '1px solid #3a3a3a', borderRadius: 8, padding: 20 }}>
            <h2 style={{ fontSize: 14, fontWeight: 'bold', color: '#d9534f', marginBottom: 16, marginTop: 0 }}>
              Burn Configuration
            </h2>

            {!selectedPosition ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#666', fontSize: 12 }}>
                Select a liquidity position from the left panel
              </div>
            ) : (
              <>
                {/* Selected Position Info */}
                <div style={{ background: '#1a1a1a', borderRadius: 8, padding: 14, marginBottom: 20 }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>SELECTED POSITION</div>
                  <div style={{ fontSize: 13, fontWeight: 'bold', color: '#f5a623', marginBottom: 4 }}>{selectedPosition.dex}</div>
                  <div style={{ fontSize: 12, color: '#aaa' }}>LP Tokens: {selectedPosition.lpTokenBalance.toFixed(6)}</div>
                  <div style={{ fontSize: 10, color: '#555', fontFamily: 'monospace', marginTop: 6 }}>
                    {selectedPosition.lpTokenMint.slice(0, 22)}...
                  </div>
                </div>

                {/* Burn Percentage Slider */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ fontSize: 11, color: '#888', marginBottom: 8, display: 'block' }}>
                    Burn Percentage: <strong style={{ color: '#d9534f' }}>{burnPercentage}%</strong>
                  </label>
                  <input
                    type="range" min="0" max="100" step="1"
                    value={burnPercentage}
                    onChange={e => setBurnPercentage(parseInt(e.target.value))}
                    style={{ width: '100%', height: 6, borderRadius: 3, background: '#333', accentColor: '#d9534f' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 4 }}>
                    {[0, 25, 50, 75, 100].map(p => (
                      <button
                        key={p}
                        onClick={() => setBurnPercentage(p)}
                        style={{
                          flex: 1,
                          background: burnPercentage === p ? '#d9534f' : '#1a1a2a',
                          border: '1px solid #444',
                          color: burnPercentage === p ? '#fff' : '#888',
                          padding: '4px 0', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                        }}
                      >
                        {p}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Burn Amount Display */}
                <div style={{
                  background: '#1a1a1a', borderRadius: 8, padding: 14, marginBottom: 20,
                  border: '1px solid #d9534f33',
                }}>
                  <div style={{ fontSize: 11, color: '#888', marginBottom: 6 }}>AMOUNT TO BURN</div>
                  <div style={{ fontSize: 22, fontWeight: 'bold', color: '#d9534f', fontFamily: 'monospace' }}>
                    {burnAmount.toFixed(6)} LP
                  </div>
                  <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
                    {burnPercentage === 100
                      ? '(Full position — account will be closed)'
                      : `(${burnPercentage}% of position)`}
                  </div>
                </div>

                {/* Confirmation Checkbox */}
                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={confirmedBurn}
                      onChange={e => setConfirmedBurn(e.target.checked)}
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
                    borderRadius: 6, padding: 12, marginBottom: 14,
                  }}>
                    <div style={{ fontSize: 12, color: burnResult.success ? '#5cb85c' : '#d9534f' }}>
                      {burnResult.success ? 'OK: ' : 'FAILED: '}{burnResult.message}
                    </div>
                    {burnResult.txSignature && (
                      <a
                        href={`https://solscan.io/tx/${burnResult.txSignature}`}
                        target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, color: '#5b9bd5', marginTop: 8, display: 'inline-block' }}
                      >
                        View on Solscan →
                      </a>
                    )}
                  </div>
                )}

                {/* Burn Button */}
                <button
                  onClick={() => {
                    if (!confirmedBurn) {
                      alert('Please confirm that you understand the risks by checking the box above');
                      return;
                    }
                    executeBurnLiquidity();
                  }}
                  disabled={isLoading || burnAmount <= 0}
                  style={{
                    width: '100%', padding: '13px',
                    background: isLoading || burnAmount <= 0 || !confirmedBurn ? '#333' : '#d9534f',
                    color: isLoading || burnAmount <= 0 || !confirmedBurn ? '#666' : '#fff',
                    borderRadius: 6, fontWeight: 'bold', fontSize: 14,
                    border: 'none',
                    cursor: isLoading || burnAmount <= 0 || !confirmedBurn ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isLoading ? `${statusMsg || 'Processing...'}` : 'Burn Liquidity'}
                </button>

                {statusMsg && !isLoading && (
                  <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 10 }}>
                    {statusMsg}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Info Section */}
        <div style={{
          marginTop: 24,
          background: '#1e1e1e',
          border: '1px solid #2a2a2a',
          borderRadius: 8,
          padding: 18,
        }}>
          <h3 style={{ fontSize: 12, fontWeight: 'bold', color: '#f5a623', marginBottom: 12, marginTop: 0 }}>
            What happens when you burn liquidity?
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 'bold', color: '#5cb85c', marginBottom: 6 }}>Good for:</div>
              <ul style={{ fontSize: 11, color: '#888', paddingLeft: 16, margin: 0, lineHeight: 1.8 }}>
                <li>Increasing token scarcity</li>
                <li>Building holder trust</li>
                <li>Reducing circulating supply</li>
                <li>Creating deflationary mechanics</li>
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 'bold', color: '#d9534f', marginBottom: 6 }}>You lose:</div>
              <ul style={{ fontSize: 11, color: '#888', paddingLeft: 16, margin: 0, lineHeight: 1.8 }}>
                <li>Ability to remove liquidity</li>
                <li>Future fee earnings</li>
                <li>Trading flexibility</li>
                <li>LP tokens permanently</li>
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 'bold', color: '#e8e8e8', marginBottom: 6 }}>Use cases:</div>
              <ul style={{ fontSize: 11, color: '#888', paddingLeft: 16, margin: 0, lineHeight: 1.8 }}>
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
