import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cookieParser from 'cookie-parser';
import winston from 'winston';

import { Board } from './game/board.js';
import { Player } from './game/player.js';
import { Deck } from './game/deck.js';
import { Card } from './game/card.js';

// Load environment variables
dotenv.config();

// Dev mode state
let devModeEnabled = false;
const DEV_PLAYER_IDS = ['dev-player-1', 'dev-player-2', 'dev-player-3', 'dev-player-4'];
const DEV_PLAYER_NAMES = ['Player 1 (Red)', 'Player 2 (Blue)', 'Player 3 (Green)', 'Player 4 (Yellow)'];

// Set up logger
const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.simple()
  ),
  transports: [
    new winston.transports.File({ filename: 'app.log' }),
    new winston.transports.Console()
  ],
});

// Initialize Express app
const app = express();
app.set('trust proxy', 1);

// Create HTTP server
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static('public'));

// --- Dev Mode API ---

// Enable dev mode endpoint
app.post('/api/dev-mode/enable', (req, res) => {
  if (devModeEnabled) {
    return res.json({ success: true, message: 'Dev mode already enabled' });
  }
  
  // Reset the game state for dev mode
  devModeEnabled = true;
  
  // Clear existing players
  Object.keys(players).forEach(key => delete players[key]);
  turnOrder.length = 0;
  currentTurn = 0;
  
  // Re-initialize deck
  deck.cards = [];
  deck.discards = [];
  const colours = [0, 1, 2, 3]; // Colour enum values
  for (const colour of colours) {
    for (let value = 1; value <= 13; value++) {
      deck.cards.push(new Card(colour, value));
    }
  }
  deck.shuffle();
  
  // Create 4 dev players
  DEV_PLAYER_IDS.forEach((id, index) => {
    players[id] = new Player(id, DEV_PLAYER_NAMES[index]);
    players[id].hand = deck.deal(5);
    turnOrder.push(id);
  });
  
  logger.info('Dev mode enabled with 4 players');
  
  // Emit updated state to all connected clients
  io.emit('devModeEnabled', {
    players: Object.fromEntries(
      Object.entries(players).map(([id, player]) => [
        id,
        {
          name: player.name,
          coins: player.coins,
          hand: player.hand
        }
      ])
    ),
    turnOrder,
    currentPlayer: turnOrder[currentTurn]
  });
  
  res.json({ 
    success: true, 
    players: DEV_PLAYER_IDS.map((id, i) => ({ id, name: DEV_PLAYER_NAMES[i] })),
    currentPlayer: turnOrder[currentTurn]
  });
});

// Disable dev mode endpoint
app.post('/api/dev-mode/disable', (req, res) => {
  devModeEnabled = false;
  
  // Clear dev players
  DEV_PLAYER_IDS.forEach(id => {
    delete players[id];
    const index = turnOrder.indexOf(id);
    if (index !== -1) {
      turnOrder.splice(index, 1);
    }
  });
  
  if (currentTurn >= turnOrder.length) {
    currentTurn = 0;
  }
  
  logger.info('Dev mode disabled');
  io.emit('devModeDisabled');
  
  res.json({ success: true });
});

// Get dev mode status
app.get('/api/dev-mode/status', (req, res) => {
  res.json({ 
    enabled: devModeEnabled,
    players: devModeEnabled ? DEV_PLAYER_IDS.map((id, i) => ({ 
      id, 
      name: DEV_PLAYER_NAMES[i],
      coins: players[id]?.coins || 0,
      handSize: players[id]?.hand.length || 0
    })) : [],
    currentPlayer: turnOrder[currentTurn] || null
  });
});

// Get a dev player's hand (for dev mode only)
app.get('/api/dev-mode/player/:playerId/hand', (req, res) => {
  if (!devModeEnabled) {
    return res.status(403).json({ error: 'Dev mode not enabled' });
  }
  
  const playerId = req.params.playerId;
  const player = players[playerId];
  
  if (!player) {
    return res.status(404).json({ error: 'Player not found' });
  }
  
  res.json({ hand: player.hand });
});

// --- Game logic ---

// Initialize board, players, and deck
const board = new Board();
const players: Record<string, Player> = {}; // Store players by their socket ID
const deck = new Deck();
deck.shuffle();

let currentTurn = 0; // Index of the current player's turn
const turnOrder: string[] = []; // Array to maintain the turn order

// Error handling middleware
app.use((req, res, next) => {
  res.status(404).sendFile('index.html', { root: 'public' });
});

io.on('connection', (socket) => {
  logger.info(`A user connected: ${socket.id}`);

  // In dev mode, don't create a new player for connecting clients
  if (!devModeEnabled) {
    // Initialize player
    players[socket.id] = new Player(socket.id, `Player-${socket.id}`);

    // Add player to turn order
    turnOrder.push(socket.id);

    // Send initial hand
    const initialCards = deck.deal(5);
    players[socket.id].hand = initialCards;
    socket.emit('updateHand', initialCards);
  }
  
  // Send current board state
  socket.emit('updateBoard', board.grid);

// Emit turn information to all players
  const emitTurnInfo = () => {
    const turnInfoData = {
      currentPlayer: turnOrder[currentTurn],
      turnOrder,
      players: Object.fromEntries(
        Object.entries(players).map(([id, player]) => [
          id,
          {
            name: player.name,
            coins: player.coins,
            handSize: player.hand.length,
            hand: devModeEnabled ? player.hand : undefined // Include hands in dev mode
          }
        ])
      ),
      devMode: devModeEnabled
    };
    io.emit('turnInfo', turnInfoData);
  };

  // Send dev mode state on connect
  if (devModeEnabled) {
    socket.emit('devModeEnabled', {
      players: Object.fromEntries(
        Object.entries(players).map(([id, player]) => [
          id,
          {
            name: player.name,
            coins: player.coins,
            hand: player.hand
          }
        ])
      ),
      turnOrder,
      currentPlayer: turnOrder[currentTurn]
    });
  }

  // Handle end of turn
  socket.on('endTurn', () => {
    if (socket.id === turnOrder[currentTurn]) {
      currentTurn = (currentTurn + 1) % turnOrder.length;
      emitTurnInfo();
    } else {
      socket.emit('error', 'Not your turn');
    }
  });

  // Dev mode: End turn for a specific player
  socket.on('devEndTurn', ({ playerId }: { playerId: string }) => {
    if (!devModeEnabled) {
      socket.emit('error', 'Dev mode not enabled');
      return;
    }
    if (playerId === turnOrder[currentTurn]) {
      currentTurn = (currentTurn + 1) % turnOrder.length;
      emitTurnInfo();
    } else {
      socket.emit('error', 'Not this player\'s turn');
    }
  });

  // Handle tile click to show state and combat options
  socket.on('clickTile', ({ x, y }: { x: number, y: number }) => {
    const tile = board.grid[x]?.[y];
    if (tile) {
      const combatants = turnOrder.map((playerId) => {
        const player = players[playerId];
        return {
          playerId,
          hand: player.hand,
        };
      });
      socket.emit('tileInfo', { tile, combatants });
    } else {
      socket.emit('tileInfo', { tile: null });
    }
  });

  socket.on('placeCard', ({ x, y, cardIndex }: { x: number, y: number, cardIndex: number }) => {
    if (socket.id === turnOrder[currentTurn]) {
      const player = players[socket.id];
      const card = player.hand[cardIndex];
      if (card && board.placeCard(x, y, card, player.id as string)) {
        player.hand.splice(cardIndex, 1); // Remove card from hand
        io.emit('updateBoard', board.grid);
      } else {
        socket.emit('error', 'Invalid placement');
      }
    } else {
      socket.emit('error', 'Not your turn');
    }
  });

  // Dev mode: Place card for a specific player
  socket.on('devPlaceCard', ({ playerId, x, y, cardIndex }: { playerId: string, x: number, y: number, cardIndex: number }) => {
    if (!devModeEnabled) {
      socket.emit('error', 'Dev mode not enabled');
      return;
    }
    if (playerId !== turnOrder[currentTurn]) {
      socket.emit('error', 'Not this player\'s turn');
      return;
    }
    const player = players[playerId];
    if (!player) {
      socket.emit('error', 'Player not found');
      return;
    }
    const card = player.hand[cardIndex];
    if (card && board.placeCard(x, y, card, player.id as string)) {
      player.hand.splice(cardIndex, 1); // Remove card from hand
      io.emit('updateBoard', board.grid);
      emitTurnInfo(); // Update all clients with new hand info
    } else {
      socket.emit('error', 'Invalid placement');
    }
  });

  socket.on('moveUnit', ({ fromX, fromY, toX, toY }: { fromX: number, fromY: number, toX: number, toY: number }) => {
    if (socket.id === turnOrder[currentTurn]) {
      const player = players[socket.id];
      if (board.moveUnit(fromX, fromY, toX, toY, player.id as string)) {
        io.emit('updateBoard', board.grid);
      } else {
        socket.emit('error', 'Invalid move');
      }
    } else {
      socket.emit('error', 'Not your turn');
    }
  });

  // Dev mode: Move unit for a specific player
  socket.on('devMoveUnit', ({ playerId, fromX, fromY, toX, toY }: { playerId: string, fromX: number, fromY: number, toX: number, toY: number }) => {
    if (!devModeEnabled) {
      socket.emit('error', 'Dev mode not enabled');
      return;
    }
    if (playerId !== turnOrder[currentTurn]) {
      socket.emit('error', 'Not this player\'s turn');
      return;
    }
    const player = players[playerId];
    if (!player) {
      socket.emit('error', 'Player not found');
      return;
    }
    if (board.moveUnit(fromX, fromY, toX, toY, player.id as string)) {
      io.emit('updateBoard', board.grid);
    } else {
      socket.emit('error', 'Invalid move');
    }
  });

  socket.on('buyCard', () => {
    if (socket.id === turnOrder[currentTurn]) {
      const player = players[socket.id];
      const card = player.buyCard(deck);
      if (card) {
        socket.emit('updateHand', player.hand);
      } else {
        socket.emit('error', 'Not enough coins');
      }
    } else {
      socket.emit('error', 'Not your turn');
    }
  });

  // Dev mode: Buy card for a specific player
  socket.on('devBuyCard', ({ playerId }: { playerId: string }) => {
    if (!devModeEnabled) {
      socket.emit('error', 'Dev mode not enabled');
      return;
    }
    if (playerId !== turnOrder[currentTurn]) {
      socket.emit('error', 'Not this player\'s turn');
      return;
    }
    const player = players[playerId];
    if (!player) {
      socket.emit('error', 'Player not found');
      return;
    }
    const card = player.buyCard(deck);
    if (card) {
      emitTurnInfo(); // Update all clients with new hand info
    } else {
      socket.emit('error', 'Not enough coins');
    }
  });

  socket.on('disconnect', () => {
    logger.info(`A user disconnected: ${socket.id}`);
    
    // In dev mode, don't remove dev players when socket disconnects
    if (!devModeEnabled) {
      delete players[socket.id];

      // Remove player from turn order
      const index = turnOrder.indexOf(socket.id);
      if (index !== -1) {
        turnOrder.splice(index, 1);
        if (currentTurn >= turnOrder.length) {
          currentTurn = 0;
        }
        emitTurnInfo();
      }
    }
  });

  // Emit initial turn info
  emitTurnInfo();
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Game server is running on http://localhost:${PORT}`);
});