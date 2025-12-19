const WebSocket = require('ws');
const sqlite3 = require('sqlite3').verbose();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 8070;
const wss = new WebSocket.Server({ port: PORT, host: '0.0.0.0' });

// Initialize Database
const db = new sqlite3.Database('./skribble.db', (err) => {
  if (err) console.error('DB Error:', err.message);
  else console.log('Connected to SQLite database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT UNIQUE,
    password TEXT
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    room_id TEXT,
    blob_hash TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
});

// Store active drawing sessions by room ID
// Each room is a Map<WebSocket, { clientId, userId }>
const rooms = new Map();

console.log(`🎨 Drawing WebSocket server started on port ${PORT}`);

wss.on('connection', (ws) => {
  console.log('New client connected');

  let currentRoom = null;
  let clientId = null;
  let userId = null; // Track authenticated user ID

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'register':
          db.run(`INSERT INTO users (nickname, password) VALUES (?, ?)`, [data.nickname, data.password], function (err) {
            if (err) {
              ws.send(JSON.stringify({ type: 'auth_error', message: 'Registration failed (nickname taken?)' }));
            } else {
              ws.send(JSON.stringify({ type: 'auth_success', userId: this.lastID, nickname: data.nickname }));
              console.log(`User registered: ${data.nickname}`);
            }
          });
          break;

        case 'login':
          db.get(`SELECT id, nickname FROM users WHERE nickname = ? AND password = ?`, [data.nickname, data.password], (err, row) => {
            if (err || !row) {
              ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid credentials' }));
            } else {
              ws.send(JSON.stringify({ type: 'auth_success', userId: row.id, nickname: row.nickname }));
              console.log(`User logged in: ${row.nickname}`);
            }
          });
          break;

        case 'publish_blob':
          let tempFile;

          if (data.payload) {
            // Enriched blob (JSON)
            tempFile = path.join(__dirname, `temp_${Date.now()}.json`);
            fs.writeFileSync(tempFile, JSON.stringify(data.payload));
            console.log(`Saved temp JSON payload to ${tempFile}`);
          } else if (data.image) {
            // Legacy blob (Image only)
            const base64Data = data.image.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            tempFile = path.join(__dirname, `temp_${Date.now()}.jpg`);
            fs.writeFileSync(tempFile, buffer);
            console.log(`Saved temp image to ${tempFile}`);
          } else {
            ws.send(JSON.stringify({ type: 'blob_error', message: 'No image or payload provided' }));
            return;
          }

          // Try direct command first
          let command = `linera publish-data-blob "${tempFile}"`;

          const tryPublish = (cmd, onError) => {
            exec(cmd, (error, stdout, stderr) => {
              // Clean up temp file
              try { fs.unlinkSync(tempFile); } catch (e) { }

              if (error) {
                console.error(`Command failed: ${cmd}`);
                console.error(`Error: ${error.message}`);
                if (onError) {
                  onError();
                } else {
                  ws.send(JSON.stringify({ type: 'blob_error', message: 'Failed to publish blob' }));
                }
                return;
              }

              const match = stdout.match(/([a-f0-9]{64})/);
              if (match) {
                const hash = match[1];
                console.log(`Blob published: ${hash}`);
                ws.send(JSON.stringify({ type: 'blob_published', hash: hash }));

                // AUTO-SAVE HISTORY FOR ALL USERS IN THE ROOM
                if (currentRoom && rooms.has(currentRoom)) {
                  const roomMembers = rooms.get(currentRoom);
                  console.log(`Auto-saving history to ${roomMembers.size} room members for blob ${hash}`);

                  const stmt = db.prepare(`INSERT INTO history (user_id, room_id, blob_hash) VALUES (?, ?, ?)`);
                  roomMembers.forEach((userInfo, memberWs) => {
                    if (userInfo.userId) {
                      console.log(`Saving blob ${hash.slice(0, 8)}... for user ${userInfo.userId} in room ${currentRoom.slice(0, 8)}...`);
                      stmt.run(userInfo.userId, currentRoom, hash);
                    } else {
                      console.log(`Skipping user without userId (clientId: ${userInfo.clientId})`);
                    }
                  });
                  stmt.finalize();
                  console.log(`History auto-saved for room ${currentRoom.slice(0, 8)}...`);
                } else {
                  console.log(`Warning: No room found for auto-save. currentRoom=${currentRoom}`);
                }
              } else {
                console.error('Could not parse hash from output:', stdout);
                ws.send(JSON.stringify({ type: 'blob_error', message: 'Could not parse blob hash' }));
              }
            });
          };

          // Try direct command first
          console.log(`Trying direct command: ${command}`);
          tryPublish(command, () => {
            // Fallback to WSL if direct command fails
            const isWindows = process.platform === 'win32';
            if (isWindows) {
              console.log('Direct command failed, trying WSL...');
              // Re-create temp file since it was deleted
              if (data.payload) {
                tempFile = path.join(__dirname, `temp_${Date.now()}.json`);
                fs.writeFileSync(tempFile, JSON.stringify(data.payload));
              } else if (data.image) {
                const base64Data = data.image.replace(/^data:image\/\w+;base64,/, "");
                const buffer = Buffer.from(base64Data, 'base64');
                tempFile = path.join(__dirname, `temp_${Date.now()}.jpg`);
                fs.writeFileSync(tempFile, buffer);
              }

              // Convert to WSL path
              let wslPath = tempFile.replace(/\\/g, '/');
              if (wslPath.match(/^[a-zA-Z]:/)) {
                wslPath = `/mnt/${wslPath[0].toLowerCase()}${wslPath.slice(2)}`;
              }
              const wslCommand = `wsl ~/.cargo/bin/linera publish-data-blob "${wslPath}"`;
              console.log(`Trying WSL command: ${wslCommand}`);
              tryPublish(wslCommand, null);
            }
          });
          break;

        case 'save_history':
          console.log('Received save_history request:', JSON.stringify(data));
          if (data.userId && data.roomId && data.blobHashes && Array.isArray(data.blobHashes)) {
            const stmt = db.prepare(`INSERT INTO history (user_id, room_id, blob_hash) VALUES (?, ?, ?)`);
            data.blobHashes.forEach(hash => {
              console.log(`Saving hash ${hash} for user ${data.userId} in room ${data.roomId}`);
              stmt.run(data.userId, data.roomId, hash);
            });
            stmt.finalize();
            console.log(`Saved ${data.blobHashes.length} history items for user ${data.userId}`);
          } else {
            console.error('Invalid save_history data:', data);
          }
          break;

        case 'get_history':
          db.all(`
            SELECT h.blob_hash, h.timestamp, h.room_id 
            FROM history h 
            JOIN users u ON h.user_id = u.id 
            WHERE u.nickname = ? 
            ORDER BY h.timestamp DESC
          `, [data.nickname], (err, rows) => {
            if (err) {
              ws.send(JSON.stringify({ type: 'history_error', message: 'Failed to fetch history' }));
            } else {
              ws.send(JSON.stringify({
                type: 'history_result',
                nickname: data.nickname,
                history: rows
              }));
            }
          });
          break;

        case 'join':
          currentRoom = data.roomId;
          clientId = data.clientId;
          userId = data.userId || null; // Accept userId from join message

          if (!rooms.has(currentRoom)) {
            rooms.set(currentRoom, new Map()); // Change to Map to store user info
          }

          // Store connection with user info
          rooms.get(currentRoom).set(ws, { clientId, userId });
          console.log(`Client ${clientId} (userId: ${userId}) joined room ${currentRoom}`);

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

            clients.forEach((userInfo, client) => {
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

            clients.forEach((userInfo, client) => {
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

            clients.forEach((userInfo, client) => {
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

            clients.forEach((userInfo, client) => {
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

            clients.forEach((userInfo, client) => {
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