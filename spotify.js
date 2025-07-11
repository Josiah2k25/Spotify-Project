const https = require('https');

// Spotify API credentials
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('❌ SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET must be set in .env file');
  process.exit(1);
}

let accessToken = null;
let tokenExpiry = null;

// Get access token using client credentials flow
const getAccessToken = async () => {
  try {
    // Check if we have a valid token
    if (accessToken && tokenExpiry && Date.now() < tokenExpiry) {
      console.log('Using cached access token');
      return accessToken;
    }

    console.log('Getting new Spotify access token...');
    
    const auth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const postData = 'grant_type=client_credentials';
    
    const options = {
      hostname: 'accounts.spotify.com',
      port: 443,
      path: '/api/token',
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.error(`❌ Token request failed with status ${res.statusCode}`);
            console.error('Response:', data);
            reject(new Error(`Token request failed: ${res.statusCode}`));
            return;
          }
          
          try {
            const response = JSON.parse(data);
            if (response.access_token) {
              accessToken = response.access_token;
              tokenExpiry = Date.now() + ((response.expires_in - 60) * 1000); // Refresh 1 min early
              console.log('✅ Access token received successfully');
              resolve(accessToken);
            } else {
              console.error('❌ No access token in response:', response);
              reject(new Error('No access token received'));
            }
          } catch (error) {
            console.error('❌ Error parsing token response:', error);
            console.error('Raw response:', data);
            reject(error);
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('❌ Error getting access token:', error);
        reject(error);
      });
      
      req.setTimeout(15000, () => {
        console.error('❌ Token request timeout');
        req.destroy();
        reject(new Error('Token request timeout'));
      });
      
      req.write(postData);
      req.end();
    });
  } catch (error) {
    console.error('❌ Error in getAccessToken:', error);
    throw error;
  }
};

// Make API request to Spotify
const makeSpotifyRequest = async (endpoint) => {
  try {
    const token = await getAccessToken();
    
    console.log(`Making request to: ${endpoint}`);
    
    const options = {
      hostname: 'api.spotify.com',
      port: 443,
      path: endpoint,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (!data || data.trim() === '') {
            console.error('❌ Empty response from Spotify');
            reject(new Error('Empty response from Spotify API'));
            return;
          }
          
          try {
            const response = JSON.parse(data);
            if (res.statusCode === 200) {
              console.log('✅ Successfully got Spotify data');
              resolve(response);
            } else {
              console.error(`❌ Spotify API error ${res.statusCode}:`, response);
              reject(new Error(`Spotify API error: ${res.statusCode} - ${response.error?.message || 'Unknown error'}`));
            }
          } catch (parseError) {
            console.error('❌ Error parsing Spotify response:', parseError);
            console.error('Raw response:', data.substring(0, 200));
            reject(new Error('Invalid JSON response from Spotify API'));
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('❌ Network error making Spotify request:', error);
        reject(error);
      });
      
      req.setTimeout(20000, () => {
        console.error('❌ Spotify API request timeout');
        req.destroy();
        reject(new Error('Request timeout'));
      });
      
      req.end();
    });
  } catch (error) {
    console.error('❌ Error in makeSpotifyRequest:', error);
    throw error;
  }
};

// Search for tracks - REAL DATA ONLY
const searchTracks = async (query, limit = 20) => {
  if (!query || query.trim() === '') {
    throw new Error('Search query cannot be empty');
  }
  
  console.log(`🔍 Searching Spotify for: "${query}"`);
  const encodedQuery = encodeURIComponent(query.trim());
  const endpoint = `/v1/search?q=${encodedQuery}&type=track&limit=${limit}&market=US`;
  
  const data = await makeSpotifyRequest(endpoint);
  
  if (!data.tracks || !data.tracks.items) {
    throw new Error('Invalid search response format');
  }
  
  console.log(`✅ Found ${data.tracks.items.length} tracks for: "${query}"`);
  return data.tracks.items;
};

// Get recommendations with user preferences - REAL DATA ONLY
const getRecommendations = async (seeds) => {
  console.log('🎯 Getting Spotify recommendations with preferences:', seeds);
  
  // Build query parameters
  const params = new URLSearchParams();
  
  // Add seed data (at least one seed is required)
  if (seeds.seed_genres) {
    const genres = Array.isArray(seeds.seed_genres) ? seeds.seed_genres.join(',') : seeds.seed_genres;
    params.append('seed_genres', genres);
  } else if (seeds.seed_artists) {
    const artists = Array.isArray(seeds.seed_artists) ? seeds.seed_artists.join(',') : seeds.seed_artists;
    params.append('seed_artists', artists);
  } else if (seeds.seed_tracks) {
    const tracks = Array.isArray(seeds.seed_tracks) ? seeds.seed_tracks.join(',') : seeds.seed_tracks;
    params.append('seed_tracks', tracks);
  } else {
    // Default genres if no seeds provided
    params.append('seed_genres', 'pop,rock,hip-hop');
  }
  
  // Add user preferences for personalization
  if (seeds.target_energy !== undefined) params.append('target_energy', seeds.target_energy);
  if (seeds.target_danceability !== undefined) params.append('target_danceability', seeds.target_danceability);
  if (seeds.target_valence !== undefined) params.append('target_valence', seeds.target_valence);
  if (seeds.target_popularity !== undefined) params.append('target_popularity', seeds.target_popularity);
  
  // Audio feature ranges for more control
  if (seeds.min_energy !== undefined) params.append('min_energy', seeds.min_energy);
  if (seeds.max_energy !== undefined) params.append('max_energy', seeds.max_energy);
  if (seeds.min_danceability !== undefined) params.append('min_danceability', seeds.min_danceability);
  if (seeds.max_danceability !== undefined) params.append('max_danceability', seeds.max_danceability);
  if (seeds.min_valence !== undefined) params.append('min_valence', seeds.min_valence);
  if (seeds.max_valence !== undefined) params.append('max_valence', seeds.max_valence);
  if (seeds.min_tempo !== undefined) params.append('min_tempo', seeds.min_tempo);
  if (seeds.max_tempo !== undefined) params.append('max_tempo', seeds.max_tempo);
  
  params.append('limit', '20');
  params.append('market', 'US');
  
  const endpoint = `/v1/recommendations?${params.toString()}`;
  console.log('🔗 Recommendations endpoint:', endpoint);
  
  const data = await makeSpotifyRequest(endpoint);
  
  if (!data.tracks) {
    throw new Error('Invalid recommendations response format');
  }
  
  console.log(`✅ Got ${data.tracks.length} real Spotify recommendations`);
  return data.tracks;
};

// Get audio features for tracks (for analysis and improved recommendations)
const getTrackFeatures = async (trackIds) => {
  if (!trackIds || trackIds.length === 0) return [];
  
  const ids = Array.isArray(trackIds) ? trackIds.join(',') : trackIds;
  const endpoint = `/v1/audio-features?ids=${ids}`;
  const data = await makeSpotifyRequest(endpoint);
  return data.audio_features;
};

// Get track by ID
const getTrack = async (trackId) => {
  const endpoint = `/v1/tracks/${trackId}?market=US`;
  const data = await makeSpotifyRequest(endpoint);
  return data;
};

// Get multiple tracks by IDs
const getTracks = async (trackIds) => {
  if (!trackIds || trackIds.length === 0) return [];
  
  const ids = Array.isArray(trackIds) ? trackIds.join(',') : trackIds;
  const endpoint = `/v1/tracks?ids=${ids}&market=US`;
  const data = await makeSpotifyRequest(endpoint);
  return data.tracks;
};

// Test Spotify connection
const testSpotifyConnection = async () => {
  try {
    console.log('🧪 Testing Spotify connection...');
    const token = await getAccessToken();
    console.log('✅ Access token obtained successfully');
    
    // Test a simple search
    const testResults = await searchTracks('test', 1);
    console.log('✅ Search test successful');
    
    // Test recommendations
    const testRecs = await getRecommendations({ seed_genres: 'pop' });
    console.log('✅ Recommendations test successful');
    
    return { success: true, message: 'Spotify connection working perfectly' };
  } catch (error) {
    console.error('❌ Spotify connection test failed:', error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  searchTracks,
  getRecommendations,
  getTrackFeatures,
  getTrack,
  getTracks,
  testSpotifyConnection
};
