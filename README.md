# Syncbeats

Syncbeats is a cross-platform synchronization and playback system comprising a backend service, desktop client, and mobile client.

# Rules

- DO NOT HARDCODE ANY refrence based key like IP or PORT or anything please . just use process.env
- Refer to change logs before making any changes.
- Try code localy, then push to main (or make your own exprimental branch)

## Repository Structure

- **`syncbeats-backend`**: Node.js / Express backend with Prisma ORM and Socket.io for real-time synchronization.
- **`syncbeats-desktop`**: Electron desktop application built with React and Vite.
- **`syncbeats-mobile`**: Mobile application built with React Native and Expo.

## Getting Started

Refer to each directory's documentation for detailed installation and setup instructions:

- [syncbeats-backend](./syncbeats-backend)
- [syncbeats-desktop](./syncbeats-desktop)
- [syncbeats-mobile](./syncbeats-mobile)

