const WebSocket = require('ws');

const PORT = 8070;
const wss = new WebSocket.Server({ port: PORT, host: '0.0.0.0' });

// Store active drawing sessions by room ID
const rooms = new Map();

console.log(`🎨 Drawing WebSocket server started on port ${PORT}`);

wss.on('connection', (ws) => {
  console.log('New client connected');
  
  let currentRoom = null;
  let clientId = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'join':
          currentRoom = data.roomId;
          clientId = data.clientId;
          
          if (!rooms.has(currentRoom)) {
            rooms.set(currentRoom, new Set());
          }
          
          rooms.get(currentRoom).add(ws);
          console.log(`Client ${clientId} joined room ${currentRoom}`);
          
          // Send confirmation
          ws.send(JSON.stringify({ type: 'joined', roomId: currentRoom }));
          break;
          
        case 'draw':
          // Broadcast drawing data to all clients in the same room
          if (currentRoom && rooms.has(currentRoom)) {
            const clients = rooms.get(currentRoom);
            const drawData = {
              type: 'draw',
              x: data.x,
              y: data.y,
              prevX: data.prevX,
              prevY: data.prevY,
              color: data.color,
              lineWidth: data.lineWidth,
              drawerId: data.drawerId,
            };
            
            clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(drawData));
              }
            });
          }
          break;

        case 'strokeEnd':
          // Signal end of a stroke so clients can save history snapshots
          if (currentRoom && rooms.has(currentRoom)) {
            const clients = rooms.get(currentRoom);
            const endData = {
              type: 'strokeEnd',
              drawerId: data.drawerId,
            };

            clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(endData));
              }
            });
          }
          break;

        case 'fill':
          // Broadcast flood fill action to all clients in the same room
          if (currentRoom && rooms.has(currentRoom)) {
            const clients = rooms.get(currentRoom);
            const fillData = {
              type: 'fill',
              x: data.x,
              y: data.y,
              color: data.color,
              drawerId: data.drawerId,
            };

            clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(fillData));
              }
            });
          }
          break;
          
        case 'clear':
          // Broadcast clear canvas command
          if (currentRoom && rooms.has(currentRoom)) {
            const clients = rooms.get(currentRoom);
            const clearData = {
              type: 'clear',
              drawerId: data.drawerId,
            };
            
            clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(clearData));
              }
            });
          }
          break;

        case 'undo':
          // Broadcast undo command to all clients in the same room
          if (currentRoom && rooms.has(currentRoom)) {
            const clients = rooms.get(currentRoom);
            const undoData = {
              type: 'undo',
              drawerId: data.drawerId,
            };

            clients.forEach((client) => {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(undoData));
              }
            });
          }
          break;
          
        case 'leave':
          if (currentRoom && rooms.has(currentRoom)) {
            rooms.get(currentRoom).delete(ws);
            console.log(`Client ${clientId} left room ${currentRoom}`);
            
            // Clean up empty rooms
            if (rooms.get(currentRoom).size === 0) {
              rooms.delete(currentRoom);
            }
          }
          break;
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  ws.on('close', () => {
    // Remove from room on disconnect
    if (currentRoom && rooms.has(currentRoom)) {
      rooms.get(currentRoom).delete(ws);
      console.log(`Client ${clientId} disconnected from room ${currentRoom}`);
      
      if (rooms.get(currentRoom).size === 0) {
        rooms.delete(currentRoom);
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

console.log('WebSocket server ready to accept connections');