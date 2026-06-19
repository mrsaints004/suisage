'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ConnectButton, useSuiClientContext } from '@mysten/dapp-kit';
import { VaultSelector } from './VaultSelector';
import { useState } from 'react';

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/portfolio', label: 'Portfolio' },
  { href: '/reasoning', label: 'Reasoning' },
  { href: '/guardian', label: 'Guardian' },
  { href: '/admin', label: 'Admin' },
];

export function Navbar() {
  const pathname = usePathname();
  const { network } = useSuiClientContext();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-sage-600 flex items-center justify-center text-white font-bold text-sm">
                S
              </div>
              <span className="text-xl font-bold text-sage-400 tracking-tight">SuiSage</span>
              <span className="text-xs bg-sage-900/50 text-sage-400 px-1.5 py-0.5 rounded border border-sage-800/50">AI</span>
              <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${network === 'testnet' ? 'bg-yellow-900/50 text-yellow-400 border border-yellow-800/50' : 'bg-green-900/50 text-green-400 border border-green-800/50'}`}>{network}</span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors relative ${
                    pathname === item.href
                      ? 'bg-sage-900/50 text-sage-400'
                      : 'text-gray-400 hover:text-white hover:bg-gray-800'
                  }`}
                >
                  {item.label}
                  {pathname === item.href && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-sage-400 rounded-full" />
                  )}
                </Link>
              ))}
            </div>
          </div>

          {/* Desktop right side */}
          <div className="hidden md:flex items-center gap-3">
            <VaultSelector />
            <ConnectButton />
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 rounded-md text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-800 bg-gray-950/95 backdrop-blur-sm animate-fade-in-up">
          <div className="px-4 py-3 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMobileOpen(false)}
                className={`block px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  pathname === item.href
                    ? 'bg-sage-900/50 text-sage-400'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
              >
                {item.label}
              </Link>
            ))}
          </div>
          <div className="px-4 py-3 border-t border-gray-800 flex flex-col gap-3">
            <VaultSelector />
            <ConnectButton />
          </div>
        </div>
      )}
    </nav>
  );
}
