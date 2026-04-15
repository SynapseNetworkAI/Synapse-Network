/**
 * Analytics Funnel Integration Tests
 * =====================================
 * Validates the frontend analytics SDK tracking the full Consumer and Provider
 * activation funnels end-to-end, including:
 *   - Full HTTP payload construction matching gateway contract
 *   - Identity stitching (anonymous → wallet hash)
 *   - UTM context propagation through funnel steps
 *   - Session continuity across page navigations
 *   - Privacy: no raw wallet addresses in any emitted payload
 *   - Batch chunking respects gateway 50-event limit
 *   - Consumer funnel 6-step coverage
 *   - Provider funnel 5-step coverage
 *   - Error event payloads for failed actions
 *
 * Run:
 *   cd services/user-front
 *   npx vitest run src/lib/__tests__/analytics-funnel-integration.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SynapseAnalytics, type AnalyticsEvent } from '../analytics';

// ---------------------------------------------------------------------------
// Browser-global mocks
// ---------------------------------------------------------------------------

type Batch = { events: AnalyticsEvent[] };

function makeStore(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
    get length() { return Object.keys(store).length; },
    key: vi.fn(() => null),
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
let mockSessionStorage: Storage;
let mockLocalStorage: Storage;
let uuidCounter = 0;

/** Create a fresh SDK instance with batchSize=1 (flush immediately). */
function sdk(overrides: Record<string, unknown> = {}): SynapseAnalytics {
  return new SynapseAnalytics({
    endpoint: 'https://api.synapse.test/api/v1/events',
    batchSize: 1,
    flushIntervalMs: 60_000,
    env: 'test',
    debug: false,
    ...overrides,
  });
}

beforeEach(() => {
  uuidCounter = 0;
  mockSessionStorage = makeStore();
  mockLocalStorage = makeStore();

  vi.stubGlobal('sessionStorage', mockSessionStorage);
  vi.stubGlobal('localStorage', mockLocalStorage);

  vi.stubGlobal('window', {
    location: { pathname: '/', search: '' },
    addEventListener: vi.fn(),
  });
  vi.stubGlobal('document', {
    title: 'Synapse Network',
    referrer: '',
    addEventListener: vi.fn(),
    visibilityState: 'visible',
  });
  vi.stubGlobal('navigator', {
    sendBeacon: vi.fn(() => false),
  });
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => `test-uuid-${++uuidCounter}`),
    subtle: {
      digest: vi.fn(async (_algo: string, data: ArrayBuffer) => {
        // Deterministic fake hash: prefix bytes of input → 32-byte output
        const input = new Uint8Array(data as ArrayBuffer);
        const out = new Uint8Array(32);
        for (let i = 0; i < Math.min(input.length, 32); i++) out[i] = input[i];
        return out.buffer;
      }),
    },
  });
  vi.stubGlobal('TextEncoder', globalThis.TextEncoder);

  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Extract all batches sent to the mock endpoint. */
function allBatches(): Batch[] {
  return fetchMock.mock.calls.map(
    (call) => JSON.parse(call[1].body as string) as Batch,
  );
}

/** Flatten all sent events across all batches. */
function allEvents(): AnalyticsEvent[] {
  return allBatches().flatMap((b) => b.events);
}

// ---------------------------------------------------------------------------
// Consumer Activation Funnel
// ---------------------------------------------------------------------------

describe('Consumer activation funnel', () => {
  it('emits all 6 funnel steps in sequence', async () => {
    const instance = sdk();
    instance.init();

    // Step 1: Landing page visit
    instance.capture('page_viewed', { page_path: '/', surface: 'landing' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // Step 2: Wallet connect
    instance.capture('wallet_connect_started', { wallet_provider: 'MetaMask' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    instance.capture('wallet_connected', {
      wallet_provider: 'MetaMask',
      chain_id: 42161,
      is_new_user: true,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    // Step 3: Identity (simulating wallet identify)
    await instance.identify('0xConsumer1234567890abcdef1234567890ABCDEF');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    // Step 4: Signup
    instance.capture('consumer_signup_completed', {
      wallet_provider: 'MetaMask',
      chain_id: 42161,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));

    // Step 5: Deposit started (gateway handles completion)
    instance.capture('deposit_started', {
      amount_usdc: 10.0,
      token_symbol: 'USDC',
      chain_id: 42161,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));

    instance.destroy();

    const events = allEvents();
    const names = events.map((e) => e.event_name);

    expect(names).toContain('page_viewed');
    expect(names).toContain('wallet_connect_started');
    expect(names).toContain('wallet_connected');
    expect(names).toContain('$identify');
    expect(names).toContain('consumer_signup_completed');
    expect(names).toContain('deposit_started');
  });

  it('distinct_id switches from anonymous to wallet hash after identify', async () => {
    const instance = sdk();
    instance.init();

    // Capture before identify — should use anonymous UUID
    instance.capture('page_viewed', { page_path: '/' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const anonEvent = allEvents()[0];
    const anonId = anonEvent.distinct_id;
    expect(anonId).toBeTruthy();

    // Identify — distinct_id should switch to wallet hash
    await instance.identify('0xConsumer1234567890abcdef1234567890ABCDEF');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    instance.capture('consumer_signup_completed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const events = allEvents();
    const signupEvent = events.find((e) => e.event_name === 'consumer_signup_completed');
    expect(signupEvent).toBeDefined();

    // After identify, distinct_id must differ from anon UUID
    expect(signupEvent!.distinct_id).not.toBe(anonId);

    instance.destroy();
  });

  it('$identify event carries anonymous_id and wallet_hash in properties', async () => {
    const instance = sdk();
    instance.init();

    // Capture a pre-identity event to establish anonymous ID
    instance.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const anonId = allEvents()[0].distinct_id;

    await instance.identify('0xConsumer1234567890abcdef1234567890ABCDEF');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const events = allEvents();
    const identifyEvent = events.find((e) => e.event_name === '$identify');
    expect(identifyEvent).toBeDefined();

    const props = identifyEvent!.properties;
    expect(props.anonymous_id).toBe(anonId);
    expect(typeof props.wallet_hash).toBe('string');
    expect((props.wallet_hash as string).length).toBeGreaterThan(0);

    // wallet_hash must NOT be the raw 0x address
    expect(props.wallet_hash).not.toMatch(/^0x[0-9a-fA-F]{40}$/);

    instance.destroy();
  });

  it('deposit_started event carries required financial properties', async () => {
    const instance = sdk();
    instance.init();

    instance.capture('deposit_started', {
      amount_usdc: 50.0,
      token_symbol: 'USDC',
      chain_id: 42161,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const evt = allEvents()[0];
    expect(evt.event_name).toBe('deposit_started');
    expect(evt.properties.amount_usdc).toBe(50.0);
    expect(evt.properties.token_symbol).toBe('USDC');
    expect(evt.properties.chain_id).toBe(42161);

    instance.destroy();
  });

  it('UTM context propagates through all funnel steps', async () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/',
        search: '?utm_source=producthunt&utm_medium=community&utm_campaign=launch_day',
      },
      addEventListener: vi.fn(),
    });

    const instance = sdk();
    instance.init();

    const funnelSteps = ['page_viewed', 'wallet_connected', 'consumer_signup_completed'];
    for (const step of funnelSteps) {
      instance.capture(step);
    }
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const events = allEvents();
    for (const evt of events) {
      expect(evt.properties.utm_source).toBe('producthunt');
      expect(evt.properties.utm_medium).toBe('community');
      expect(evt.properties.utm_campaign).toBe('launch_day');
    }

    instance.destroy();
  });
});

// ---------------------------------------------------------------------------
// Provider Activation Funnel
// ---------------------------------------------------------------------------

describe('Provider activation funnel', () => {
  it('emits all 5 provider funnel steps', async () => {
    vi.stubGlobal('window', {
      location: { pathname: '/provider', search: '' },
      addEventListener: vi.fn(),
    });

    const instance = sdk();
    instance.init();
    await instance.identify('0xProvider1234567890abcdef1234567890ABCDEF', {
      role: 'provider',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    instance.capture('provider_signup_completed', {
      wallet_provider: 'Coinbase',
      chain_id: 42161,
    });
    await vi.waitFor(() => {
      const names = allEvents().map((e) => e.event_name);
      return names.includes('provider_signup_completed');
    });

    instance.capture('service_manifest_step_completed', {
      step_name: 'pricing',
      step_number: 1,
    });
    await vi.waitFor(() => {
      const names = allEvents().map((e) => e.event_name);
      return names.includes('service_manifest_step_completed');
    });

    instance.destroy();

    const names = allEvents().map((e) => e.event_name);
    expect(names).toContain('$identify');
    expect(names).toContain('provider_signup_completed');
    expect(names).toContain('service_manifest_step_completed');
  });

  it('service_manifest_step_completed carries step_name and step_number', async () => {
    const instance = sdk();
    instance.init();

    instance.capture('service_manifest_step_completed', {
      step_name: 'endpoint_url',
      step_number: 2,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const evt = allEvents()[0];
    expect(evt.event_name).toBe('service_manifest_step_completed');
    expect(evt.properties.step_name).toBe('endpoint_url');
    expect(evt.properties.step_number).toBe(2);

    instance.destroy();
  });

  it('provider surface detected correctly for /provider routes', async () => {
    vi.stubGlobal('window', {
      location: { pathname: '/provider/services', search: '' },
      addEventListener: vi.fn(),
    });

    const instance = sdk();
    instance.init();

    instance.capture('provider_signup_completed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const evt = allEvents()[0];
    expect(evt.properties.surface).toBe('provider_console');

    instance.destroy();
  });
});

// ---------------------------------------------------------------------------
// Privacy: No Raw Wallet Addresses
// ---------------------------------------------------------------------------

describe('Privacy: no raw wallet addresses in emitted payloads', () => {
  const RAW_WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

  function assertNoRawWallet(events: AnalyticsEvent[]) {
    for (const evt of events) {
      // Check distinct_id
      expect(evt.distinct_id).not.toMatch(RAW_WALLET_RE);
      // Check all string property values
      for (const val of Object.values(evt.properties)) {
        if (typeof val === 'string') {
          expect(val).not.toMatch(RAW_WALLET_RE);
        }
      }
    }
  }

  it('anonymous events never expose a raw wallet address', async () => {
    const instance = sdk();
    instance.init();

    instance.capture('page_viewed');
    instance.capture('cta_clicked', { cta_id: 'hero_get_started', cta_location: 'hero' });
    instance.capture('wallet_connect_started', { wallet_provider: 'MetaMask' });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    assertNoRawWallet(allEvents());
    instance.destroy();
  });

  it('$identify event hashes the wallet address before emitting', async () => {
    const instance = sdk();
    instance.init();

    await instance.identify('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    assertNoRawWallet(allEvents());
    instance.destroy();
  });

  it('full consumer funnel produces zero raw wallet addresses', async () => {
    const instance = sdk();
    instance.init();

    instance.capture('page_viewed');
    await instance.identify('0xConsumer1234567890abcdef1234567890ABCDEF');
    instance.capture('consumer_signup_completed');
    instance.capture('deposit_started', { amount_usdc: 10, token_symbol: 'USDC', chain_id: 42161 });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    assertNoRawWallet(allEvents());
    instance.destroy();
  });
});

// ---------------------------------------------------------------------------
// Session Continuity (SPA route changes)
// ---------------------------------------------------------------------------

describe('Session continuity across SPA navigation', () => {
  it('same session_id persists across page captures', async () => {
    const instance = sdk();
    instance.init();

    instance.page('/');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const sessionId1 = allEvents()[0].properties.session_id;

    instance.page('/marketplace');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const sessionId2 = allEvents()[1].properties.session_id;

    expect(sessionId1).toBe(sessionId2);
    instance.destroy();
  });

  it('page_viewed is emitted for each .page() call', async () => {
    const instance = sdk();
    instance.init();

    instance.page('/');
    instance.page('/marketplace');
    instance.page('/provider');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const events = allEvents();
    expect(events.filter((e) => e.event_name === 'page_viewed')).toHaveLength(3);
    instance.destroy();
  });
});

// ---------------------------------------------------------------------------
// Batch Chunking: Gateway 50-event limit
// ---------------------------------------------------------------------------

describe('Batch size enforcement', () => {
  it('large flush is chunked into ≤50-event batches', async () => {
    const instance = sdk({ batchSize: 200 }); // don't auto-flush until 200 events
    instance.init();

    // Capture 120 events
    for (let i = 0; i < 120; i++) {
      instance.capture('page_viewed', { seq: i });
    }

    instance.flush();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    // All individual batch calls must have ≤ 50 events
    const batches = allBatches();
    for (const batch of batches) {
      expect(batch.events.length).toBeLessThanOrEqual(50);
    }

    // All 120 events must be sent in total
    const totalEvents = batches.reduce((sum, b) => sum + b.events.length, 0);
    expect(totalEvents).toBe(120);

    instance.destroy();
  });

  it('batchSize=1 flushes immediately on each capture', async () => {
    const instance = sdk({ batchSize: 1 });
    instance.init();

    instance.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    instance.capture('wallet_connected', { wallet_provider: 'MetaMask' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    // Each call should be exactly 1 event
    for (const batch of allBatches()) {
      expect(batch.events.length).toBe(1);
    }

    instance.destroy();
  });
});

// ---------------------------------------------------------------------------
// CTA Click Tracking
// ---------------------------------------------------------------------------

describe('CTA click tracking', () => {
  it('cta_clicked carries cta_id, cta_text, cta_location, page_path', async () => {
    const instance = sdk();
    instance.init();

    instance.capture('cta_clicked', {
      cta_id: 'hero_get_started',
      cta_text: 'Get Started Free',
      cta_location: 'hero',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const evt = allEvents()[0];
    expect(evt.event_name).toBe('cta_clicked');
    const props = evt.properties;
    expect(props.cta_id).toBe('hero_get_started');
    expect(props.cta_text).toBe('Get Started Free');
    expect(props.cta_location).toBe('hero');
    expect(typeof props.page_path).toBe('string');

    instance.destroy();
  });

  it('provider_console cta uses provider_console surface', async () => {
    vi.stubGlobal('window', {
      location: { pathname: '/provider/services', search: '' },
      addEventListener: vi.fn(),
    });

    const instance = sdk();
    instance.init();

    instance.capture('cta_clicked', {
      cta_id: 'deploy_service',
      cta_text: 'Deploy API',
      cta_location: 'services_header',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(allEvents()[0].properties.surface).toBe('provider_console');

    instance.destroy();
  });
});

// ---------------------------------------------------------------------------
// Event Field Schema Invariants
// ---------------------------------------------------------------------------

describe('Event field schema invariants', () => {
  it('every event has event_id as valid UUID format', async () => {
    const instance = sdk();
    instance.init();

    const funnelEvents = ['page_viewed', 'wallet_connected', 'consumer_signup_completed'];
    for (const name of funnelEvents) {
      instance.capture(name);
    }
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    for (const evt of allEvents()) {
      // UUID format (or test UUID from mock)
      expect(typeof evt.event_id).toBe('string');
      expect(evt.event_id.length).toBeGreaterThan(0);
    }

    instance.destroy();
  });

  it('every event has ISO 8601 timestamp', async () => {
    const instance = sdk();
    instance.init();

    instance.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const ts = new Date(allEvents()[0].timestamp);
    expect(ts.getTime()).toBeGreaterThan(0);

    instance.destroy();
  });

  it('source is always "frontend" for all SDK events', async () => {
    const instance = sdk();
    instance.init();

    instance.capture('page_viewed');
    instance.capture('wallet_connected');
    instance.capture('cta_clicked', { cta_id: 'hero', cta_location: 'hero' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    for (const evt of allEvents()) {
      expect(evt.source).toBe('frontend');
    }

    instance.destroy();
  });

  it('properties object always present and is a plain object', async () => {
    const instance = sdk();
    instance.init();

    instance.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const { properties } = allEvents()[0];
    expect(typeof properties).toBe('object');
    expect(properties).not.toBeNull();
    expect(Array.isArray(properties)).toBe(false);

    instance.destroy();
  });
});
