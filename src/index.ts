import { WebSocketServer, type ServerOptions, type WebSocket as WebSocketType } from 'ws';
import type { IncomingMessage } from 'http';
import type {
  StartEvent,
  MediaEvent,
  DTMFEvent,
  PlayedStreamEvent,
  ClearedAudioEvent,
  PlayAudioEvent,
  CheckpointEvent,
  ClearAudioEvent,
} from './types';
import { validateV3Signature } from 'plivo';
import {
  ClearedAudioEventSchema,
  DTMFEventSchema,
  MediaEventSchema,
  PlayedStreamEventSchema,
  StartEventSchema,
} from './types';

export interface PlivoWebSocketServerOptions extends ServerOptions {
  /**
   * Whether to validate the V3 signature on incoming WebSocket connections.
   * If true, `authToken` must also be provided.
   */
  validateSignature?: boolean;
  /**
   * The Plivo auth token used for V3 signature validation.
   * Required if `validateSignature` is true.
   */
  authToken?: string;
}

interface ConnectionMetadata {
  streamId?: string;
  accountId?: string;
  callId?: string;
  headers?: string;
}

export type ConnectionCallback = (ws: WebSocketType, request: IncomingMessage) => void | Promise<void>;

class PlivoWebSocketServer extends WebSocketServer {
  private isStarted = false;
  private connectionMetadata = new WeakMap<WebSocketType, ConnectionMetadata>();
  private readonly validateSignatureEnabled: boolean;
  private readonly authToken?: string;

  // Pre-registered callbacks
  private connectionCallbacks: ConnectionCallback[] = [];
  private startCallbacks: Array<(event: StartEvent, ws: WebSocketType) => void> = [];
  private mediaCallbacks: Array<(event: MediaEvent, ws: WebSocketType) => void> = [];
  private dtmfCallbacks: Array<(event: DTMFEvent, ws: WebSocketType) => void> = [];
  private playedStreamCallbacks: Array<(event: PlayedStreamEvent, ws: WebSocketType) => void> = [];
  private clearedAudioCallbacks: Array<(event: ClearedAudioEvent, ws: WebSocketType) => void> = [];
  private errorCallbacks: Array<(error: Error, ws: WebSocketType) => void> = [];
  private closeCallbacks: Array<(ws: WebSocketType) => void> = [];

  constructor(options: PlivoWebSocketServerOptions, callback?: () => void) {
    const { validateSignature, authToken, ...wsOptions } = options;
    super(wsOptions, callback);

    this.validateSignatureEnabled = validateSignature ?? false;
    this.authToken = authToken;

    if (this.validateSignatureEnabled && !this.authToken) {
      throw new Error('authToken is required when validateSignature is enabled');
    }
  }

  /**
   * Start accepting WebSocket connections.
   * Call this after registering all event handlers.
   */
  public start(): this {
    if (this.isStarted) {
      throw new Error('PlivoWebSocketServer is already started');
    }
    this.isStarted = true;
    this.setupConnectionHandler();
    return this;
  }

  private setupConnectionHandler() {
    this.on('connection', async (ws: WebSocketType, request: IncomingMessage) => {
      // Validate V3 signature if enabled
      if (this.validateSignatureEnabled) {
        const isValid = this.validateConnectionSignature(request);
        if (!isValid) {
          console.error('[PlivoWebSocketServer] V3 signature validation failed');
          ws.close(1008, 'Signature validation failed');
          return;
        }
      }

      // Initialize metadata for this connection
      this.connectionMetadata.set(ws, {});

      // Buffer messages until connection callbacks complete
      const messageBuffer: any[] = [];
      let isReady = false;

      ws.on('message', (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          if (isReady) {
            this.handleIncomingEvent(parsed, ws);
          } else {
            messageBuffer.push(parsed);
          }
        } catch (error) {
          this.handleError(
            new Error(`Failed to parse message: ${error instanceof Error ? error.message : String(error)}`),
            ws,
          );
        }
      });

      ws.on('error', () => {
        this.handleError(new Error('WebSocket error occurred'), ws);
      });

      ws.on('close', () => {
        this.closeCallbacks.forEach((cb) => cb(ws));
      });

      try {
        // Run connection callbacks
        for (const cb of this.connectionCallbacks) {
          await cb(ws, request);
        }

        // Process buffered messages
        isReady = true;
        for (const msg of messageBuffer) {
          this.handleIncomingEvent(msg, ws);
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error('[PlivoWebSocketServer] Connection setup failed:', err.message);
        this.errorCallbacks.forEach((cb) => {
          try {
            cb(err, ws);
          } catch {
            // Ignore errors in error handlers
          }
        });
        try {
          ws.close(1011, 'Connection setup failed');
        } catch {
          // Ignore close errors
        }
      }
    });
  }

  private validateConnectionSignature(request: IncomingMessage): boolean {
    console.log('validateConnectionSignature', request.headers);
    const signature = request.headers['x-plivo-signature-v3'] as string | undefined;
    const nonce = request.headers['x-plivo-signature-v3-nonce'] as string | undefined;

    if (!signature || !nonce) {
      console.error('[PlivoWebSocketServer] Missing V3 signature headers');
      return false;
    }

    // Construct the full URI from the request
    const host = request.headers.host || '';
    const protocol = (request.socket as any).encrypted ? 'https' : 'http';
    const uri = `${protocol}://${host}${request.url || '/'}`;

    try {
      // Coerce Boolean wrapper to primitive boolean
      console.log('validateV3Signature', request.method ?? 'GET', uri, nonce, this.authToken!, signature);
      return !!validateV3Signature(request.method ?? 'GET', uri, nonce, this.authToken!, signature);
    } catch (error) {
      console.error('[PlivoWebSocketServer] Signature validation error:', error);
      return false;
    }
  }

  private handleIncomingEvent(data: any, ws: WebSocketType) {
    try {
      const metadata = this.connectionMetadata.get(ws) || {};

      switch (data.event) {
        case 'start':
          const startEvent = StartEventSchema.parse(data);
          metadata.streamId = startEvent.start.streamId;
          metadata.accountId = startEvent.start.accountId;
          metadata.callId = startEvent.start.callId;
          metadata.headers = startEvent.extra_headers;
          this.connectionMetadata.set(ws, metadata);
          this.startCallbacks.forEach((cb) => cb(startEvent, ws));
          break;

        case 'media':
          const mediaEvent = MediaEventSchema.parse(data);
          this.mediaCallbacks.forEach((cb) => cb(mediaEvent, ws));
          break;

        case 'dtmf':
          const dtmfEvent = DTMFEventSchema.parse(data);
          this.dtmfCallbacks.forEach((cb) => cb(dtmfEvent, ws));
          break;

        case 'playedStream':
          const playedStreamEvent = PlayedStreamEventSchema.parse(data);
          this.playedStreamCallbacks.forEach((cb) => cb(playedStreamEvent, ws));
          break;

        case 'clearedAudio':
          const clearedAudioEvent = ClearedAudioEventSchema.parse(data);
          this.clearedAudioCallbacks.forEach((cb) => cb(clearedAudioEvent, ws));
          break;

        default:
          this.handleError(new Error(`Unknown event type: ${data.event}`), ws);
      }
    } catch (error) {
      this.handleError(
        new Error(`Failed to handle event: ${error instanceof Error ? error.message : String(error)}`),
        ws,
      );
    }
  }

  private handleError(error: Error, ws: WebSocketType) {
    if (this.errorCallbacks.length > 0) {
      this.errorCallbacks.forEach((cb) => cb(error, ws));
    } else {
      console.error('[PlivoWebSocketServer] Error:', error);
    }
  }

  // Event registration methods (chainable)

  /**
   * Register a callback for new connections.
   * Can be async - will be awaited before any WebSocket events are processed.
   */
  public onConnection(callback: ConnectionCallback): this {
    this.connectionCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback for the 'start' event on all connections
   */
  public onStart(callback: (event: StartEvent, ws: WebSocketType) => void): this {
    this.startCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback for the 'media' event on all connections
   */
  public onMedia(callback: (event: MediaEvent, ws: WebSocketType) => void): this {
    this.mediaCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback for the 'dtmf' event on all connections
   */
  public onDtmf(callback: (event: DTMFEvent, ws: WebSocketType) => void): this {
    this.dtmfCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback for the 'playedStream' event on all connections
   */
  public onPlayedStream(callback: (event: PlayedStreamEvent, ws: WebSocketType) => void): this {
    this.playedStreamCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback for the 'clearedAudio' event on all connections
   */
  public onClearedAudio(callback: (event: ClearedAudioEvent, ws: WebSocketType) => void): this {
    this.clearedAudioCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback for errors on all connections
   */
  public onError(callback: (error: Error, ws: WebSocketType) => void): this {
    this.errorCallbacks.push(callback);
    return this;
  }

  /**
   * Register a callback for when connections close
   */
  public onClose(callback: (ws: WebSocketType) => void): this {
    this.closeCallbacks.push(callback);
    return this;
  }

  // Action methods

  /**
   * Send audio to a specific connection
   * @param ws - WebSocket connection
   * @param contentType - Audio content type (e.g., 'audio/x-l16')
   * @param sampleRate - Sample rate in Hz
   * @param payload - Raw audio data as Buffer, Uint8Array, or ArrayBuffer
   */
  public playAudio(
    ws: WebSocketType,
    contentType: string,
    sampleRate: number,
    payload: Buffer | Uint8Array | ArrayBuffer,
  ) {
    if (ws.readyState !== ws.OPEN) {
      console.warn('Attempted to play audio on a closed WebSocket connection.');
      return;
    }

    // Convert raw audio to base64
    let base64Payload: string;
    if (Buffer.isBuffer(payload)) {
      base64Payload = payload.toString('base64');
    } else if (payload instanceof ArrayBuffer) {
      base64Payload = Buffer.from(payload).toString('base64');
    } else {
      base64Payload = Buffer.from(payload).toString('base64');
    }

    const event: PlayAudioEvent = {
      event: 'playAudio',
      media: { contentType, sampleRate, payload: base64Payload },
    };

    ws.send(JSON.stringify(event));
  }

  /**
   * Send a checkpoint event to a specific connection
   */
  public checkpoint(ws: WebSocketType, name: string) {
    const metadata = this.connectionMetadata.get(ws);
    if (ws.readyState !== ws.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    if (!metadata?.streamId) {
      throw new Error('Stream ID not available. Wait for the start event.');
    }

    const event: CheckpointEvent = {
      event: 'checkpoint',
      streamId: metadata.streamId,
      name,
    };

    ws.send(JSON.stringify(event));
  }

  /**
   * Clear all queued audio for a specific connection
   */
  public clearAudio(ws: WebSocketType) {
    const metadata = this.connectionMetadata.get(ws);
    if (ws.readyState !== ws.OPEN) {
      throw new Error('WebSocket is not connected');
    }
    if (!metadata?.streamId) {
      throw new Error('Stream ID not available. Wait for the start event.');
    }

    const event: ClearAudioEvent = {
      event: 'clearAudio',
      streamId: metadata.streamId,
    };

    ws.send(JSON.stringify(event));
  }

  // Getters for connection metadata

  public getStreamId(ws: WebSocketType): string | undefined {
    return this.connectionMetadata.get(ws)?.streamId;
  }

  public getAccountId(ws: WebSocketType): string | undefined {
    return this.connectionMetadata.get(ws)?.accountId;
  }

  public getCallId(ws: WebSocketType): string | undefined {
    return this.connectionMetadata.get(ws)?.callId;
  }

  public getHeaders(ws: WebSocketType): string | undefined {
    return this.connectionMetadata.get(ws)?.headers;
  }

  /**
   * Check if a connection is active
   */
  public isActive(ws: WebSocketType): boolean {
    return ws.readyState === ws.OPEN;
  }
}

export default PlivoWebSocketServer;
