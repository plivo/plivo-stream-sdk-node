# plivo-stream-sdk-node

A Node.js SDK for handling Plivo real-time media streaming over WebSocket. Built on top of `ws` WebSocketServer.

## Installation

```bash
npm install plivo-stream-sdk-node
# or
bun install plivo-stream-sdk-node
```

## Quick Start

```typescript
import express from 'express';
import PlivoWebSocketServer from 'plivo-stream-sdk-node';
import type { StartEvent, MediaEvent, DTMFEvent } from 'plivo-stream-sdk-node';

const app = express();
const PORT = 8000;

// Plivo webhook endpoint - returns XML to initiate streaming
app.get('/stream', (req, res) => {
  const streamUrl = `wss://${req.get('host')}/stream`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Speak>Hello!</Speak>
    <Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-l16;rate=16000">
    ${streamUrl}
    </Stream>
</Response>`;
  res.type('application/xml').send(xml);
});

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// Create PlivoWebSocketServer attached to your HTTP server
const plivoServer = new PlivoWebSocketServer({ server, path: '/stream' });

plivoServer
  .onConnection(async (ws, req) => {
    console.log('New WebSocket connection');
    // Initialize per-connection resources here (e.g., speech-to-text clients)
  })
  .onStart((event: StartEvent, ws) => {
    console.log('Stream started:', event.start.streamId);
    console.log('Call ID:', event.start.callId);
    console.log('Media format:', event.start.mediaFormat);
  })
  .onMedia((event: MediaEvent, ws) => {
    // Get raw audio buffer from the event
    const audioBuffer = event.getRawMedia();
    // Process audio (e.g., send to speech-to-text service)
  })
  .onDtmf((event: DTMFEvent, ws) => {
    console.log('DTMF digit:', event.dtmf.digit);

    // Example: clear audio queue on * press
    if (event.dtmf.digit === '*') {
      plivoServer.clearAudio(ws);
    }
  })
  .onPlayedStream((event) => {
    console.log('Stream played:', event.name);
  })
  .onClearedAudio((event) => {
    console.log('Audio cleared:', event.streamId);
  })
  .onError((error, ws) => {
    console.error('Stream error:', error.message);
  })
  .onClose((ws) => {
    console.log('Connection closed');
  })
  .start(); // Must call .start() to begin accepting connections
```

## API Reference

### `PlivoWebSocketServer`

Extends `WebSocketServer` from the `ws` package.

#### Constructor

```typescript
new PlivoWebSocketServer(options: ServerOptions, callback?: () => void)
```

Standard `ws` ServerOptions. Common options:

- `server`: HTTP/HTTPS server to attach to
- `path`: URL path for WebSocket connections (e.g., `'/stream'`)
- `port`: Port to listen on (if not attaching to existing server)

#### Lifecycle Methods

##### `start(): this`

Start accepting WebSocket connections. **Must be called after registering all event handlers.**

##### `close(callback?: () => void): void`

Close the WebSocket server.

#### Event Registration Methods (Chainable)

All return `this` for chaining. Multiple handlers can be registered per event.

| Method           | Callback Signature                       | Description                                                                         |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `onConnection`   | `(ws, request) => void \| Promise<void>` | New connection established. Async callbacks are awaited before processing messages. |
| `onStart`        | `(event: StartEvent, ws) => void`        | Stream initialization with call metadata                                            |
| `onMedia`        | `(event: MediaEvent, ws) => void`        | Incoming audio chunk                                                                |
| `onDtmf`         | `(event: DTMFEvent, ws) => void`         | DTMF digit received                                                                 |
| `onPlayedStream` | `(event: PlayedStreamEvent, ws) => void` | Audio playback confirmation                                                         |
| `onClearedAudio` | `(event: ClearedAudioEvent, ws) => void` | Audio queue cleared confirmation                                                    |
| `onError`        | `(error: Error, ws) => void`             | Error occurred                                                                      |
| `onClose`        | `(ws) => void`                           | Connection closed                                                                   |

#### Action Methods

##### `playAudio(ws, contentType, sampleRate, payload)`

Send audio to a specific connection.

```typescript
// payload can be Buffer, Uint8Array, or ArrayBuffer
plivoServer.playAudio(ws, 'audio/x-l16', 16000, audioBuffer);
```

##### `checkpoint(ws, name)`

Send a checkpoint event to track audio playback progress.

```typescript
plivoServer.checkpoint(ws, 'greeting-complete');
```

##### `clearAudio(ws)`

Clear all queued audio for a connection.

```typescript
plivoServer.clearAudio(ws);
```

#### Getter Methods

| Method             | Return Type           | Description                    |
| ------------------ | --------------------- | ------------------------------ |
| `getStreamId(ws)`  | `string \| undefined` | Stream ID for the connection   |
| `getAccountId(ws)` | `string \| undefined` | Plivo account ID               |
| `getCallId(ws)`    | `string \| undefined` | Call ID                        |
| `getHeaders(ws)`   | `string \| undefined` | Extra headers from start event |
| `isActive(ws)`     | `boolean`             | Whether connection is open     |

## Event Types

### StartEvent

```typescript
{
  event: 'start';
  sequenceNumber: number;
  start: {
    callId: string;      // UUID
    streamId: string;    // UUID
    accountId: string;
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
    };
  };
  extra_headers: string;
}
```

### MediaEvent

```typescript
{
  event: 'media';
  sequenceNumber: number;
  streamId: string;
  media: {
    track: string;
    timestamp: string;
    chunk: number;
    payload: string;  // base64 encoded audio
  };
  extra_headers: string;
  getRawMedia(): Buffer;  // Helper to decode payload
}
```

### DTMFEvent

```typescript
{
  event: 'dtmf';
  sequenceNumber: number;
  streamId: string;
  dtmf: {
    track: string;
    digit: string;
    timestamp: string;
  }
  extra_headers: string;
}
```

### PlayedStreamEvent

```typescript
{
  event: 'playedStream';
  sequenceNumber: number;
  streamId: string;
  name: string;
}
```

### ClearedAudioEvent

```typescript
{
  event: 'clearedAudio';
  sequenceNumber: number;
  streamId: string;
}
```

## Types Export

```typescript
import type {
  StartEvent,
  MediaEvent,
  DTMFEvent,
  PlayedStreamEvent,
  ClearedAudioEvent,
  PlayAudioEvent,
  CheckpointEvent,
  ClearAudioEvent,
  IncomingEventEnum,
  OutgoingEventEnum,
} from 'plivo-stream-sdk-node';
```

---

## Running the Example App

The `examples/express-streaming` directory contains a complete voice AI example using:

- **Deepgram** - Real-time speech-to-text
- **OpenAI** - Chat completion for responses
- **ElevenLabs** - Text-to-speech

### Prerequisites

1. Node.js 18+ or Bun
2. A Plivo account with streaming enabled
3. API keys for Deepgram, OpenAI, and ElevenLabs
4. A way to expose your local server (e.g., ngrok)

### Setup

1. Navigate to the example directory:

```bash
cd examples/express-streaming
```

2. Install dependencies:

```bash
npm install
# or
bun install
```

3. Create a `.env` file:

```env
PORT=8000

# Deepgram (https://console.deepgram.com)
DEEPGRAM_API_KEY=your_deepgram_api_key
DEEPGRAM_MODEL=nova-2

# OpenAI (https://platform.openai.com)
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini

# ElevenLabs (https://elevenlabs.io)
ELEVENLABS_API_KEY=your_elevenlabs_api_key
ELEVENLABS_VOICE_ID=your_voice_id
ELEVENLABS_MODEL_ID=eleven_turbo_v2
```

4. Start the server:

```bash
npx ts-node server.ts
# or with bun
bun run server.ts
```

5. Expose your server using ngrok:

```bash
ngrok http 8000
```

6. Configure Plivo:

   - Go to your Plivo console
   - Set your application's Answer URL to: `https://your-ngrok-url.ngrok.io/stream`

7. Make a call to your Plivo number and start talking!

### How It Works

1. When a call comes in, Plivo hits the `/stream` endpoint
2. The XML response initiates a bidirectional WebSocket stream
3. Audio from the caller is sent to Deepgram for transcription
4. Transcriptions are sent to OpenAI for a response
5. OpenAI's response is converted to speech via ElevenLabs
6. The audio is streamed back to the caller in real-time

### DTMF Controls

- Press `*` to clear the audio queue (interrupt the AI)

---

## License

MIT
