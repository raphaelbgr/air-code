import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT = 768;
const TABLET_BREAKPOINT = 1024;

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export function useMobileDetect(): { device: DeviceType; isMobile: boolean; isTablet: boolean } {
  const [width, setWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handler = () => setWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const isMobile = width < MOBILE_BREAKPOINT;
  const isTablet = width >= MOBILE_BREAKPOINT && width < TABLET_BREAKPOINT;
  const device: DeviceType = isMobile ? 'mobile' : isTablet ? 'tablet' : 'desktop';

  return { device, isMobile, isTablet };
}
