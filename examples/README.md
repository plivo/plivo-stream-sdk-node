# Plivo Streaming SDK Examples

This directory contains example projects demonstrating how to use the Plivo Streaming Node SDK.

## Available Examples

### [Express Streaming](./express-streaming)

A complete Express.js server with WebSocket support for handling Plivo real-time audio streaming.

**Features:**
- HTTP endpoints for Plivo webhooks
- WebSocket server for audio streaming
- Real-time audio processing
- DTMF handling
- Audio playback and queue management
- Checkpoint system

**Quick Start:**
```bash
cd express-streaming
bun install
bun run dev
```

## Requirements

- Bun runtime
- A Plivo account with phone number
- ngrok or similar tunneling service (for local development)

## Getting Started

1. Choose an example from the list above
2. Follow the README in that example's directory
3. Configure your Plivo application to use the webhook URLs
4. Test with a phone call

## Common Setup Steps

### 1. Install Dependencies

Each example has its own dependencies. Navigate to the example directory and run:

```bash
bun install
```

### 2. Expose Local Server

For development, use ngrok to expose your local server:

```bash
ngrok http 3000
```

### 3. Configure Plivo

In your Plivo application:
- Set the Answer URL to your server's webhook endpoint
- Ensure WebSocket URLs are accessible from Plivo's servers

### 4. Test

Make a call to your Plivo phone number and watch the logs!

## Need Help?

- Check the README in each example directory
- Review the [SDK documentation](../README.md)
- Visit [Plivo's documentation](https://www.plivo.com/docs/)

