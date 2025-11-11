/**
 * Test suite for RecentlyServedCache
 * Run with: tsx tests/test-recently-served-cache.ts
 */

import { RecentlyServedCache } from '../server/recently-served-cache';
import type { ArtSession } from '../shared/schema';

// Create test artwork data
function createTestArtwork(id: string): ArtSession {
  return {
    id,
    sessionId: 'test-session',
    userId: 'test-user',
    imageUrl: `https://example.com/image-${id}.jpg`,
    prompt: `Test prompt ${id}`,
    dnaVector: null,
    audioFeatures: null,
    musicTrack: null,
    musicArtist: null,
    musicGenre: null,
    musicAlbum: null,
    generationExplanation: null,
    isSaved: false,
    motifs: [],
    qualityScore: 50,
    perceptualHash: null,
    poolStatus: 'active',
    lastUsedAt: null,
    styles: [],
    artists: [],
    isLibrary: false,
    orientation: 'portrait',
    aspectRatio: '9:16',
    catalogueTier: null,
    width: 1080,
    height: 1920,
    safeArea: null,
    focalPoints: null,
    sidefillPalette: null,
    createdAt: new Date()
  } as ArtSession;
}

// Test 1: Basic cache operations
function testBasicOperations() {
  console.log('\n=== Test 1: Basic Cache Operations ===');
  const cache = new RecentlyServedCache(5, 60 * 1000); // 5 items max, 1 minute TTL for testing
  
  // Test getUserKey
  const key1 = cache.getUserKey('session-1', 'user-1');
  const key2 = cache.getUserKey('session-1', undefined);
  console.log(`✓ getUserKey with user: ${key1}`);
  console.log(`✓ getUserKey anonymous: ${key2}`);
  
  // Test addServed
  cache.addServed('session-1', 'user-1', ['art-1', 'art-2'], 'fresh');
  cache.addServed('session-1', 'user-1', ['art-3'], 'style');
  
  // Test filterRecentlyServed
  const artworks = [
    createTestArtwork('art-1'),
    createTestArtwork('art-2'),
    createTestArtwork('art-3'),
    createTestArtwork('art-4'),
    createTestArtwork('art-5')
  ];
  
  const filtered = cache.filterRecentlyServed('session-1', 'user-1', artworks);
  console.log(`✓ Filtered ${artworks.length} → ${filtered.length} artworks`);
  console.log(`  Remaining IDs: ${filtered.map(a => a.id).join(', ')}`);
  
  // Test stats
  const stats = cache.getStats();
  console.log(`✓ Stats: ${stats.totalUsers} users, ${stats.totalArtworks} artworks`);
}

// Test 2: LRU eviction
function testLRUEviction() {
  console.log('\n=== Test 2: LRU Eviction ===');
  const cache = new RecentlyServedCache(3, 60 * 1000); // Max 3 items
  
  // Add more than max items
  cache.addServed('session-1', 'user-1', ['art-1'], 'fresh');
  cache.addServed('session-1', 'user-1', ['art-2'], 'fresh');
  cache.addServed('session-1', 'user-1', ['art-3'], 'fresh');
  cache.addServed('session-1', 'user-1', ['art-4'], 'fresh'); // Should evict art-1
  
  const artworks = [
    createTestArtwork('art-1'), // Should be available (evicted)
    createTestArtwork('art-2'),
    createTestArtwork('art-3'),
    createTestArtwork('art-4')
  ];
  
  const filtered = cache.filterRecentlyServed('session-1', 'user-1', artworks);
  const filteredIds = filtered.map(a => a.id);
  
  console.log(`✓ After LRU eviction: ${filteredIds.join(', ')}`);
  console.log(`  art-1 evicted: ${filteredIds.includes('art-1')}`);
  console.log(`  art-2,3,4 cached: ${!filteredIds.includes('art-2') && !filteredIds.includes('art-3') && !filteredIds.includes('art-4')}`);
  
  const stats = cache.getStats();
  console.log(`✓ Total cached after eviction: ${stats.totalArtworks} (max: 3)`);
}

// Test 3: TTL expiration
async function testTTLExpiration() {
  console.log('\n=== Test 3: TTL Expiration ===');
  const cache = new RecentlyServedCache(10, 500); // 500ms TTL for quick testing
  
  cache.addServed('session-1', 'user-1', ['art-1', 'art-2'], 'fresh');
  
  const artworks = [createTestArtwork('art-1'), createTestArtwork('art-2')];
  
  // Check immediately - should be filtered
  const filtered1 = cache.filterRecentlyServed('session-1', 'user-1', artworks);
  console.log(`✓ Immediately after adding: ${filtered1.length} artworks filtered`);
  
  // Wait for TTL to expire
  await new Promise(resolve => setTimeout(resolve, 600));
  
  // Check after expiration - should not be filtered
  const filtered2 = cache.filterRecentlyServed('session-1', 'user-1', artworks);
  console.log(`✓ After TTL expiration: ${filtered2.length} artworks available`);
  
  // Clean up
  const removed = cache.cleanup();
  console.log(`✓ Cleanup removed ${removed} expired entries`);
}

// Test 4: Multiple users/sessions
function testMultipleUsers() {
  console.log('\n=== Test 4: Multiple Users/Sessions ===');
  const cache = new RecentlyServedCache(5, 60 * 1000);
  
  // Add artworks for different users
  cache.addServed('session-1', 'user-1', ['art-1', 'art-2'], 'fresh');
  cache.addServed('session-2', 'user-2', ['art-1', 'art-3'], 'style');
  cache.addServed('session-3', undefined, ['art-1', 'art-4'], 'global'); // Anonymous
  
  const artworks = [
    createTestArtwork('art-1'),
    createTestArtwork('art-2'),
    createTestArtwork('art-3'),
    createTestArtwork('art-4')
  ];
  
  // Check filtering for each user
  const filtered1 = cache.filterRecentlyServed('session-1', 'user-1', artworks);
  const filtered2 = cache.filterRecentlyServed('session-2', 'user-2', artworks);
  const filtered3 = cache.filterRecentlyServed('session-3', undefined, artworks);
  
  console.log(`✓ User 1 sees: ${filtered1.map(a => a.id).join(', ')}`);
  console.log(`✓ User 2 sees: ${filtered2.map(a => a.id).join(', ')}`);
  console.log(`✓ Anonymous sees: ${filtered3.map(a => a.id).join(', ')}`);
  
  const stats = cache.getStats();
  console.log(`✓ Total users cached: ${stats.totalUsers}`);
}

// Run all tests
async function runTests() {
  console.log('Running RecentlyServedCache Tests...');
  
  testBasicOperations();
  testLRUEviction();
  await testTTLExpiration();
  testMultipleUsers();
  
  console.log('\n=== All Tests Completed ===');
}

// Run tests
runTests().catch(console.error);