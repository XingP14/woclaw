import WebSocket from 'ws';

const ws = new WebSocket('ws://vm153:8082?agentId=p14-local&token=WoClaw2026');

console.log('Connecting to ws://vm153:8082...');

ws.on('open', () => {
  console.log('✅ Connected!');
  ws.send(JSON.stringify({type:'join', topic:'test'}));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('📨 Type:', msg.type);
  if (msg.type === 'welcome') {
    console.log('   Agent ID:', msg.agentId);
    console.log('   Topics:', msg.topics);
  } else if (msg.type === 'history') {
    console.log('   Topic:', msg.topic);
    console.log('   Messages:', msg.messages?.length || 0);
    console.log('   Agents:', msg.agents);
  } else if (msg.type === 'join') {
    console.log('   Agent:', msg.agent, 'joined', msg.topic);
  }
  
  // Send a test message
  if (msg.type === 'history') {
    ws.send(JSON.stringify({type:'message', topic:'test', content:'Hello from p14!'}));
  }
  
  // Close after receiving response
  if (msg.type === 'message' && msg.sent) {
    console.log('✅ Test passed - message sent and confirmed!');
    ws.close();
    process.exit(0);
  }
});

ws.on('error', (e) => {
  console.log('❌ Error:', e.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('⏰ Timeout');
  process.exit(1);
}, 8000);
