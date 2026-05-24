import {
  Raydium, CREATE_CPMM_POOL_PROGRAM, CREATE_CPMM_POOL_FEE_ACC,
  DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId, Percent,
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import { PublicKey, VersionedTransaction, Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { DexAdapter, PoolConfig, DexResult, PoolInfo } from './types';

const CPMM_FEE_CONFIGS = [
  { index: 0, tradeFeeRate: 2500 },
  { index: 1, tradeFeeRate: 500  },
  { index: 2, tradeFeeRate: 100  },
];

function toRaw(amount: string, decimals: number, Decimal: any): bigint {
  if (!amount || isNaN(parseFloat(amount))) return 0n;
  try {
    const d = new Decimal(amount).mul(new Decimal(10).pow(decimals));
    return BigInt(d.toFixed(0));
  } catch {
    return 0n;
  }
}

export const raydiumAdapter: DexAdapter = {
  name:        'raydium',
  label:       'Raydium CPMM',
  description: 'Standard AMM pool — cocok untuk token baru, likuiditas luas',
  isAvailable: () => true,

  async createPool(config: PoolConfig): Promise<DexResult> {
    const { connection, publicKey, signTransaction, network,
            tokenAMint, tokenBMint, tokenADecimals, tokenBDecimals,
            amountA, amountB, feeTierIndex } = config;

    console.log('[Raydium] Starting createPool...', { tokenAMint, tokenBMint, amountA, amountB });

    let Decimal: any;
    try {
      Decimal = (await import('decimal.js')).default;
    } catch {
      throw new Error('[Raydium] decimal.js belum terinstall.');
    }

    let raydium: Raydium;
    try {
      raydium = await Raydium.load({
        connection,
        owner: publicKey,
        cluster: network === 'devnet' ? 'devnet' : 'mainnet',
        disableFeatureCheck: true,
        blockhashCommitment: 'confirmed',
      });
    } catch (e: any) {
      throw new Error(`Gagal inisialisasi Raydium SDK: ${e.message}`);
    }

    const programId = network === 'devnet'
      ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
      : CREATE_CPMM_POOL_PROGRAM;

    const poolFeeAccount = network === 'devnet'
      ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC
      : CREATE_CPMM_POOL_FEE_ACC;

    const selectedFee = CPMM_FEE_CONFIGS[feeTierIndex] ?? CPMM_FEE_CONFIGS[0];
    
    const bnA = new BN(toRaw(amountA, tokenADecimals, Decimal).toString());
    const bnB = new BN(toRaw(amountB, tokenBDecimals, Decimal).toString());

    // Raydium CPMM createPool requires the fee config object.
    console.log('[Raydium] Fetching CPMM configs...');
    let feeConfig: any;
    try {
      const sdkConfigs = await raydium.api.getCpmmConfigs();
      feeConfig = sdkConfigs.find((c: any) => c.index === selectedFee.index);
    } catch (e: any) {
      throw new Error(`Gagal mengambil config Raydium: ${e.message}`);
    }
    
    if (!feeConfig) {
      throw new Error(`Fee config dengan index ${selectedFee.index} tidak ditemukan di API Raydium.`);
    }

    // 1. Detect Program IDs for both tokens
    const getProgramId = async (mint: string) => {
      if (mint === 'So11111111111111111111111111111111111111112') return TOKEN_PROGRAM_ID.toString();
      try {
        const info = await connection.getAccountInfo(new PublicKey(mint));
        return info?.owner.toString() || TOKEN_PROGRAM_ID.toString();
      } catch {
        return TOKEN_PROGRAM_ID.toString();
      }
    };

    const progA = await getProgramId(tokenAMint);
    const progB = await getProgramId(tokenBMint);

    // 2. Ensure tokens are sorted by mint address as required by Raydium
    const mintAKey = new PublicKey(tokenAMint);
    const mintBKey = new PublicKey(tokenBMint);
    const shouldSwap = mintAKey.toBuffer().compare(mintBKey.toBuffer()) > 0;

    const [finalMintA, finalMintB] = shouldSwap ? [tokenBMint, tokenAMint] : [tokenAMint, tokenBMint];
    const [finalDecA, finalDecB] = shouldSwap ? [tokenBDecimals, tokenADecimals] : [tokenADecimals, tokenBDecimals];
    const [finalAmountA, finalAmountB] = shouldSwap ? [bnB, bnA] : [bnA, bnB];
    const [finalProgA, finalProgB] = shouldSwap ? [progB, progA] : [progA, progB];

    console.log('[Raydium] Final Pool Params:', {
      mintA: finalMintA, progA: finalProgA, amountA: finalAmountA.toString(),
      mintB: finalMintB, progB: finalProgB, amountB: finalAmountB.toString()
    });

    const isSolInvolved = finalMintA === 'So11111111111111111111111111111111111111112' || finalMintB === 'So11111111111111111111111111111111111111112';

    let result: any;
    try {
      result = await raydium.cpmm.createPool({
        programId,
        poolFeeAccount,
        mintA: { address: finalMintA, decimals: finalDecA, programId: finalProgA },
        mintB: { address: finalMintB, decimals: finalDecB, programId: finalProgB },
        mintAAmount: finalAmountA,
        mintBAmount: finalAmountB,
        startTime:   new BN(0),
        feeConfig,
        associatedOnly:      false,
        ownerInfo:           { useSOLBalance: isSolInvolved },
        computeBudgetConfig: { units: 1000000, microLamports: 250000 },
      });
    } catch (e: any) {
      console.error('[Raydium SDK Error]', e);
      throw new Error(`Raydium SDK Error: ${e.message || 'Gagal membuat instruksi pool'}`);
    }

    const tx = result.transactions ?? result.transaction;
    const txArr = Array.isArray(tx) ? tx : [tx];

    let lastSig = '';
    for (let i = 0; i < txArr.length; i++) {
      const t = txArr[i];
      console.log(`[Raydium] Sending transaction ${i + 1}/${txArr.length}...`);
      
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      
      try {
        if (t instanceof VersionedTransaction) {
          if (!signTransaction) throw new Error('Wallet tidak mendukung signTransaction');
          const signed = await signTransaction(t);
          lastSig = await connection.sendRawTransaction(signed.serialize(), {
            skipPreflight: false,
            maxRetries: 5,
            preflightCommitment: 'confirmed'
          });
        } else {
          t.recentBlockhash = blockhash;
          t.feePayer = publicKey;
          lastSig = await config.sendTransaction(t, connection);
        }

        console.log(`[Raydium] Tx Sig: ${lastSig}. Waiting for confirmation...`);
        await connection.confirmTransaction({ signature: lastSig, blockhash, lastValidBlockHeight }, 'confirmed');
      } catch (e: any) {
        console.error(`[Raydium Tx Error ${i + 1}]`, e);
        throw e; // handleTxError will catch this
      }

      if (txArr.length > 1 && i < txArr.length - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    return { signature: lastSig };
  },

  async addLiquidity(config): Promise<DexResult> {
    const { connection, publicKey, signTransaction, network, poolId, amountA, amountB, tokenADecimals, tokenBDecimals } = config;
    
    let Decimal: any;
    try {
      Decimal = (await import('decimal.js')).default;
    } catch {
      throw new Error('[Raydium] decimal.js belum terinstall.');
    }

    const raydium = await Raydium.load({
      connection, owner: publicKey,
      cluster: network === 'devnet' ? 'devnet' : 'mainnet',
      disableFeatureCheck: true, blockhashCommitment: 'confirmed',
    });

    const poolInfoFull = await raydium.cpmm.getPoolInfoFromRpc(poolId);
    const bnA = new BN(toRaw(amountA, tokenADecimals, Decimal).toString());
    const bnB = new BN(toRaw(amountB, tokenBDecimals, Decimal).toString());

    const result = await raydium.cpmm.addLiquidity({
      poolInfo: poolInfoFull.poolInfo,
      poolKeys: poolInfoFull.poolKeys,
      inputAmount: bnA,
      baseIn: true,
      slippage: new Percent(1, 100),
      computeBudgetConfig: { units: 400000, microLamports: 100000 },
    });

    const tx = (result as any).transactions ?? (result as any).transaction;
    const txArr = Array.isArray(tx) ? tx : [tx];

    let lastSig = '';
    for (const t of txArr) {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      if (t instanceof VersionedTransaction) {
        if (!signTransaction) throw new Error('Wallet tidak mendukung signTransaction');
        const signed = await signTransaction(t);
        lastSig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      } else {
        t.recentBlockhash = blockhash;
        t.feePayer = publicKey;
        lastSig = await config.sendTransaction(t, connection);
      }
      await connection.confirmTransaction({ signature: lastSig, blockhash, lastValidBlockHeight }, 'confirmed');
      if (txArr.length > 1) await new Promise(r => setTimeout(r, 1000));
    }

    return { signature: lastSig };
  },

  async removeLiquidity(config): Promise<DexResult> {
    const { connection, publicKey, signTransaction, network, poolId, lpAmount: lpAmountStr } = config;
    
    const raydium = await Raydium.load({
      connection, owner: publicKey,
      cluster: network === 'devnet' ? 'devnet' : 'mainnet',
      disableFeatureCheck: true, blockhashCommitment: 'confirmed',
    });

    const poolInfoFull = await raydium.cpmm.getPoolInfoFromRpc(poolId);
    
    // Fetch wallet token accounts to find the LP token account
    const { tokenAccounts } = await raydium.account.fetchWalletTokenAccounts();
    const lpMint = poolInfoFull.poolInfo.lpMint;
    const lpMintStr = typeof lpMint === 'string' ? lpMint : (lpMint as any).address;
    const lpTokenAccount = tokenAccounts.find((a) => a.mint.toBase58() === lpMintStr);
    
    if (!lpTokenAccount) {
      throw new Error('LP token account not found in wallet');
    }

    const lpAmount = new BN(lpAmountStr);

    const result = await raydium.cpmm.withdrawLiquidity({
      poolInfo: poolInfoFull.poolInfo,
      poolKeys: poolInfoFull.poolKeys,
      lpAmount,
      slippage: new Percent(1, 100),
      computeBudgetConfig: { units: 400000, microLamports: 100000 },
    });

    const tx = (result as any).transactions ?? (result as any).transaction;
    const txArr = Array.isArray(tx) ? tx : [tx];

    let lastSig = '';
    for (const t of txArr) {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      if (t instanceof VersionedTransaction) {
        if (!signTransaction) throw new Error('Wallet tidak mendukung signTransaction');
        const signed = await signTransaction(t);
        lastSig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      } else {
        t.recentBlockhash = blockhash;
        t.feePayer = publicKey;
        lastSig = await config.sendTransaction(t, connection);
      }
      await connection.confirmTransaction({ signature: lastSig, blockhash, lastValidBlockHeight }, 'confirmed');
      if (txArr.length > 1) await new Promise(r => setTimeout(r, 1000));
    }

    return { signature: lastSig };
  },

  async findPool(connection, tokenA, tokenB, network): Promise<PoolInfo | null> {
    const {
      CREATE_CPMM_POOL_PROGRAM,
      DEVNET_PROGRAM_ID,
      getCpmmPdaAmmConfigId,
      getCpmmPdaPoolId,
      CpmmPoolInfoLayout,
    } = await import('@raydium-io/raydium-sdk-v2');

    const programId = network === 'devnet'
      ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
      : CREATE_CPMM_POOL_PROGRAM;

    for (const cfg of CPMM_FEE_CONFIGS) {
      for (const [mA, mB] of [[tokenA, tokenB], [tokenB, tokenA]]) {
        try {
          const configPda = getCpmmPdaAmmConfigId(programId, cfg.index);
          const poolPda = getCpmmPdaPoolId(
            programId,
            configPda.publicKey,
            new PublicKey(mA),
            new PublicKey(mB)
          );
          const accountInfo = await connection.getAccountInfo(poolPda.publicKey);
          if (!accountInfo) continue;

          const poolState = CpmmPoolInfoLayout.decode(accountInfo.data);
          let reserveA = 0n;
          let reserveB = 0n;
          try {
            const vaultAInfo = await connection.getTokenAccountBalance(poolState.vaultA);
            const vaultBInfo = await connection.getTokenAccountBalance(poolState.vaultB);
            reserveA = BigInt(vaultAInfo.value.amount);
            reserveB = BigInt(vaultBInfo.value.amount);
          } catch { }

          return {
            exists: true,
            poolId: poolPda.publicKey.toString(),
            lpMint: poolState.mintLp.toString(),
            lpDecimals: poolState.lpDecimals,
            feeConfigIndex: cfg.index,
            tradeFeeRate: cfg.tradeFeeRate,
            reserveA,
            reserveB,
            lpSupply: BigInt(poolState.lpAmount?.toString() ?? '0'),
          };
        } catch { continue; }
      }
    }
    return null;
  },

  async fetchPosition(connection, owner, pool): Promise<any> {
    const { getAssociatedTokenAddress, getAccount } = await import('@solana/spl-token');
    if (!pool.lpMint) return null;

    try {
      const lpAta = await getAssociatedTokenAddress(new PublicKey(pool.lpMint), owner);
      const lpAccount = await getAccount(connection, lpAta).catch(() => null);
      if (!lpAccount) return null;

      const raw = BigInt(lpAccount.amount.toString());
      if (raw === 0n) return null;

      const lpSupply = pool.lpSupply || 0n;
      const share = lpSupply > 0n ? ((Number(raw) / Number(lpSupply)) * 100).toFixed(4) : '0';

      let valueA = '0';
      let valueB = '0';

      if (lpSupply > 0n && pool.reserveA !== undefined && pool.reserveB !== undefined) {
        const outA = (raw * pool.reserveA) / lpSupply;
        const outB = (raw * pool.reserveB) / lpSupply;
        // Note: We don't have token decimals here easily, but LiquidityPage handles formatting
        // For now we return raw strings or let the UI handle it.
        // To be consistent with UserPoolPosition interface:
        valueA = outA.toString();
        valueB = outB.toString();
      }

      return {
        lpBalance: raw.toString(), // Will be formatted by UI
        lpBalanceRaw: raw,
        sharePercent: share,
        valueA,
        valueB,
      };
    } catch {
      return null;
    }
  },

  async lockLpTokens(
    connection: any,
    owner: PublicKey,
    signTransaction: any,
    lpMint: string,
    lpAmount: bigint,
    lockUntilMs: number
  ): Promise<string> {
    // Derive lock escrow PDA:
    // seeds: ["lp_lock", owner, lpMint, lockUntil as bytes]
    const { SystemProgram, TransactionMessage, VersionedTransaction: VT } =
      await import('@solana/web3.js');
    const {
      getAssociatedTokenAddress,
      createTransferInstruction,
      TOKEN_PROGRAM_ID
    } = await import('@solana/spl-token');

    const lockUntilSec = Math.floor(lockUntilMs / 1000);
    const lockUntilBuf = Buffer.alloc(8);
    lockUntilBuf.writeBigInt64LE(BigInt(lockUntilSec));

    // Derive escrow PDA
    const [escrowPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('lp_lock'),
        owner.toBuffer(),
        new PublicKey(lpMint).toBuffer(),
        lockUntilBuf,
      ],
      SystemProgram.programId // Replace with actual lock program ID if deployed
    );

    // Get source LP ATA
    const sourceAta = await getAssociatedTokenAddress(
      new PublicKey(lpMint), owner
    );

    // Get or create escrow ATA
    const escrowAta = await getAssociatedTokenAddress(
      new PublicKey(lpMint), escrowPda, true
    );

    // Build transfer instruction
    const transferIx = createTransferInstruction(
      sourceAta,
      escrowAta,
      owner,
      lpAmount,
      [],
      TOKEN_PROGRAM_ID
    );

    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash('confirmed');

    const msg = new TransactionMessage({
      payerKey: owner,
      recentBlockhash: blockhash,
      instructions: [transferIx],
    }).compileToV0Message();

    const tx = new VT(msg);
    const signed = await signTransaction(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
    
    return sig;
  }
};
