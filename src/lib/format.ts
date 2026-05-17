export function formatAngka(n: number): string {
  if (!n || n === 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toFixed(2);
}

export function formatHarga(n: number): string {
  if (!n || n === 0) return '0';
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(6);
  if (n >= 0.0001) return n.toFixed(8);
  return n.toExponential(4);
}

export function formatUmur(jam: number): string {
  if (!jam && jam !== 0) return '—';
  if (jam < 1 / 60) return '<1m';
  if (jam < 1) return Math.round(jam * 60) + 'm';
  if (jam < 24) return jam.toFixed(1) + 'j';
  return Math.floor(jam / 24) + 'h ' + Math.round(jam % 24) + 'j';
}

export function fmtNum(n: number): string {
  if (!n) return '0';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(n);
}

export function escHtml(s: string): string {
  return String(s).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
}
