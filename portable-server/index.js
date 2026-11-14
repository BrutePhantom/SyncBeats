const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

// DO NOT HARDCODE ANY reference based key like IP or PORT or anything. Just use process.env

const app = express();
app.use(cors());
app.use(express.json());

// Songs folder: store and serve local MP3 files
const songsDir = process.env.SONGS_DIR || path.join(__dirname, 'public/songs');
if (!fs.existsSync(songsDir)) {
    fs.mkdirSync(songsDir, { recursive: true });
}
app.use('/songs', express.static(songsDir));

const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

const prisma = new PrismaClient();

// Memory store for live room playback state
const roomStates = {};
const roomHosts = {};
const roomSongs = {};

// ─── Helpers for Song Auto-Sync & Dynamic URLs ──────────────────────────────

function parseSongMetadata(filename) {
    const base = filename.replace(/\.(mp3|wav|ogg|m4a|aac|flac)$/i, '');

    // Format: "Artist - Title.mp3"
    if (base.includes(' - ')) {
        const parts = base.split(' - ');
        const artist = parts[0].trim();
        const title = parts.slice(1).join(' - ').trim();
        return {
            title: title || base,
            artist: artist || 'Unknown Artist'
        };
    }

    // Format: "SoundHelix-Song-X.mp3"
    if (base.startsWith('SoundHelix-Song-')) {
        const num = base.replace('SoundHelix-Song-', '');
        return {
            title: `SoundHelix Song ${num}`,
            artist: 'T. Schürger'
        };
    }

    // Default: Clean up hyphens and underscores
    const cleaned = base.replace(/[-_]+/g, ' ').trim();
    return {
        title: cleaned || filename,
        artist: 'Local Library'
    };
}

// Scans songs directory and syncs all MP3 files into the Prisma database
async function syncSongsFromFolder() {
    try {
        if (!fs.existsSync(songsDir)) return;

        const files = fs.readdirSync(songsDir).filter((file) =>
            /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file)
        );

        for (const filename of files) {
            const filePath = path.join(songsDir, filename);
            const stats = fs.statSync(filePath);
            const relativeUrl = `/songs/${encodeURIComponent(filename)}`;
            const { title, artist } = parseSongMetadata(filename);

            // Estimate duration in seconds (~192 kbps bitrate)
            const estimatedDuration = Math.max(30, Math.round(stats.size / 24000));

            const existing = await prisma.song.findFirst({
                where: {
                    OR: [
                        { fileUrl: { contains: encodeURIComponent(filename) } },
                        { fileUrl: { contains: filename } },
                        { title: title }
                    ]
                }
            });

            if (!existing) {
                await prisma.song.create({
                    data: {
                        title,
                        artist,
                        duration: estimatedDuration,
                        fileUrl: relativeUrl,
                        coverUrl: null
                    }
                });
                console.log(`[Song Library] Added from folder: "${title}" (${artist})`);
            } else if (existing.fileUrl.startsWith('http')) {
                // If previously pointing to external URL, update to local folder path
                await prisma.song.update({
                    where: { id: existing.id },
                    data: { fileUrl: relativeUrl }
                });
                console.log(`[Song Library] Swapped remote URL with local MP3 for: "${title}"`);
            }
        }
    } catch (err) {
        console.error('[Song Library] Folder sync error:', err.message);
    }
}

// Dynamically formats fileUrl into a fully-qualified URL for Express requests
function formatSongWithHost(song, req) {
    if (!song) return null;
    let fileUrl = song.fileUrl;
    if (fileUrl && !fileUrl.startsWith('http://') && !fileUrl.startsWith('https://')) {
        const protocol = req ? (req.headers['x-forwarded-proto'] || req.protocol) : 'http';
        const host = req ? req.get('host') : (process.env.BACKEND_HOST || `localhost:${PORT}`);
        fileUrl = `${protocol}://${host}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
    }
    return { ...song, fileUrl };
}

// Dynamically formats fileUrl into a fully-qualified URL for Socket.io events
function formatSongForSocket(song, socket) {
    if (!song) return null;
    let fileUrl = song.fileUrl;
    if (fileUrl && !fileUrl.startsWith('http://') && !fileUrl.startsWith('https://')) {
        const host = socket?.handshake?.headers?.host || (process.env.BACKEND_HOST || `localhost:${PORT}`);
        fileUrl = `http://${host}${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
    }
    return { ...song, fileUrl };
}

// Watch songs folder for when the host drops in new MP3 files
let syncDebounceTimer = null;
try {
    fs.watch(songsDir, (eventType, filename) => {
        if (filename && /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(filename)) {
            if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
            syncDebounceTimer = setTimeout(async () => {
                console.log(`[Folder Watcher] File event "${eventType}" on ${filename}. Updating database...`);
                await syncSongsFromFolder();
                const rawSongs = await prisma.song.findMany({ orderBy: { createdAt: 'asc' } });
                io.emit('songs-updated', rawSongs);
            }, 1000);
        }
    });
} catch (watchErr) {
    console.warn('[Folder Watcher] Notice:', watchErr.message);
}

// Initial sync on startup
syncSongsFromFolder();

// ─── HTTP Endpoints ────────────────────────────────────────────────────────

app.get('/', (req, res) => {
    res.json({ status: 'ok', name: 'Syncbeats Backend', timestamp: new Date().toISOString() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Song Library APIs
app.get('/api/songs', async (req, res) => {
    try {
        await syncSongsFromFolder();
        const rawSongs = await prisma.song.findMany({
            orderBy: { createdAt: 'asc' }
        });
        const songs = rawSongs.map((s) => formatSongWithHost(s, req));
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
        res.json({ success: true, song: formatSongWithHost(song, req) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Manual sync trigger
app.post('/api/songs/sync', async (req, res) => {
    try {
        await syncSongsFromFolder();
        const rawSongs = await prisma.song.findMany({
            orderBy: { createdAt: 'asc' }
        });
        const songs = rawSongs.map((s) => formatSongWithHost(s, req));
        io.emit('songs-updated', rawSongs);
        res.json({ success: true, count: songs.length, songs });
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

        const formattedRoom = {
            ...room,
            currentSong: formatSongWithHost(room.currentSong, req)
        };

        res.json({ success: true, room: formattedRoom });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Socket.io Real-time events ───────────────────────────────────────────

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
            socket.emit('room-song', formatSongForSocket(currentSong, socket));
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
                song: formatSongForSocket(song, socket),
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
    console.log(`Songs folder: ${songsDir}`);
});
