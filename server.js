const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const { searchTracks, getRecommendations, getTrackFeatures, testSpotifyConnection } = require('./spotify');
const User = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;

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
  res.json({ message: 'Music Discovery App API - Real Spotify Data Only' });
});

// Test route for debugging
app.get('/api/test', async (req, res) => {
  const spotifyTest = await testSpotifyConnection();
  res.json({ 
    message: 'API is working', 
    spotifyCredentials: {
      clientId: process.env.SPOTIFY_CLIENT_ID ? 'Set' : 'MISSING',
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET ? 'Set' : 'MISSING'
    },
    spotifyConnection: spotifyTest,
    timestamp: new Date().toISOString(),
    note: 'This app only uses real Spotify data - no mock data'
  });
});

// Search for music - REAL DATA ONLY
app.get('/api/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Search query is required' });
    }
    
    console.log(`🔍 API: Searching for "${q}"`);
    const tracks = await searchTracks(q);
    
    res.json({ 
      tracks,
      count: tracks.length,
      query: q,
      source: 'spotify_api'
    });
  } catch (error) {
    console.error('❌ Search error:', error);
    res.status(500).json({ 
      error: 'Failed to search tracks from Spotify',
      message: error.message,
      suggestion: 'Check your Spotify API credentials and connection'
    });
  }
});

// Get personalized music recommendations - REAL DATA ONLY
app.get('/api/recommendations', async (req, res) => {
  try {
    const { seed_genres, seed_artists, seed_tracks, user_id, mood, energy_level, dance_level } = req.query;
    
    console.log('🎯 API: Getting personalized recommendations');
    
    const seeds = {};
    
    // Basic seeds
    if (seed_genres) seeds.seed_genres = seed_genres.split(',');
    if (seed_artists) seeds.seed_artists = seed_artists.split(',');
    if (seed_tracks) seeds.seed_tracks = seed_tracks.split(',');
    
    // User preferences from query params (quick mood selection)
    if (mood) {
      console.log(`🎭 Applying mood: ${mood}`);
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
    if (energy_level) {
      seeds.target_energy = parseFloat(energy_level);
      console.log(`⚡ Energy level: ${seeds.target_energy}`);
    }
    if (dance_level) {
      seeds.target_danceability = parseFloat(dance_level);
      console.log(`💃 Dance level: ${seeds.target_danceability}`);
    }
    
    // If user_id provided, get personalized recommendations from saved preferences
    if (user_id) {
      try {
        const user = await User.findById(user_id);
        if (user && user.preferences) {
          console.log(`👤 Loading preferences for user: ${user_id}`);
          seeds.target_energy = user.preferences.energy;
          seeds.target_danceability = user.preferences.danceability;
          seeds.target_valence = user.preferences.valence;
          
          // Use favorite genres if available
          if (user.favoriteGenres && user.favoriteGenres.length > 0) {
            seeds.seed_genres = user.favoriteGenres.slice(0, 3); // Max 3 genres
          }
        }
      } catch (userError) {
        console.log('⚠️ Could not load user preferences:', userError.message);
      }
    }
    
    // Default genres if none specified
    if (!seeds.seed_genres && !seeds.seed_artists && !seeds.seed_tracks) {
      seeds.seed_genres = ['pop', 'rock', 'hip-hop'];
      console.log('🎵 Using default genres: pop, rock, hip-hop');
    }
    
    const recommendations = await getRecommendations(seeds);
    
    res.json({ 
      recommendations, 
      appliedPreferences: seeds,
      count: recommendations.length,
      source: 'spotify_api'
    });
    
  } catch (error) {
    console.error('❌ Recommendations error:', error);
    res.status(500).json({ 
      error: 'Failed to get recommendations from Spotify',
      message: error.message,
      suggestion: 'Check your Spotify API credentials and connection'
    });
  }
});

// Quick mood-based recommendations
app.get('/api/recommendations/mood/:mood', async (req, res) => {
  try {
    const { mood } = req.params;
    const { user_id } = req.query;
    
    console.log(`🎭 Getting ${mood} mood recommendations`);
    
    // Redirect to main recommendations with mood parameter
    const query = new URLSearchParams({ mood });
    if (user_id) query.append('user_id', user_id);
    
    // Forward the request
    req.url = `/api/recommendations?${query.toString()}`;
    req.query = Object.fromEntries(query);
    return app._router.handle(req, res);
    
  } catch (error) {
    console.error('❌ Mood recommendations error:', error);
    res.status(500).json({ 
      error: 'Failed to get mood recommendations',
      message: error.message 
    });
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

// Get trending/popular tracks - REAL DATA ONLY
app.get('/api/trending', async (req, res) => {
  try {
    console.log('📈 Getting trending tracks from Spotify');
    
    const trendingSeeds = {
      seed_genres: ['pop', 'hip-hop', 'electronic'],
      target_popularity: 80,
      limit: 20
    };
    
    const tracks = await getRecommendations(trendingSeeds);
    res.json({ 
      tracks,
      count: tracks.length,
      source: 'spotify_api'
    });
  } catch (error) {
    console.error('❌ Trending error:', error);
    res.status(500).json({ 
      error: 'Failed to get trending tracks from Spotify',
      message: error.message 
    });
  }
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB'))
  .catch(err => console.error('❌ MongoDB connection error:', err));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Visit http://localhost:${PORT} to see your app!`);
  console.log(`🧪 Test API at http://localhost:${PORT}/api/test`);
  console.log('🎵 This app uses 100% real Spotify data - no mock data!');
  
  // Test Spotify connection on startup
  setTimeout(async () => {
    console.log('\n🔍 Testing Spotify connection...');
    const test = await testSpotifyConnection();
    if (test.success) {
      console.log('✅ Spotify integration is working perfectly!');
      console.log('🎉 Your app will show real music recommendations!');
    } else {
      console.log('❌ Spotify integration needs attention:', test.error);
      console.log('💡 Run: node debug-spotify.js to troubleshoot');
    }
  }, 2000);
});
