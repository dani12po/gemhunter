import {
  Raydium, CREATE_CPMM_POOL_FEE_ACC, CREATE_CPMM_POOL_PROGRAM,
  DEVNET_PROGRAM_ID, getCpmmPdaAmmConfigId, Percent,
} from '@raydium-io/raydium-sdk-v2';
import BN from 'bn.js';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { DexAdapter, PoolConfig, DexResult } from './types';

const CPMM_FEE_CONFIGS = [
  { index: 0, tradeFeeRate: 2500 },
  { index: 1, tradeFeeRate: 500  },
  { index: 2, tradeFeeRate: 100  },
];

function toRaw(amount: string, decimals: number): bigint {
  if (!amount || isNaN(parseFloat(amount))) return 0n;
  const [intPart, fracPart = ''] = amount.split('.');
  const fracs = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(intPart || '0') * BigInt(10 ** decimals) + BigInt(fracs || '0');
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

    const raydium = await Raydium.load({
      connection, owner: publicKey,
      cluster: network === 'devnet' ? 'devnet' : 'mainnet',
      disableFeatureCheck: true, blockhashCommitment: 'confirmed',
    });

    const programId = network === 'devnet'
      ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_PROGRAM
      : CREATE_CPMM_POOL_PROGRAM;

    const poolFeeAccount = network === 'devnet'
      ? DEVNET_PROGRAM_ID.CREATE_CPMM_POOL_FEE_ACC
      : CREATE_CPMM_POOL_FEE_ACC;

    const selectedFee = CPMM_FEE_CONFIGS[feeTierIndex] ?? CPMM_FEE_CONFIGS[0];
    const configPda   = getCpmmPdaAmmConfigId(programId, selectedFee.index);

    const bnA = new BN(toRaw(amountA, tokenADecimals).toString());
    const bnB = new BN(toRaw(amountB, tokenBDecimals).toString());

    const result = await raydium.cpmm.createPool({
      programId,
      poolFeeAccount,
      mintA: { address: tokenAMint, decimals: tokenADecimals, programId: TOKEN_PROGRAM_ID.toString() },
      mintB: { address: tokenBMint, decimals: tokenBDecimals, programId: TOKEN_PROGRAM_ID.toString() },
      mintAAmount: bnA,
      mintBAmount: bnB,
      startTime:   new BN(0),
      feeConfig: {
        id:              configPda.publicKey.toString(),
        index:           selectedFee.index,
        protocolFeeRate: 120000,
        tradeFeeRate:    selectedFee.tradeFeeRate,
        fundFeeRate:     40000,
        createPoolFee:   network === 'devnet' ? '0' : '150000000',
        creatorFeeRate:  0,
      } as any,
      associatedOnly:      false,
      ownerInfo:           { useSOLBalance: tokenAMint === 'So11111111111111111111111111111111111111112' },
      computeBudgetConfig: { units: 600000, microLamports: 100000 },
    });

    const tx = (result as any).transactions ?? (result as any).transaction;
    const txArr = Array.isArray(tx) ? tx : [tx];

    let lastSig = '';
    for (const t of txArr) {
      if (t instanceof VersionedTransaction) {
        if (!signTransaction) throw new Error('Wallet tidak mendukung signTransaction');
        const signed = await signTransaction(t);
        lastSig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
      } else {
        const { blockhash } = await connection.getLatestBlockhash('confirmed');
        t.recentBlockhash = blockhash;
        t.feePayer = publicKey;
        lastSig = await config.sendTransaction(t, connection);
      }
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction({ signature: lastSig, blockhash, lastValidBlockHeight }, 'confirmed');
    }

    return { signature: lastSig };
  },

  async addLiquidity(config): Promise<DexResult> {
    throw new Error('addLiquidity via raydiumAdapter belum diimplementasikan');
  },
};
