'use client';

import * as React from 'react';
import { Sidebar } from './sidebar';
import { Header } from './header';

export function AppShell({ children }: { children: React.ReactNode }) {
  const [navOpen, setNavOpen] = React.useState(false);

  return (
    <div className="min-h-screen bg-surface">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <Header onOpenNav={() => setNavOpen(true)} />
      <div className="lg:pl-64">
        <main className="pt-16 min-h-screen">
          <div className="w-full max-w-[1600px] mx-auto p-space-4 sm:p-space-6 lg:p-space-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
