/**
 * OyoTrigger
 * ----------
 * Convenience wrapper component for invoking OYO via long-press.
 *
 * Most callers should reach for the `useOyoInvocation()` hook directly
 * — it gives you `bindLongPress()` which you spread onto an existing
 * button to ADD long-press without REPLACING the normal tap.
 *
 * This component is here for the case where you have a generic clickable
 * area you want to wrap (e.g. a custom shape, a feed card hero) and you
 * just want long-press → invoke without writing the wiring.
 *
 * Usage:
 *   <OyoTrigger surface="player" onTap={() => doNormalThing()}>
 *     <YourButton />
 *   </OyoTrigger>
 */

import { useOyoInvocation } from './useOyoInvocation';
import type { InvocationSurface } from '../store/oyoStore';

interface OyoTriggerProps {
  surface: InvocationSurface;
  onTap?: () => void;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

export function OyoTrigger({
  surface,
  onTap,
  children,
  className,
  style,
  ariaLabel,
}: OyoTriggerProps) {
  const { bindLongPress } = useOyoInvocation();
  const bindings = bindLongPress(surface);

  return (
    <button
      type="button"
      className={className}
      style={style}
      aria-label={ariaLabel}
      onClick={onTap}
      {...bindings}
    >
      {children}
    </button>
  );
}

export default OyoTrigger;
