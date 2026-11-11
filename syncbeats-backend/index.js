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
const roomHosts = {};

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
        const cleanRoomCode = String(roomCode || '').trim().toUpperCase();

        if (!cleanRoomCode) {
            socket.emit('room-error', { message: 'Enter a valid room code.' });
            return;
        }

        socket.join(cleanRoomCode);

        // The first device in a room becomes its host for this session.
        if (!roomHosts[cleanRoomCode]) {
            roomHosts[cleanRoomCode] = socket.id;
        }

        const isHost = roomHosts[cleanRoomCode] === socket.id;
        socket.emit('room-role', { isHost });
        console.log(`Socket ${socket.id} joined room ${cleanRoomCode} as ${isHost ? 'host' : 'follower'}`);

        if (roomStates[cleanRoomCode]) {
            socket.emit('sync-state', roomStates[cleanRoomCode]);
        }
    });

    socket.on('audio-action', ({ roomCode, action, currentTime }) => {
        const cleanRoomCode = String(roomCode || '').trim().toUpperCase();
        const validActions = ['play', 'pause', 'seek'];

        if (!socket.rooms.has(cleanRoomCode) || roomHosts[cleanRoomCode] !== socket.id) {
            socket.emit('control-denied', { message: 'Only the room host can control playback.' });
            return;
        }

        if (!validActions.includes(action) || !Number.isFinite(currentTime) || currentTime < 0) {
            socket.emit('room-error', { message: 'Invalid playback action.' });
            return;
        }

        roomStates[cleanRoomCode] = { action, currentTime, updatedAt: Date.now() };
        socket.to(cleanRoomCode).emit('sync-action', { action, currentTime });
    });

    socket.on('disconnecting', () => {
        socket.rooms.forEach((roomCode) => {
            if (roomCode !== socket.id && roomHosts[roomCode] === socket.id) {
                delete roomHosts[roomCode];
                delete roomStates[roomCode];
                socket.to(roomCode).emit('host-left');
            }
        });
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

server.listen(5000, () => {
    console.log('Backend server running on http://localhost:5000');
});
