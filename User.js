const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  favoriteGenres: [String],
  savedTracks: [{
    trackId: String,
    name: String,
    artist: String,
    album: String,
    imageUrl: String,
    previewUrl: String,
    savedAt: { type: Date, default: Date.now }
  }],
  playlists: [{
    name: String,
    tracks: [String], // Spotify track IDs
    createdAt: { type: Date, default: Date.now }
  }],
  preferences: {
    energy: { type: Number, min: 0, max: 1, default: 0.5 },
    danceability: { type: Number, min: 0, max: 1, default: 0.5 },
    valence: { type: Number, min: 0, max: 1, default: 0.5 } // positivity
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);