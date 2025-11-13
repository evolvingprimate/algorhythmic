// Test script for async endpoints
const fetch = require('node-fetch');

async function testAsyncEndpoint() {
  console.log('Testing async artwork endpoint...');
  
  try {
    // Test the async endpoint
    const response = await fetch('http://localhost:5000/api/artworks/next/async?sessionId=test-session&limit=3', {
      headers: {
        'Cookie': 'connect.sid=test' // This won't auth properly but will test the endpoint exists
      }
    });
    
    console.log('Response status:', response.status);
    
    if (response.status === 200) {
      const data = await response.text();
      
      // Check if it's JSON or HTML
      if (data.startsWith('<!DOCTYPE')) {
        console.log('Got HTML response - authentication required (expected)');
        console.log('Endpoint exists and is accessible ✓');
      } else {
        try {
          const json = JSON.parse(data);
          console.log('Got JSON response:', json);
        } catch (e) {
          console.log('Response body:', data.substring(0, 200));
        }
      }
    } else {
      console.log('Unexpected status code');
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Also test that the polling endpoint exists
async function testPollingEndpoint() {
  console.log('\nTesting polling endpoint...');
  
  try {
    const response = await fetch('http://localhost:5000/api/artworks/job/test-job-id', {
      headers: {
        'Cookie': 'connect.sid=test'
      }
    });
    
    console.log('Polling endpoint status:', response.status);
    
    if (response.status === 200) {
      console.log('Polling endpoint exists and returned 200 (unexpected without auth)');
    } else if (response.status === 404) {
      console.log('Polling endpoint returned 404 - job not found (expected)');
    } else {
      const data = await response.text();
      if (data.startsWith('<!DOCTYPE')) {
        console.log('Polling endpoint requires auth (expected) ✓');
      }
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// Run tests
testAsyncEndpoint().then(() => testPollingEndpoint());