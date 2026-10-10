import React from 'react';
import type { MediaItem } from '../../types/stream';

type Kind = 'poster' | 'backdrop';
type Props = React.ImgHTMLAttributes<HTMLImageElement> & { media: MediaItem; kind: Kind };

/** Prefer catalogue artwork; if it fails, retry the same title's TMDB detail metadata. */
export function TmdbArtwork({ media, kind, onError, ...props }: Props) {
  const original = kind === 'poster' ? media.posterUrl : media.backdropUrl;
  const [url, setUrl] = React.useState(original || '');
  const [failed, setFailed] = React.useState(false);
  const tried = React.useRef(false);

  React.useEffect(() => {
    setUrl(original || '');
    setFailed(false);
    tried.current = false;
  }, [media.id, media.type, original, kind]);

  const resolveFromTmdb = async () => {
    if (tried.current) { setFailed(true); return; }
    tried.current = true;
    const id = String(media.id).replace(/^(tmdb-|tv-)/, '');
    if (!/^\d+$/.test(id)) { setFailed(true); return; }
    try {
      const endpoint = media.type === 'tv' ? 'tv' : 'movie';
      const response = await fetch(`/api/tmdb/${endpoint}/${id}`);
      if (!response.ok) throw new Error('TMDB metadata unavailable');
      const data = await response.json();
      const replacement = kind === 'poster' ? data?.item?.posterUrl : data?.item?.backdropUrl;
      if (data?.success && typeof replacement === 'string' && replacement && replacement !== url) {
        setUrl(replacement);
        return;
      }
    } catch {
      // A broken/missing image is represented by a neutral placeholder, never unrelated artwork.
    }
    setFailed(true);
  };

  if (failed || !url) {
    return <div role="img" aria-label={`Artwork unavailable for ${media.title}`} className={`${props.className || ''} flex items-center justify-center bg-slate-900 text-slate-400 text-center p-3`}>
      <span className="text-sm font-semibold line-clamp-3">{media.title}</span>
    </div>;
  }
  return <img {...props} src={url} onError={e => { onError?.(e); void resolveFromTmdb(); }} />;
}
