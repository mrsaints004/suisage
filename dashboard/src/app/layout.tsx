import type { Metadata } from 'next';
import { Providers } from './providers';
import { Navbar } from './components/Navbar';
import './globals.css';

export const metadata: Metadata = {
  title: 'SuiSage - Autonomous DeFi Agent',
  description: 'AI-powered trading with verifiable reasoning on Sui',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
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
