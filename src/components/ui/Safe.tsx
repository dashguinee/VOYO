/**
 * Safe — tiny error boundary that hides its children on any render
 * crash instead of bubbling up. Used around individual top-level
 * features on the home page so one misbehaving shelf can't take down
 * the whole tree.
 *
 * Logs the name + error for diagnostics but shows null to the user.
 */

import { Component, type ReactNode } from 'react';
import { devWarn } from '../../utils/logger';

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

  componentDidCatch(error: Error) {
    devWarn(`[Safe:${this.props.name}] crashed:`, error?.message || error);
  }

  render() {
    if (this.state.dead) return this.props.fallback ?? null;
    return this.props.children;
  }
}
