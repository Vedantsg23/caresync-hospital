import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { Providers } from '@/components/providers';

/**
 * Fonts are served from this origin, from files committed to the repository.
 *
 * They used to be a `<link>` to Google Fonts, which meant every page view of a
 * hospital system announced itself — reader IP, referring URL — to a third
 * party, and meant the Content Security Policy had to permit a stylesheet from
 * somewhere other than 'self'. Neither is acceptable here.
 *
 * They are local files rather than `next/font/google` because that helper
 * fetches from Google at build time: it moves the dependency from every page
 * view to every deployment, but it does not remove it, and a build that needs
 * an outside network is a build that can fail for reasons nobody controls.
 *
 * Both faces are the upstream Inter and JetBrains Mono variable fonts (SIL Open
 * Font License, see NOTICE), latin subset. Same typefaces, same weights: the
 * design is unchanged.
 */
const inter = localFont({
  src: './fonts/inter-variable.woff2',
  weight: '100 900',
  style: 'normal',
  variable: '--font-sans',
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
});

const jetbrainsMono = localFont({
  src: './fonts/jetbrains-mono-variable.woff2',
  weight: '100 800',
  style: 'normal',
  variable: '--font-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
});

export const metadata: Metadata = {
  title: {
    default: 'CareSync Hospital',
    template: '%s | CareSync Hospital',
  },
  description: 'One Hospital. One Connected View of the Patient.',
  robots: { index: false, follow: false },
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#131b2e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
