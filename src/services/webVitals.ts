/**
 * Web Vitals → telemetry.
 *
 * Reports LCP (Largest Contentful Paint), INP (Interaction to Next Paint),
 * and CLS (Cumulative Layout Shift) once they're measured. The web-vitals
 * library defers until the metric is final (e.g. INP fires on visibility
 * change with the worst observed interaction), so each metric ships at
 * most once per page lifecycle.
 *
 * Stored as event_type='vital' with meta.metric='LCP'|'INP'|'CLS' so
 * dashboards can compute p75/p95 over time without joining tables.
 *
 * No FCP/TTFB — those are diagnostic for the LCP/INP we already get.
 */

import { onLCP, onINP, onCLS, type Metric } from 'web-vitals';
import { logPlaybackEvent } from './telemetry';

let installed = false;

const ship = (m: Metric): void => {
  try {
    logPlaybackEvent({
      event_type: 'vital',
      track_id: '-',
      meta: {
        metric: m.name,
        value: Math.round(m.value * 100) / 100,
        rating: m.rating,            // 'good' | 'needs-improvement' | 'poor'
        delta: Math.round(m.delta * 100) / 100,
        nav_type: m.navigationType,
      },
    });
  } catch { /* never break the page for telemetry */ }
};

export function installWebVitals(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  // reportAllChanges:false (default) — fires once with the final value.
  onLCP(ship);
  onINP(ship);
  onCLS(ship);
}
