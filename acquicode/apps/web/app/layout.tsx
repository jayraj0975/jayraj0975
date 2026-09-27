import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'AcquiCode — Technical due diligence for AI-built software', template: '%s · AcquiCode' },
  description: 'Prove what your software contains, where it came from and what a buyer will ask, with every claim tied to evidence and every unknown left unknown.',
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
