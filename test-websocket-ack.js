#!/usr/bin/env node

// WebSocket ACK Test Script
import WebSocket from 'ws';

// Connect to the WebSocket server
const ws = new WebSocket('ws://localhost:5000/ws');

let clientId = null;
let lastSequence = 0;
let receivedMessages = [];

console.log('🔌 Connecting to WebSocket server...');

ws.on('open', () => {
  console.log('✅ Connected to WebSocket');
});

ws.on('message', (data) => {
  try {
    const message = JSON.parse(data.toString());
    console.log(`📥 Received message:`, {
      type: message.type,
      seq: message.seq,
      ts: message.ts ? new Date(message.ts).toISOString() : undefined,
      requiresAck: message.requiresAck
    });
    
    receivedMessages.push(message);
    
    // Handle connection init
    if (message.type === 'connection.init') {
      clientId = message.clientId;
      lastSequence = message.seq || 0;
      console.log(`🆔 Client ID: ${clientId}, Initial seq: ${lastSequence}`);
      
      // Send a test message to trigger server response
      setTimeout(() => {
        console.log('📤 Sending test audio-analysis message...');
        ws.send(JSON.stringify({
          type: 'audio-analysis',
          payload: {
            test: true,
            timestamp: Date.now()
          }
        }));
      }, 1000);
    }
    
    // Handle heartbeat
    if (message.type === 'heartbeat') {
      console.log('💓 Heartbeat received, sending ACK...');
      ws.send(JSON.stringify({
        type: 'heartbeat.ack',
        seq: message.seq
      }));
    }
    
    // Send ACK for messages that require it
    if (message.requiresAck && message.seq) {
      console.log(`📨 Sending ACK for seq ${message.seq}...`);
      ws.send(JSON.stringify({
        type: 'client.ack',
        seq: message.seq
      }));
    }
    
    // Track sequence
    if (message.seq) {
      if (message.seq === lastSequence + 1) {
        lastSequence = message.seq;
      } else if (message.seq > lastSequence + 1) {
        console.warn(`⚠️  Sequence gap detected! Expected ${lastSequence + 1}, got ${message.seq}`);
        
        // Request resync after a small delay
        setTimeout(() => {
          console.log(`🔄 Requesting resync from seq ${lastSequence + 1}...`);
          ws.send(JSON.stringify({
            type: 'resync.request',
            fromSeq: lastSequence + 1
          }));
        }, 500);
      }
    }
  } catch (error) {
    console.error('❌ Error parsing message:', error);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', () => {
  console.log('🔌 Disconnected from WebSocket');
  console.log(`📊 Total messages received: ${receivedMessages.length}`);
  process.exit(0);
});

// Close connection after 15 seconds
setTimeout(() => {
  console.log('⏰ Test complete, closing connection...');
  console.log('📊 Messages received:', receivedMessages.length);
  console.log('📝 Message types:', [...new Set(receivedMessages.map(m => m.type))].join(', '));
  ws.close();
}, 15000);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down test...');
  ws.close();
  process.exit(0);
});