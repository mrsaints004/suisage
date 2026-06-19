import type { Metadata } from 'next';
import { Providers } from './providers';
import { Navbar } from './components/Navbar';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://suisage.xyz'),
  title: 'SuiSage — Safe Autonomous Agent Wallet',
  description: 'Framework for autonomous agent wallets with Move-enforced guardrails, verifiable reasoning on Walrus, and SHA-256 hash commitment on Sui.',
  icons: {
    icon: '/favicon.svg',
  },
  openGraph: {
    title: 'SuiSage — Safe Autonomous Agent Wallet',
    description: 'Move-enforced guardrails. Verifiable reasoning. SHA-256 hash commitment on Sui.',
    url: 'https://suisage.xyz',
    siteName: 'SuiSage',
    images: [{ url: '/og-image.svg', width: 1200, height: 630 }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SuiSage — Safe Autonomous Agent Wallet',
    description: 'Move-enforced guardrails. Verifiable reasoning. SHA-256 hash commitment on Sui.',
    images: ['/og-image.svg'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <meta name="theme-color" content="#0a0a0a" />
      </head>
      <body className="min-h-screen bg-gray-950 text-white">
        <Providers>
          <Navbar />
          <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
