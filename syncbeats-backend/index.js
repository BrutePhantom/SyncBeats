const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

//DO NOT HARDCODE ANY refrence based key like IP or PORT or anything please . just use process.env


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

// Health check / info route
app.get('/', (req, res) => {
    res.json({ status: 'ok', name: 'Syncbeats Backend', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Create room via Prisma
app.post('/api/create-room', async (req, res) => {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
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
            const state = roomStates[cleanRoomCode];
            let currentPlaybackTime = state.currentTime;
            if (state.action === 'play') {
                const elapsed = (Date.now() - state.updatedAt) / 1000;
                currentPlaybackTime += elapsed;
            }
            socket.emit('sync-state', {
                action: state.action,
                currentTime: currentPlaybackTime
            });
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

    socket.on('leave-room', ({ roomCode }) => {
        const cleanRoomCode = String(roomCode || '').trim().toUpperCase();
        if (!cleanRoomCode) return;

        socket.leave(cleanRoomCode);

        if (roomHosts[cleanRoomCode] === socket.id) {
            delete roomHosts[cleanRoomCode];
            delete roomStates[cleanRoomCode];
            socket.to(cleanRoomCode).emit('host-left');
        }
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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
