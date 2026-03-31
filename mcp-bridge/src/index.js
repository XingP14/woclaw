#!/usr/bin/env node
/**
 * WoClaw MCP Bridge
 * 
 * Exposes WoClaw Hub memory and topics as MCP tools.
 * Connect any MCP-capable agent (Claude Desktop, Cursor, etc.) to WoClaw Hub.
 * 
 * Usage:
 *   node dist/index.js --hub ws://localhost:8082 --token your-token --rest-url http://localhost:8083
 * 
 * MCP Protocol: JSON-RPC 2.0 over stdin/stdout
 */

import { WebSocket } from 'ws';
import { createInterface } from 'readline';

// Parse args
const args = process.argv.slice(2);
let hubUrl = 'ws://localhost:8082';
let token = '';
let restUrl = 'http://localhost:8083';

for (const arg of args) {
  if (arg.startsWith('--hub=')) hubUrl = arg.slice(6);
  if (arg.startsWith('--token=')) token = arg.slice(8);
  if (arg.startsWith('--rest-url=')) restUrl = arg.slice(11);
}

// WoClaw Hub connection
let ws = null;
let connected = false;
let pending = new Map(); // id -> { resolve, reject }
let msgId = 1;

function connect() {
  return new Promise((resolve, reject) => {
    const url = `${hubUrl}${hubUrl.includes('?') ? '&' : '?'}agentId=woclaw-mcp&token=${token}`;
    ws = new WebSocket(url);
    
    ws.on('open', () => {
      connected = true;
      console.error('[WoClaw MCP] Connected to Hub:', hubUrl);
      resolve();
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id && pending.has(msg.id)) {
          const { resolve } = pending.get(msg.id);
          pending.delete(msg.id);
          resolve(msg);
        }
      } catch (e) {
        console.error('[WoClaw MCP] Parse error:', e.message);
      }
    });
    
    ws.on('error', (err) => {
      console.error('[WoClaw MCP] WS error:', err.message);
    });
    
    ws.on('close', () => {
      connected = false;
      console.error('[WoClaw MCP] Disconnected, reconnecting in 3s...');
      setTimeout(() => connect().catch(() => {}), 3000);
    });
  });
}

function send(type, data = {}) {
  return new Promise((resolve, reject) => {
    if (!ws || !connected) {
      reject(new Error('Not connected to Hub'));
      return;
    }
    const id = msgId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, type, ...data }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error('Request timeout'));
      }
    }, 5000);
  });
}

// MCP Protocol Handlers
function handleInitialize() {
  return {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'woclaw', version: '0.1.1' }
  };
}

function handleListTools() {
  return {
    tools: [
      {
        name: 'woclaw_memory_read',
        description: 'Read a value from the WoClaw shared memory pool',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Memory key to read' }
          },
          required: ['key']
        }
      },
      {
        name: 'woclaw_memory_write',
        description: 'Write a value to the WoClaw shared memory pool',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Memory key to write' },
            value: { type: 'string', description: 'Value to store' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for categorization (optional)' }
          },
          required: ['key', 'value']
        }
      },
      {
        name: 'woclaw_memory_list',
        description: 'List all entries in the WoClaw shared memory pool',
        inputSchema: {
          type: 'object',
          properties: {
            tags: { type: 'string', description: 'Filter by comma-separated tags (optional)' }
          }
        }
      },
      {
        name: 'woclaw_topics_list',
        description: 'List all topics available in the WoClaw Hub',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'woclaw_topic_messages',
        description: 'Get recent messages from a topic',
        inputSchema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Topic name' },
            limit: { type: 'number', description: 'Max messages to return (default 20, max 200)' }
          },
          required: ['topic']
        }
      },
      {
        name: 'woclaw_topic_send',
        description: 'Send a message to a topic',
        inputSchema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Topic name' },
            content: { type: 'string', description: 'Message content' }
          },
          required: ['topic', 'content']
        }
      },
      {
        name: 'woclaw_topic_join',
        description: 'Join a topic to receive messages',
        inputSchema: {
          type: 'object',
          properties: {
            topic: { type: 'string', description: 'Topic name to join' }
          },
          required: ['topic']
        }
      }
    ]
  };
}

async function handleCallTool(name, args) {
  if (!ws || !connected) {
    return { content: [{ type: 'text', text: 'Error: Not connected to WoClaw Hub' }] };
  }

  switch (name) {
    case 'woclaw_memory_read': {
      try {
        const res = await fetch(`${restUrl}/memory/${encodeURIComponent(args.key)}`);
        const data = await res.json();
        if (res.ok) {
          return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
        } else {
          return { content: [{ type: 'text', text: `Error: ${data.error}` }] };
        }
      } catch (e) {
        // Fall back to WebSocket
        const msg = await send('memory.read', { key: args.key });
        return { content: [{ type: 'text', text: JSON.stringify(msg, null, 2) }] };
      }
    }
    case 'woclaw_memory_write': {
      const msg = await send('memory.write', {
        key: args.key,
        value: args.value,
        tags: args.tags || [],
      });
      return { content: [{ type: 'text', text: `Written: ${args.key}` }] };
    }
    case 'woclaw_memory_list': {
      const msg = await send('memory.list', { tags: args.tags });
      return { content: [{ type: 'text', text: JSON.stringify(msg, null, 2) }] };
    }
    case 'woclaw_topics_list': {
      const msg = await send('topics.list', {});
      return { content: [{ type: 'text', text: JSON.stringify(msg, null, 2) }] };
    }
    case 'woclaw_topic_messages': {
      const msg = await send('topic.history', { topic: args.topic, limit: args.limit || 20 });
      return { content: [{ type: 'text', text: JSON.stringify(msg, null, 2) }] };
    }
    case 'woclaw_topic_send': {
      const msg = await send('message', { topic: args.topic, content: args.content });
      return { content: [{ type: 'text', text: 'Message sent' }] };
    }
    case 'woclaw_topic_join': {
      const msg = await send('join', { topic: args.topic });
      return { content: [{ type: 'text', text: `Joined topic: ${args.topic}` }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
}

// MCP message loop (JSON-RPC 2.0 over stdin/stdout)
async function main() {
  // Connect to Hub in background
  connect().catch(err => {
    console.error('[WoClaw MCP] Failed to connect:', err.message);
  });

  const rl = createInterface({ input: process.stdin });
  let buffer = '';

  for await (const chunk of rl) {
    buffer += chunk;
    // Try to parse complete JSON messages (split by newlines)
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const req = JSON.parse(line);
        const id = req.id;
        const method = req.method;
        const params = req.params || {};

        let result;
        switch (method) {
          case 'initialize':
            result = handleInitialize();
            break;
          case 'tools/list':
            result = handleListTools();
            break;
          case 'tools/call':
            result = await handleCallTool(params.name, params.arguments || {});
            break;
          default:
            // Send not implemented
            process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }) + '\n');
            continue;
        }

        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
      } catch (e) {
        console.error('[WoClaw MCP] Error:', e.message);
      }
    }
  }
}

main().catch(console.error);
