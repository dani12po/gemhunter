# 🔍 Token Scanner — Solana & Base

Aplikasi web untuk memindai token baru di jaringan **Solana** dan **Base** secara real-time menggunakan [Dexscreener API](https://docs.dexscreener.com/) yang gratis. Berjalan sepenuhnya di browser tanpa backend atau server.

---

## 🚀 Cara Menjalankan

1. Pastikan semua file berada dalam satu folder:
├── index.html ├── style.css ├── scanner.js ├── scoring.js └── README.md
2. Buka file `index.html` langsung di browser (Chrome/Edge/Firefox)
3. Izinkan notifikasi browser jika diminta
4. Scanner akan otomatis berjalan dan memperbarui data setiap 60 detik

> **Catatan:** Tidak perlu server lokal, tidak perlu API key, tidak perlu instalasi apapun.

---

## ✨ Fitur Utama

| Fitur | Keterangan |
|---|---|
| Scanner Otomatis | Fetch token baru dari Dexscreener setiap 60 detik |
| Filter Kriteria | 6 filter otomatis untuk menyaring token berkualitas |
| Scoring System | Skor 0–100 berdasarkan 5 komponen |
| Red Flag Detector | Deteksi otomatis tanda bahaya pada token |
| Sort & Search | Urutkan tabel dan cari token secara real-time |
| Export CSV | Unduh data token yang terfilter |
| Notifikasi Browser | Alert otomatis untuk token baru skor ≥70 |
| Dark Mode | Tampilan gelap yang nyaman di mata |
| Responsive | Bisa digunakan di desktop maupun mobile |

---

## 🔧 Penjelasan Filter

| Filter | Nilai Default | Penjelasan |
|---|---|---|
| Liquidity min ($) | 30.000 | Likuiditas pool minimal agar tidak mudah dimanipulasi |
| Volume min ($) | 10.000 | Volume trading 24 jam minimal sebagai bukti aktivitas |
| Umur maks (jam) | 72 | Hanya tampilkan token yang baru listing (≤3 hari) |
| Δ1j min (%) | 5 | Harga harus naik minimal 5% dalam 1 jam terakhir |
| Txn min | 100 | Minimal 100 transaksi dalam 24 jam |
| MCap maks ($) | 10.000.000 | Fokus pada micro cap dengan potensi kenaikan besar |

Filter dapat diubah di bagian atas halaman dan akan tersimpan otomatis.

---

## 📊 Penjelasan Sistem Skor (0–100)

| Komponen | Bobot | Logika |
|---|---|---|
| Volume / Liquidity ratio | 30% | Rasio tinggi = aktivitas trading sehat |
| Price Momentum | 25% | Gabungan Δ1j (50%) + Δ6j (30%) + Δ24j (20%) |
| Umur Token | 20% | ≤6j=20pt, ≤24j=15pt, ≤48j=10pt, ≤72j=5pt |
| Jumlah Transaksi | 15% | Dinormalisasi ke 0–15 (cap 10.000 txn) |
| Market Cap Rendah | 10% | ≤$500K=10pt, ≤$1M=8pt, ≤$5M=5pt, ≤$10M=2pt |

**Badge Skor:**
- 🟢 **71–100** — Potensi tinggi
- 🟡 **41–70** — Perlu perhatian lebih
- 🔴 **0–40** — Risiko tinggi / kurang menarik

---

## ⚠️ Red Flag Detector

Token akan ditandai ⚠️ jika memenuhi salah satu kondisi berikut:

| Kondisi | Penjelasan |
|---|---|
| Liquidity turun >20% dalam 1 jam | Kemungkinan rug pull atau exit liquidity |
| Top 10 holder pegang >80% supply | Konsentrasi kepemilikan sangat tinggi |
| Tidak ada website atau sosial media | Token tanpa identitas publik |
| Volume spike >500% tiba-tiba | Kemungkinan manipulasi atau pump & dump |

---

## 🌐 Catatan API

- Menggunakan **Dexscreener API** yang sepenuhnya **gratis**
- **Tidak perlu API key** atau registrasi apapun
- Endpoint yang digunakan:
- `https://api.dexscreener.com/token-profiles/latest/v1`
- `https://api.dexscreener.com/latest/dex/tokens/{tokenAddress}`

---

## 🔔 Catatan Notifikasi Browser

- Notifikasi akan muncul saat token baru ditemukan dengan **skor ≥ 70**
- Browser akan meminta izin notifikasi saat pertama kali membuka aplikasi
- Pastikan izin notifikasi **diizinkan** di pengaturan browser Anda

---

## 🛠️ Troubleshooting

**Data tidak muncul / tabel kosong:**
- Pastikan koneksi internet aktif
- Coba klik tombol "↺ Refresh Sekarang"
- Coba longgarkan nilai filter (turunkan Δ1j min atau naikkan umur maks)

**Error CORS saat membuka dari <traycer-file absPath="//" isDirectory="true">//</traycer-file>:**
- Gunakan browser Chrome atau Edge terbaru
- Atau jalankan via server lokal sederhana: `npx serve D:\trading`

**API rate limit:**
- Dexscreener membatasi jumlah request per menit
- Aplikasi sudah menangani ini dengan retry otomatis pada refresh berikutnya
- Jangan refresh terlalu sering secara manual

**Notifikasi tidak muncul:**
- Pastikan izin notifikasi sudah diberikan di browser
- Cek pengaturan: `chrome://settings/content/notifications`

---

## ⚖️ Disclaimer

Aplikasi ini hanya untuk tujuan informasi dan riset. Bukan merupakan saran investasi. Trading kripto mengandung risiko tinggi. Selalu lakukan riset mandiri (DYOR) sebelum membeli token apapun.
