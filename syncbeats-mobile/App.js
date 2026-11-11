import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, SafeAreaView, StatusBar } from 'react-native';
import { Audio } from 'expo-av';
import io from 'socket.io-client';

// ⚠️ STEP 1: Put your laptop's Local IP address here (run `ipconfig` in terminal to find it)
const BACKEND_URL = 'http://192.168.0.114:5000';

let socket;

export default function App() {
  const [roomCode, setRoomCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [hostLeft, setHostLeft] = useState(false);
  const [statusText, setStatusText] = useState('Disconnected');
  const soundRef = useRef(null);
  const isRemoteEvent = useRef(false);

  useEffect(() => {
    // Enable background & silent mode playback on mobile devices
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: true,
    });

    loadAudio();

    // Connect Socket.io
    socket = io(BACKEND_URL);

    socket.on('connect', () => {
      setStatusText('Connected to Server');
    });

    socket.on('disconnect', () => {
      setStatusText('Disconnected');
    });

    // Handle real-time sync actions from other connected devices
    socket.on('sync-action', async ({ action, currentTime }) => {
      if (!soundRef.current) return;
      isRemoteEvent.current = true;

      // Update position to match host/other device
      await soundRef.current.setPositionAsync(Math.floor(currentTime * 1000));

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

    // Handle initial state for late joiners
    socket.on('sync-state', async ({ action, currentTime }) => {
      if (!soundRef.current) return;
      await soundRef.current.setPositionAsync(Math.floor(currentTime * 1000));
      if (action === 'play') {
        await soundRef.current.playAsync();
        setIsPlaying(true);
      }
    });

    socket.on('room-role', ({ isHost: assignedHost }) => {
      setIsHost(assignedHost);
      setHostLeft(false);
    });

    socket.on('host-left', () => {
      soundRef.current?.pauseAsync().catch(() => {});
      setIsPlaying(false);
      setIsHost(false);
      setHostLeft(true);
    });

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
      if (socket) {
        socket.disconnect();
      }
    };
  }, []);

  const loadAudio = async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
        { shouldPlay: false }
      );
      soundRef.current = sound;
    } catch (error) {
      console.log('Error loading audio:', error);
    }
  };

  const handleJoin = () => {
    if (roomCode.trim()) {
      const cleanCode = roomCode.trim().toUpperCase();
      setIsHost(false);
      setHostLeft(false);
      socket.emit('join-room', { roomCode: cleanCode });
      setJoined(true);
    }
  };

  const togglePlayPause = async () => {
    if (!isHost || !soundRef.current || isRemoteEvent.current) return;

    const status = await soundRef.current.getStatusAsync();
    if (!status.isLoaded) return;

    const currentTime = status.positionMillis / 1000;
    const cleanCode = roomCode.trim().toUpperCase();

    if (isPlaying) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
      socket.emit('audio-action', { roomCode: cleanCode, action: 'pause', currentTime });
    } else {
      await soundRef.current.playAsync();
      setIsPlaying(true);
      socket.emit('audio-action', { roomCode: cleanCode, action: 'play', currentTime });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <Text style={styles.title}>🎵 Syncbeats Mobile</Text>
      <Text style={styles.status}>{statusText}</Text>

      {!joined ? (
        <View style={styles.card}>
          <Text style={styles.subtitle}>Join a Room</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter Room Code (e.g. 15151)"
            placeholderTextColor="#777"
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
          <Text style={[styles.role, isHost ? styles.hostRole : styles.followerRole]}>
            {isHost ? 'You are the host. Your playback controls the room.' : 'Following the host.'}
          </Text>

          {isHost ? (
            <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
              <Text style={styles.playButtonText}>{isPlaying ? '⏸ PAUSE' : '▶ PLAY'}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.followerMessage}>
              {hostLeft ? 'The host left the room. This session has ended.' : 'Playback controls are disabled.'}
            </Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#121212', alignItems: 'center', justifyContent: 'center', padding: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 5 },
  status: { fontSize: 12, color: '#1db954', marginBottom: 30 },
  subtitle: { fontSize: 20, fontWeight: '600', color: '#fff', marginBottom: 15 },
  songTitle: { fontSize: 16, color: '#b3b3b3', marginBottom: 25 },
  role: { fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 10 },
  hostRole: { color: '#1db954' },
  followerRole: { color: '#b3b3b3' },
  followerMessage: { color: '#777', fontSize: 14, textAlign: 'center', marginTop: 10 },
  card: { width: '90%', backgroundColor: '#1e1e1e', borderRadius: 16, padding: 25, alignItems: 'center' },
  input: { width: '100%', height: 50, backgroundColor: '#2a2a2a', borderRadius: 10, paddingHorizontal: 15, color: '#fff', fontSize: 16, marginBottom: 15 },
  button: { width: '100%', height: 50, backgroundColor: '#1db954', borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  playButton: { width: 150, height: 50, backgroundColor: '#1db954', borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginTop: 10 },
  playButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
});
