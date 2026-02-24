import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Track whether a DOM element is visible in the viewport.
 * Used for lazy-mounting xterm.js terminals only when their node is on screen.
 */
export function useViewportVisibility(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        setVisible(entry.isIntersecting);
      },
      { threshold: 0.01 },
    );

    observerRef.current.observe(el);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [ref]);

  return visible;
}
