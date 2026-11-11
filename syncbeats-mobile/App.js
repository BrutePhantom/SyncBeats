import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ScrollView,
} from 'react-native';
import { Audio } from 'expo-av';
import io from 'socket.io-client';

const DEFAULT_SERVER_URL = 'http://192.168.1.13:5000';

export default function App() {
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [roomCode, setRoomCode] = useState('');
  const [joined, setJoined] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [hostLeft, setHostLeft] = useState(false);
  const [statusText, setStatusText] = useState('Connecting...');
  const [errorMessage, setErrorMessage] = useState('');

  const socketRef = useRef(null);
  const soundRef = useRef(null);
  const isRemoteEvent = useRef(false);
  const pendingSync = useRef(null);

  useEffect(() => {
    // Enable background playback and audio focus
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      shouldDuckAndroid: true,
      staysActiveInBackground: true,
    }).catch(() => {});

    loadAudio();

    // Connect to backend server
    const socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setStatusText('Connected to Server');
      setErrorMessage('');
    });

    socket.on('disconnect', () => {
      setStatusText('Disconnected');
    });

    socket.on('connect_error', () => {
      setStatusText('Connection error');
      setErrorMessage(`Cannot connect to backend at ${serverUrl}`);
    });

    socket.on('room-role', ({ isHost: assignedHost }) => {
      setIsHost(assignedHost);
      setHostLeft(false);
      setErrorMessage('');
    });

    // Handle real-time sync actions from host/other devices
    socket.on('sync-action', async ({ action, currentTime }) => {
      if (!soundRef.current) {
        pendingSync.current = { action, currentTime };
        return;
      }

      isRemoteEvent.current = true;
      try {
        await soundRef.current.setPositionAsync(Math.floor(currentTime * 1000));
        if (action === 'play') {
          await soundRef.current.playAsync();
        } else if (action === 'pause') {
          await soundRef.current.pauseAsync();
        }
      } catch (err) {
        console.log('Error applying sync-action:', err);
      }

      setTimeout(() => {
        isRemoteEvent.current = false;
      }, 300);
    });

    // Handle late-join initial synchronization
    socket.on('sync-state', async ({ action, currentTime }) => {
      if (!soundRef.current) {
        pendingSync.current = { action, currentTime };
        return;
      }

      try {
        await soundRef.current.setPositionAsync(Math.floor(currentTime * 1000));
        if (action === 'play') {
          await soundRef.current.playAsync();
        }
      } catch (err) {
        console.log('Error applying sync-state:', err);
      }
    });

    socket.on('host-left', () => {
      soundRef.current?.pauseAsync().catch(() => {});
      setIsPlaying(false);
      setIsHost(false);
      setHostLeft(true);
    });

    socket.on('room-error', ({ message }) => {
      setErrorMessage(message);
    });

    socket.on('control-denied', ({ message }) => {
      setErrorMessage(message);
    });

    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
      socket.disconnect();
    };
  }, [serverUrl]);

  const loadAudio = async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
        { shouldPlay: false }
      );
      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        setIsPlaying(status.isPlaying);
      });

      // Apply any sync state that arrived while the audio was buffering
      if (pendingSync.current) {
        const { action, currentTime } = pendingSync.current;
        pendingSync.current = null;
        await sound.setPositionAsync(Math.floor(currentTime * 1000));
        if (action === 'play') {
          await sound.playAsync();
        }
      }
    } catch (error) {
      console.log('Error loading audio:', error);
    }
  };

  const handleJoin = () => {
    const cleanCode = roomCode.trim().toUpperCase();
    if (!cleanCode) {
      setErrorMessage('Please enter a room code.');
      return;
    }
    setErrorMessage('');
    setIsHost(false);
    setHostLeft(false);
    socketRef.current?.emit('join-room', { roomCode: cleanCode });
    setJoined(true);
  };

  const handleLeave = async () => {
    if (soundRef.current) {
      await soundRef.current.pauseAsync().catch(() => {});
    }
    socketRef.current?.emit('leave-room', { roomCode: roomCode.trim().toUpperCase() });
    setJoined(false);
    setIsHost(false);
    setHostLeft(false);
    setErrorMessage('');
  };

  const togglePlayPause = async () => {
    if (!isHost || !soundRef.current || isRemoteEvent.current) return;

    const status = await soundRef.current.getStatusAsync();
    if (!status.isLoaded) return;

    const currentTime = status.positionMillis / 1000;
    const cleanCode = roomCode.trim().toUpperCase();

    if (isPlaying) {
      await soundRef.current.pauseAsync();
      socketRef.current?.emit('audio-action', { roomCode: cleanCode, action: 'pause', currentTime });
    } else {
      await soundRef.current.playAsync();
      socketRef.current?.emit('audio-action', { roomCode: cleanCode, action: 'play', currentTime });
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>🎵 Syncbeats Mobile</Text>
        <Text
          style={[
            styles.status,
            { color: statusText.startsWith('Connected') ? '#1db954' : '#ff6b6b' },
          ]}
        >
          {statusText}
        </Text>

        {errorMessage ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {!joined ? (
          <View style={styles.card}>
            <Text style={styles.subtitle}>Join or Host a Room</Text>

            <Text style={styles.label}>Backend Server URL</Text>
            <TextInput
              style={styles.input}
              placeholder="http://192.168.1.13:5000"
              placeholderTextColor="#666"
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.label}>Room Code</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 15151"
              placeholderTextColor="#666"
              value={roomCode}
              onChangeText={setRoomCode}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <TouchableOpacity style={styles.button} onPress={handleJoin}>
              <Text style={styles.buttonText}>Join Room</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.subtitle}>Room: {roomCode.toUpperCase()}</Text>
              <TouchableOpacity style={styles.leaveButton} onPress={handleLeave}>
                <Text style={styles.leaveButtonText}>Leave</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.songTitle}>Now Playing: Sample Audio</Text>

            <Text style={[styles.role, isHost ? styles.hostRole : styles.followerRole]}>
              {isHost
                ? '★ You are the host. Your playback controls the room.'
                : '👥 Following the host.'}
            </Text>

            {isHost ? (
              <TouchableOpacity style={styles.playButton} onPress={togglePlayPause}>
                <Text style={styles.playButtonText}>{isPlaying ? '⏸ PAUSE' : '▶ PLAY'}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.followerMessage}>
                {hostLeft
                  ? '⚠️ The host left the room. This session has ended.'
                  : 'Audio is synchronized with the host in real time.'}
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  scrollContent: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100%',
  },
  title: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
  },
  status: {
    fontSize: 12,
    marginBottom: 20,
  },
  errorBanner: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#ff444422',
    borderWidth: 1,
    borderColor: '#ff4444',
    padding: 10,
    borderRadius: 8,
    marginBottom: 15,
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 13,
    textAlign: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1e1e1e',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 10,
  },
  label: {
    fontSize: 12,
    color: '#aaa',
    marginBottom: 6,
    marginTop: 6,
  },
  songTitle: {
    fontSize: 15,
    color: '#b3b3b3',
    marginBottom: 15,
  },
  role: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 15,
  },
  hostRole: {
    color: '#1db954',
  },
  followerRole: {
    color: '#b3b3b3',
  },
  followerMessage: {
    color: '#777',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 10,
  },
  input: {
    width: '100%',
    height: 48,
    backgroundColor: '#2a2a2a',
    borderRadius: 8,
    paddingHorizontal: 12,
    color: '#fff',
    fontSize: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  button: {
    width: '100%',
    height: 48,
    backgroundColor: '#1db954',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  leaveButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#333',
    borderRadius: 6,
  },
  leaveButtonText: {
    color: '#fff',
    fontSize: 12,
  },
  playButton: {
    width: 140,
    height: 48,
    backgroundColor: '#1db954',
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 10,
  },
  playButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: 'bold',
  },
});
