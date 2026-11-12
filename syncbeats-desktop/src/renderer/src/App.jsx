import { useState, useEffect, useRef, useCallback } from 'react'
import io from 'socket.io-client'

const BACKEND_URL = 'http://localhost:5000'
const socket = io(BACKEND_URL)

function App() {
  const [songs, setSongs] = useState([])
  const [selectedSongId, setSelectedSongId] = useState(null)
  const [currentSong, setCurrentSong] = useState(null)
  const [roomCode, setRoomCode] = useState('')
  const [joined, setJoined] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [hostLeft, setHostLeft] = useState(false)
  const [statusText, setStatusText] = useState('Connecting...')
  const [errorMessage, setErrorMessage] = useState('')

  // Pre-download / Blob caching state
  const [audioBlobUrl, setAudioBlobUrl] = useState('')
  const [isDownloading, setIsDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)
  const [showSongPicker, setShowSongPicker] = useState(false)

  const audioRef = useRef(null)
  const isRemoteEvent = useRef(false)
  const activeBlobUrlRef = useRef('')

  const fetchSongs = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/songs`)
      const data = await res.json()
      if (data.success && Array.isArray(data.songs)) {
        setSongs(data.songs)
        setSelectedSongId((prev) => prev || (data.songs[0] ? data.songs[0].id : null))
      }
    } catch {
      // Backend might still be starting
    }
  }, [])

  // Download track into temporary in-memory Blob URL for zero-lag local playback
  const downloadAndPrepareAudio = useCallback(async (song) => {
    if (!song || !song.fileUrl) return

    try {
      setIsDownloading(true)
      setDownloadProgress(10)

      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current)
        activeBlobUrlRef.current = ''
        setAudioBlobUrl('')
      }

      const response = await fetch(song.fileUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const contentLength = +(response.headers.get('Content-Length') || 0)
      const reader = response.body ? response.body.getReader() : null

      let blob
      if (reader && contentLength) {
        let received = 0
        const chunks = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          received += value.length
          setDownloadProgress(Math.min(99, Math.round((received / contentLength) * 100)))
        }
        blob = new Blob(chunks, { type: 'audio/mpeg' })
      } else {
        blob = await response.blob()
      }

      setDownloadProgress(100)
      const blobUrl = URL.createObjectURL(blob)
      activeBlobUrlRef.current = blobUrl
      setAudioBlobUrl(blobUrl)
      setCurrentSong(song)
      setIsDownloading(false)
    } catch (err) {
      console.warn('Pre-download failed, falling back to direct URL:', err)
      activeBlobUrlRef.current = song.fileUrl
      setAudioBlobUrl(song.fileUrl)
      setCurrentSong(song)
      setIsDownloading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSongs()
    }, 0)

    socket.on('connect', () => {
      setStatusText('Connected to Server')
      setErrorMessage('')
      fetchSongs()
    })

    socket.on('disconnect', () => {
      setStatusText('Disconnected')
    })

    socket.on('connect_error', () => {
      setStatusText('Connection error (Check backend)')
    })

    // Receive song info from the room
    socket.on('room-song', (song) => {
      downloadAndPrepareAudio(song)
    })

    // Handle song changed by host
    socket.on('song-changed', ({ song, currentTime }) => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = currentTime || 0
      }
      downloadAndPrepareAudio(song)
      setShowSongPicker(false)
    })

    // Receive play/pause/seek events from host
    socket.on('sync-action', ({ action, currentTime }) => {
      if (!audioRef.current) return
      isRemoteEvent.current = true

      audioRef.current.currentTime = currentTime

      if (action === 'play') {
        audioRef.current.play().catch(() => {})
      } else if (action === 'pause') {
        audioRef.current.pause()
      }

      setTimeout(() => {
        isRemoteEvent.current = false
      }, 250)
    })

    // Catch up late joiners
    socket.on('sync-state', ({ action, currentTime }) => {
      if (!audioRef.current) return
      audioRef.current.currentTime = currentTime
      if (action === 'play') {
        audioRef.current.play().catch(() => {})
      }
    })

    socket.on('room-role', ({ isHost: assignedHost }) => {
      setIsHost(assignedHost)
      setHostLeft(false)
      setErrorMessage('')
    })

    socket.on('host-left', () => {
      isRemoteEvent.current = true
      audioRef.current?.pause()
      setIsHost(false)
      setHostLeft(true)
      setTimeout(() => {
        isRemoteEvent.current = false
      }, 250)
    })

    socket.on('room-error', ({ message }) => {
      setErrorMessage(message)
    })

    socket.on('control-denied', ({ message }) => {
      setErrorMessage(message)
    })

    return () => {
      clearTimeout(timer)
      socket.off('connect')
      socket.off('disconnect')
      socket.off('connect_error')
      socket.off('room-song')
      socket.off('song-changed')
      socket.off('sync-action')
      socket.off('sync-state')
      socket.off('room-role')
      socket.off('host-left')
      socket.off('room-error')
      socket.off('control-denied')
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current)
      }
    }
  }, [fetchSongs, downloadAndPrepareAudio])

  // Host creates room with selected song
  const handleCreateRoom = async () => {
    try {
      setErrorMessage('')
      const res = await fetch(`${BACKEND_URL}/api/create-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: selectedSongId })
      })
      const data = await res.json()
      if (data.success && data.room) {
        const newCode = data.room.code
        setRoomCode(newCode)
        setIsHost(true)
        setHostLeft(false)
        if (data.room.currentSong) {
          downloadAndPrepareAudio(data.room.currentSong)
        }
        socket.emit('join-room', { roomCode: newCode })
        setJoined(true)
      } else {
        setErrorMessage(data.error || 'Failed to create room.')
      }
    } catch {
      setErrorMessage('Cannot reach backend server to create room.')
    }
  }

  // Join existing room
  const handleJoin = () => {
    const cleanCode = roomCode.trim().toUpperCase()
    if (!cleanCode) {
      setErrorMessage('Please enter a room code.')
      return
    }
    setErrorMessage('')
    setIsHost(false)
    setHostLeft(false)
    socket.emit('join-room', { roomCode: cleanCode })
    setJoined(true)
  }

  // Leave room & clean up local cache
  const handleLeave = () => {
    if (audioRef.current) {
      audioRef.current.pause()
    }
    socket.emit('leave-room', { roomCode: roomCode.toUpperCase() })
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current)
      activeBlobUrlRef.current = ''
      setAudioBlobUrl('')
    }
    setCurrentSong(null)
    setJoined(false)
    setIsHost(false)
    setHostLeft(false)
    setErrorMessage('')
  }

  // Host changes song during an active session
  const handleChangeSong = (songId) => {
    if (!isHost) return
    socket.emit('change-song', {
      roomCode: roomCode.toUpperCase(),
      songId
    })
  }

  const sendAudioAction = (action) => {
    if (!isHost || isRemoteEvent.current || !audioRef.current) return
    socket.emit('audio-action', {
      roomCode: roomCode.toUpperCase(),
      action,
      currentTime: audioRef.current.currentTime
    })
  }

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '30px',
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        background: '#121212',
        color: '#ffffff',
        boxSizing: 'border-box'
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '26px' }}>🎵 Syncbeats Desktop</h1>
        <span
          style={{
            fontSize: '12px',
            padding: '5px 12px',
            borderRadius: '12px',
            background: statusText.startsWith('Connected') ? '#1db95422' : '#ff444422',
            color: statusText.startsWith('Connected') ? '#1db954' : '#ff6b6b',
            border: `1px solid ${statusText.startsWith('Connected') ? '#1db954' : '#ff6b6b'}`
          }}
        >
          {statusText}
        </span>
      </div>

      {/* Error Banner */}
      {errorMessage ? (
        <div
          style={{
            marginTop: '15px',
            padding: '10px 15px',
            backgroundColor: '#ff444422',
            color: '#ff6b6b',
            borderRadius: '8px',
            border: '1px solid #ff4444'
          }}
        >
          {errorMessage}
        </div>
      ) : null}

      {!joined ? (
        /* Lobby: Choice between Creating with a Song or Joining */
        <div
          style={{
            marginTop: '30px',
            display: 'grid',
            gridTemplateColumns: '1.2fr 1fr',
            gap: '20px'
          }}
        >
          {/* Card A: Host a room with chosen song */}
          <div
            style={{
              background: '#1e1e1e',
              padding: '25px',
              borderRadius: '12px',
              border: '1px solid #2a2a2a'
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: '20px' }}>1. Select a Song & Host</h2>
            <p style={{ color: '#aaa', fontSize: '13px', marginBottom: '15px' }}>
              Choose a track from the library. Followers who join will download and listen in sync.
            </p>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                maxHeight: '220px',
                overflowY: 'auto'
              }}
            >
              {songs.length === 0 ? (
                <div style={{ color: '#666', fontSize: '14px', padding: '10px 0' }}>
                  No songs available. Ensure backend is running.
                </div>
              ) : (
                songs.map((song) => {
                  const isSelected = selectedSongId === song.id
                  return (
                    <div
                      key={song.id}
                      onClick={() => setSelectedSongId(song.id)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        background: isSelected ? '#1db95422' : '#282828',
                        border: isSelected ? '1px solid #1db954' : '1px solid transparent',
                        cursor: 'pointer'
                      }}
                    >
                      <div>
                        <div
                          style={{ fontWeight: isSelected ? 'bold' : 'normal', fontSize: '14px' }}
                        >
                          {song.title}
                        </div>
                        <div style={{ fontSize: '12px', color: '#888' }}>{song.artist}</div>
                      </div>
                      <span style={{ fontSize: '12px', color: '#aaa' }}>
                        {formatDuration(song.duration)}
                      </span>
                    </div>
                  )
                })
              )}
            </div>

            <button
              onClick={handleCreateRoom}
              disabled={songs.length === 0}
              style={{
                width: '100%',
                marginTop: '15px',
                padding: '12px',
                fontSize: '15px',
                fontWeight: 'bold',
                borderRadius: '8px',
                border: 'none',
                background: '#1db954',
                color: '#fff',
                cursor: 'pointer',
                opacity: songs.length === 0 ? 0.5 : 1
              }}
            >
              🚀 Create Room & Host
            </button>
          </div>

          {/* Card B: Join Existing Room */}
          <div
            style={{
              background: '#1e1e1e',
              padding: '25px',
              borderRadius: '12px',
              border: '1px solid #2a2a2a',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <h2 style={{ marginTop: 0, fontSize: '20px' }}>2. Join an Existing Room</h2>
              <p style={{ color: '#aaa', fontSize: '13px', marginBottom: '20px' }}>
                Enter the room code shared by the host to join their synchronized session.
              </p>

              <input
                type="text"
                placeholder="Enter Code (e.g. 15151)"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                style={{
                  width: '100%',
                  padding: '12px',
                  fontSize: '16px',
                  borderRadius: '8px',
                  border: '1px solid #333',
                  background: '#2a2a2a',
                  color: '#fff',
                  outline: 'none',
                  boxSizing: 'border-box',
                  marginBottom: '15px'
                }}
              />
            </div>

            <button
              onClick={handleJoin}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '15px',
                fontWeight: 'bold',
                borderRadius: '8px',
                border: 'none',
                background: '#333',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              Join Room
            </button>
          </div>
        </div>
      ) : (
        /* In-Room View */
        <div style={{ marginTop: '30px', maxWidth: '680px' }}>
          <div
            style={{
              padding: '25px',
              background: '#1e1e1e',
              borderRadius: '12px',
              border: '1px solid #2a2a2a'
            }}
          >
            {/* Room Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '15px'
              }}
            >
              <div>
                <span style={{ fontSize: '12px', color: '#888', textTransform: 'uppercase' }}>
                  Room Code
                </span>
                <h2 style={{ margin: 0, fontSize: '24px', letterSpacing: '1px' }}>
                  {roomCode.toUpperCase()}
                </h2>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                {isHost && (
                  <button
                    onClick={() => setShowSongPicker(!showSongPicker)}
                    style={{
                      padding: '8px 14px',
                      background: '#282828',
                      color: '#fff',
                      border: '1px solid #444',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '13px'
                    }}
                  >
                    🎶 Change Song
                  </button>
                )}
                <button
                  onClick={handleLeave}
                  style={{
                    padding: '8px 14px',
                    background: '#ff444422',
                    color: '#ff6b6b',
                    border: '1px solid #ff4444',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '13px'
                  }}
                >
                  Leave Room
                </button>
              </div>
            </div>

            {/* Change Song Modal / Panel (Host only) */}
            {isHost && showSongPicker && (
              <div
                style={{
                  marginBottom: '20px',
                  padding: '15px',
                  background: '#252525',
                  borderRadius: '8px',
                  border: '1px solid #333'
                }}
              >
                <div style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
                  Select a new song for the room:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {songs.map((song) => (
                    <div
                      key={song.id}
                      onClick={() => handleChangeSong(song.id)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: currentSong?.id === song.id ? '#1db95422' : '#303030',
                        border: currentSong?.id === song.id ? '1px solid #1db954' : 'none',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '13px'
                      }}
                    >
                      <span>
                        {song.title} — <span style={{ color: '#888' }}>{song.artist}</span>
                      </span>
                      <span style={{ color: '#aaa' }}>{formatDuration(song.duration)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Current Song Details Card */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '15px',
                padding: '15px',
                background: '#252525',
                borderRadius: '8px',
                marginBottom: '15px'
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '6px',
                  background: '#333',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '24px'
                }}
              >
                🎵
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, fontSize: '18px', color: '#fff' }}>
                  {currentSong ? currentSong.title : 'Loading song...'}
                </h3>
                <p style={{ margin: '3px 0 0 0', fontSize: '13px', color: '#aaa' }}>
                  {currentSong
                    ? `${currentSong.artist} • ${formatDuration(currentSong.duration)}`
                    : 'Waiting for host...'}
                </p>
              </div>
            </div>

            {/* Download / Caching Progress Bar */}
            {isDownloading ? (
              <div
                style={{
                  marginBottom: '15px',
                  padding: '12px',
                  background: '#252525',
                  borderRadius: '8px'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: '12px',
                    color: '#aaa',
                    marginBottom: '6px'
                  }}
                >
                  <span>⏳ Pre-downloading track for zero-lag sync...</span>
                  <span>{downloadProgress}%</span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: '6px',
                    background: '#333',
                    borderRadius: '3px',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      width: `${downloadProgress}%`,
                      height: '100%',
                      background: '#1db954',
                      transition: 'width 0.2s ease'
                    }}
                  />
                </div>
              </div>
            ) : null}

            {/* Role & Status Label */}
            <p
              style={{
                margin: '0 0 15px 0',
                fontSize: '14px',
                color: isHost ? '#1db954' : '#b3b3b3',
                fontWeight: '500'
              }}
            >
              {isHost
                ? '★ You are the host. Your playback controls the room.'
                : hostLeft
                  ? '⚠️ The host left the room. This session has ended.'
                  : '👥 Following the host. Audio is synced from temporary local cache.'}
            </p>

            {/* Audio Player (Host controls / Follower synchronized) */}
            {audioBlobUrl ? (
              <audio
                ref={audioRef}
                src={audioBlobUrl}
                controls={isHost && !isDownloading}
                style={{
                  width: '100%',
                  marginTop: '10px',
                  display: isHost && !isDownloading ? 'block' : 'none'
                }}
                onPlay={() => sendAudioAction('play')}
                onPause={() => sendAudioAction('pause')}
                onSeeked={() => sendAudioAction('seek')}
              >
                Your browser does not support the audio element.
              </audio>
            ) : null}

            {!isHost && !isDownloading && (
              <div
                style={{
                  marginTop: '15px',
                  padding: '15px',
                  background: '#252525',
                  borderRadius: '8px',
                  textAlign: 'center',
                  color: '#aaa',
                  fontSize: '14px'
                }}
              >
                {hostLeft
                  ? 'Session ended. Click "Leave Room" to join another room.'
                  : 'Audio is downloaded in temp cache and playing in sync with the host.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
