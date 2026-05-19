import { ReactNode } from 'react';
import Navbar from './Navbar';
import { GlobalSearch } from './GlobalSearch';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <GlobalSearch />
      <main className="flex-1 w-full">
        {children}
      </main>
    </div>
  );
}
