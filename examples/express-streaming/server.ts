import express from 'express';
import PlivoWebSocketServer from '../../src';
import type { StartEvent, MediaEvent, DTMFEvent } from '../../src/types';
import { createClient, ListenLiveClient, LiveTranscriptionEvent, LiveTranscriptionEvents } from '@deepgram/sdk';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { OpenAI } from 'openai';
import { config } from 'dotenv';
import { TextToSpeechStreamRequestOutputFormat } from '@elevenlabs/elevenlabs-js/api';
import type { WebSocket as WebSocketType } from 'ws';
import * as Plivo from 'plivo';

config();
const app = express();
const PORT = Number(process.env.PORT) || 8000;
const deepgram = createClient(process.env.DEEPGRAM_API_KEY);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

const elevenLabsClient = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

async function streamTextToSpeech(text: string, ws: WebSocketType) {
  const audioStream = await elevenLabsClient.textToSpeech.stream(process.env.ELEVENLABS_VOICE_ID!, {
    text: text,
    modelId: process.env.ELEVENLABS_MODEL_ID,
    outputFormat: TextToSpeechStreamRequestOutputFormat.Ulaw8000,
  });

  for await (const chunk of audioStream) {
    plivoServer.playAudio(ws, 'audio/x-mulaw', 8000, Buffer.from(chunk));
  }
  console.log('🔊 Finished streaming TTS to Plivo');
}

async function addMessageAndGetResponse(message: string) {
  if (messages.length >= 10) {
    messages.shift();
  }
  messages.push({
    role: 'user',
    content: message,
  });
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL!,
    messages: [
      {
        role: 'system',
        content: 'You are a helpful assistant that can answer questions and help with tasks.',
      },
      ...messages,
    ],
  });
  if (messages.length === 10) {
    messages.shift();
  }
  messages.push({
    role: 'assistant',
    content: response.choices[0].message.content,
  });
  return response.choices[0].message.content;
}

// Plivo webhook endpoint
app.get('/stream', (req, res) => {
  const streamUrl = `wss://${req.get('host')}/stream`;
  const plivoResponse = new (Plivo as any).Response();
  plivoResponse.addSpeak('Hello world!');
  const params = {
    contentType: 'audio/x-mulaw;rate=8000',
    keepCallAlive: true,
    bidirectional: true,
  };
  plivoResponse.addStream(streamUrl, params);
  res.header('Content-Type', 'application/xml');
  res.header('Content-Length', plivoResponse.toString().length.toString());
  res.header('Connection', 'keep-alive');
  res.header('Keep-Alive', 'timeout=60');
  const xml = plivoResponse.toXML();
  res.type('application/xml');
  res.send(xml);
});

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`✓ Express server listening on http://localhost:${PORT}`);
  console.log(`✓ WebSocket endpoint: ws://localhost:${PORT}/stream`);
});

function waitForDeepgramConnectionToOpen(client: ListenLiveClient): Promise<void> {
  return new Promise((resolve, reject) => {
    client.on(LiveTranscriptionEvents.Open, () => {
      console.log('🔊 Deepgram connection opened');
      resolve();
    });
    client.on(LiveTranscriptionEvents.Error, (error) => {
      reject(error);
    });
  });
}

// Per-connection state - keyed by WebSocket instance
const connectionState = new WeakMap<WebSocketType, { client: ListenLiveClient }>();

// Create PlivoWebSocketServer - no separate handler needed
const plivoServer = new PlivoWebSocketServer({
  server,
  path: '/stream',
  // make this true if you want to validate the signature
  // validateSignature: true,
  validateSignature: false,
  // make this the same as the auth token in your Plivo account, if you want to validate the signature
  // authToken: process.env.PLIVO_AUTH_TOKEN!,
});

plivoServer
  .onStart((event: StartEvent, ws: WebSocketType) => {
    console.log('🔊 Stream started:', event.start.streamId);
  })
  .onMedia((event: MediaEvent, ws: WebSocketType) => {
    const state = connectionState.get(ws);
    if (!state) return;

    const audioBuffer = event.getRawMedia();
    if (state.client.isConnected()) {
      try {
        state.client.send(audioBuffer as any);
      } catch (error) {
        console.error('❌ Error sending audio to Deepgram:', error);
      }
    } else {
      console.log('🔊 Deepgram is not connected, skipping audio send');
    }
  })
  .onDtmf((event: DTMFEvent, ws: WebSocketType) => {
    console.log('🔢 DTMF received:', {
      digit: event.dtmf.digit,
      track: event.dtmf.track,
      timestamp: event.dtmf.timestamp,
    });

    if (event.dtmf.digit === '*') {
      plivoServer.clearAudio(ws);
      console.log('🧹 Audio queue cleared');
    }
  })
  .onPlayedStream((event) => {
    console.log('✅ Stream played:', {
      name: event.name,
      streamId: event.streamId,
    });
  })
  .onClearedAudio((event) => {
    console.log('🧹 Audio cleared:', {
      streamId: event.streamId,
      sequenceNumber: event.sequenceNumber,
    });
  })
  .onError((error, ws) => {
    console.error('❌ Stream error:', error.message);
  })
  .onClose((ws) => {
    console.log('👋 Stream closed');
    const state = connectionState.get(ws);
    if (state) {
      state.client.requestClose();
    }
  })
  .onConnection(async (ws, req) => {
    console.log('📞 New WebSocket connection established');

    // Initialize per-connection Deepgram client
    const deepgramClient: ListenLiveClient = deepgram.listen.live({
      model: process.env.DEEPGRAM_MODEL!,
      encoding: 'mulaw',
      sample_rate: 8000,
      smart_format: true,
      vad_events: true,
    });

    // Store client in connection state for use by event handlers
    connectionState.set(ws, { client: deepgramClient });

    await waitForDeepgramConnectionToOpen(deepgramClient);

    deepgramClient.on(LiveTranscriptionEvents.Transcript, async (data: LiveTranscriptionEvent) => {
      const transcription = data.channel.alternatives[0].transcript;
      if (transcription.trim().length > 0) {
        console.log('🎤 Transcript:', transcription);
        const completion = await addMessageAndGetResponse(transcription);
        console.log('🤖 Completion:', completion);
        if (completion) {
          await streamTextToSpeech(completion, ws);
        }
      }
    });

    console.log('✓ PlivoWebSocketServer connection initialized');
  })
  .start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  plivoServer.close(() => {
    console.log('WebSocket server closed');
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
});
