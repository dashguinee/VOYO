/**
 * Safe — tiny error boundary that hides its children on any render
 * crash instead of bubbling up. Used around individual top-level
 * features on the home page so one misbehaving shelf can't take down
 * the whole tree.
 *
 * Logs the name + error for diagnostics but shows null to the user.
 */

import { Component, type ReactNode } from 'react';
import { criticalError } from '../../utils/logger';

interface Props {
  name: string;
  children: ReactNode;
  /** Optional fallback node — default is null (hidden). */
  fallback?: ReactNode;
}

interface State { dead: boolean }

export class Safe extends Component<Props, State> {
  state: State = { dead: false };

  static getDerivedStateFromError(): State { return { dead: true }; }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log in prod too — we need this info from real users to find
    // rendering bugs that only surface in their session state.
    criticalError(
      `[Safe:${this.props.name}] crashed:`,
      error?.message || error,
      '\nComponent stack:',
      (info?.componentStack || '').split('\n').slice(0, 6).join('\n'),
    );
  }

  render() {
    if (this.state.dead) return this.props.fallback ?? null;
    return this.props.children;
  }
}
