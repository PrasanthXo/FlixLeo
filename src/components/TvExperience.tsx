import React, { useEffect } from 'react';
import { Home, Film, Tv, Search, Bookmark, UserRound } from 'lucide-react';

const items = [
  { id: 'browse', label: 'Home', Icon: Home },
  { id: 'movies', label: 'Movies', Icon: Film },
  { id: 'series', label: 'Series', Icon: Tv },
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'watchlist', label: 'Watchlist', Icon: Bookmark },
] as const;

export function TvExperience({ currentTab, onSelectTab, onOpenProfile }: {
  currentTab: string; onSelectTab: (tab: string) => void; onOpenProfile: () => void;
}) {
  useEffect(() => {
    const focusFirst = () => {
      const node = document.querySelector<HTMLElement>('.flixleo-tv-nav button[aria-current="page"]');
      if (node && !document.querySelector('[role="dialog"]')) node.focus();
    };
    const timer = window.setTimeout(focusFirst, 200);
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = target?.matches('input,textarea,select,[contenteditable="true"]');
      if (editable) return;
      if (event.key === 'Escape' || event.key === 'Backspace' || event.key === 'BrowserBack') {
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        if (dialog) {
          const close = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(b => /close|back|cancel/i.test(b.getAttribute('aria-label') || b.textContent || ''));
          if (close) { event.preventDefault(); close.click(); return; }
        }
        if (currentTab !== 'browse') { event.preventDefault(); onSelectTab('browse'); }
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      const buttons = Array.from(document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, [tabindex]:not([tabindex="-1"])')).filter(node => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const dialog = document.querySelector('[role="dialog"]');
        return (!dialog || dialog.contains(node)) && rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight && style.visibility !== 'hidden' && style.display !== 'none';
      });
      const active = document.activeElement as HTMLElement;
      if (!buttons.includes(active)) { event.preventDefault(); buttons[0]?.focus(); return; }
      const from = active.getBoundingClientRect();
      const fx = from.left + from.width / 2; const fy = from.top + from.height / 2;
      const match = buttons.map(node => {
        const r = node.getBoundingClientRect(); const dx = r.left + r.width / 2 - fx; const dy = r.top + r.height / 2 - fy;
        if (event.key === 'ArrowRight' && dx <= 2 || event.key === 'ArrowLeft' && dx >= -2 || event.key === 'ArrowDown' && dy <= 2 || event.key === 'ArrowUp' && dy >= -2) return null;
        const along = event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? Math.abs(dx) : Math.abs(dy);
        const across = event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
        return { node, score: along + across * 2.5 };
      }).filter((v): v is { node: HTMLElement; score: number } => Boolean(v)).sort((a,b) => a.score-b.score)[0];
      if (match) { event.preventDefault(); match.node.focus(); match.node.scrollIntoView({block: 'nearest', inline: 'nearest', behavior: 'smooth'}); }
    };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey); };
  }, [currentTab, onSelectTab]);
  return <header className="flixleo-tv-nav" aria-label="FlixLeo television navigation">
    <button type="button" className="flixleo-tv-brand" onClick={() => onSelectTab('browse')}>
      <img src="/flixleo-logo.svg" alt="" /> FlixLeo
    </button>
    <nav aria-label="TV navigation">
      {items.map(({ id, label, Icon }) => <button key={id} type="button" aria-current={currentTab === id ? 'page' : undefined} onClick={() => onSelectTab(id)}>
        <Icon size={23} />{label}
      </button>)}
      <button type="button" onClick={onOpenProfile}><UserRound size={23} /> Profile</button>
    </nav>
  </header>;
}
