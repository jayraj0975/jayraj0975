import type { Metadata } from 'next';
import { site } from '@/lib/site';
import './globals.css';

const description = 'Know what a buyer will find in your code before they look. Evidence-graded technical diligence for AI-built software: every claim tied to evidence, every unknown left unknown.';

export async function generateMetadata(): Promise<Metadata> {
  const { url } = site();
  return {
    metadataBase: new URL(url),
    title: { default: 'AcquiCode — Technical due diligence for AI-built software', template: '%s · AcquiCode' },
    description,
    applicationName: 'AcquiCode',
    robots: { index: true, follow: true },
    openGraph: { type: 'website', siteName: 'AcquiCode', title: 'AcquiCode — Technical due diligence for AI-built software', description, url },
    twitter: { card: 'summary_large_image', title: 'AcquiCode', description },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
