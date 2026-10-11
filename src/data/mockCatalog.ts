import { MediaItem } from '../types/stream';

const STREAM_FEATURE_DIRECT_1 = 'https://archive.org/download/Charade_1963/Charade.mp4';
const STREAM_FEATURE_DIRECT_2 = 'https://archive.org/download/night_of_the_living_dead/night_of_the_living_dead_512kb.mp4';
const STREAM_FEATURE_DIRECT_3 = 'https://archive.org/download/Sita_Sings_the_Blues_1080p/Sita_Sings_the_Blues_1080p.mp4';
const STREAM_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const STREAM_FEATURE_DIRECT_4 = 'https://archive.org/download/CarnivalOfSouls/Carnival_Of_Souls_512kb.mp4';

// Real Blockbuster Catalog powered by TMDB IDs & Real Embed/Direct Streams
const RAW_MEDIA_CATALOG: MediaItem[] = [
  {
    id: 'tmdb-693134',
    title: 'Dune: Part Two',
    originalTitle: 'Dune: Part Two',
    year: 2024,
    duration: '2h 46m',
    rating: 'PG-13',
    imdbRating: '8.5',
    genres: ['Sci-Fi', 'Adventure'],
    language: 'English · Dual Audio',
    overview: 'Paul Atreides unites with Chani and the Fremen while seeking revenge against the conspirators who destroyed his family.',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/xOMo8BRK7PfcJv9JCnx7s520bEx.jpg',
    posterUrl: 'https://image.tmdb.org/t/p/w500/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg',
    primarySource: 'streamhub',
    availableSources: ['streamhub', 'remux', 'fastedge', 'vault'],
    resolutionBadge: '4K UHD HDR',
    featured: true,
    trending: true,
    director: 'Denis Villeneuve',
    cast: ['Timothée Chalamet', 'Zendaya', 'Rebecca Ferguson', 'Javier Bardem'],
    audioTracks: ['English Dolby Atmos 7.1', 'Hindi Clean Dub 5.1'],
    subtitles: [{ label: 'English', language: 'en', isDefault: true }, { label: 'Hindi', language: 'hi' }],
    mirrors: [
      {
        id: 'mir-693134-embed1',
        source: 'streamhub',
        label: 'Full Feature Stream · Server 1 (AutoEmbed / VidLink) [4K UHD Full Movie]',
        quality: '4K UHD',
        url: 'https://vidlink.pro/movie/693134',
        streamType: 'embed-iframe',
        fileSize: 'Full Movie Stream',
        bitrate: '28 Mbps',
        serverNode: 'Ultra Cloud Fast NVMe',
        downloadUrl: 'https://vidlink.pro/movie/693134',
        isDirect: false,
        audioTrack: 'Original + Multi-Audio'
      },
      {
        id: 'mir-693134-embed2',
        source: 'fastedge',
        label: 'Full Feature Stream · Server 2 (Embed.su HD) [1080p 60fps Full Movie]',
        quality: '1080p',
        url: 'https://embed.su/embed/movie/693134',
        streamType: 'embed-iframe',
        fileSize: 'Full Movie Stream',
        bitrate: '9.8 Mbps',
        serverNode: 'Global Fast Edge Node',
        isDirect: false,
        audioTrack: 'Original 5.1'
      },
      {
        id: 'mir-693134-embed3',
        source: 'vault',
        label: 'Full Feature Stream · Server 3 (VidSrc VIP) [Uncut Full Movie]',
        quality: '1080p',
        url: 'https://vidsrc.cc/v2/embed/movie/693134',
        streamType: 'embed-iframe',
        fileSize: 'Full Movie Stream',
        bitrate: '11.0 Mbps',
        serverNode: 'Cloud Tier-1 Frankfurt',
        isDirect: false,
        audioTrack: 'Dual Audio + Subtitles'
      },
      {
        id: 'mir-693134-direct',
        source: 'streamhub',
        label: 'Direct HTML5 Player · 1080p Full Length Feature Film [MP4 Direct]',
        quality: '1080p',
        url: STREAM_FEATURE_DIRECT_1,
        streamType: 'direct-video',
        fileSize: '1.8 GB',
        bitrate: '8.5 Mbps',
        serverNode: 'High-Availability Video Node',
        downloadUrl: STREAM_FEATURE_DIRECT_1,
        isDirect: true,
        audioTrack: 'Original Cinema Master'
      }
    ]
  },
  {
    id: 'tmdb-801688',
    title: 'Kalki 2898 AD',
    originalTitle: 'కల్కి 2898 AD',
    year: 2024,
    duration: '3h 01m',
    rating: 'UA',
    imdbRating: '8.2',
    genres: ['Sci-Fi', 'Action', 'Fantasy'],
    language: 'Telugu · Hindi · Tamil',
    overview: 'A modern avatar of Vishnu, a Hindu god, descends to the earth to protect the world from evil forces in a dystopian futuristic Kasi.',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/yEQ4j2wzE6wWk8rL11yV9qM7r5p.jpg',
    posterUrl: 'https://image.tmdb.org/t/p/w500/3Yp2b39PzGzF8e7dI614W5mYV77.jpg',
    primarySource: 'streamhub',
    availableSources: ['streamhub', 'remux', 'fastedge', 'vault'],
    resolutionBadge: '4K UHD HDR',
    featured: true,
    trending: true,
    director: 'Nag Ashwin',
    cast: ['Prabhas', 'Deepika Padukone', 'Amitabh Bachchan', 'Kamal Haasan'],
    audioTracks: ['Telugu Original 5.1', 'Hindi Dub 5.1', 'Tamil Dub 5.1'],
    subtitles: [{ label: 'English', language: 'en', isDefault: true }, { label: 'Hindi', language: 'hi' }],
    mirrors: [
      {
        id: 'mir-801688-embed1',
        source: 'streamhub',
        label: 'Full Feature Stream · Server 1 (AutoEmbed / VidLink) [4K UHD Full Movie]',
        quality: '4K UHD',
        url: 'https://vidlink.pro/movie/801688',
        streamType: 'embed-iframe',
        fileSize: 'Full Movie Stream',
        bitrate: '28 Mbps',
        serverNode: 'Ultra Cloud Fast NVMe',
        downloadUrl: 'https://vidlink.pro/movie/801688',
        isDirect: false,
        audioTrack: 'Original + Multi-Audio'
      },
      {
        id: 'mir-801688-embed2',
        source: 'fastedge',
        label: 'Full Feature Stream · Server 2 (Embed.su HD) [1080p 60fps Full Movie]',
        quality: '1080p',
        url: 'https://embed.su/embed/movie/801688',
        streamType: 'embed-iframe',
        fileSize: 'Full Movie Stream',
        bitrate: '9.8 Mbps',
        serverNode: 'Global Fast Edge Node',
        isDirect: false,
        audioTrack: 'Original 5.1'
      },
      {
        id: 'mir-801688-direct',
        source: 'vault',
        label: 'Direct HTML5 Player · 1080p Full Length Feature Film [MP4 Direct]',
        quality: '1080p',
        url: STREAM_FEATURE_DIRECT_3,
        streamType: 'direct-video',
        fileSize: '1.5 GB',
        bitrate: '8.0 Mbps',
        serverNode: 'Regional Edge Server',
        downloadUrl: STREAM_FEATURE_DIRECT_3,
        isDirect: true,
        audioTrack: 'Regional Master'
      }
    ]
  },
  {
    id: 'tmdb-533535',
    title: 'Deadpool & Wolverine',
    originalTitle: 'Deadpool & Wolverine',
    year: 2024,
    duration: '2h 08m',
    rating: 'R',
    imdbRating: '8.0',
    genres: ['Action', 'Comedy', 'Sci-Fi'],
    language: 'English · Dual Audio',
    overview: 'A listless Wade Wilson toils away in civilian life with his days as the morally flexible mercenary behind him. When his homeworld faces an existential threat, Wade must reluctantly suit-up.',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/9l1eZiJHmhr5jMvAG2GfRlu9Qz2.jpg',
    posterUrl: 'https://image.tmdb.org/t/p/w500/8cdWjvZQUExUUTzyp4t6EDMubfO.jpg',
    primarySource: 'streamhub',
    availableSources: ['streamhub', 'remux', 'fastedge', 'vault'],
    resolutionBadge: '4K UHD HDR',
    featured: true,
    trending: true,
    director: 'Shawn Levy',
    cast: ['Ryan Reynolds', 'Hugh Jackman', 'Emma Corrin', 'Matthew Macfadyen'],
    audioTracks: ['English Dolby Atmos 7.1', 'Hindi Dub 5.1'],
    subtitles: [{ label: 'English', language: 'en', isDefault: true }],
    mirrors: [
      {
        id: 'mir-533535-embed1',
        source: 'streamhub',
        label: 'Full Feature Stream · Server 1 (AutoEmbed / VidLink) [4K UHD Full Movie]',
        quality: '4K UHD',
        url: 'https://vidlink.pro/movie/533535',
        streamType: 'embed-iframe',
        fileSize: 'Full Movie Stream',
        bitrate: '28 Mbps',
        serverNode: 'Ultra Cloud Fast NVMe',
        downloadUrl: 'https://vidlink.pro/movie/533535',
        isDirect: false,
        audioTrack: 'Original + Multi-Audio'
      },
      {
        id: 'mir-533535-embed2',
        source: 'vault',
        label: 'Full Feature Stream · Server 2 (VidSrc VIP) [Uncut Full Movie]',
        quality: '1080p',
        url: 'https://vidsrc.cc/v2/embed/movie/533535',
        streamType: 'embed-iframe',
        fileSize: 'Full Movie Stream',
        bitrate: '11.0 Mbps',
        serverNode: 'Cloud Tier-1 Frankfurt',
        isDirect: false,
        audioTrack: 'Dual Audio + Subtitles'
      },
      {
        id: 'mir-533535-direct',
        source: 'fastedge',
        label: 'Direct HTML5 Player · 1080p Full Length Feature [MP4 Direct]',
        quality: '1080p',
        url: STREAM_FEATURE_DIRECT_2,
        streamType: 'direct-video',
        fileSize: '1.4 GB',
        bitrate: '7.5 Mbps',
        serverNode: 'High-Availability Video Node',
        downloadUrl: STREAM_FEATURE_DIRECT_2,
        isDirect: true,
        audioTrack: 'Original'
      }
    ]
  },
  {
    id: 'tmdb-872585',
    title: 'Oppenheimer',
    originalTitle: 'Oppenheimer',
    year: 2023,
    duration: '3h 00m',
    rating: 'R',
    imdbRating: '8.1',
    genres: ['Drama', 'History'],
    language: 'English · Dual Audio',
    overview: 'The story of J. Robert Oppenheimer’s role in the development of the atomic bomb during World War II.',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg',
    posterUrl: 'https://image.tmdb.org/t/p/w500/8Gxv8gSFCU0XGDykEGv7zR1n2ua.jpg',
    primarySource: 'streamhub',
    availableSources: ['streamhub', 'remux', 'fastedge', 'vault'],
    resolutionBadge: '4K UHD IMAX',
    featured: false,
    trending: true,
    director: 'Christopher Nolan',
    cast: ['Cillian Murphy', 'Emily Blunt', 'Matt Damon', 'Robert Downey Jr.'],
    audioTracks: ['English IMAX 5.1', 'Hindi Dub 5.1'],
    subtitles: [{ label: 'English', language: 'en', isDefault: true }],
    mirrors: [
      {
        id: 'mir-872585-embed1',
        source: 'streamhub',
        label: 'Full Feature Stream · Server 1 (AutoEmbed / VidLink) [4K UHD Full Movie]',
        quality: '4K UHD',
        url: 'https://vidlink.pro/movie/872585',
        streamType: 'embed-iframe',
        fileSize: 'Full Movie Stream',
        bitrate: '28 Mbps',
        serverNode: 'Ultra Cloud Fast NVMe',
        downloadUrl: 'https://vidlink.pro/movie/872585',
        isDirect: false,
        audioTrack: 'Original + Multi-Audio'
      },
      {
        id: 'mir-872585-direct',
        source: 'remux',
        label: 'Direct HTML5 Player · 1080p Full Length Feature [MP4 Direct]',
        quality: '1080p',
        url: STREAM_FEATURE_DIRECT_1,
        streamType: 'direct-video',
        fileSize: '1.8 GB',
        bitrate: '8.5 Mbps',
        serverNode: 'Master Remux Node',
        downloadUrl: STREAM_FEATURE_DIRECT_1,
        isDirect: true,
        audioTrack: 'Cinema Master'
      }
    ]
  },
  {
    id: 'tmdb-786892',
    title: 'Salaar: Part 1 - Ceasefire',
    originalTitle: 'సలార్: పార్ట్ 1 - సీజ్ ఫైర్',
    year: 2023,
    duration: '2h 55m',
    rating: 'A',
    imdbRating: '7.9',
    genres: ['Action', 'Crime', 'Thriller'],
    language: 'Telugu · Hindi · Kannada',
    overview: 'In the lawless walled city of Khansaar, a hardened exile returns to protect his childhood companion and rightful prince against rival tribal syndicates.',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/bV3bWJ7fW6jE9X7X8V7X6M5M2m1.jpg',
    posterUrl: 'https://image.tmdb.org/t/p/w500/mKGlw6mJ8rQv5vV7rG0v6Hq7kKz.jpg',
    primarySource: 'streamhub',
    availableSources: ['streamhub', 'remux', 'fastedge', 'vault'],
    resolutionBadge: '4K UHD HDR',
    featured: false,
    trending: true,
    director: 'Prashanth Neel',
    cast: ['Prabhas', 'Prithviraj Sukumaran', 'Shruti Haasan', 'Jagapathi Babu'],
    audioTracks: ['Telugu Original 5.1', 'Hindi Dub 5.1', 'Kannada Dub 5.1'],
    subtitles: [{ label: 'English', language: 'en', isDefault: true }],
    mirrors: [
      {
        id: 'mir-786892-embed1',
        source: 'streamhub',
        label: 'Full Feature Stream · Server 1 (AutoEmbed / VidLink) [4K UHD Full Movie]',
        quality: '4K UHD',
        url: 'https://vidlink.pro/movie/786892',
        streamType: 'embed-iframe',
        fileSize: 'Full Movie Stream',
        bitrate: '28 Mbps',
        serverNode: 'Ultra Cloud Fast NVMe',
        downloadUrl: 'https://vidlink.pro/movie/786892',
        isDirect: false,
        audioTrack: 'Original + Multi-Audio'
      },
      {
        id: 'mir-786892-direct',
        source: 'vault',
        label: 'Direct HTML5 Player · 1080p Full Length Feature [MP4 Direct]',
        quality: '1080p',
        url: STREAM_FEATURE_DIRECT_3,
        streamType: 'direct-video',
        fileSize: '1.5 GB',
        bitrate: '8.0 Mbps',
        serverNode: 'Regional Server',
        downloadUrl: STREAM_FEATURE_DIRECT_3,
        isDirect: true,
        audioTrack: 'Regional Master'
      }
    ]
  },
  {
    id: 'tmdb-157336',
    title: 'Interstellar',
    originalTitle: 'Interstellar',
    year: 2014,
    duration: '2h 49m',
    rating: 'PG-13',
    imdbRating: '8.4',
    genres: ['Adventure', 'Drama', 'Sci-Fi'],
    language: 'English · Dual Audio',
    overview: 'The adventures of a group of explorers who make use of a newly discovered wormhole to surpass the limitations on human space travel and conquer vast interstellar distances.',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/xJHokMbljvjADYdit5fK5VQsXEG.jpg',
    posterUrl: 'https://image.tmdb.org/t/p/w500/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg',
    primarySource: 'streamhub',
    availableSources: ['streamhub', 'remux', 'fastedge', 'vault'],
    resolutionBadge: '4K UHD IMAX',
    featured: false,
    trending: true,
    director: 'Christopher Nolan',
    cast: ['Matthew McConaughey', 'Anne Hathaway', 'Jessica Chastain', 'Michael Caine'],
    audioTracks: ['English Dolby Atmos 7.1', 'Hindi Dub 5.1'],
    subtitles: [{ label: 'English', language: 'en', isDefault: true }],
    mirrors: [
      {
        id: 'mir-157336-embed1',
        source: 'streamhub',
        label: 'Full Feature Stream · Server 1 (AutoEmbed / VidLink) [4K UHD Full Movie]',
        quality: '4K UHD',
        url: 'https://vidlink.pro/movie/157336',
        streamType: 'embed-iframe',
        fileSize: 'Full Movie Stream',
        bitrate: '28 Mbps',
        serverNode: 'Ultra Cloud Fast NVMe',
        downloadUrl: 'https://vidlink.pro/movie/157336',
        isDirect: false,
        audioTrack: 'Original + Multi-Audio'
      },
      {
        id: 'mir-157336-direct',
        source: 'fastedge',
        label: 'Direct HTML5 Player · 1080p Full Length Feature [MP4 Direct]',
        quality: '1080p',
        url: STREAM_FEATURE_DIRECT_4,
        streamType: 'direct-video',
        fileSize: '1.3 GB',
        bitrate: '7.8 Mbps',
        serverNode: 'Fast CDN Edge',
        downloadUrl: STREAM_FEATURE_DIRECT_4,
        isDirect: true,
        audioTrack: 'Original'
      }
    ]
  },
  {
    id: 'tmdb-1396',
    title: 'Breaking Bad',
    originalTitle: 'Breaking Bad',
    year: 2008,
    duration: '45m',
    rating: 'TV-MA',
    imdbRating: '9.5',
    genres: ['Crime', 'Drama', 'Thriller'],
    language: 'English',
    overview: 'A high school chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing and selling methamphetamine in order to secure his family future.',
    backdropUrl: 'https://image.tmdb.org/t/p/w1280/tsRy63Mu5cu8etL1X7ZLyf7UP1M.jpg',
    posterUrl: 'https://image.tmdb.org/t/p/w500/ztkgnF0jMaqnLNM346v23XgQW5p.jpg',
    primarySource: 'streamhub',
    availableSources: ['streamhub'],
    featured: true,
    trending: true,
    type: 'tv',
    seasons: [
      {
        number: 1,
        episodes: [
          {
            id: 'bb-s1-e1',
            number: 1,
            title: 'Pilot',
            duration: '58m',
            mirrors: [
              {
                id: 'bb-s1-e1-m1',
                source: 'streamhub',
                label: 'Episode 1 Stream',
                quality: '1080p',
                url: 'https://vidsrc.cc/v2/embed/tv/1396/1/1',
                streamType: 'embed-iframe',
                isDirect: false
              }
            ]
          }
        ]
      }
    ],
    mirrors: []
  }
];

// Only title-specific sources belong in the playable catalogue.
// Shared public-domain demo MP4 files are not the listed commercial titles.
export const MEDIA_CATALOG: MediaItem[] = RAW_MEDIA_CATALOG.map(item => ({
  ...item,
  mirrors: item.mirrors.filter(m => !m.id.endsWith('-direct')),
}));

export const SOURCE_METADATA = {
  all: {
    name: 'All Streaming Servers',
    description: 'Unified search and streaming across all supported media networks.',
    accent: '#f59e0b',
  },
  streamhub: {
    name: 'Ultra 4K UHD',
    description: 'Ultra High Definition 2160p 4K Remux, HDR10, and Dolby Atmos multi-language master releases.',
    tagline: 'True 4K UHD & 10-Bit HEVC',
    accent: '#38bdf8',
    badge: '4K ULTRA'
  },
  remux: {
    name: 'Cinema Remux',
    description: 'Premier master cinema streaming catalog covering high definition and multi-audio features.',
    tagline: 'Master Cinema Remux',
    accent: '#ec4899',
    badge: 'REMUX'
  },
  fastedge: {
    name: 'FastStream Edge',
    description: 'Direct CDN infrastructure offering sub-second buffering and high bandwidth.',
    tagline: 'Zero-Latency Fast Servers',
    accent: '#10b981',
    badge: 'FASTSTREAM'
  },
  vault: {
    name: 'Cloud Vault',
    description: 'Direct cloud file storage integration with native direct video streaming, resume support and raw download pipelines.',
    tagline: 'Direct File & Cloud Stream',
    accent: '#8b5cf6',
    badge: 'CLOUD VAULT'
  },
  custom: {
    name: 'Custom Resolver',
    description: 'Paste any direct MP4, HLS (.m3u8), or cloud video stream URL to test and stream immediately.',
    tagline: 'Universal Stream Injector',
    accent: '#e2e8f0',
    badge: 'RESOLVER'
  }
};