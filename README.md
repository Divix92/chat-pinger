# Chat Pinger

A small Kick chat notification app: paste a channel link, pick a short sound,
and hear a ping whenever a new chat message arrives.

Two independent versions:

- **Windows desktop app** — Electron, with an installer and portable EXE.
- **Native OBS plugin** — a C++/Qt dock with its own chat connection and OBS
  media-source audio. The desktop app does not need to run. See [OBS setup](obs/README.md).

Both include short chime, soft ping, double bell, water drop, and an original
retro messenger tone inspired by classic messengers such as Gadu-Gadu. No
copyrighted Gadu-Gadu recording is included. You can import your own audio.
Volume, sound selection and mute settings are saved locally.

## Connection fallback (desktop 0.2)

If the direct chat feed keeps reconnecting, click **Open Kick chat window
(fallback)** below the channel field. A separate, visible Kick chat window opens
at Kick's popout chat page. Complete any verification that Kick displays. Once
its chat list appears, the app watches new message elements and plays the same
selected sound at your configured volume. Keep both app and chat window open;
closing the chat window stops this mode. Minimized windows keep running.

Initial chat history is ignored (including the first 1.5 seconds of rendering).
This mode depends on Kick's chat page DOM and can break if Kick changes its
layout. It cannot overcome a blocked Kick website or guarantee that Electron
passes a browser verification. The status stays at “Waiting for Kick chat” when
the expected chat list has not appeared. It does not require the public Pusher
socket or channel metadata lookup. The native OBS plugin still uses its
independent direct connector; the desktop's optional OBS browser-source output
can carry fallback notifications into OBS.

The main activity list contains newly received messages, not an embedded copy
of Kick chat or old message history. Version 0.2 also shows direct transport
errors and stops after eight retries instead of reconnecting indefinitely.

## Desktop

Run the portable EXE, or install using the Setup EXE. Paste a Kick channel link
or username and click **Start listening**. Choose a sound and **Test sound**.
Import MP3, WAV or OGG audio up to 10 MB and 10 seconds. Closing the app stops
monitoring; minimizing it keeps monitoring running. No account or Kick login is
requested, and the app does not send messages or post to chat.

The activity list shows the latest 50 messages in memory; chat is not written to
disk. Messages are rendered as plain text. A bounded set of message IDs prevents
replayed messages from sounding twice. Reconnection uses exponential backoff up
to 30 seconds, and connection loss is visible in the status. Missed messages
while disconnected are not replayed. Busy chat can overlap tones, capped at 24
voices to keep memory/audio usage bounded.

The optional browser-source bridge is available in the desktop OBS section.
It binds only to `127.0.0.1`, authenticates controls/events with a random session
capability, validates request Host/Origin, and serves no user-selected file paths.
Its URL changes each time the desktop app starts; recopy it in OBS after restart.
Use the native plugin for independent operation and persistent OBS integration.

## Develop

Node.js 24+, npm, and the platform's normal Electron desktop libraries:

```sh
npm ci
npm test
npm start
```

For browser development (without launching Electron):

```sh
npm run dev:web
```

Open the capability URL printed in the terminal. Keep it private. This server
has the same interface and monitoring engine; it uses Node fetch rather than
Electron's network stack. In proxy-managed environments use Node's supported
proxy configuration (`NODE_USE_ENV_PROXY=1`). WebSocket connectivity must also
be supported by the environment. Never disable TLS verification.

Browser integration tests:

```sh
npx playwright install --with-deps chromium
CHROMIUM_PATH=$(node -e "process.stdout.write(require('playwright').chromium.executablePath())") npm run test:ui
```

On Windows, run `npm run dist:win` for installer + portable EXE in `dist/`.
Cross-building the NSIS installer on Linux also requires Wine; portable EXE
packaging can run separately with `npx electron-builder --win portable --x64`.
Windows packages are unsigned until a signing certificate is configured.
GitHub Actions builds both Windows desktop packages and the native OBS DLL
archive; artifacts are downloadable from the workflow run, not automatically
published as a GitHub Release.

## Kick connectivity

The no-login, paste-any-channel workflow uses Kick's **website API**, currently
`https://kick.com/api/v2/channels/{slug}`, and its public Pusher transport at
`wss://ws-us2.pusher.com`, subscribing to `chatrooms.{id}.v2` and
`App\\Events\\ChatMessageEvent`. These are not stable official API contracts.
Kick can block requests with anti-bot challenges or change them. The app shows
lookup/connection errors rather than pretending to be connected or bypassing
challenges. Both online and offline channels can be selected if Kick exposes
their chatroom. Verification requires an actual channel and a new chat message.

Kick's [official events API](https://docs.kick.com/events/introduction) delivers
chat messages by webhook and requires a registered app, token, and public HTTPS
receiver. A future hosted connector could support that model. This local app
does not claim to implement the official webhook API.

## Validation

`npm test` checks channel validation, subscription/heartbeat behavior, message
filtering/deduplication, stale-connection cancellation, reconnection, local API
authentication, settings persistence, upload and event delivery. `npm run test:ui`
checks actual browser controls, sound preview, audio import, mute/persistence,
error handling, safe message rendering and mobile layout. These use synthetic
chat events and do not prove the upstream Kick service is reachable.

The initial Linux development run compiled and loaded the native OBS shared
library in OBS 30.2.3 / Qt 6.8.2, opened its dock and exercised Test sound to
create the expected media source with the bundled chime. The actual Electron
window also passed a startup/preview smoke check, and all Node/browser tests
passed. A portable Windows EXE was cross-built; the NSIS installer requires
Wine on Linux and is built on Windows in CI. The cloud had no PulseAudio
monitoring server, so audible headphone output was not verified. Live Kick access was blocked by the cloud network
policy, so receiving a real Kick message and hearing it in Windows/OBS remain
acceptance checks. See the latest workflow result before using Windows builds.

Desktop code and original sounds: MIT. Native OBS plugin/build tooling:
GPL-2.0-or-later; see [third-party notes](obs/THIRD_PARTY.md).
