import { useState, useEffect, useRef, useCallback } from 'react'
import io from 'socket.io-client'

function App() {
  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem('syncbeats_server_url') || 'http://localhost:5000'
  )
  const [serverInput, setServerInput] = useState('')
  const [isScanning, setIsScanning] = useState(false)
  const [showManualIp, setShowManualIp] = useState(false)

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
  const [isSubmitting, setIsSubmitting] = useState(false)

  const audioRef = useRef(null)
  const isRemoteEvent = useRef(false)
  const activeBlobUrlRef = useRef('')
  const socketRef = useRef(null)
  const isJoiningRoomRef = useRef(false)

  // Helper to test if a given server URL responds to /health
  const probeUrl = useCallback(async (url, timeoutMs = 1200) => {
    try {
      const ctrl = new AbortController()
      const tid = setTimeout(() => ctrl.abort(), timeoutMs)
      const res = await fetch(`${url}/health`, { signal: ctrl.signal })
      clearTimeout(tid)
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'ok') return url
      }
    } catch {
      // Unreachable
    }
    return null
  }, [])

  // Auto-detect nearby Syncbeats host on the local network
  const scanForNearbyServer = useCallback(async () => {
    setIsScanning(true)
    setErrorMessage('')
    setStatusText('Scanning LAN...')

    try {
      // 1. First attempt fast Node-based scan in Electron main process
      if (window.api?.scanServers) {
        const found = await window.api.scanServers()
        if (found) {
          localStorage.setItem('syncbeats_server_url', found)
          setServerUrl(found)
          setStatusText(`Connected (${found})`)
          setIsScanning(false)
          return found
        }
      }

      // 2. Fallback in-renderer scan: collect candidate IPs from Electron preload or common prefixes
      const candidates = ['http://localhost:5000']
      try {
        const ips = await window.api?.getLocalIps?.()
        if (Array.isArray(ips)) {
          for (const ip of ips) {
            const parts = ip.split('.')
            if (parts.length === 4) {
              const prefix = `${parts[0]}.${parts[1]}.${parts[2]}`
              for (let i = 1; i <= 254; i++) {
                const candidate = `http://${prefix}.${i}:5000`
                if (!candidates.includes(candidate)) candidates.push(candidate)
              }
            }
          }
        }
      } catch {
        // Ignore IPC error
      }

      // Probe in parallel batches
      const BATCH = 15
      for (let i = 0; i < candidates.length; i += BATCH) {
        const batch = candidates.slice(i, i + BATCH)
        const results = await Promise.all(batch.map((u) => probeUrl(u, 900)))
        const found = results.find(Boolean)
        if (found) {
          localStorage.setItem('syncbeats_server_url', found)
          setServerUrl(found)
          setStatusText(`Connected (${found})`)
          setIsScanning(false)
          return found
        }
      }

      setStatusText('Not Connected')
      setErrorMessage(
        'No Syncbeats server found on this network. Please ensure the host backend is running and connected to the same Wi-Fi, or enter the host IP manually.'
      )
    } catch {
      setStatusText('Scan Failed')
      setErrorMessage('Network scan failed. Enter host IP manually.')
    } finally {
      setIsScanning(false)
    }
    return null
  }, [probeUrl])

  // On initial mount: test saved URL or automatically scan LAN
  useEffect(() => {
    let active = true

    const bootstrapConnection = async () => {
      const saved = localStorage.getItem('syncbeats_server_url')
      if (saved) {
        const ok = await probeUrl(saved, 1000)
        if (ok && active) {
          setServerUrl(saved)
          return
        }
      }
      if (active) {
        await scanForNearbyServer()
      }
    }

    bootstrapConnection()
    return () => {
      active = false
    }
  }, [probeUrl, scanForNearbyServer])

  // Rewrite localhost or relative paths from backend to the active LAN serverUrl
  const resolveAssetUrl = useCallback(
    (rawUrl) => {
      if (!rawUrl) return ''
      try {
        const parsed = new URL(rawUrl, serverUrl)
        if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
          const base = new URL(serverUrl)
          parsed.protocol = base.protocol
          parsed.hostname = base.hostname
          parsed.port = base.port
        }
        return parsed.toString()
      } catch {
        return `${serverUrl}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`
      }
    },
    [serverUrl]
  )

  const fetchSongs = useCallback(
    async (overrideUrl) => {
      const targetUrl = overrideUrl || serverUrl
      if (!targetUrl) return
      try {
        const res = await fetch(`${targetUrl}/api/songs`)
        const data = await res.json()
        if (data.success && Array.isArray(data.songs)) {
          setSongs(data.songs)
          setSelectedSongId((prev) => prev || (data.songs[0] ? data.songs[0].id : null))
        }
      } catch {
        // Backend unreachable
      }
    },
    [serverUrl]
  )

  const downloadAndPrepareAudio = useCallback(
    async (song) => {
      if (!song || !song.fileUrl) return
      const resolvedUrl = resolveAssetUrl(song.fileUrl)

      try {
        setIsDownloading(true)
        setDownloadProgress(10)

        if (activeBlobUrlRef.current) {
          URL.revokeObjectURL(activeBlobUrlRef.current)
          activeBlobUrlRef.current = ''
          setAudioBlobUrl('')
        }

        const response = await fetch(resolvedUrl)
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
        activeBlobUrlRef.current = resolvedUrl
        setAudioBlobUrl(resolvedUrl)
        setCurrentSong(song)
        setIsDownloading(false)
      }
    },
    [resolveAssetUrl]
  )

  // Socket.IO lifecycle — automatically connects/reconnects when serverUrl changes
  useEffect(() => {
    if (!serverUrl) return

    const timer = setTimeout(() => {
      setStatusText('Connecting...')
      fetchSongs(serverUrl)
    }, 0)
    const socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      timeout: 10000
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setStatusText(`Connected (${serverUrl})`)
      setErrorMessage('')
      localStorage.setItem('syncbeats_server_url', serverUrl)
      fetchSongs(serverUrl)
    })

    socket.on('disconnect', () => {
      setStatusText('Disconnected')
      if (isJoiningRoomRef.current) {
        isJoiningRoomRef.current = false
        setIsSubmitting(false)
        setErrorMessage('Connection lost while joining the room. Please try again.')
      }
    })

    socket.on('connect_error', () => {
      setStatusText('Connection error (Check Host IP)')
    })

    socket.on('songs-updated', () => fetchSongs(serverUrl))
    socket.on('room-song', (song) => downloadAndPrepareAudio(song))

    socket.on('song-changed', ({ song, currentTime }) => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = currentTime || 0
      }
      downloadAndPrepareAudio(song)
      setShowSongPicker(false)
    })

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

    socket.on('sync-state', ({ action, currentTime }) => {
      if (!audioRef.current) return
      audioRef.current.currentTime = currentTime
      if (action === 'play') {
        audioRef.current.play().catch(() => {})
      }
    })

    socket.on('room-role', ({ isHost: assignedHost }) => {
      isJoiningRoomRef.current = false
      setIsSubmitting(false)
      setJoined(true)
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
      if (isJoiningRoomRef.current) {
        isJoiningRoomRef.current = false
        setJoined(false)
      }
      setIsSubmitting(false)
      setErrorMessage(message)
    })
    socket.on('control-denied', ({ message }) => setErrorMessage(message))

    return () => {
      clearTimeout(timer)
      socket.disconnect()
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current)
      }
    }
  }, [serverUrl, fetchSongs, downloadAndPrepareAudio])

  const handleSaveServerUrl = (e) => {
    e?.preventDefault()
    let formatted = serverInput.trim().replace(/\/+$/, '')
    if (!formatted) return
    if (!/^https?:\/\//i.test(formatted)) {
      formatted = `http://${formatted}`
    }
    localStorage.setItem('syncbeats_server_url', formatted)
    setServerUrl(formatted)
    setShowManualIp(false)
    setServerInput('')
  }

  const handleCreateRoom = async () => {
    if (isSubmitting) return
    if (!socketRef.current?.connected) {
      setErrorMessage('Connect to the backend before creating a room.')
      return
    }

    setIsSubmitting(true)
    try {
      setErrorMessage('')
      const res = await fetch(`${serverUrl}/api/create-room`, {
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
        isJoiningRoomRef.current = true
        socketRef.current?.emit('join-room', { roomCode: newCode })
      } else {
        setIsSubmitting(false)
        setErrorMessage(data.error || 'Failed to create room.')
      }
    } catch {
      setIsSubmitting(false)
      setErrorMessage(`Cannot reach backend at ${serverUrl}`)
    }
  }

  const handleJoin = () => {
    if (isSubmitting) return
    const cleanCode = roomCode.trim().toUpperCase()
    if (cleanCode.length !== 5) {
      setErrorMessage('Room code must be exactly 5 characters.')
      return
    }
    if (!socketRef.current?.connected) {
      setErrorMessage('Connect to the backend before joining a room.')
      return
    }
    setErrorMessage('')
    setIsHost(false)
    setHostLeft(false)
    setIsSubmitting(true)
    isJoiningRoomRef.current = true
    socketRef.current?.emit('join-room', { roomCode: cleanCode })
  }

  const handleLeave = () => {
    isJoiningRoomRef.current = false
    setIsSubmitting(false)
    audioRef.current?.pause()
    socketRef.current?.emit('leave-room', { roomCode: roomCode.toUpperCase() })
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

  const handleChangeSong = (songId) => {
    if (!isHost) return
    socketRef.current?.emit('change-song', {
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
    socketRef.current?.emit('audio-action', {
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
          {/* Nearby Host Server Connection Bar */}
          <div className="server-connection-bar">
            <div className="server-connection-main">
              <div className="server-connection-info">
                <div>
                  <div className="server-connection-label">
                    {isScanning ? '⏳ Scanning Local Network...' : '📡 Host Server Connection'}
                  </div>
                  <div className="server-connection-url">{serverUrl}</div>
                </div>
              </div>
              <div className="server-connection-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={scanForNearbyServer}
                  disabled={isScanning}
                >
                  {isScanning ? '⏳ Scanning…' : '🔍 Auto-Detect'}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setShowManualIp(!showManualIp)
                    setServerInput(serverUrl)
                  }}
                  title="Enter server IP manually"
                >
                  ✏️ Edit IP
                </button>
              </div>
            </div>

            {showManualIp && (
              <form onSubmit={handleSaveServerUrl} className="server-manual-input-row">
                <input
                  type="text"
                  placeholder="e.g. http://192.168.1.13:5000"
                  value={serverInput}
                  onChange={(e) => setServerInput(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-app)',
                    color: 'var(--text-main)',
                    fontSize: '13px'
                  }}
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  Connect
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowManualIp(false)}
                >
                  Cancel
                </button>
              </form>
            )}
          </div>

          {/* Card 1: Host a Room */}
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
                  <button onClick={() => fetchSongs()} className="btn btn-secondary btn-sm">
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
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setSelectedSongId(song.id)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
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
              disabled={songs.length === 0 || isSubmitting}
              className="btn btn-primary"
              style={{ marginTop: '18px' }}
            >
              {isSubmitting ? 'Creating Room…' : '🚀 Create Room & Host'}
            </button>
          </section>

          {/* Card 2: Join a Room */}
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
                maxLength={5}
                onChange={(e) =>
                  setRoomCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
                }
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                className="input-code"
              />

              <button
                onClick={handleJoin}
                disabled={roomCode.length !== 5 || isSubmitting}
                className="btn btn-secondary"
                style={{ width: '100%' }}
              >
                {isSubmitting ? 'Joining…' : 'Join Session'}
              </button>
            </div>

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
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          handleChangeSong(song.id)
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isCurrent}
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

            {/* Mounted for BOTH host (with controls) and follower (hidden so sync-action plays audio) */}
            {audioBlobUrl && !isDownloading ? (
              <audio
                ref={audioRef}
                src={audioBlobUrl}
                controls={isHost}
                style={isHost ? undefined : { display: 'none' }}
                className="audio-player-element"
                onPlay={() => sendAudioAction('play')}
                onPause={() => sendAudioAction('pause')}
                onSeeked={() => sendAudioAction('seek')}
              >
                Your browser does not support the audio element.
              </audio>
            ) : null}

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
