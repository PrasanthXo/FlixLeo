export type SourceType = 'streamhub' | 'remux' | 'fastedge' | 'vault' | 'custom';

export type QualityOption = '4K UHD' | '1080p' | '720p' | '480p' | '360p' | 'Auto';

export interface StreamMirror {
  id: string;
  source: SourceType;
  label: string;
  quality: QualityOption;
  url: string;
  streamType: 'direct-video' | 'hls' | 'embed-iframe' | 'pixeldrain';
  fileSize?: string;
  bitrate?: string;
  serverNode?: string;
  downloadUrl?: string;
  isDirect: boolean;
  audioTrack?: string;
  audioFixUrl?: string;
}

export interface SubtitleTrack {
  label: string;
  language: string;
  src?: string;
  isDefault?: boolean;
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  duration: string;
  airDate?: string | null;
  mirrors: StreamMirror[];
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export interface MediaItem {
  id: string;
  title: string;
  originalTitle?: string;
  year: number;
  duration: string;
  rating: string;
  imdbRating: string;
  genres: string[];
  language: string;
  overview: string;
  backdropUrl: string;
  posterUrl: string;
  primarySource: SourceType;
  availableSources: SourceType[];
  mirrors: StreamMirror[];
  subtitles?: SubtitleTrack[];
  audioTracks?: string[];
  director?: string;
  cast?: string[];
  featured?: boolean;
  trending?: boolean;
  resolutionBadge?: string;
  type?: 'movie' | 'tv';
  seasons?: Season[];
}

export interface PlaybackProgress {
  mediaId: string;
  mirrorId: string;
  currentTime: number;
  duration: number;
  lastWatched: number;
}

/**
 * Clean user-facing display names for sources
 * Strictly prevents leaking internal network source names
 */
export function getSourceDisplayName(source: SourceType | string): string {
  switch (source) {
    case 'streamhub':
      return 'Ultra 4K UHD';
    case 'remux':
      return 'Cinema Remux';
    case 'fastedge':
      return 'FastStream Edge';
    case 'vault':
      return 'Cloud Vault';
    case 'custom':
      return 'Custom Stream';
    default:
      return 'Cinema Stream';
  }
}

/**
 * Clean user-facing badge labels for sources
 */
export function getSourceDisplayBadge(source: SourceType | string): string {
  switch (source) {
    case 'streamhub':
      return '4K UHD';
    case 'remux':
      return 'REMUX';
    case 'fastedge':
      return 'FAST CDN';
    case 'vault':
      return 'CLOUD';
    case 'custom':
      return 'STREAM';
    default:
      return 'HD';
  }
}
