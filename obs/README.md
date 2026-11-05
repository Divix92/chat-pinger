# Chat Pinger — native OBS plugin

An independent C++/Qt dock for OBS Studio (64-bit; Windows build targets OBS 31.1.1 / Qt 6.8.3), with five default
sounds, a custom sound file picker, volume, mute, and automatic reconnection.
No desktop app, browser source, Node.js, or account credentials are needed.

## Windows installation

1. Close OBS. Extract the Windows plugin archive into your OBS installation
   folder (normally `C:\Program Files\obs-studio`). Its `obs-plugins/64bit` and
   `data/obs-plugins/chat-pinger` folders merge with the existing folders.
   The included `bin/64bit/Qt6WebSockets.dll` is an additional Qt module.
   Use OBS 31.1.1 with Qt 6.8.3 for the packaged Windows build.
2. Start OBS and open **Docks → Chat Pinger**.
3. Paste `https://kick.com/channel` or a channel name. Click **Start listening**.
4. Select a sound, adjust volume, and click **Test sound**.
5. Set your headphones under **Settings → Audio → Advanced → Monitoring Device**.

The first alert/test adds a **Chat Pinger Alerts** media source to the current
regular scene. Keep it enabled. A subsequent alert adds that same source to a
new current scene when necessary. The plugin will not replace a non-media
source with that name. Avoid renaming or deleting the source while connected.
OBS's obs-ffmpeg media-source module must be enabled (standard OBS builds include it).

**Headphones only** is the default. Choose **Headphones + stream / recording**
when viewers should hear alerts too. Check OBS mixer routing and avoid capturing
the headphone monitoring device again with Desktop Audio, which would duplicate
alerts and defeat monitor-only routing. Test in a recording before a live stream.
OBS Studio Mode routes audio through its active scene graph; verify the selected
preview/program scenes before going live.

Settings are retained in the OBS plugin configuration directory. Custom sounds
are referenced by their original file path; keep the file in place. Use short
WAV, MP3, OGG or FLAC clips (max 10 MB). Very busy chat restarts the current
sound instead of layering an unlimited number of sounds. The retro tone is an
original messenger-style sound, not the Gadu-Gadu recording; you can select your
own recording if you have one.

## Build

Windows: Visual Studio 2022 with Desktop C++, Windows 10/11 SDK, CMake 3.28+,
and Qt 6.8.3 for MSVC 2022 with its Qt WebSockets module. Pass that Qt install
as `-DCMAKE_PREFIX_PATH=C:/Qt/6.8.3/msvc2022_64` during configuration.
GitHub Actions installs this matching Qt package automatically.

```powershell
cmake -S obs -B obs/build -G "Visual Studio 17 2022" -A x64
cmake --build obs/build --config Release --parallel 3
cmake --install obs/build --config Release --prefix dist/obs-windows
```

The upstream OBS template bootstrap downloads pinned, checksum-verified OBS
31.1.1 sources, obs-deps, and Qt into `obs/.deps` and builds just the SDK targets.
The plugin links Qt6 Core, Widgets, Network and WebSockets. It must match OBS's
Qt major version and architecture. The Windows build workflow packages the DLL
and sound data together. Windows compilation/runtime testing is separate from
the Linux compilation check.

Linux, with OBS and Qt6 development packages installed:

```sh
cmake -S obs -B obs/build -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build obs/build --parallel 3
cmake --install obs/build --prefix "$PWD/dist/obs-linux"
```

## Connection limits

This uses Kick's website channel endpoint and public Pusher chat transport,
not Kick's supported OAuth/webhook API. Cloudflare or a Kick API change can
block channel lookup. Errors are shown in the dock; there is no anti-bot bypass.
The official API requires an app token and a publicly hosted webhook receiver,
which is a different deployment model. Only new chat events trigger alerts;
there is no chat history polling or backfill after a connection gap.
