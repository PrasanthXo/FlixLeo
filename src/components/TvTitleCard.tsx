import React from 'react';
import { TmdbArtwork } from './Catalog/TmdbArtwork';
import type { MediaItem } from '../types/stream';

export function TvTitleCard({ media, onOpen }: { media: MediaItem; onOpen: (m: MediaItem) => void }) {
  return <button type="button" className="tv6-title" aria-label={'View ' + media.title} onClick={() => onOpen(media)}>
    <div className="tv6-title-art"><TmdbArtwork media={media} kind="poster" alt={media.title} loading="eager" /></div>
    <div className="tv6-title-info">
      <strong>{media.title}</strong>
      <span>{media.year}{media.rating ? ' · ★ ' + media.rating : ''}</span>
    </div>
  </button>;
}
