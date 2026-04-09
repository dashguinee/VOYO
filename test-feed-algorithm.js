// Quick test of feed algorithm
const { estimateTreatment, applyTreatment, calculateFeedScore } = require('./dist/assets/index-CVqoUS9L.js');

// Mock track data
const shortTrack = {
  id: '1',
  title: 'Love Nwantiti',
  artist: 'CKay',
  trackId: 'yt1',
  coverUrl: 'https://example.com/cover.jpg',
  duration: 118, // 1:58 - short track
  tags: ['afrobeats', 'viral'],
  oyeScore: 95,
  createdAt: '2024-01-01T00:00:00Z'
};

const highEnergyTrack = {
  id: '2',
  title: 'Last Last',
  artist: 'Burna Boy',
  trackId: 'yt2',
  coverUrl: 'https://example.com/cover.jpg',
  duration: 165, // 2:45
  tags: ['afrobeats', 'party', 'drill'],
  oyeScore: 98,
  createdAt: '2024-01-15T00:00:00Z'
};

const chillTrack = {
  id: '3',
  title: 'Free Mind',
  artist: 'Tems',
  trackId: 'yt3',
  coverUrl: 'https://example.com/cover.jpg',
  duration: 210, // 3:30
  tags: ['rnb', 'soul', 'chill'],
  oyeScore: 92,
  createdAt: '2024-02-01T00:00:00Z'
};

console.log('Testing Feed Algorithm...\n');

// Test short track
console.log('1. SHORT TRACK (< 2min):');
console.log(`   ${shortTrack.title} by ${shortTrack.artist} (${shortTrack.duration}s)`);
const shortResult = estimateTreatment(shortTrack, []);
console.log(`   Treatment: ${shortResult.treatment}`);
console.log(`   Start: ${shortResult.startSeconds}s, Duration: ${shortResult.durationSeconds}s`);
console.log(`   Energy: ${shortResult.energyLevel}, Skip Intro: ${shortResult.skipIntro}`);
console.log(`   Reason: ${shortResult.reason}\n`);

// Test high energy track
console.log('2. HIGH ENERGY TRACK:');
console.log(`   ${highEnergyTrack.title} by ${highEnergyTrack.artist} (${highEnergyTrack.duration}s)`);
const highEnergyResult = estimateTreatment(highEnergyTrack, []);
console.log(`   Treatment: ${highEnergyResult.treatment}`);
console.log(`   Start: ${highEnergyResult.startSeconds}s, Duration: ${highEnergyResult.durationSeconds}s`);
console.log(`   Energy: ${highEnergyResult.energyLevel}, Skip Intro: ${highEnergyResult.skipIntro}`);
console.log(`   Reason: ${highEnergyResult.reason}\n`);

// Test chill track
console.log('3. CHILL TRACK:');
console.log(`   ${chillTrack.title} by ${chillTrack.artist} (${chillTrack.duration}s)`);
const chillResult = estimateTreatment(chillTrack, []);
console.log(`   Treatment: ${chillResult.treatment}`);
console.log(`   Start: ${chillResult.startSeconds}s, Duration: ${chillResult.durationSeconds}s`);
console.log(`   Energy: ${chillResult.energyLevel}, Skip Intro: ${chillResult.skipIntro}`);
console.log(`   Reason: ${chillResult.reason}\n`);

// Test with hotspot data
console.log('4. TRACK WITH HOTSPOT DATA:');
const hotspots = [
  { position: 35, intensity: 0.85, reactionCount: 15, dominantType: 'fire' }
];
console.log(`   ${highEnergyTrack.title} with ${hotspots[0].reactionCount} reactions at ${hotspots[0].position}%`);
const hotspotResult = estimateTreatment(highEnergyTrack, hotspots);
console.log(`   Treatment: ${hotspotResult.treatment}`);
console.log(`   Start: ${hotspotResult.startSeconds}s, Duration: ${hotspotResult.durationSeconds}s`);
console.log(`   Energy: ${hotspotResult.energyLevel}, Skip Intro: ${hotspotResult.skipIntro}`);
console.log(`   Reason: ${hotspotResult.reason}\n`);

console.log('✅ Feed Algorithm Test Complete!');
