import { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'

const socket = io('http://localhost:5000')

function App() {
  const [roomCode, setRoomCode] = useState('')
  const [joined, setJoined] = useState(false)
  const [isHost, setIsHost] = useState(false)
  const [hostLeft, setHostLeft] = useState(false)
  const [statusText, setStatusText] = useState('Connecting...')
  const [errorMessage, setErrorMessage] = useState('')
  const audioRef = useRef(null)
  const isRemoteEvent = useRef(false)

  useEffect(() => {
    socket.on('connect', () => {
      setStatusText('Connected to Server')
      setErrorMessage('')
    })

    socket.on('disconnect', () => {
      setStatusText('Disconnected')
    })

    socket.on('connect_error', () => {
      setStatusText('Connection error (Check if backend is running)')
    })

    // Receive play/pause/seek events from mobile or backend
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

    // Catch up if joining late
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
      socket.off('connect')
      socket.off('disconnect')
      socket.off('connect_error')
      socket.off('sync-action')
      socket.off('sync-state')
      socket.off('room-role')
      socket.off('host-left')
      socket.off('room-error')
      socket.off('control-denied')
    }
  }, [])

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

  const handleLeave = () => {
    if (audioRef.current) {
      audioRef.current.pause()
    }
    socket.emit('leave-room', { roomCode: roomCode.toUpperCase() })
    setJoined(false)
    setIsHost(false)
    setHostLeft(false)
    setErrorMessage('')
  }

  const sendAudioAction = (action) => {
    if (!isHost || isRemoteEvent.current || !audioRef.current) return
    socket.emit('audio-action', {
      roomCode: roomCode.toUpperCase(),
      action,
      currentTime: audioRef.current.currentTime
    })
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '28px' }}>🎵 Syncbeats Desktop</h1>
        <span
          style={{
            fontSize: '12px',
            padding: '4px 10px',
            borderRadius: '12px',
            background: statusText.startsWith('Connected') ? '#1db95422' : '#ff444422',
            color: statusText.startsWith('Connected') ? '#1db954' : '#ff6b6b',
            border: `1px solid ${statusText.startsWith('Connected') ? '#1db954' : '#ff6b6b'}`
          }}
        >
          {statusText}
        </span>
      </div>

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
        <div
          style={{
            marginTop: '40px',
            maxWidth: '450px',
            background: '#1e1e1e',
            padding: '25px',
            borderRadius: '12px'
          }}
        >
          <h2 style={{ marginTop: 0, fontSize: '20px' }}>Join or Host a Room</h2>
          <p style={{ color: '#aaa', fontSize: '14px', marginBottom: '20px' }}>
            Enter a room code. The first person to join will become the room host.
          </p>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              placeholder="e.g. 15151"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              style={{
                flex: 1,
                padding: '12px',
                fontSize: '16px',
                borderRadius: '8px',
                border: '1px solid #333',
                background: '#2a2a2a',
                color: '#fff',
                outline: 'none'
              }}
            />
            <button
              onClick={handleJoin}
              style={{
                padding: '12px 24px',
                fontSize: '16px',
                fontWeight: 'bold',
                borderRadius: '8px',
                border: 'none',
                background: '#1db954',
                color: '#fff',
                cursor: 'pointer'
              }}
            >
              Join Room
            </button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: '30px', maxWidth: '600px' }}>
          <div
            style={{
              padding: '25px',
              background: '#1e1e1e',
              borderRadius: '12px',
              border: '1px solid #2a2a2a'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '15px'
              }}
            >
              <h2 style={{ margin: 0, fontSize: '22px' }}>Room: {roomCode.toUpperCase()}</h2>
              <button
                onClick={handleLeave}
                style={{
                  padding: '6px 14px',
                  background: '#333',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px'
                }}
              >
                Leave Room
              </button>
            </div>

            <h3 style={{ margin: '15px 0 5px 0', fontSize: '18px', color: '#fff' }}>
              Now Playing: Sample Audio
            </h3>
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
                  : '👥 Following the host. Playback controls are synchronized.'}
            </p>

            <audio
              ref={audioRef}
              controls={isHost}
              style={{
                width: '100%',
                marginTop: '10px',
                display: isHost ? 'block' : 'none'
              }}
              onPlay={() => sendAudioAction('play')}
              onPause={() => sendAudioAction('pause')}
              onSeeked={() => sendAudioAction('seek')}
            >
              <source
                src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3"
                type="audio/mpeg"
              />
              Your browser does not support the audio element.
            </audio>

            {!isHost && (
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
                  : 'Audio is synchronized with the host in real time.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
