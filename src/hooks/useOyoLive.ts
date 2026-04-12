/**
 * useOyoLive — Gemini Live WebSocket for OYO voice conversations.
 *
 * Ported from Hub's useGeminiLive, adapted for VOYO:
 * - Uses OYO music tools (converted via gemini-bridge)
 * - Tool calls dispatch through OYO's registry (executeTool)
 * - System instruction includes OYO's personality + now-playing context
 * - Audio output plays through a separate AudioContext (not the music chain)
 *
 * API: Gemini 2.5 Flash Native Audio (BidiGenerateContent WebSocket)
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { listTools, executeTool } from '../oyo/tools/registry';
import { allOyoToolsAsGemini, type GeminiFunctionDeclaration } from '../oyo/tools/gemini-bridge';
import { devLog, devWarn } from '../utils/logger';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const MODEL = 'models/gemini-2.5-flash-native-audio-latest';
const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`;
const OUTPUT_SAMPLE_RATE = 24000;
const MAX_RETRIES = 4;
const BACKOFF_BASE_MS = 2000;
const KEEPALIVE_MS = 15000;

// -- Utility --

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function pcm16ToFloat32(pcm: ArrayBuffer): Float32Array {
  const int16 = new Int16Array(pcm);
  const f32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
  return f32;
}

// -- Audio Queue (separate from music chain) --

class VoiceAudioPlayer {
  private ctx: AudioContext | null = null;
  private nextStart = 0;
  private pending = 0;
  playing = false;
  onDone: (() => void) | null = null;
  onPlayingChange: ((p: boolean) => void) | null = null;

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  enqueue(pcm: ArrayBuffer) {
    const ctx = this.getCtx();
    const samples = pcm16ToFloat32(pcm);
    if (!samples.length) return;
    const buf = ctx.createBuffer(1, samples.length, OUTPUT_SAMPLE_RATE);
    buf.getChannelData(0).set(samples);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const now = ctx.currentTime;
    const start = Math.max(now, this.nextStart);
    this.nextStart = start + buf.duration;
    this.pending++;
    if (!this.playing) { this.playing = true; this.onPlayingChange?.(true); }
    src.onended = () => {
      this.pending--;
      if (this.pending <= 0) {
        this.pending = 0;
        this.playing = false;
        this.onPlayingChange?.(false);
        this.onDone?.();
      }
    };
    src.start(start);
  }

  flush() {
    if (this.ctx) { this.ctx.close().catch(() => {}); this.ctx = null; }
    this.nextStart = 0;
    this.pending = 0;
    if (this.playing) { this.playing = false; this.onPlayingChange?.(false); }
  }

  reset() { this.nextStart = 0; }
}

// -- OYO Tool Handler --

async function oyoToolHandler(name: string, args: Record<string, unknown>): Promise<unknown> {
  // Convert Gemini args to OYO's string-based params
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(args)) {
    params[k] = String(v);
  }
  const result = await executeTool({ id: Date.now().toString(), tool: name, params });
  return result.success ? result.data : { error: result.data };
}

// -- Hook --

export interface OyoLiveController {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  speaking: boolean;
  connect: (systemInstruction: string) => void;
  disconnect: () => void;
  sendAudio: (pcm: ArrayBuffer) => void;
  sendText: (text: string) => void;
  sendContext: (ctx: string) => void;
  onText: React.MutableRefObject<((text: string) => void) | null>;
  onTurnDone: React.MutableRefObject<(() => void) | null>;
}

export function useOyoLive(): OyoLiveController {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const onText = useRef<((text: string) => void) | null>(null);
  const onTurnDone = useRef<(() => void) | null>(null);
  const playerRef = useRef<VoiceAudioPlayer | null>(null);
  const retryRef = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepalive = useRef<ReturnType<typeof setInterval> | null>(null);
  const sysRef = useRef('');

  // Build OYO tools as Gemini FunctionDeclarations (computed once)
  const oyoGeminiTools = useRef<GeminiFunctionDeclaration[]>(allOyoToolsAsGemini(listTools()));

  // Init voice audio player
  useEffect(() => {
    const p = new VoiceAudioPlayer();
    p.onPlayingChange = (v) => setSpeaking(v);
    playerRef.current = p;
    return () => { p.flush(); playerRef.current = null; };
  }, []);

  // Handle WebSocket messages
  const handleMsg = useCallback(async (ev: MessageEvent) => {
    let data: Record<string, unknown>;
    try {
      const raw = ev.data instanceof Blob ? await ev.data.text() : ev.data as string;
      data = JSON.parse(raw);
    } catch { return; }

    if ('setupComplete' in data) {
      retryRef.current = 0;
      setError(null);
      setConnected(true);
      setConnecting(false);
      if (keepalive.current) clearInterval(keepalive.current);
      keepalive.current = setInterval(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ clientContent: { turnComplete: false } }));
        }
      }, KEEPALIVE_MS);
      devLog('[OYO Live] Connected');
      return;
    }

    if ('serverContent' in data) {
      const sc = data.serverContent as Record<string, unknown>;
      if (sc.turnComplete) { playerRef.current?.reset(); onTurnDone.current?.(); return; }
      const mt = sc.modelTurn as { parts?: Array<Record<string, unknown>> } | undefined;
      if (mt?.parts) {
        for (const part of mt.parts) {
          if (typeof part.text === 'string' && part.text.length > 0) onText.current?.(part.text);
          const inline = part.inlineData as { data?: string } | undefined;
          if (inline?.data) {
            try { playerRef.current?.enqueue(base64ToArrayBuffer(inline.data)); } catch {}
          }
        }
      }
      if (sc.outputTranscription) {
        const txt = (sc.outputTranscription as { text?: string })?.text;
        if (txt) onText.current?.(txt);
      }
      return;
    }

    if ('toolCall' in data) {
      const tc = data.toolCall as { functionCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }> };
      if (tc.functionCalls) {
        const responses = [];
        for (const call of tc.functionCalls) {
          devLog(`[OYO Live] Tool: ${call.name}`, call.args);
          let result: unknown;
          try { result = await oyoToolHandler(call.name, call.args); }
          catch (e) { result = { error: String(e) }; }
          responses.push({ id: call.id, name: call.name, response: { result } });
        }
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
        }
      }
      return;
    }
  }, []);

  const connect = useCallback((systemInstruction: string) => {
    if (wsRef.current) return;
    if (!GEMINI_API_KEY) { setError('No Gemini API key'); return; }
    sysRef.current = systemInstruction;
    retryRef.current = 0;
    setError(null);
    setConnecting(true);
    setConnected(false);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        setup: {
          model: MODEL,
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
          },
          systemInstruction: { parts: [{ text: systemInstruction }] },
          tools: [{ functionDeclarations: oyoGeminiTools.current }],
        },
      }));
      devLog('[OYO Live] Setup sent');
    };

    ws.onmessage = handleMsg;
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      wsRef.current = null;
      if (keepalive.current) clearInterval(keepalive.current);
      setConnected(false);
      setConnecting(false);
      if (ev.code !== 1000 && retryRef.current < MAX_RETRIES) {
        const delay = BACKOFF_BASE_MS * Math.pow(2, retryRef.current++);
        retryTimer.current = setTimeout(() => connect(sysRef.current), delay);
      } else if (ev.code !== 1000) {
        setError(ev.reason || `Disconnected (${ev.code})`);
      }
    };
  }, [handleMsg]);

  const disconnect = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (keepalive.current) clearInterval(keepalive.current);
    retryRef.current = MAX_RETRIES;
    playerRef.current?.flush();
    wsRef.current?.close(1000, 'User disconnect');
    wsRef.current = null;
    setConnected(false);
    setConnecting(false);
  }, []);

  const sendAudio = useCallback((pcm: ArrayBuffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      realtimeInput: { mediaChunks: [{ mimeType: 'audio/pcm;rate=16000', data: arrayBufferToBase64(pcm) }] },
    }));
  }, []);

  const sendText = useCallback((text: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true },
    }));
  }, []);

  const sendContext = useCallback((ctx: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      clientContent: {
        turns: [{ role: 'user', parts: [{ text: `[CONTEXT UPDATE]\n${ctx}` }] }],
        turnComplete: true,
      },
    }));
  }, []);

  // Reconnect on network restore
  useEffect(() => {
    const handleOnline = () => {
      if (!wsRef.current && sysRef.current) { retryRef.current = 0; connect(sysRef.current); }
    };
    const handleVis = () => {
      if (document.visibilityState === 'visible' && !wsRef.current && sysRef.current) {
        retryRef.current = 0; connect(sysRef.current);
      }
    };
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVis);
    return () => { window.removeEventListener('online', handleOnline); document.removeEventListener('visibilitychange', handleVis); };
  }, [connect]);

  // Cleanup
  useEffect(() => () => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    if (keepalive.current) clearInterval(keepalive.current);
    wsRef.current?.close(1000, 'Unmount');
    wsRef.current = null;
  }, []);

  return { connected, connecting, error, speaking, connect, disconnect, sendAudio, sendText, sendContext, onText, onTurnDone };
}
