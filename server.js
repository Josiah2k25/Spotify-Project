const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const { searchTracks, getRecommendations, getTrackFeatures, testSpotifyConnection } = require('./spotify');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;

// Enhanced mock data with variety
const mockRecommendations = [
  {
    id: '1',
    name: 'Bohemian Rhapsody',
    artists: [{ name: 'Queen' }],
    album: { name: 'A Night at the Opera', images: [{ url: 'https://via.placeholder.com/300x300/1DB954/ffffff?text=Queen' }] },
    preview_url: null
  },
  {
    id: '2', 
    name: 'Hotel California',
    artists: [{ name: 'Eagles' }],
    album: { name: 'Hotel California', images: [{ url: 'https://via.placeholder.com/300x300/1DB954/ffffff?text=Eagles' }] },
    preview_url: null
  },
  {
    id: '3',
    name: 'Stairway to Heaven',
    artists: [{ name: 'Led Zeppelin' }],
    album: { name: 'Led Zeppelin IV', images: [{ url: 'https://via.placeholder.com/300x300/1DB954/ffffff?text=Led+Zeppelin' }] },
    preview_url: null
  },
  {
    id: '4',
    name: 'Sweet Child O\' Mine',
    artists: [{ name: 'Guns N\' Roses' }],
    album: { name: 'Appetite for Destruction', images: [{ url: 'https://via.placeholder.com/300x300/1DB954/ffffff?text=GNR' }] },
    preview_url: null
  },
  {
    id: '5',
    name: 'Billie Jean',
    artists: [{ name: 'Michael Jackson' }],
    album: { name: 'Thriller', images: [{ url: 'https://via.placeholder.com/300x300/1DB954/ffffff?text=MJ' }] },
    preview_url: null
  },
  {
    id: '6',
    name: 'Shape of You',
    artists: [{ name: 'Ed Sheeran' }],
    album: { name: '÷ (Divide)', images: [{ url: 'https://via.placeholder.com/300x300/1DB954/ffffff?text=Ed+Sheeran' }] },
    preview_url: null
  },
  {
    id: '7',
    name: 'Blinding Lights',
    artists: [{ name: 'The Weeknd' }],
    album: { name: 'After Hours', images: [{ url: 'https://via.placeholder.com/300x300/1DB954/ffffff?text=Weeknd' }] },
    preview_url: null
  },
  {
    id: '8',
    name: 'Bad Guy',
    artists: [{ name: 'Billie Eilish' }],
    album: { name: 'When We All Fall Asleep, Where Do We Go?', images: [{ url: 'https://via.placeholder.com/300x300/1DB954/ffffff?text=Billie' }] },
    preview_url: null
  }
];

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files (your HTML)
app.use(express.static('.'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// API info route
app.get('/api', (req, res) => {
  res.json({ message: 'Music Discovery App API' });
});

// Test route for debugging
app.get('/api/test', async (req, res) => {
  const spotifyTest = await testSpotifyConnection();
  res.json({ 
    message: 'API is working', 
    spotifyCredentials: {
      clientId: process.env.SPOTIFY_CLIENT_ID ? 'Set' : 'Missing',
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET ? 'Set' : 'Missing'
    },
    spotifyConnection: spotifyTest,
    timestamp: new Date().toISOString()
  });
});

// Search for music
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    try {
      const tracks = await searchTracks(q);
      res.json({ tracks });
    } catch (spotifyError) {
      console.log('Spotify search failed, using mock data');
      // Filter mock data based on search query
      const query = q.toLowerCase();
      let filteredMockData = mockRecommendations;
      
      if (query.includes('queen')) {
        filteredMockData = mockRecommendations.filter(track => track.artists[0].name === 'Queen');
      } else if (query.includes('rock')) {
        filteredMockData = mockRecommendations.slice(0, 4); // Rock songs
      } else if (query.includes('pop')) {
        filteredMockData = mockRecommendations.slice(4); // Pop songs
      }
      
      res.json({ tracks: filteredMockData });
    }
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Failed to search tracks' });
  }
});

// Get personalized music recommendations
app.get('/api/recommendations', async (req, res) => {
  try {
    const { seed_genres, seed_artists, seed_tracks, user_id, mood, energy_level, dance_level } = req.query;
    
    const seeds = {};
    
    // Basic seeds
    if (seed_genres) seeds.seed_genres = seed_genres.split(',');
    if (seed_artists) seeds.seed_artists = seed_artists.split(',');
    if (seed_tracks) seeds.seed_tracks = seed_tracks.split(',');
    
    // User preferences from query params (quick mood selection)
    if (mood) {
      switch(mood) {
        case 'happy':
          seeds.target_valence = 0.8;
          seeds.target_energy = 0.7;
          break;
        case 'sad':
          seeds.target_valence = 0.2;
          seeds.target_energy = 0.3;
          break;
        case 'energetic':
          seeds.target_energy = 0.9;
          seeds.target_danceability = 0.8;
          break;
        case 'chill':
          seeds.target_energy = 0.3;
          seeds.target_valence = 0.5;
          break;
        case 'focus':
          seeds.target_energy = 0.4;
          seeds.target_valence = 0.6;
          seeds.min_instrumentalness = 0.3;
          break;
      }
    }
    
    // Manual preference overrides
    if (energy_level) seeds.target_energy = parseFloat(energy_level);
    if (dance_level) seeds.target_danceability = parseFloat(dance_level);
    
    // If user_id provided, get personalized recommendations from saved preferences
    if (user_id) {
      try {
        const user = await User.findById(user_id);
        if (user && user.preferences) {
          seeds.target_energy = user.preferences.energy;
          seeds.target_danceability = user.preferences.danceability;
          seeds.target_valence = user.preferences.valence;
          
          // Use favorite genres if available
          if (user.favoriteGenres && user.favoriteGenres.length > 0) {
            seeds.seed_genres = user.favoriteGenres.slice(0, 3); // Max 3 genres
          }
        }
      } catch (userError) {
        console.log('Could not load user preferences:', userError.message);
      }
    }
    
    // Default genres if none specified
    if (!seeds.seed_genres) {
      seeds.seed_genres = ['pop', 'rock', 'hip-hop'];
    }
    
    try {
      const recommendations = await getRecommendations(seeds);
      res.json({ recommendations, appliedPreferences: seeds });
    } catch (spotifyError) {
      console.log('Spotify API failed, using mock data with preferences applied');
      
      // Apply mock personalization based on preferences
      let personalizedMockData = [...mockRecommendations];
      
      if (mood === 'energetic' || energy_level > 0.7) {
        personalizedMockData = mockRecommendations.filter(track => 
          ['Billie Jean', 'Sweet Child O\' Mine', 'Blinding Lights'].includes(track.name)
        );
      } else if (mood === 'chill' || energy_level < 0.4) {
        personalizedMockData = mockRecommendations.filter(track => 
          ['Hotel California', 'Shape of You'].includes(track.name)
        );
      }
      
      // Shuffle for variety
      personalizedMockData = personalizedMockData.sort(() => 0.5 - Math.random());
      
      res.json({ recommendations: personalizedMockData, appliedPreferences: seeds, usingMockData: true });
    }
  } catch (error) {
    console.error('Recommendations error:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
});

// Quick mood-based recommendations
app.get('/api/recommendations/mood/:mood', async (req, res) => {
  try {
    const { mood } = req.params;
    const { user_id } = req.query;
    
    // Redirect to main recommendations with mood parameter
    const moodQuery = `mood=${mood}${user_id ? `&user_id=${user_id}` : ''}`;
    req.url = `/api/recommendations?${moodQuery}`;
    return app._router.handle(req, res);
  } catch (error) {
    console.error('Mood recommendations error:', error);
    res.status(500).json({ error: 'Failed to get mood recommendations' });
  }
});

// Create or get user
app.post('/api/users', async (req, res) => {
  try {
    const { name, email, favoriteGenres } = req.body;
    
    // Check if user exists
    let user = await User.findOne({ email });
    if (user) {
      return res.json({ user });
    }
    
    // Create new user with default preferences
    user = new User({ 
      name, 
      email,
      favoriteGenres: favoriteGenres || ['pop', 'rock'],
      preferences: {
        energy: 0.5,
        danceability: 0.5,
        valence: 0.5
      }
    });
    await user.save();
    res.status(201).json({ user });
  } catch (error) {
    console.error('User creation error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Get user profile with preferences
app.get('/api/users/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update user preferences (energy, danceability, valence, genres)
app.put('/api/users/:userId/preferences', async (req, res) => {
  try {
    const { userId } = req.params;
    const { energy, danceability, valence, favoriteGenres } = req.body;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Update preferences
    if (energy !== undefined) user.preferences.energy = Math.max(0, Math.min(1, energy));
    if (danceability !== undefined) user.preferences.danceability = Math.max(0, Math.min(1, danceability));
    if (valence !== undefined) user.preferences.valence = Math.max(0, Math.min(1, valence));
    
    // Update favorite genres
    if (favoriteGenres) user.favoriteGenres = favoriteGenres;
    
    await user.save();
    
    res.json({ 
      message: 'Preferences updated', 
      preferences: user.preferences,
      favoriteGenres: user.favoriteGenres
    });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
});

// Save track to favorites
app.post('/api/users/:userId/favorites', async (req, res) => {
  try {
    const { userId } = req.params;
    const { trackId, name, artist, album, imageUrl, previewUrl } = req.body;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Check if track already saved
    const existingTrack = user.savedTracks.find(track => track.trackId === trackId);
    if (existingTrack) {
      return res.status(400).json({ error: 'Track already in favorites' });
    }
    
    user.savedTracks.push({
      trackId, name, artist, album, imageUrl, previewUrl
    });
    
    await user.save();
    res.json({ message: 'Track added to favorites', favorites: user.savedTracks });
  } catch (error) {
    console.error('Save favorite error:', error);
    res.status(500).json({ error: 'Failed to save track' });
  }
});

// Get user favorites
app.get('/api/users/:userId/favorites', async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ favorites: user.savedTracks });
  } catch (error) {
    console.error('Get favorites error:', error);
    res.status(500).json({ error: 'Failed to get favorites' });
  }
});

// Remove from favorites
app.delete('/api/users/:userId/favorites/:trackId', async (req, res) => {
  try {
    const { userId, trackId } = req.params;
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    user.savedTracks = user.savedTracks.filter(track => track.trackId !== trackId);
    await user.save();
    
    res.json({ message: 'Track removed from favorites', favorites: user.savedTracks });
  } catch (error) {
    console.error('Remove favorite error:', error);
    res.status(500).json({ error: 'Failed to remove track' });
  }
});

// Get trending/popular tracks
app.get('/api/trending', async (req, res) => {
  try {
    const trendingSeeds = {
      seed_genres: ['pop', 'hip-hop', 'electronic'],
      target_popularity: 80,
      limit: 20
    };
    
    try {
      const tracks = await getRecommendations(trendingSeeds);
      res.json({ tracks });
    } catch (spotifyError) {
      console.log('Spotify trending failed, using mock data');
      const trendingMockData = mockRecommendations.slice(4); // Modern tracks
      res.json({ tracks: trendingMockData });
    }
  } catch (error) {
    console.error('Trending error:', error);
    res.status(500).json({ error: 'Failed to get trending tracks' });
  }
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Visit http://localhost:${PORT} to see your app!`);
  console.log(`Test API at http://localhost:${PORT}/api/test`);
  
  // Test Spotify connection on startup
  setTimeout(async () => {
    const test = await testSpotifyConnection();
    if (test.success) {
      console.log('✅ Spotify integration is working!');
    } else {
      console.log('❌ Spotify integration needs attention:', test.error);
    }
  }, 2000);
});