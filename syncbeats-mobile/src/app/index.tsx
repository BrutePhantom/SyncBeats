import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity } from 'react-native';
import { Audio } from 'expo-av';
import io from 'socket.io-client';

// ⚠️ REPLACE WITH YOUR LAPTOP'S LOCAL IP (Run `ipconfig` in CMD/PowerShell to get it)
const BACKEND_URL = 'http://192.168.1.15:5000';

const socket = io(BACKEND_URL);

export default function HomeScreen() {
  const [roomCode, setRoomCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const soundRef = useRef<Audio.Sound | null>(null);
  const isRemoteEvent = useRef(false);

  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: true,
    });

    loadAudio();

    // Listen for sync actions from desktop/backend
    socket.on('sync-action', async ({ action, currentTime }) => {
      if (!soundRef.current) return;
      isRemoteEvent.current = true;

      await soundRef.current.setPositionAsync(currentTime * 1000);

      if (action === 'play') {
        await soundRef.current.playAsync();
        setIsPlaying(true);
      } else if (action === 'pause') {
        await soundRef.current.pauseAsync();
        setIsPlaying(false);
      }

      setTimeout(() => {
        isRemoteEvent.current = false;
      }, 300);
    });

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
      socket.off('sync-action');
    };
  }, []);

  const loadAudio = async () => {
    const { sound } = await Audio.Sound.createAsync(
      { uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
      { shouldPlay: false }
    );
    soundRef.current = sound;
  };

  const handleJoin = () => {
    if (roomCode.trim()) {
      socket.emit('join-room', { roomCode: roomCode.toUpperCase() });
      setJoined(true);
    }
  };

  const togglePlayPause = async () => {
    if (!soundRef.current || isRemoteEvent.current) return;

    const status = await soundRef.current.getStatusAsync();
    if (!status.isLoaded) return;

    const currentTime = status.positionMillis / 1000;

    if (isPlaying) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
      socket.emit('audio-action', { roomCode: roomCode.toUpperCase(), action: 'pause', currentTime });
    } else {
      await soundRef.current.playAsync();
      setIsPlaying(true);
      socket.emit('audio-action', { roomCode: roomCode.toUpperCase(), action: 'play', currentTime });
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🎵 Syncbeats Mobile</Text>

      {!joined ? (
        <View style={styles.card}>
          <Text style={styles.subtitle}>Join a Room</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter Room Code (e.g. 15151)"
            placeholderTextColor="#888"
            value={roomCode}
            onChangeText={setRoomCode}
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.button} onPress={handleJoin}>
            <Text style={styles.buttonText}>Join Room</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.subtitle}>Room: {roomCode.toUpperCase()}</Text>
          <Text style={styles.songTitle}>Now Playing: Sample Audio</Text>

          <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
            <Text style={styles.playButtonText}>{isPlaying ? '⏸ PAUSE' : '▶ PLAY'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', alignItems: 'center', justifyContent: 'center', padding: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 30 },
  subtitle: { fontSize: 20, fontWeight: '600', color: '#fff', marginBottom: 15 },
  songTitle: { fontSize: 16, color: '#b3b3b3', marginBottom: 25 },
  card: { width: '100%', backgroundColor: '#1e1e1e', borderRadius: 12, padding: 20, alignItems: 'center' },
  input: { width: '100%', height: 50, backgroundColor: '#2a2a2a', borderRadius: 8, paddingHorizontal: 15, color: '#fff', fontSize: 16, marginBottom: 15 },
  button: { width: '100%', height: 50, backgroundColor: '#1db954', borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  playButton: { width: 140, height: 50, backgroundColor: '#1db954', borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  playButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});