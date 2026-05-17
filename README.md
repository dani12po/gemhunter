# Solana Gem Hunter

Platform all-in-one untuk trading token Solana: Scanner real-time, Swap dengan fee, Liquidity Pool, dan Create Token.

---

## Fitur

### Token Scanner
- Scan token Solana terbaru secara real-time dari Dexscreener
- Multi-source: Latest Profiles + Boosted Tokens (hype)
- Scoring otomatis 0-100 berdasarkan momentum, likuiditas, umur, buy pressure
- Filter preset: Gem Hunter, Safe, Degen, Custom
- Akumulasi token, data tidak hilang saat refresh
- Notifikasi browser untuk gem baru (skor >= 70)
- Export CSV

### Swap Token
- Swap langsung di web via Jupiter Aggregator API
- Support semua token Solana (search by nama/simbol/CA)
- Platform fee 0.5% otomatis ke wallet owner
- Quote real-time dengan debounce 600ms
- Auto-refresh quote setiap 30 detik
- Riwayat transaksi dengan link Solscan

### Liquidity Pool
- Add & Remove Liquidity via Raydium CPMM SDK v2
- Buat pool baru atau tambah ke pool existing
- Pilih fee tier: 0.25% / 0.05% / 0.01%
- Preview LP token yang diterima
- Tampilkan posisi LP, pool share %, estimasi nilai
- Support Devnet & Mainnet

### Create Token
- Buat SPL Token baru di Solana
- Set nama, simbol, supply, decimals, metadata
- Upload logo token
- Langsung mint ke wallet kamu

---

## Tech Stack

| Layer | Teknologi |
|-------|-----------|
| Framework | Next.js 14 App Router |
| Language | TypeScript 5 |
| Wallet | @solana/wallet-adapter-react (Phantom, Solflare) |
| Swap | Jupiter Aggregator API v1 |
| Liquidity | Raydium SDK v2 CPMM |
| Token Data | Dexscreener API |
| Blockchain | Solana Web3.js |

---

## Quick Start

### Prerequisites
- Node.js 18+
- npm atau yarn
- Phantom / Solflare wallet browser extension

### Install & Run

    git clone https://github.com/dani12po/gemhunter.git
    cd gemhunter
    npm install
    cp .env.local.example .env.local
    # Edit .env.local sesuai kebutuhan
    npm run dev

Buka http://localhost:3000

---

## Environment Variables

Salin .env.local.example ke .env.local dan isi nilainya.

| Variable | Wajib | Default | Keterangan |
|----------|-------|---------|------------|
| NEXT_PUBLIC_NETWORK | Ya | devnet | devnet atau mainnet-beta |
| NEXT_PUBLIC_RPC_URL | Ya | Solana publik | RPC endpoint mainnet |
| NEXT_PUBLIC_DEVNET_RPC_URL | Tidak | Solana devnet | RPC endpoint devnet |
| NEXT_PUBLIC_JUPITER_API_KEY | Tidak | kosong | API key Jupiter (rate limit lebih tinggi) |

---

## Platform Fee

Setiap swap dikenakan fee 0.5% (50 bps) yang otomatis dikirim ke wallet owner via Jupiter fee account.

Konfigurasi di src/lib/constants.ts:

    export const PLATFORM_FEE_BPS    = 50;
    export const PLATFORM_FEE_WALLET = 'GFK2JGbzQ8b3jusvNdSwbfdsuQEBP9KawPj6VwcLyyEx';

Daftarkan wallet di https://station.jup.ag sebagai referral account untuk aktivasi fee collection.

---

## Deploy ke Vercel

1. Import repo dari GitHub di vercel.com
2. Framework: Next.js (auto-detect)
3. Tambahkan Environment Variables di Vercel Dashboard
4. Klik Deploy

---

## Struktur Project

    src/
    +-- app/
    |   +-- page.tsx                  # Scanner utama (/)
    |   +-- create-token/page.tsx     # Create SPL Token
    |   +-- liquidity/page.tsx        # Liquidity Pool
    |   +-- dashboard/scanner/        # Scanner dashboard
    +-- components/
    |   +-- layout/Header.tsx         # Header + navigasi
    |   +-- scanner/TokenScanner.tsx  # Komponen scanner
    |   +-- swap/SwapUI.tsx           # UI swap + Jupiter API
    |   +-- shared/SolanaProvider.tsx # Wallet adapter
    +-- hooks/useScanner.ts           # Hook scanner logic
    +-- lib/
        +-- constants.ts              # Fee wallet, endpoints
        +-- types.ts                  # TypeScript interfaces
        +-- scoring.ts                # Algoritma scoring
        +-- dex/raydium.ts            # Raydium CPMM adapter

---

## Disclaimer

Platform ini dibuat untuk tujuan edukasi dan trading personal.
Selalu lakukan riset sendiri (DYOR) sebelum membeli token apapun.
Crypto trading mengandung risiko tinggi termasuk kehilangan seluruh modal.

---

## License

MIT 2025 Solana Gem Hunter