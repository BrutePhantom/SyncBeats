import { useState, useEffect, useRef } from 'react'
import io from 'socket.io-client'

const socket = io('http://localhost:5000')

function App() {
  const [roomCode, setRoomCode] = useState('')
  const [joined, setJoined] = useState(false)
  const audioRef = useRef(null)
  const isRemoteEvent = useRef(false)

  useEffect(() => {
    // Receive play/pause/seek events from mobile or backend
    socket.on('sync-action', ({ action, currentTime }) => {
      if (!audioRef.current) return
      isRemoteEvent.current = true

      audioRef.current.currentTime = currentTime

      if (action === 'play') {
        audioRef.current.play().catch(() => { })
      } else if (action === 'pause') {
        audioRef.current.pause()
      }

      setTimeout(() => {
        isRemoteEvent.current = false
      }, 200)
    })

    // Catch up if joining late
    socket.on('sync-state', ({ action, currentTime }) => {
      if (!audioRef.current) return
      audioRef.current.currentTime = currentTime
      if (action === 'play') audioRef.current.play().catch(() => { })
    })

    return () => {
      socket.off('sync-action')
      socket.off('sync-state')
    }
  }, [])

  const handleJoin = () => {
    if (roomCode.trim()) {
      socket.emit('join-room', { roomCode: roomCode.toUpperCase() })
      setJoined(true)
    }
  }

  const sendAudioAction = (action) => {
    if (isRemoteEvent.current || !audioRef.current) return
    socket.emit('audio-action', {
      roomCode: roomCode.toUpperCase(),
      action,
      currentTime: audioRef.current.currentTime
    })
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', color: 'white' }}>
      <h1>🎵 Syncbeats Desktop</h1>

      {!joined ? (
        <div>
          <h2>Join a Room</h2>
          <input
            type="text"
            placeholder="Enter Room Code (e.g. 15151)"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            style={{ padding: '10px', fontSize: '16px' }}
          />
          <button onClick={handleJoin} style={{ padding: '10px 20px', marginLeft: '10px', cursor: 'pointer' }}>
            Join Room
          </button>
        </div>
      ) : (
        <div>
          <h2>Room: {roomCode.toUpperCase()}</h2>
          <div style={{ marginTop: '30px', padding: '20px', background: '#222', borderRadius: '10px' }}>
            <h3>Now Playing: Sample Audio</h3>
            <audio
              ref={audioRef}
              controls
              style={{ width: '100%', marginTop: '10px' }}
              onPlay={() => sendAudioAction('play')}
              onPause={() => sendAudioAction('pause')}
              onSeeked={() => sendAudioAction('seek')}
            >
              <source src="https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" type="audio/mpeg" />
              Your browser does not support the audio element.
            </audio>
          </div>
        </div>
      )}
    </div>
  )
}

export default App