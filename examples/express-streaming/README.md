# Plivo Streaming Express Example

A complete example showing how to use the Plivo Streaming SDK with Express and WebSocket.

## Features

- Express HTTP server for Plivo webhooks
- WebSocket server for real-time audio streaming
- Handle incoming audio streams from Plivo calls
- Process DTMF tones
- Send audio back to the stream
- Checkpoint management
- Audio queue control

## Installation

```bash
cd examples/express-streaming
bun install
```

## Running the Server

```bash
bun run dev
```

The server will start on `http://localhost:3000` with WebSocket available at `ws://localhost:3000/stream`.

## Usage

### 1. Expose Your Local Server (for development)

Use a tunneling service like ngrok:

```bash
ngrok http 3000
```

You'll get a URL like `https://abc123.ngrok.io`

### 2. Configure Plivo

In your Plivo application settings:

- Set the Answer URL to: `https://abc123.ngrok.io/voice`
- Make sure the HTTP method is set to POST

### 3. Make a Test Call

Call your Plivo phone number. The server will:

1. Receive the webhook at `/voice`
2. Return XML with Stream instruction
3. Establish WebSocket connection
4. Start streaming audio

## Endpoints

### HTTP Endpoints

- `GET /health` - Health check endpoint
- `POST /voice` - Plivo voice webhook (receives incoming calls)

### WebSocket Endpoint

- `WS /stream` - WebSocket endpoint for Plivo media streaming

## Event Handlers

The example demonstrates all available event handlers:

- **onStart** - Called when stream starts, contains call metadata
- **onMedia** - Called for each audio packet (every ~20ms)
- **onDtmf** - Called when DTMF digit is pressed
- **onPlayedStream** - Called when checkpoint is reached
- **onClearedAudio** - Called when audio queue is cleared
- **onError** - Called on any errors
- **onClose** - Called when connection closes

## Methods

The `PlivoStreamingHandler` provides these methods:

```typescript
// Play audio to the stream
handler.playAudio(contentType, sampleRate, base64Payload);

// Send checkpoint
handler.checkpoint(name);

// Clear audio queue
handler.clearAudio();

// Close connection
handler.close();

// Get stream metadata
handler.getStreamId();
handler.getAccountId();
handler.getCallId();
handler.getHeaders();
handler.isActive();
```

## Example Use Cases

### Echo Bot

Uncomment the echo code in the `onMedia` handler to play back received audio:

```typescript
onMedia: (event) => {
  handler.playAudio('audio/x-mulaw', 8000, event.media.payload);
};
```

### DTMF Response

The example clears audio when user presses `*`:

```typescript
onDtmf: (event) => {
  if (event.dtmf.digit === '*') {
    handler.clearAudio();
  }
};
```

### Integration with Speech Services

```typescript
onMedia: async (event) => {
  // Send audio to speech recognition service
  const text = await speechToText(event.media.payload);

  // Process with AI
  const response = await aiProcess(text);

  // Convert response to audio and play
  const audio = await textToSpeech(response);
  handler.playAudio('audio/x-mulaw', 8000, audio);
};
```

## Media Format

Plivo streams audio in the following format:

- **Encoding**: µ-law (8-bit)
- **Sample Rate**: 8000 Hz
- **Chunk Size**: ~20ms
- **Format**: Base64 encoded

## Troubleshooting

### WebSocket Connection Issues

- Ensure your firewall allows WebSocket connections
- Check that ngrok (or similar) properly forwards WebSocket connections
- Verify the Stream URL in Plivo XML is correct

### No Audio Received

- Check that `onStart` is called (stream initialized)
- Verify `onMedia` is being called
- Check Plivo console for any errors

### Audio Quality Issues

- Ensure you're sending audio in the correct format (µ-law, 8000 Hz)
- Check that base64 encoding is correct
- Verify sample rate matches Plivo's format

## Learn More

- [Plivo Streaming API Documentation](https://www.plivo.com/docs/)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Express.js Documentation](https://expressjs.com/)
