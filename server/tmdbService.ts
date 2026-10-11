import { MediaItem, StreamMirror } from '../src/types/stream';

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Movie and episode playback sources must be title-specific. Never reuse demo videos as real movies.
\n// Genre ID to name lookup
export const TMDB_GENRES: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
};

// Language code to display name
export const TMDB_LANGUAGES: Record<string, string> = {
  en: 'English',
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  ml: 'Malayalam',
  kn: 'Kannada',
  ja: 'Japanese',
  ko: 'Korean',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  zh: 'Mandarin',
};

// In-memory cache for TMDB API calls (5 min TTL)
const cache = new Map<string, { data: any; expiry: number }>();

export function getCached(key: string) {
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiry) {
    return cached.data;
  }
  return null;
}

export function setCached(key: string, data: any, ttlMs = 300000) {
  cache.set(key, { data, expiry: Date.now() + ttlMs });
}

// Transform TMDB raw movie object into FlixLeo MediaItem
export function transformTmdbMovie(raw: any): MediaItem {
  const id = `tmdb-${raw.id}`;
  const title = raw.title || raw.name || 'Untitled Feature';
  const originalTitle = raw.original_title || raw.original_name || title;
  const releaseYear = raw.release_date
    ? new Date(raw.release_date).getFullYear()
    : raw.first_air_date
    ? new Date(raw.first_air_date).getFullYear()
    : 2024;

  const genres = raw.genres
    ? raw.genres.map((g: any) => g.name)
    : raw.genre_ids
    ? raw.genre_ids.map((gid: number) => TMDB_GENRES[gid]).filter(Boolean)
    : ['Cinema', 'Action'];

  const langCode = raw.original_language || 'en';
  const langDisplay = TMDB_LANGUAGES[langCode] || langCode.toUpperCase();
  const isSouthAsian = ['hi', 'ta', 'te', 'ml', 'kn', 'pa', 'bn'].includes(langCode);

  const backdropUrl = raw.backdrop_path
    ? `${TMDB_IMAGE_BASE}/w1280${raw.backdrop_path}`
    : '/src/assets/images/hero_cinema_stream_1791647936700.jpg';

  const posterUrl = raw.poster_path
    ? `${TMDB_IMAGE_BASE}/w500${raw.poster_path}`
    : '/src/assets/images/poster_action_blockbuster_1791647951763.jpg';

  const voteAvg = typeof raw.vote_average === 'number' ? raw.vote_average.toFixed(1) : '8.1';
  const primarySource = 'streamhub';

  // Generate multi-server full playback mirrors (Embed iframe servers with complete movie playback + direct feature streams)
  const tmdbId = raw.id;
  const mirrors: StreamMirror[] = [
    {
      id: `mir-${id}-embed1`,
      source: 'streamhub',
      label: `Full Feature Stream · Server 1 (AutoEmbed / VidLink) [4K UHD Full Movie]`,
      quality: '4K UHD',
      url: `https://vidlink.pro/movie/${tmdbId}`,
      streamType: 'embed-iframe',
      fileSize: 'Full Movie Stream',
      bitrate: '28 Mbps',
      serverNode: 'Ultra Cloud Fast NVMe',
      downloadUrl: `https://vidlink.pro/movie/${tmdbId}`,
      isDirect: false,
      audioTrack: 'Original + Multi-Audio'
    },
    {
      id: `mir-${id}-embed2`,
      source: 'fastedge',
      label: `Full Feature Stream · Server 2 (Embed.su HD) [1080p 60fps Full Movie]`,
      quality: '1080p',
      url: `https://embed.su/embed/movie/${tmdbId}`,
      streamType: 'embed-iframe',
      fileSize: 'Full Movie Stream',
      bitrate: '9.8 Mbps',
      serverNode: 'Global Fast Edge Node',
      isDirect: false,
      audioTrack: 'Original 5.1'
    },
    {
      id: `mir-${id}-embed3`,
      source: 'vault',
      label: `Full Feature Stream · Server 3 (VidSrc VIP) [Uncut Full Movie]`,
      quality: '1080p',
      url: `https://vidsrc.cc/v2/embed/movie/${tmdbId}`,
      streamType: 'embed-iframe',
      fileSize: 'Full Movie Stream',
      bitrate: '11.0 Mbps',
      serverNode: 'Cloud Tier-1 Frankfurt',
      isDirect: false,
      audioTrack: 'Dual Audio + Subtitles'
    },
    {
      id: `mir-${id}-embed4`,
      source: 'remux',
      label: `Full Feature Stream · Server 4 (Videasy Player) [Complete Playback]`,
      quality: '1080p',
      url: `https://player.videasy.net/movie/${tmdbId}`,
      streamType: 'embed-iframe',
      fileSize: 'Full Movie Stream',
      bitrate: '8.4 Mbps',
      serverNode: 'Regional Edge Cloud',
      isDirect: false,
      audioTrack: `${langDisplay} Master 5.1`
    },
    {
      id: `mir-${id}-embed5`,
      source: 'streamhub',
      label: `Full Feature Stream · Server 5 (SuperEmbed Multi) [Dual Audio]`,
      quality: '1080p',
      url: `https://multiembed.mov/?video_id=${tmdbId}&tmdb=1`,
      streamType: 'embed-iframe',
      fileSize: 'Full Movie Stream',
      bitrate: '6.2 Mbps',
      serverNode: 'Fast Cloud Mirror',
      isDirect: false,
      audioTrack: 'Dual Audio Hindi + Eng'
    }
  ];

  // Cast members if detailed info available
  let cast: string[] = [];
  let director: string = 'Cinema Director';
  if (raw.credits) {
    if (raw.credits.cast) {
      cast = raw.credits.cast.slice(0, 4).map((c: any) => c.name);
    }
    if (raw.credits.crew) {
      const dirObj = raw.credits.crew.find((c: any) => c.job === 'Director');
      if (dirObj) director = dirObj.name;
    }
  }

  return {
    id,
    title,
    originalTitle,
    year: releaseYear,
    duration: raw.runtime ? `${Math.floor(raw.runtime / 60)}h ${raw.runtime % 60}m` : '2h 15m',
    rating: raw.adult ? 'R' : 'PG-13',
    imdbRating: voteAvg,
    genres: genres.length > 0 ? genres : ['Action', 'Thriller'],
    language: `${langDisplay} · Dual Audio`,
    overview: raw.overview || 'Experience unified high-definition cinema streaming with multi-server failover and high-speed cloud mirrors.',
    backdropUrl,
    posterUrl,
    primarySource,
    availableSources: ['streamhub', 'remux', 'fastedge', 'vault'],
    resolutionBadge: '4K UHD HDR',
    trending: true,
    director,
    cast: cast.length > 0 ? cast : ['Lead Cast', 'Co-Star', 'Ensemble'],
    audioTracks: ['Dolby Atmos 7.1', `${langDisplay} Original`, 'Dual Audio Hindi + Eng'],
    subtitles: [
      { label: 'English (SDH)', language: 'en', isDefault: true },
      { label: 'Hindi', language: 'hi' }
    ],
    mirrors
  };
}

// Built-in curated TMDB catalog (Used as instant fallback or offline base)
export const CURATED_TMDB_MOVIES = [
  {
    id: 693134,
    title: 'Dune: Part Two',
    original_title: 'Dune: Part Two',
    release_date: '2024-03-01',
    vote_average: 8.5,
    genre_ids: [878, 12],
    original_language: 'en',
    overview: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',
    poster_path: '/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    backdrop_path: '/xOMo8BRK7PfcJv9JCnx7s520bEx.jpg'
  },
  {
    id: 801688,
    title: 'Kalki 2898 AD',
    original_title: 'కల్కి 2898 AD',
    release_date: '2024-06-27',
    vote_average: 8.2,
    genre_ids: [878, 28, 14],
    original_language: 'te',
    overview: 'A modern avatar of Vishnu, a Hindu god, is believed to have descended to the earth to protect the world from evil forces in a dystopian futuristic Kasi.',
    poster_path: '/3Yp2b39PzGzF8e7dI614W5mYV77.jpg',
    backdrop_path: '/yEQ4j2wzE6wWk8rL11yV9qM7r5p.jpg'
  },
  {
    id: 533535,
    title: 'Deadpool & Wolverine',
    original_title: 'Deadpool & Wolverine',
    release_date: '2024-07-26',
    vote_average: 8.0,
    genre_ids: [28, 35, 878],
    original_language: 'en',
    overview: 'A listless Wade Wilson toils away in civilian life with his days as the morally flexible mercenary, Deadpool, behind him. But when his homeworld faces an existential threat, Wade must reluctantly suit-up.',
    poster_path: '/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
    backdrop_path: '/9l1eZiJHmhr5jMvAG2GfRlu9Qz2.jpg'
  },
  {
    id: 872585,
    title: 'Oppenheimer',
    original_title: 'Oppenheimer',
    release_date: '2023-07-21',
    vote_average: 8.1,
    genre_ids: [18, 36],
    original_language: 'en',
    overview: 'The story of J. Robert Oppenheimer’s role in the development of the atomic bomb during World War II.',
    poster_path: '/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    backdrop_path: '/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg'
  },
  {
    id: 786892,
    title: 'Salaar: Part 1 - Ceasefire',
    original_title: 'సలార్: పార్ట్ 1 - సీజ్ ఫైర్',
    release_date: '2023-12-22',
    vote_average: 7.9,
    genre_ids: [28, 80, 53],
    original_language: 'te',
    overview: 'In the lawless walled city of Khansaar, a hardened exile returns to protect his childhood companion and rightful prince against rival tribal syndicates.',
    poster_path: '/mKGlw6mJ8rQv5vV7rG0v6Hq7kKz.jpg',
    backdrop_path: '/bV3bWJ7fW6jE9X7X8V7X6M5M2m1.jpg'
  },
  {
    id: 157336,
    title: 'Interstellar',
    original_title: 'Interstellar',
    release_date: '2014-11-05',
    vote_average: 8.4,
    genre_ids: [12, 18, 878],
    original_language: 'en',
    overview: 'The adventures of a group of explorers who make use of a newly discovered wormhole to surpass the limitations on human space travel.',
    poster_path: '/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    backdrop_path: '/xJHokMbljvjADYdit5fK5VQsXEG.jpg'
  },
  {
    id: 579974,
    title: 'RRR (Rise Roar Revolt)',
    original_title: 'RRR',
    release_date: '2022-03-24',
    vote_average: 8.0,
    genre_ids: [28, 18],
    original_language: 'te',
    overview: 'A fictional history of two legendary revolutionaries and their journey away from home before they began fighting for their country in the 1920s.',
    poster_path: '/wE0noMt24B9xr9TeMhn0vsb9Ah8.jpg',
    backdrop_path: '/707thQ4684p6B1b6W3p9V7r6W9x.jpg'
  },
  {
    id: 823464,
    title: 'Godzilla x Kong: The New Empire',
    original_title: 'Godzilla x Kong: The New Empire',
    release_date: '2024-03-29',
    vote_average: 7.2,
    genre_ids: [28, 878, 12],
    original_language: 'en',
    overview: 'Following their explosive showdown, Godzilla and Kong must reunite against a colossal undiscovered threat hidden within our world.',
    poster_path: '/bQ2ywkch09pq9G6vJq6QyN3M7n7.jpg',
    backdrop_path: '/qrGtVFxaD8c7et0j3hxY1aJ5N.jpg'
  }
];

export const CURATED_TMDB_SERIES = [
  {
    id: 1396,
    title: 'Breaking Bad',
    original_title: 'Breaking Bad',
    first_air_date: '2008-01-20',
    vote_average: 8.9,
    genre_ids: [18, 80],
    original_language: 'en',
    overview: 'A chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing and selling methamphetamine with a former student in order to secure his family\'s financial future.',
    poster_path: '/ztkUQFLlC19CCMYHW4oN9cI1nZu.jpg',
    backdrop_path: '/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg'
  },
  {
    id: 66732,
    title: 'Stranger Things',
    original_title: 'Stranger Things',
    first_air_date: '2016-07-15',
    vote_average: 8.6,
    genre_ids: [18, 10765, 9648],
    original_language: 'en',
    overview: 'When a young boy vanishes, a small town uncovers a mystery involving secret experiments, terrifying supernatural forces and one strange little girl.',
    poster_path: '/49WJfeN0moxb9IPfGn8AIqMGskD.jpg',
    backdrop_path: '/56v2KjBlU4XaOv9rVYEQypROD7P.jpg'
  },
  {
    id: 1399,
    title: 'Game of Thrones',
    original_title: 'Game of Thrones',
    first_air_date: '2011-04-17',
    vote_average: 8.5,
    genre_ids: [10765, 18, 10759],
    original_language: 'en',
    overview: 'Seven noble families fight for control of the mythical lands of Westeros, while an ancient enemy returns after being dormant for thousands of years.',
    poster_path: '/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg',
    backdrop_path: '/suopoADq0k8YZr4dQXcU6pToj6s.jpg'
  },
  {
    id: 100088,
    title: 'The Last of Us',
    original_title: 'The Last of Us',
    first_air_date: '2023-01-15',
    vote_average: 8.6,
    genre_ids: [18, 10765, 10759],
    original_language: 'en',
    overview: 'After a global pandemic destroys civilization, a hardened survivor takes charge of a 14-year-old girl who may be humanity\'s last hope.',
    poster_path: '/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg',
    backdrop_path: '/q2dyeHxZc69x8b40lD2f7lqF7N3.jpg'
  },
  {
    id: 87108,
    title: 'Chernobyl',
    original_title: 'Chernobyl',
    first_air_date: '2019-05-06',
    vote_average: 8.7,
    genre_ids: [18, 36],
    original_language: 'en',
    overview: 'In April 1986, an explosion at the Chernobyl nuclear power plant in the Ukrainian Soviet Socialist Republic, one of the worst man-made catastrophes in history.',
    poster_path: '/hlLXt2StEbGGRiLDOT5GQg1rBhu.jpg',
    backdrop_path: '/9xfEDAcXjoNqYQk330rF4E07E8F.jpg'
  },
  {
    id: 94605,
    title: 'Arcane',
    original_title: 'Arcane',
    first_air_date: '2021-11-06',
    vote_average: 8.7,
    genre_ids: [16, 10765, 10759, 18],
    original_language: 'en',
    overview: 'Set in the utopian region of Piltover and the oppressed underground of Zaun, the story follows the origins of two iconic League champions-and the power that will tear them apart.',
    poster_path: '/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg',
    backdrop_path: '/cDJu1gX7q4qO520wK75aVj78lYm.jpg'
  },
  {
    id: 110492,
    title: 'Panchayat',
    original_title: 'Panchayat',
    first_air_date: '2020-04-03',
    vote_average: 8.4,
    genre_ids: [35, 18],
    original_language: 'hi',
    overview: 'A comedy-drama that follows the life of an engineering graduate who joins as a secretary of a Panchayat office in a remote rural village of Uttar Pradesh.',
    poster_path: '/vX3Zg82o7G4uL34s8R1r3Y3n0M2.jpg',
    backdrop_path: '/mKGlw6mJ8rQv5vV7rG0v6Hq7kKz.jpg'
  }
];

export function transformTmdbTvShow(raw: any): MediaItem {
  const id = `tv-${raw.id}`;
  const title = raw.name || raw.title || 'Untitled Series';
  const originalTitle = raw.original_name || raw.original_title || title;
  const releaseYear = raw.first_air_date
    ? new Date(raw.first_air_date).getFullYear()
    : 2024;

  const genres = raw.genres
    ? raw.genres.map((g: any) => g.name)
    : raw.genre_ids
    ? raw.genre_ids.map((gid: number) => TMDB_GENRES[gid]).filter(Boolean)
    : ['TV Series', 'Drama'];

  const langCode = raw.original_language || 'en';
  const langDisplay = TMDB_LANGUAGES[langCode] || langCode.toUpperCase();

  const backdropUrl = raw.backdrop_path
    ? `${TMDB_IMAGE_BASE}/w1280${raw.backdrop_path}`
    : '/src/assets/images/hero_cinema_stream_1791647936700.jpg';

  const posterUrl = raw.poster_path
    ? `${TMDB_IMAGE_BASE}/w500${raw.poster_path}`
    : '/src/assets/images/poster_action_blockbuster_1791647951763.jpg';

  const voteAvg = typeof raw.vote_average === 'number' ? raw.vote_average.toFixed(1) : '8.5';
  const tmdbId = raw.id;

  const mirrors: StreamMirror[] = [
    {
      id: `mir-${id}-embed1`,
      source: 'streamhub',
      label: `TV Series Stream · S01E01 (VidLink HD) [4K Series Stream]`,
      quality: '4K UHD',
      url: `https://vidlink.pro/tv/${tmdbId}/1/1`,
      streamType: 'embed-iframe',
      fileSize: 'Full Season HD',
      bitrate: '15 Mbps',
      serverNode: 'Ultra Cloud Fast NVMe',
      isDirect: false,
      audioTrack: 'Original + Subtitles'
    },
    {
      id: `mir-${id}-embed2`,
      source: 'fastedge',
      label: `TV Series Stream · S01E01 (Embed.su HD) [1080p Series]`,
      quality: '1080p',
      url: `https://embed.su/embed/tv/${tmdbId}/1/1`,
      streamType: 'embed-iframe',
      fileSize: 'Full Season HD',
      bitrate: '9.2 Mbps',
      serverNode: 'Global Fast Edge Node',
      isDirect: false,
      audioTrack: 'Original 5.1'
    },
    {
      id: `mir-${id}-embed3`,
      source: 'vault',
      label: `TV Series Stream · S01E01 (VidSrc VIP) [Uncut Series]`,
      quality: '1080p',
      url: `https://vidsrc.cc/v2/embed/tv/${tmdbId}/1/1`,
      streamType: 'embed-iframe',
      fileSize: 'Full Season HD',
      bitrate: '10.5 Mbps',
      serverNode: 'Cloud Tier-1 Frankfurt',
      isDirect: false,
      audioTrack: 'Multi-Audio'
    }
  ];

  return {
    id,
    title,
    originalTitle,
    year: releaseYear,
    duration: '45m / Ep',
    rating: 'TV-MA',
    imdbRating: voteAvg,
    genres: genres.length > 0 ? genres : ['Drama', 'Series'],
    language: `${langDisplay} · Series`,
    overview: raw.overview || 'Binge-watch hit television series, seasons, and episodes with high-speed multi-server embeds and zero buffering.',
    backdropUrl,
    posterUrl,
    primarySource: 'streamhub',
    availableSources: ['streamhub', 'remux', 'fastedge', 'vault'],
    resolutionBadge: 'TV Series HD',
    trending: true,
    audioTracks: [`${langDisplay} Master`, 'Dolby 5.1'],
    subtitles: [
      { label: 'English (SDH)', language: 'en', isDefault: true },
      { label: 'Spanish', language: 'es' }
    ],
    mirrors
  };
}

// TMDB Fetch helper with auto fallback
export async function fetchFromTmdb(endpoint: string, params: Record<string, string> = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  const cacheKey = `${endpoint}?${new URLSearchParams(params).toString()}`;
  
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (!apiKey || apiKey === 'MY_TMDB_API_KEY') {
    return null;
  }

  const searchParams = new URLSearchParams({
    api_key: apiKey,
    ...params
  });

  const url = `${TMDB_BASE_URL}${endpoint}?${searchParams.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`TMDB responded with status ${res.status}`);
  }

  const json = await res.json();
  setCached(cacheKey, json);
  return json;
}