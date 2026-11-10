import { useState } from 'react'

function App() {
  const [roomCode, setRoomCode] = useState('')
  const [joined, setJoined] = useState(false)

  const handleJoin = () => {
    if (roomCode.trim()) setJoined(true)
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', color: 'white' }}>
      <h1>🎵 Syncbeats Desktop</h1>

      {!joined ? (
        <div>
          <h2>Join a Room</h2>
          <input
            type="text"
            placeholder="Enter Room Code"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value)}
            style={{ padding: '10px', fontSize: '16px' }}
          />
          <button onClick={handleJoin} style={{ padding: '10px 20px', marginLeft: '10px', cursor: 'pointer' }}>
            Join
          </button>
        </div>
      ) : (
        <div>
          <h2>Room: {roomCode}</h2>
          <div style={{ marginTop: '30px', padding: '20px', background: '#222', borderRadius: '10px' }}>
            <h3>Now Playing: Unknown Song</h3>
            {/* The standard HTML5 Audio Player */}
            <audio controls style={{ width: '100%', marginTop: '10px' }}>
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