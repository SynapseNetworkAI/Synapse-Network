/**
 * Synapse Analytics SDK — Frontend Event Emitter
 *
 * Responsibilities:
 *   1. Unified capture / identify / page calls for all frontend tracking
 *   2. Batch events and send to Gateway /api/v1/events endpoint
 *   3. Auto-inject session_id, UTM params, common properties
 *   4. No direct coupling to third-party SDKs (PostHog / GA4)
 *
 * Usage:
 *   import { analytics } from '@/lib/analytics';
 *   analytics.capture('cta_clicked', { cta_id: 'hero_signup', cta_text: 'Get Started' });
 */

import { getGatewayBaseUrl } from '@/utils/gatewayApi';

export interface AnalyticsEvent {
  event_id: string;
  event_name: string;
  timestamp: string;
  distinct_id: string;
  source: 'frontend';
  properties: Record<string, unknown>;
}

export interface AnalyticsConfig {
  /** Gateway events endpoint. Defaults to the configured gateway /api/v1/events */
  endpoint: string;
  /** Current environment */
  env: 'local' | 'staging' | 'prod';
  /** Max events before auto-flush */
  batchSize: number;
  /** Max ms between flushes */
  flushIntervalMs: number;
  /** Enable console logging in dev */
  debug: boolean;
}

function resolveDefaultAnalyticsEndpoint(): string {
  const configuredEndpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT?.trim();
  if (configuredEndpoint) {
    return configuredEndpoint;
  }

  return `${getGatewayBaseUrl()}/api/v1/events`;
}

const DEFAULT_CONFIG: AnalyticsConfig = {
  endpoint: resolveDefaultAnalyticsEndpoint(),
  env: (process.env.NEXT_PUBLIC_ENV as AnalyticsConfig['env']) || 'local',
  batchSize: 10,
  flushIntervalMs: 5_000,
  debug: process.env.NODE_ENV === 'development',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
] as const;

function getSessionId(): string {
  const KEY = 'synapse_session_id';
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

function getAnonymousId(): string {
  const KEY = 'synapse_anonymous_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

function parseUtmParams(): Record<string, string> {
  const STORAGE_KEY = 'synapse_utm';

  // Try to read fresh UTM params from the URL
  const params = new URLSearchParams(window.location.search);
  const fresh: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const val = params.get(key);
    if (val) fresh[key] = val;
  }

  // Persist if we found any new ones
  if (Object.keys(fresh).length > 0) {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  // Fall back to previously persisted values (SPA navigation)
  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as Record<string, string>;
    } catch {
      return {};
    }
  }
  return {};
}

async function hashWallet(address: string): Promise<string> {
  const encoded = new TextEncoder().encode(address.toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Surface detection
// ---------------------------------------------------------------------------

type Surface =
  | 'provider_console'
  | 'console'
  | 'docs'
  | 'landing';

function detectSurface(): Surface {
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  if (path.startsWith('/provider')) return 'provider_console';
  if (path.startsWith('/owner') || path.startsWith('/consumer')) return 'console';
  if (path.startsWith('/docs')) return 'docs';
  return 'landing';
}

// ---------------------------------------------------------------------------
// SynapseAnalytics class
// ---------------------------------------------------------------------------

/** Max events to re-enqueue on flush failure to avoid unbounded growth. */
const MAX_QUEUE_SIZE = 100;

/** Gateway rejects batches larger than this. flush() chunks at this limit. */
const MAX_BATCH_SIZE = 50;

export class SynapseAnalytics {
  private config: AnalyticsConfig;
  private queue: AnalyticsEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private distinctId: string = '';
  private identifiedWalletHash: string | null = null;
  private role: string | null = null;
  private walletProvider: string | null = null;
  private chainId: number | undefined = undefined;

  constructor(config?: Partial<AnalyticsConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Call once on app mount. Starts flush interval & unload listeners. */
  init(): void {
    this.distinctId = getAnonymousId();

    this.flushTimer = setInterval(() => this.flush(), this.config.flushIntervalMs);

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') this.flush();
      });
    }

    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.log('[SynapseAnalytics] initialised', this.config);
    }
  }

  /** Identify a wallet connection. Hashes the address before storing. */
  async identify(
    walletAddress: string,
    opts?: { walletProvider?: string; chainId?: number; role?: string },
  ): Promise<void> {
    const walletHash = await hashWallet(walletAddress);
    const previousId = this.distinctId;

    this.identifiedWalletHash = walletHash;
    this.distinctId = walletHash;
    this.walletProvider = opts?.walletProvider ?? null;
    this.chainId = opts?.chainId;
    this.role = opts?.role ?? null;

    this.capture('$identify', {
      anonymous_id: previousId,
      wallet_hash: walletHash,
    });
  }

  /** Reset back to anonymous tracking (e.g. on wallet disconnect). */
  reset(): void {
    this.identifiedWalletHash = null;
    this.distinctId = getAnonymousId();
    this.walletProvider = null;
    this.chainId = undefined;
    this.role = null;
  }

  /** Tear down timers and flush remaining events. */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  // -----------------------------------------------------------------------
  // Tracking
  // -----------------------------------------------------------------------

  /** Capture an arbitrary analytics event. */
  capture(eventName: string, properties: Record<string, unknown> = {}): void {
    const event: AnalyticsEvent = {
      event_id: crypto.randomUUID(),
      event_name: eventName,
      timestamp: new Date().toISOString(),
      distinct_id: this.distinctId,
      source: 'frontend',
      properties: {
        ...this.commonProperties(),
        ...properties,
      },
    };

    this.queue.push(event);

    if (this.config.debug) {
      // eslint-disable-next-line no-console
      console.log('[SynapseAnalytics] captured', event);
    }

    if (this.queue.length >= this.config.batchSize) {
      this.flush();
    }
  }

  /** Track a page view. Automatically called by AnalyticsProvider on route changes. */
  page(pagePath?: string): void {
    this.capture('page_viewed', {
      page_path: pagePath ?? (typeof window !== 'undefined' ? window.location.pathname : ''),
      page_title: typeof document !== 'undefined' ? document.title : '',
      referrer: typeof document !== 'undefined' ? document.referrer : '',
    });
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private commonProperties(): Record<string, unknown> {
    const utm = parseUtmParams();
    return {
      role: this.role,
      surface: detectSurface(),
      env: this.config.env,
      chain_id: this.chainId,
      wallet_provider: this.walletProvider,
      session_id: getSessionId(),
      page_path: typeof window !== 'undefined' ? window.location.pathname : '',
      ...utm,
    };
  }

  flush(): void {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.queue.length);

    // Chunk into MAX_BATCH_SIZE slices — gateway rejects batches > 50 events.
    for (let i = 0; i < batch.length; i += MAX_BATCH_SIZE) {
      const chunk = batch.slice(i, i + MAX_BATCH_SIZE);
      const payload = JSON.stringify({ events: chunk });

      // Try sendBeacon first (works during unload), fall back to fetch
      const beaconSent =
        typeof navigator !== 'undefined' &&
        typeof navigator.sendBeacon === 'function' &&
        navigator.sendBeacon(
          this.config.endpoint,
          new Blob([payload], { type: 'application/json' }),
        );

      if (!beaconSent) {
        this.fetchSend(payload).catch(() => {
          // Re-enqueue failed chunk, capped at MAX_QUEUE_SIZE
          const capacity = MAX_QUEUE_SIZE - this.queue.length;
          if (capacity > 0) {
            this.queue.unshift(...chunk.slice(0, capacity));
          }
        });
      }
    }
  }

  private async fetchSend(payload: string): Promise<void> {
    const res = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    });
    if (!res.ok) {
      throw new Error(`Analytics flush failed: ${res.status}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const analytics = new SynapseAnalytics();
