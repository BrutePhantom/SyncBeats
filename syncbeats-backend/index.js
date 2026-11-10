const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const prisma = new PrismaClient();

// Memory store for live room playback state
const roomStates = {};

// Create room via Prisma
app.post('/api/create-room', async (req, res) => {
    const code = Math.random().toString(36).substring(2, 6).toUpperCase();
    try {
        const room = await prisma.room.create({ data: { code } });
        res.json({ success: true, room });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Socket.io Real-time events
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join-room', ({ roomCode }) => {
        socket.join(roomCode);
        console.log(`Socket ${socket.id} joined room ${roomCode}`);

        if (roomStates[roomCode]) {
            socket.emit('sync-state', roomStates[roomCode]);
        }
    });

    socket.on('audio-action', ({ roomCode, action, currentTime }) => {
        roomStates[roomCode] = { action, currentTime, updatedAt: Date.now() };
        socket.to(roomCode).emit('sync-action', { action, currentTime });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

server.listen(5000, () => {
    console.log('Backend server running on http://localhost:5000');
});