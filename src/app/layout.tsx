import './globals.css';
import { SolanaProvider } from '../components/shared/SolanaProvider';

export const metadata = {
  title: 'Solana Gem Hunter',
  description: 'Find the next 100x gem on Solana',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />
      </head>
      <body style={{ background: '#1a1a1a' }}>
        <SolanaProvider>
          {children}
        </SolanaProvider>
      </body>
    </html>
  );
}