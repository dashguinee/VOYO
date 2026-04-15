/**
 * Audio Error Boundary — catches uncaught throws inside AudioPlayer and
 * prevents them from killing the whole app. The audio pipeline has 30+
 * refs, 15+ useEffects, and integrates with OS APIs (MediaSession,
 * WakeLock, getBattery, AudioContext). Any one of them can throw.
 *
 * On error: log to telemetry, render nothing (the audio element + chain
 * are gone this render but componentDidCatch will attempt one remount).
 * Music stops — but the rest of the app (library, search, UI) survives.
 */

import { Component, type ReactNode } from 'react';
import { trace } from '../services/telemetry';
import { devWarn } from '../utils/logger';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorKey: number;
}

export class AudioErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorKey: 0 };

  static getDerivedStateFromError(): Partial<State> {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string }) {
    trace('audio_boundary_catch', null, {
      name: error.name,
      message: (error.message || '').slice(0, 120),
      componentStack: (errorInfo.componentStack || '').slice(0, 200),
    });
    devWarn('[AudioErrorBoundary] caught:', error);

    // One automatic remount attempt after 1s — covers transient failures
    // (a ref-access race, a throw during chain setup). If it fails again
    // the next catch keeps hasError true.
    setTimeout(() => {
      this.setState({ hasError: false, errorKey: this.state.errorKey + 1 });
    }, 1000);
  }

  render() {
    if (this.state.hasError) return null;
    // Key remount forces React to tear down and rebuild child tree — gives
    // AudioPlayer a fresh mount after a caught throw.
    return <div key={this.state.errorKey}>{this.props.children}</div>;
  }
}
