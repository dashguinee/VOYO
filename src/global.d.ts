/// <reference types="vite/client" />

// Build-time constant injected by vite.config.ts via `define`.
declare const __APP_VERSION__: string;

// VOYO window extensions
declare interface Window {
  // Debug utilities — set at runtime by their respective modules
  voyoHistory?: () => void;
  voyoDJ?: Record<string, CallableFunction>;
  voyoPool?: Record<string, CallableFunction>;
  voyoTelemetry?: Record<string, CallableFunction>;
  voyoCentral?: Record<string, CallableFunction>;
  trackVerifier?: Record<string, CallableFunction>;

  // Internal state
  __voyoReactionChannel?: { unsubscribe: () => void };

  // Push notification bridge (set by DynamicIsland)
  pushNotification?: (notif: {
    id: string;
    type: 'music' | 'message' | 'system' | 'admin';
    title: string;
    subtitle: string;
    read?: boolean;
    color?: string;
    url?: string;
  }) => void;

  // Vendor-prefixed browser APIs
  webkitAudioContext?: typeof AudioContext;
  SpeechRecognition?: typeof SpeechRecognition;
  webkitSpeechRecognition?: typeof SpeechRecognition;
}
