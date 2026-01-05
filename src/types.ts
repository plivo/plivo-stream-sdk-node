import { z } from 'zod';

export enum IncomingEventEnum {
  START = 'start',
  MEDIA = 'media',
  DTMF = 'dtmf',
  PLAYED_STREAM = 'playedStream',
  CLEARED_AUDIO = 'clearedAudio',
}

export enum OutgoingEventEnum {
  PLAY_AUDIO = 'playAudio',
  CHECKPOINT = 'checkpoint',
  CLEAR_AUDIO = 'clearAudio',
}

const IncomingEventType = z.enum(IncomingEventEnum);

const OutgoingEventType = z.enum(OutgoingEventEnum);

const StartEventDataSchema = z.object({
  callId: z.uuid(),
  streamId: z.uuid(),
  accountId: z.string(),
  tracks: z.array(z.string()),
  mediaFormat: z.object({
    encoding: z.string(),
    sampleRate: z.number(),
  }),
});

export const StartEventSchema = z.object({
  event: z.literal('start'),
  sequenceNumber: z.number(),
  start: StartEventDataSchema,
  extra_headers: z.string(),
});

const MediaEventDataSchema = z.object({
  track: z.string(),
  timestamp: z.string(),
  chunk: z.number(),
  payload: z.string(),
});

export const MediaEventSchema = z
  .object({
    sequenceNumber: z.number(),
    streamId: z.uuid(),
    event: z.literal('media'),
    media: MediaEventDataSchema,
    extra_headers: z.string(),
  })
  .transform((data) => ({
    ...data,
    /** Decode base64 payload to raw audio Buffer */
    getRawMedia(): Buffer {
      return Buffer.from(data.media.payload, 'base64');
    },
  }));

const DTMFEventDataSchema = z.object({
  track: z.string(),
  digit: z.string(),
  timestamp: z.string(),
});

export const DTMFEventSchema = z.object({
  event: z.literal('dtmf'),
  sequenceNumber: z.number(),
  streamId: z.uuid(),
  dtmf: DTMFEventDataSchema,
  extra_headers: z.string(),
});

export const PlayedStreamEventSchema = z.object({
  event: z.literal('playedStream'),
  sequenceNumber: z.number(),
  streamId: z.uuid(),
  name: z.string(),
});

export const ClearedAudioEventSchema = z.object({
  event: z.literal('clearedAudio'),
  sequenceNumber: z.number(),
  streamId: z.uuid(),
});

const PlayAudioEventDataSchema = z.object({
  contentType: z.string(),
  sampleRate: z.number(),
  payload: z.string(),
});

const PlayAudioEventSchema = z.object({
  event: z.literal('playAudio'),
  media: PlayAudioEventDataSchema,
});

const CheckpointEventSchema = z.object({
  event: z.literal('checkpoint'),
  streamId: z.uuid(),
  name: z.string(),
});

const ClearAudioEventSchema = z.object({
  event: z.literal('clearAudio'),
  streamId: z.uuid(),
});

export type StartEvent = z.infer<typeof StartEventSchema>;
export type MediaEvent = z.infer<typeof MediaEventSchema>;
export type DTMFEvent = z.infer<typeof DTMFEventSchema>;
export type PlayedStreamEvent = z.infer<typeof PlayedStreamEventSchema>;
export type ClearedAudioEvent = z.infer<typeof ClearedAudioEventSchema>;
export type PlayAudioEvent = z.infer<typeof PlayAudioEventSchema>;
export type CheckpointEvent = z.infer<typeof CheckpointEventSchema>;
export type ClearAudioEvent = z.infer<typeof ClearAudioEventSchema>;
