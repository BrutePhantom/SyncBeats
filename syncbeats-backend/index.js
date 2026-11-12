const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

// DO NOT HARDCODE ANY reference based key like IP or PORT or anything. Just use process.env

const app = express();
app.use(cors());
app.use(express.json());

// Serve static songs if placed in public/songs
app.use('/songs', express.static(path.join(__dirname, 'public/songs')));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const prisma = new PrismaClient();

// Memory store for live room playback state
const roomStates = {};
const roomHosts = {};
const roomSongs = {};

// Health check / info route
app.get('/', (req, res) => {
    res.json({ status: 'ok', name: 'Syncbeats Backend', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Song Library APIs
app.get('/api/songs', async (req, res) => {
    try {
        const songs = await prisma.song.findMany({
            orderBy: { createdAt: 'asc' }
        });
        res.json({ success: true, songs });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/songs/:id', async (req, res) => {
    try {
        const song = await prisma.song.findUnique({
            where: { id: req.params.id }
        });
        if (!song) {
            return res.status(404).json({ success: false, error: 'Song not found' });
        }
        res.json({ success: true, song });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create room via Prisma (accepts optional songId)
app.post('/api/create-room', async (req, res) => {
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    const { songId } = req.body || {};

    try {
        let song = null;
        if (songId) {
            song = await prisma.song.findUnique({ where: { id: songId } });
        }
        if (!song) {
            // Default to the first song in library if available
            song = await prisma.song.findFirst({ orderBy: { createdAt: 'asc' } });
        }

        const room = await prisma.room.create({
            data: {
                code,
                currentSongId: song ? song.id : null
            },
            include: { currentSong: true }
        });

        if (song) {
            roomSongs[code] = song;
        }

        res.json({ success: true, room });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Socket.io Real-time events
io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join-room', async ({ roomCode }) => {
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

        // Resolve current song for this room
        let currentSong = roomSongs[cleanRoomCode];
        if (!currentSong) {
            try {
                const dbRoom = await prisma.room.findUnique({
                    where: { code: cleanRoomCode },
                    include: { currentSong: true }
                });
                if (dbRoom && dbRoom.currentSong) {
                    currentSong = dbRoom.currentSong;
                    roomSongs[cleanRoomCode] = currentSong;
                } else {
                    currentSong = await prisma.song.findFirst({ orderBy: { createdAt: 'asc' } });
                    if (currentSong) {
                        roomSongs[cleanRoomCode] = currentSong;
                    }
                }
            } catch (e) {
                console.error('Error fetching room song:', e);
            }
        }

        if (currentSong) {
            socket.emit('room-song', currentSong);
        }

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

    socket.on('change-song', async ({ roomCode, songId }) => {
        const cleanRoomCode = String(roomCode || '').trim().toUpperCase();

        if (!socket.rooms.has(cleanRoomCode) || roomHosts[cleanRoomCode] !== socket.id) {
            socket.emit('control-denied', { message: 'Only the room host can change the song.' });
            return;
        }

        try {
            const song = await prisma.song.findUnique({ where: { id: songId } });
            if (!song) {
                socket.emit('room-error', { message: 'Selected song was not found.' });
                return;
            }

            await prisma.room.update({
                where: { code: cleanRoomCode },
                data: { currentSongId: song.id }
            }).catch(() => {});

            roomSongs[cleanRoomCode] = song;
            roomStates[cleanRoomCode] = { action: 'pause', currentTime: 0, updatedAt: Date.now() };

            io.to(cleanRoomCode).emit('song-changed', {
                song,
                action: 'pause',
                currentTime: 0
            });
        } catch (err) {
            socket.emit('room-error', { message: 'Failed to change song.' });
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
            delete roomSongs[cleanRoomCode];
            socket.to(cleanRoomCode).emit('host-left');
        }
    });

    socket.on('disconnecting', () => {
        socket.rooms.forEach((roomCode) => {
            if (roomCode !== socket.id && roomHosts[roomCode] === socket.id) {
                delete roomHosts[roomCode];
                delete roomStates[roomCode];
                delete roomSongs[roomCode];
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
