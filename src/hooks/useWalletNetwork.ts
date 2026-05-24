'use client';

import { useEffect, useState } from 'react';
import { useConnection } from '@solana/wallet-adapter-react';

export type WalletNetwork = 'mainnet-beta' | 'devnet' | 'testnet' | 'unknown';

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const DEVNET_GENESIS  = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const TESTNET_GENESIS = '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY';

/**
 * Auto-detects the network the connected wallet is on
 * by querying the genesis hash of the current RPC endpoint.
 */
export function useWalletNetwork(): {
  network: WalletNetwork;
  isMainnet: boolean;
  isDevnet: boolean;
  label: string;
} {
  const { connection } = useConnection();
  const [network, setNetwork] = useState<WalletNetwork>('unknown');

  useEffect(() => {
    let cancelled = false;
    connection.getGenesisHash().then(hash => {
      if (cancelled) return;
      if (hash === MAINNET_GENESIS) setNetwork('mainnet-beta');
      else if (hash === DEVNET_GENESIS) setNetwork('devnet');
      else if (hash === TESTNET_GENESIS) setNetwork('testnet');
      else setNetwork('unknown');
    }).catch(() => {
      if (!cancelled) setNetwork('unknown');
    });
    return () => { cancelled = true; };
  }, [connection]);

  return {
    network,
    isMainnet: network === 'mainnet-beta',
    isDevnet:  network === 'devnet',
    label:     network === 'mainnet-beta' ? 'Mainnet' :
               network === 'devnet'       ? 'Devnet'  :
               network === 'testnet'      ? 'Testnet' : '',
  };
}
