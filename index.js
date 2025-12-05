const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// CORS configuration
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json());

// Basic route
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Socket.io connection
const queues = {
  video: [],
  text: []
};

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  let currentRoom = null;
  let currentType = null;

  socket.on('find_match', ({ type, interest }) => {
    // Basic matching logic: just pair with the next person in the queue of the same type
    // In a real app, you'd filter by interest here
    
    const queue = queues[type];
    
    if (queue.length > 0) {
      // Found a partner
      const partner = queue.pop();
      const roomID = `${socket.id}#${partner.id}`;
      
      socket.join(roomID);
      partner.socket.join(roomID);
      
      currentRoom = roomID;
      currentType = type;
      
      // Notify both users
      socket.emit('match_found', { partnerId: partner.id, initiator: true });
      partner.socket.emit('match_found', { partnerId: socket.id, initiator: false });
      
      console.log(`Matched ${socket.id} with ${partner.id} in room ${roomID}`);
    } else {
      // No partner found, add to queue
      queue.push({ id: socket.id, socket, interest });
      console.log(`Added ${socket.id} to ${type} queue`);
    }
  });

  socket.on('offer', (data) => {
    socket.to(data.target).emit('offer', {
      sdp: data.sdp,
      caller: socket.id
    });
  });

  socket.on('answer', (data) => {
    socket.to(data.target).emit('answer', {
      sdp: data.sdp,
      responder: socket.id
    });
  });

  socket.on('ice_candidate', (data) => {
    socket.to(data.target).emit('ice_candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  socket.on('send_message', (data) => {
    // Send to the specific target user instead of a room broadcast if possible, 
    // or use the room if we tracked it properly. 
    // Since the frontend sends 'target', we can use socket.to(target)
    if (data.target) {
      socket.to(data.target).emit('receive_message', {
        text: data.text,
        sender: socket.id,
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('skip', () => {
    // Leave current room if any
    if (currentRoom) {
      socket.to(currentRoom).emit('partner_disconnected');
      socket.leave(currentRoom);
      currentRoom = null;
    }
    
    // Remove from queue if currently waiting
    ['video', 'text'].forEach(type => {
      const index = queues[type].findIndex(u => u.id === socket.id);
      if (index !== -1) {
        queues[type].splice(index, 1);
      }
    });

    // Re-trigger find match logic from client side or handle here?
    // Client will emit 'find_match' again after skip.
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Notify partner
    if (currentRoom) {
      socket.to(currentRoom).emit('partner_disconnected');
    }

    // Remove from queues
    ['video', 'text'].forEach(type => {
      const index = queues[type].findIndex(u => u.id === socket.id);
      if (index !== -1) {
        queues[type].splice(index, 1);
      }
    });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Socket.io server ready`);
});