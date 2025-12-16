const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", // This lets your GitHub Game connect to this server
    methods: ["GET", "POST"]
  }
});

let players = {};

io.on('connection', (socket) => {
  console.log('New spider connected: ' + socket.id);

  // 1. Create a new player record
  players[socket.id] = {
    x: 0,
    y: 0,
    rotation: 0,
    playerId: socket.id
  };

  // 2. Send the current list of players to the NEW guy
  socket.emit('currentPlayers', players);

  // 3. Tell EVERYONE ELSE that a new guy joined
  socket.broadcast.emit('newPlayer', players[socket.id]);

  // 4. Listen for movement
  socket.on('playerMovement', (movementData) => {
    players[socket.id].x = movementData.x;
    players[socket.id].y = movementData.y;
    players[socket.id].rotation = movementData.rotation;
    
    // Tell everyone else this player moved
    socket.broadcast.emit('playerMoved', players[socket.id]);
  });

  // 5. Handle disconnect
  socket.on('disconnect', () => {
    console.log('Spider disconnected: ' + socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
