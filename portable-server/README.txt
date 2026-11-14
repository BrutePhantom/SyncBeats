======================================================================
                     SYNCBEATS PORTABLE SERVER
======================================================================

Syncbeats Portable Server lets you host a synchronized music listening 
session from any computer (Windows, Mac, or Linux).

----------------------------------------------------------------------
HOW TO START THE SERVER:
----------------------------------------------------------------------

On Windows:
  1. Double-click "start-server.bat".
  2. The server will start and show your Local and Wi-Fi LAN addresses.
  (If you don't have Node.js installed, the script can automatically
   download a portable Node.js runtime for you!)

On macOS:
  1. Double-click "start-server.command" (or run ./start-server.sh in Terminal).
  2. The server will start and display your LAN IP address.

On Linux:
  1. Open terminal and run: ./start-server.sh
  2. The server will start and display your LAN IP address.

----------------------------------------------------------------------
ADDING YOUR OWN SONGS:
----------------------------------------------------------------------
Simply drop any .mp3, .wav, or .m4a audio files into the "public/songs"
folder. The server will instantly detect new files and make them 
available to everyone in the room!

----------------------------------------------------------------------
CONNECTING TO THE SERVER:
----------------------------------------------------------------------
Make sure the devices running the Syncbeats App (Desktop or Mobile) 
are connected to the same Wi-Fi network as this computer.

- The desktop and mobile apps will automatically scan and find this server!
- Or enter the LAN IP displayed in the server terminal 
  (e.g., http://192.168.1.13:5000).
======================================================================
