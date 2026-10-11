import React from 'react';
import { TmdbArtwork } from './Catalog/TmdbArtwork';
import type { MediaItem } from '../types/stream';

function tvArtwork(url: string): string {
  const match = url?.match(/^https:\/\/image\.tmdb\.org\/t\/p\/(w185|w342|w500|w780|original)\/([a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp))$/i);
  return match ? '/api/tv/artwork/' + match[1] + '/' + match[2] : url;
}
export function TvTitleCard({ media, onOpen }: { media: MediaItem; onOpen: (m: MediaItem) => void }) {
  return <button type="button" className="tv6-title" aria-label={'View ' + media.title} onClick={() => onOpen(media)}>
    <div className="tv6-title-art"><TmdbArtwork media={{ ...media, posterUrl: tvArtwork(media.posterUrl) }} kind="poster" alt={media.title} loading="eager" /></div>
    <div className="tv6-title-info">
      <strong>{media.title}</strong>
      <span>{media.year}{media.rating ? ' · ★ ' + media.rating : ''}</span>
    </div>
  </button>;
}
