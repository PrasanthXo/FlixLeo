import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type ScrollState = {
  canLeft: boolean;
  canRight: boolean;
  thumbWidth: number;
  thumbLeft: number;
};

const INITIAL: ScrollState = {
  canLeft: false,
  canRight: false,
  thumbWidth: 100,
  thumbLeft: 0
};

/**
 * FlixLeo Windows EXE Home only. Web/mobile still receive the original rail.
 * A thin animated position indicator replaces Chromium's thick scrollbar,
 * while the glass arrows provide an accessible way to navigate with a mouse.
 */
export function WindowsCatalogRail({
  children, title, itemCount, windowsExe
}: {
  children: React.ReactNode;
  title: string;
  itemCount: number;
  windowsExe: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ScrollState>(INITIAL);
  const update = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const overflow = Math.max(0, el.scrollWidth - el.clientWidth);
    const position = Math.min(overflow, Math.max(0, el.scrollLeft));
    const width = overflow > 2
      ? Math.max(13, Math.min(100, (el.clientWidth / el.scrollWidth) * 100))
      : 100;
    const left = overflow > 2 ? (position / overflow) * (100 - width) : 0;
    setState(prev => {
      const next = {
        canLeft: position > 2,
        canRight: position < overflow - 2,
        thumbWidth: width,
        thumbLeft: left
      };
      return prev.canLeft === next.canLeft && prev.canRight === next.canRight &&
        Math.abs(prev.thumbLeft - next.thumbLeft) < 0.2 &&
        Math.abs(prev.thumbWidth - next.thumbWidth) < 0.2 ? prev : next;
    });
  }, []);

  useEffect(() => {
    if (!windowsExe) return;
    const el = viewport.current;
    if (!el) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
      });
    };
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(schedule)
      : null;
    observer?.observe(el);
    // Each title card has a fixed width, but changes in the collection or
    // viewport must still refresh both navigation buttons.
    window.addEventListener('resize', schedule);
    el.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      el.removeEventListener('scroll', schedule);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [windowsExe, itemCount, update]);

  const move = (direction: -1 | 1) => {
    const el = viewport.current;
    if (!el) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({
      left: direction * Math.max(210, Math.floor(el.clientWidth * 0.78)),
      behavior: reduceMotion ? 'instant' : 'smooth'
    });
  };

  if (!windowsExe) {
    return <div className="flixleo-mobile-collection-scroll">{children}</div>;
  }

  const scrollable = state.canLeft || state.canRight;
  return <div
    className="flixleo-exe-carousel"
    data-left={state.canLeft ? 'true' : 'false'}
    data-right={state.canRight ? 'true' : 'false'}
  >
    <div className="flixleo-exe-carousel-frame">
      <div ref={viewport} className="flixleo-mobile-collection-scroll flixleo-exe-carousel-track"
        aria-label={`${title} — horizontal titles`} role="region" tabIndex={0}>
        {children}
      </div>
      <button type="button" aria-label={`Scroll ${title} left`}
        title="Previous titles" onClick={() => move(-1)} disabled={!state.canLeft}
        className="flixleo-exe-carousel-arrow flixleo-exe-carousel-prev">
        <ChevronLeft size={24} strokeWidth={2.25} aria-hidden="true" />
      </button>
      <button type="button" aria-label={`Scroll ${title} right`}
        title="Next titles" onClick={() => move(1)} disabled={!state.canRight}
        className="flixleo-exe-carousel-arrow flixleo-exe-carousel-next">
        <ChevronRight size={24} strokeWidth={2.25} aria-hidden="true" />
      </button>
    </div>
    {scrollable && <div className="flixleo-exe-carousel-indicator" aria-hidden="true">
      <span className="flixleo-exe-carousel-thumb" style={{
        width: `${state.thumbWidth}%`,
        left: `${state.thumbLeft}%`
      }} />
    </div>}
  </div>;
}
