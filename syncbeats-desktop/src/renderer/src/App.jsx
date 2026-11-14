import { useState, useEffect, useRef, useCallback } from 'react'
import io from 'socket.io-client'

const BACKEND_URL =
  (typeof process !== 'undefined' && process.env?.VITE_BACKEND_URL) ||
  import.meta.env.VITE_BACKEND_URL ||
  'http://localhost:5000'

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
  const [copied, setCopied] = useState(false)

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
      // Backend might still be starting or unreachable
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

  const handleCopyCode = () => {
    if (!roomCode) return
    navigator.clipboard.writeText(roomCode.toUpperCase())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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

  const isConnected = statusText.startsWith('Connected')

  return (
    <div className="app-container">
      {/* Top Header Bar */}
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-icon-wrapper">🎧</div>
          <div>
            <h1 className="brand-title">Syncbeats</h1>
            <p className="brand-subtitle">Synchronized Audio Listening</p>
          </div>
        </div>

        <div className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
          <span className="status-dot" />
          <span>{statusText}</span>
        </div>
      </header>

      {/* Error Notification */}
      {errorMessage ? (
        <div className="alert-error">
          <span>⚠️ {errorMessage}</span>
          <button
            onClick={() => setErrorMessage('')}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#fca5a5',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            ✕
          </button>
        </div>
      ) : null}

      {!joined ? (
        /* Lobby View */
        <main className="lobby-grid">
          {/* Card 1: Host a Session */}
          <section className="dark-card">
            <div className="card-title-row">
              <span style={{ fontSize: '20px' }}>🎶</span>
              <h2 className="card-title">Host a Room</h2>
            </div>
            <p className="card-desc">
              Select a track from the library. Followers who join will download it to temporary
              cache and listen in sync.
            </p>

            <div className="song-list">
              {songs.length === 0 ? (
                <div
                  style={{
                    color: 'var(--text-muted)',
                    fontSize: '13px',
                    padding: '24px 0',
                    textAlign: 'center'
                  }}
                >
                  <p style={{ margin: '0 0 10px' }}>No songs found in catalog.</p>
                  <button onClick={fetchSongs} className="btn btn-secondary btn-sm">
                    🔄 Refresh Library
                  </button>
                </div>
              ) : (
                songs.map((song) => {
                  const isSelected = selectedSongId === song.id
                  return (
                    <div
                      key={song.id}
                      onClick={() => setSelectedSongId(song.id)}
                      className={`song-item ${isSelected ? 'selected' : ''}`}
                    >
                      <div className="song-info">
                        <span className="song-icon">{isSelected ? '▶' : '🎵'}</span>
                        <div>
                          <div className="song-title">{song.title}</div>
                          <div className="song-artist">{song.artist}</div>
                        </div>
                      </div>
                      <span className="song-duration">{formatDuration(song.duration)}</span>
                    </div>
                  )
                })
              )}
            </div>

            <button
              onClick={handleCreateRoom}
              disabled={songs.length === 0}
              className="btn btn-primary"
              style={{ marginTop: '18px' }}
            >
              🚀 Create Room & Host
            </button>
          </section>

          {/* Card 2: Join Existing Room */}
          <section className="dark-card" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="card-title-row">
                <span style={{ fontSize: '20px' }}>👥</span>
                <h2 className="card-title">Join a Room</h2>
              </div>
              <p className="card-desc">
                Enter the room code shared by the host to join their synchronized session.
              </p>

              <input
                type="text"
                placeholder="Enter 5-digit code..."
                value={roomCode}
                maxLength={10}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                className="input-code"
              />

              <button onClick={handleJoin} className="btn btn-secondary" style={{ width: '100%' }}>
                Join Session
              </button>
            </div>

            {/* Quick feature highlights */}
            <div className="feature-box">
              <div className="feature-item">
                <span className="feature-bullet">⚡</span>
                <span>Pre-downloads tracks for zero-lag playback</span>
              </div>
              <div className="feature-item">
                <span className="feature-bullet">🔄</span>
                <span>Real-time host play/pause/seek sync</span>
              </div>
              <div className="feature-item">
                <span className="feature-bullet">📱</span>
                <span>Compatible with mobile & desktop clients</span>
              </div>
            </div>
          </section>
        </main>
      ) : (
        /* In-Room Active Session View */
        <main className="room-container">
          {/* Room Header Bar */}
          <div className="room-bar">
            <div className="room-code-tag">
              <div>
                <div className="room-code-label">Room Code</div>
                <div className="room-code-val">{roomCode.toUpperCase()}</div>
              </div>
              <button onClick={handleCopyCode} className="copy-btn">
                {copied ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              {isHost && (
                <button
                  onClick={() => setShowSongPicker(!showSongPicker)}
                  className="btn btn-secondary btn-sm"
                >
                  🎶 Change Song
                </button>
              )}
              <button onClick={handleLeave} className="btn btn-danger btn-sm">
                Leave Room
              </button>
            </div>
          </div>

          {/* Host Change Song Modal / Panel */}
          {isHost && showSongPicker && (
            <div className="picker-panel">
              <div className="picker-title">Select a new song for the room:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {songs.map((song) => {
                  const isCurrent = currentSong?.id === song.id
                  return (
                    <div
                      key={song.id}
                      onClick={() => handleChangeSong(song.id)}
                      className={`song-item ${isCurrent ? 'selected' : ''}`}
                    >
                      <div className="song-info">
                        <span className="song-icon">{isCurrent ? '▶' : '🎵'}</span>
                        <div>
                          <span className="song-title">{song.title}</span> —{' '}
                          <span className="song-artist">{song.artist}</span>
                        </div>
                      </div>
                      <span className="song-duration">{formatDuration(song.duration)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Main Player Display Card */}
          <div className="player-main-card">
            <div className="track-hero">
              <div className="album-art-fallback">🎵</div>
              <div className="track-meta">
                <h2>{currentSong ? currentSong.title : 'Loading song...'}</h2>
                <p className="track-artist-duration">
                  {currentSong
                    ? `${currentSong.artist} • ${formatDuration(currentSong.duration)}`
                    : 'Waiting for room stream...'}
                </p>

                <div className="badge-row">
                  <span className={`badge-pill ${isHost ? 'host' : 'follower'}`}>
                    {isHost ? '★ Host (Master)' : '👥 Follower (Client)'}
                  </span>
                  {audioBlobUrl ? (
                    <span className="badge-pill cached">💾 Cached in RAM</span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Download Progress Bar */}
            {isDownloading ? (
              <div className="download-card">
                <div className="download-labels">
                  <span>⏳ Pre-downloading track for synchronized playback...</span>
                  <span>{downloadProgress}%</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${downloadProgress}%` }} />
                </div>
              </div>
            ) : null}

            {/* Host Audio Controller */}
            {audioBlobUrl && isHost && !isDownloading ? (
              <audio
                ref={audioRef}
                src={audioBlobUrl}
                controls
                className="audio-player-element"
                onPlay={() => sendAudioAction('play')}
                onPause={() => sendAudioAction('pause')}
                onSeeked={() => sendAudioAction('seek')}
              >
                Your browser does not support the audio element.
              </audio>
            ) : null}

            {/* Follower Synchronized View */}
            {!isHost && !isDownloading && (
              <div className="follower-state-box">
                <span className="sync-wave-dot" />
                <span>
                  {hostLeft
                    ? '⚠️ The host has left the room. Session ended.'
                    : 'Audio synchronized with host • Playing from local temporary memory'}
                </span>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  )
}

export default App
