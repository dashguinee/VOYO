/**
 * EXAMPLE: How to add Album Shelves to HomeFeed
 *
 * This shows how to integrate the Piped Albums system into HomeFeed.tsx
 * Copy-paste the sections you need into your actual HomeFeed component.
 */

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { searchArtistAlbums, searchAlbums } from '../services/piped';
import { AlbumCard } from '../components/classic/AlbumCard';
import { usePlayerStore } from '../store/playerStore';
import { Album } from '../types';

// ============================================
// EXAMPLE 1: Featured Artist Albums Shelf
// ============================================

export const FeaturedArtistAlbums = () => {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const { playAlbum } = usePlayerStore();

  useEffect(() => {
    // Load albums for a featured artist
    searchArtistAlbums('Burna Boy', 5)
      .then(results => {
        setAlbums(results);
        setLoading(false);
      })
      .catch(err => {
        console.error('Failed to load albums:', err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="px-4 py-6">
        <div className="text-white/50">Loading albums...</div>
      </div>
    );
  }

  if (albums.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex justify-between items-center px-4 mb-3">
        <h2 className="text-white font-bold text-lg">Burna Boy Albums</h2>
      </div>
      <div className="flex gap-3 px-4 overflow-x-auto scrollbar-hide">
        {albums.map(album => (
          <AlbumCard
            key={album.id}
            album={album}
            onPlay={() => playAlbum(album.id, album.name)}
          />
        ))}
      </div>
    </div>
  );
};

// ============================================
// EXAMPLE 2: New African Albums Shelf
// ============================================

export const NewAfricanAlbums = () => {
  const [albums, setAlbums] = useState<Album[]>([]);
  const { playAlbum } = usePlayerStore();

  useEffect(() => {
    // Search for new African albums
    searchAlbums('new african album 2025', 10)
      .then(setAlbums)
      .catch(err => console.error('Failed to load albums:', err));
  }, []);

  if (albums.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex justify-between items-center px-4 mb-3">
        <h2 className="text-white font-bold text-lg">New African Albums</h2>
        <motion.button
          className="text-purple-400 text-sm font-medium"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          See all
        </motion.button>
      </div>
      <div className="flex gap-3 px-4 overflow-x-auto scrollbar-hide">
        {albums.map(album => (
          <AlbumCard
            key={album.id}
            album={album}
            onPlay={() => playAlbum(album.id, album.name)}
          />
        ))}
      </div>
    </div>
  );
};

// ============================================
// EXAMPLE 3: Multiple Artists Albums (Rotating)
// ============================================

export const AfricanArtistsAlbums = () => {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [currentArtist, setCurrentArtist] = useState('Burna Boy');
  const { playAlbum } = usePlayerStore();

  const artists = ['Burna Boy', 'Wizkid', 'Davido', 'Rema', 'Tems', 'Asake'];

  useEffect(() => {
    // Load albums for current artist
    searchArtistAlbums(currentArtist, 5)
      .then(setAlbums)
      .catch(err => console.error('Failed to load albums:', err));
  }, [currentArtist]);

  const rotateArtist = () => {
    const currentIndex = artists.indexOf(currentArtist);
    const nextIndex = (currentIndex + 1) % artists.length;
    setCurrentArtist(artists[nextIndex]);
  };

  return (
    <div className="mb-6">
      <div className="flex justify-between items-center px-4 mb-3">
        <h2 className="text-white font-bold text-lg">{currentArtist} Albums</h2>
        <motion.button
          className="text-purple-400 text-sm font-medium"
          onClick={rotateArtist}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          Next Artist
        </motion.button>
      </div>
      <div className="flex gap-3 px-4 overflow-x-auto scrollbar-hide">
        {albums.map(album => (
          <AlbumCard
            key={album.id}
            album={album}
            onPlay={() => playAlbum(album.id, album.name)}
          />
        ))}
      </div>
    </div>
  );
};

// ============================================
// EXAMPLE 4: Smart Album Recommendations
// ============================================

export const RecommendedAlbums = () => {
  const [albums, setAlbums] = useState<Album[]>([]);
  const { currentTrack, playAlbum } = usePlayerStore();

  useEffect(() => {
    if (!currentTrack) return;

    // Search for albums by current track's artist
    searchArtistAlbums(currentTrack.artist, 5)
      .then(results => {
        // Filter out the current album if it's in the list
        const filtered = results.filter(a => a.name !== currentTrack.album);
        setAlbums(filtered);
      })
      .catch(err => console.error('Failed to load albums:', err));
  }, [currentTrack?.artist]);

  if (albums.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex justify-between items-center px-4 mb-3">
        <h2 className="text-white font-bold text-lg">
          More from {currentTrack?.artist}
        </h2>
      </div>
      <div className="flex gap-3 px-4 overflow-x-auto scrollbar-hide">
        {albums.map(album => (
          <AlbumCard
            key={album.id}
            album={album}
            onPlay={() => playAlbum(album.id, album.name)}
          />
        ))}
      </div>
    </div>
  );
};

// ============================================
// EXAMPLE 5: Complete HomeFeed with Albums
// ============================================

export const HomeFeedWithAlbums = () => {
  return (
    <div className="h-full overflow-y-auto scrollbar-hide">
      {/* Greeting */}
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-white text-3xl font-bold">Good evening</h1>
      </div>

      {/* Featured Artist Albums */}
      <FeaturedArtistAlbums />

      {/* Continue Listening (existing shelf) */}
      {/* <ContinueListening /> */}

      {/* New African Albums */}
      <NewAfricanAlbums />

      {/* Heavy Rotation (existing shelf) */}
      {/* <HeavyRotation /> */}

      {/* Recommended Albums (based on current track) */}
      <RecommendedAlbums />

      {/* Made For You (existing shelf) */}
      {/* <MadeForYou /> */}

      {/* African Artists Albums (rotating) */}
      <AfricanArtistsAlbums />
    </div>
  );
};

// ============================================
// USAGE IN YOUR HOMEFEED.TSX
// ============================================

/*

STEP 1: Import at the top of HomeFeed.tsx:

import { searchArtistAlbums } from '../../services/piped';
import { AlbumCard } from './AlbumCard';
import { Album } from '../../types';


STEP 2: Add state for albums:

const [featuredAlbums, setFeaturedAlbums] = useState<Album[]>([]);


STEP 3: Load albums in useEffect:

useEffect(() => {
  searchArtistAlbums('Burna Boy', 5).then(setFeaturedAlbums);
}, []);


STEP 4: Add album shelf between existing shelves:

<Shelf title="Burna Boy Albums">
  {featuredAlbums.map(album => (
    <AlbumCard
      key={album.id}
      album={album}
      onPlay={() => playAlbum(album.id, album.name)}
    />
  ))}
</Shelf>


STEP 5: Get playAlbum from playerStore:

const { playAlbum } = usePlayerStore();


That's it! Your HomeFeed now has albums.

*/
