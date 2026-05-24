'use client';

import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';

require('@solana/wallet-adapter-react-ui/styles.css');

// RPC endpoints dari env — fallback ke public endpoints
const MAINNET_RPC = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';
const DEVNET_RPC  = process.env.NEXT_PUBLIC_DEVNET_RPC_URL || 'https://api.devnet.solana.com';

// Default network dari env — default mainnet-beta jika tidak diset
const DEFAULT_NETWORK = (process.env.NEXT_PUBLIC_NETWORK as WalletAdapterNetwork)
  || WalletAdapterNetwork.Mainnet;

export const SolanaProvider = ({ children }: { children: React.ReactNode }) => {
  // Gunakan network dari env sebagai default
  // Wallet adapter akan otomatis terhubung ke jaringan yang dipilih user di wallet mereka
  const network = DEFAULT_NETWORK;

  const endpoint = useMemo(() => {
    if (network === WalletAdapterNetwork.Mainnet) return MAINNET_RPC;
    if (network === WalletAdapterNetwork.Devnet)  return DEVNET_RPC;
    return clusterApiUrl(network);
  }, [network]);

  const wallets = useMemo(() => [
    new PhantomWalletAdapter(),
    new SolflareWalletAdapter({ network }),
  ], [network]);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
