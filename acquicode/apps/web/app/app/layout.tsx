import { Footer } from '@/components/ui';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Footer />
    </>
  );
}
