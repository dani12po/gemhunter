'use client';

import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';

require('@solana/wallet-adapter-react-ui/styles.css');

// ─── RPC Endpoints ───────────────────────────────────────────
// Priority: env variable > free providers that support CORS
// api.mainnet-beta.solana.com blocks browser requests (403)
// Use providers that explicitly allow browser/CORS requests

const MAINNET_RPC = process.env.NEXT_PUBLIC_RPC_URL
  // Free providers with CORS support (no API key needed):
  || 'https://solana-mainnet.rpc.extrnode.com'   // extrnode — free, CORS ok
  ;

const DEVNET_RPC = process.env.NEXT_PUBLIC_DEVNET_RPC_URL
  || 'https://api.devnet.solana.com';

const DEFAULT_NETWORK = (process.env.NEXT_PUBLIC_NETWORK as WalletAdapterNetwork)
  || WalletAdapterNetwork.Mainnet;

export const SolanaProvider = ({ children }: { children: React.ReactNode }) => {
  const network = DEFAULT_NETWORK;

  const endpoint = useMemo(() => {
    if (network === WalletAdapterNetwork.Mainnet) return MAINNET_RPC;
    if (network === WalletAdapterNetwork.Devnet)  return DEVNET_RPC;
    return MAINNET_RPC;
  }, [network]);

  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter({ network }),
  ], [network]);

  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: 'confirmed' }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
