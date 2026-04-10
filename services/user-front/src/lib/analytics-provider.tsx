'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAccount } from 'wagmi';
import { analytics } from './analytics';

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { address, connector, chain } = useAccount();
  const prevPath = useRef<string>('');
  const identified = useRef(false);

  // Init on mount
  useEffect(() => {
    analytics.init();
    return () => analytics.destroy();
  }, []);

  // Track page views on route change
  useEffect(() => {
    const fullPath = searchParams?.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname;

    if (fullPath !== prevPath.current) {
      analytics.page(pathname);
      prevPath.current = fullPath;
    }
  }, [pathname, searchParams]);

  // Identify on wallet connect
  useEffect(() => {
    if (address && !identified.current) {
      analytics.identify(address, {
        walletProvider: connector?.name || 'unknown',
        chainId: chain?.id,
      });
      identified.current = true;
    }
    if (!address && identified.current) {
      analytics.reset();
      identified.current = false;
    }
  }, [address, connector, chain]);

  return <>{children}</>;
}
