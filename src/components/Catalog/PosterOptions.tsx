import React, { useState } from 'react';
import { Bookmark, BookmarkCheck, Info, MoreVertical, Share2 } from 'lucide-react';
import type { MediaItem } from '../../types/stream';

type Props = {
  media: MediaItem;
  onOpen: (media: MediaItem) => void;
  isBookmarked?: boolean;
  onToggleBookmark?: (media: MediaItem) => void;
  className?: string;
};

export function PosterOptions({ media, onOpen, isBookmarked = false, onToggleBookmark, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const share = async () => {
    setOpen(false);
    const url = new URL(window.location.origin);
    url.searchParams.set('media', media.id);
    try {
      if (navigator.share) await navigator.share({ title: media.title + ' · FlixLeo', url: url.toString() });
      else {
        await navigator.clipboard.writeText(url.toString());
        window.alert('Link copied');
      }
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') window.alert('Unable to share link');
    }
  };
  return <div className={'absolute top-2 right-2 z-40 ' + className} onClick={e => e.stopPropagation()}
    onKeyDown={e => e.stopPropagation()}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}>
    <button type="button" aria-label={'More options for ' + media.title} aria-expanded={open}
      onClick={() => setOpen(value => !value)}
      className="w-8 h-8 flex items-center justify-center rounded-full border border-white/30 bg-black/85 text-white shadow-lg backdrop-blur-md">
      <MoreVertical size={18} />
    </button>
    {open && <div className="absolute top-9 right-0 min-w-[158px] rounded-xl bg-[#141923] border border-slate-600 shadow-2xl p-1 text-white">
      {onToggleBookmark && <button type="button" onClick={() => { onToggleBookmark(media); setOpen(false); }}
        className="flex w-full items-center gap-2 px-2 py-2 rounded-lg text-xs text-left hover:bg-slate-700">
        {isBookmarked ? <BookmarkCheck size={15}/> : <Bookmark size={15}/>}
        {isBookmarked ? 'Remove from Watchlist' : 'Add to Watchlist'}
      </button>}
      <button type="button" onClick={() => { setOpen(false); onOpen(media); }}
        className="flex w-full items-center gap-2 px-2 py-2 rounded-lg text-xs text-left hover:bg-slate-700">
        <Info size={15}/> View details
      </button>
      <button type="button" onClick={() => void share()}
        className="flex w-full items-center gap-2 px-2 py-2 rounded-lg text-xs text-left hover:bg-slate-700">
        <Share2 size={15}/> Share
      </button>
    </div>}
  </div>;
}
