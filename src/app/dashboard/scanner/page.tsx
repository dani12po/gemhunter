'use client';

import { useState } from 'react';
import { Header } from '../../../components/layout/Header';
import { ErrorBoundary } from '../../../components/shared/ErrorBoundary';
import { TokenScanner } from '../../../components/scanner/TokenScanner';
import { useScanner } from '../../../hooks/useScanner';
import type { TokenData } from '../../../lib/types';

export default function ScannerPage() {
  const {
    tokens,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    filter,
    setFilter,
    preset,
    setPresetValue,
    scanMode,
    setScanMode,
    stats,
    exportCSV,
    scanToken,
  } = useScanner();

  // undefined = modal closed
  // null = general swap (SOL -> ?)
  // TokenData = specific token swap
  const [swapToken, setSwapToken] = useState<TokenData | null | undefined>(undefined);

  const handleSwapOpen = (token: TokenData | null) => {
    setSwapToken(token);
  };

  return (
    <ErrorBoundary>
      <Header
        scanMode={scanMode}
        onScanModeChange={setScanMode}
        preset={preset}
        onPresetChange={setPresetValue}
        onSwapOpen={() => handleSwapOpen(null)}
      />
      <TokenScanner
        tokens={tokens}
        loading={loading}
        error={error}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        filter={filter}
        onFilterChange={setFilter}
        onSwapOpen={handleSwapOpen}
        swapToken={swapToken}
        onSwapClose={() => setSwapToken(undefined)}
        stats={stats}
        onExport={exportCSV}
        onRefresh={scanToken}
        preset={preset}
      />
    </ErrorBoundary>
  );
}
