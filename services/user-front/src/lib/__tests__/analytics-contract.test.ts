/**
 * Analytics HTTP Contract Tests
 * =================================
 * Validates that the frontend SDK sends HTTP payloads that match the gateway's
 * expected schema at `POST /api/v1/events`.
 *
 * These are "contract" tests — they verify the serialization format, field
 * names, and structural constraints agreed upon by both sides, without
 * requiring a live backend.
 *
 * Run:
 *   cd services/user-front
 *   npm test src/lib/__tests__/analytics-contract.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SynapseAnalytics, type AnalyticsEvent, type AnalyticsBatch } from '../analytics';

// ---------------------------------------------------------------------------
// Browser mocks (same pattern as analytics.test.ts)
// ---------------------------------------------------------------------------

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

function createAnalytics(overrides = {}) {
  return new SynapseAnalytics({
    endpoint: 'https://api.synapse.test/api/v1/events',
    batchSize: 1, // flush immediately on every capture
    flushIntervalMs: 60_000,
    ...overrides,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubGlobal('sessionStorage', makeStore());
  vi.stubGlobal('localStorage', makeStore());
  vi.stubGlobal('window', {
    location: { pathname: '/', search: '?utm_source=hn&utm_medium=social&utm_campaign=launch' },
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
    randomUUID: vi.fn(() => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'),
    subtle: {
      digest: vi.fn(async (_algo: string, data: ArrayBuffer) => {
        // Deterministic fake: reflect input bytes
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

/** Extract the parsed JSON body from the first fetch call. */
function getLastPayload(): AnalyticsBatch {
  const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse(lastCall[1].body as string) as AnalyticsBatch;
}

// ---------------------------------------------------------------------------
// Contract: top-level HTTP request shape
// ---------------------------------------------------------------------------

describe('HTTP request shape', () => {
  it('POSTs to the configured endpoint', async () => {
    const sdk = createAnalytics();
    sdk.init();
    sdk.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.synapse.test/api/v1/events');
    sdk.destroy();
  });

  it('sends Content-Type: application/json', async () => {
    const sdk = createAnalytics();
    sdk.init();
    sdk.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    sdk.destroy();
  });

  it('uses POST method', async () => {
    const sdk = createAnalytics();
    sdk.init();
    sdk.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    sdk.destroy();
  });

  it('body is JSON with top-level "events" array', async () => {
    const sdk = createAnalytics();
    sdk.init();
    sdk.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = getLastPayload();
    expect(Array.isArray(body.events)).toBe(true);
    sdk.destroy();
  });
});

// ---------------------------------------------------------------------------
// Contract: individual event object schema
// ---------------------------------------------------------------------------

describe('Event object schema', () => {
  it('each event has event_id (UUID string)', async () => {
    const sdk = createAnalytics();
    sdk.init();
    sdk.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { events } = getLastPayload();
    expect(events[0].event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    sdk.destroy();
  });

  it('each event has event_name (string)', async () => {
    const sdk = createAnalytics();
    sdk.init();
    sdk.capture('cta_clicked', { cta_id: 'hero' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { events } = getLastPayload();
    expect(typeof events[0].event_name).toBe('string');
    expect(events[0].event_name).toBe('cta_clicked');
    sdk.destroy();
  });

  it('each event has ISO 8601 timestamp', async () => {
    const sdk = createAnalytics();
    sdk.init();
    sdk.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { events } = getLastPayload();
    // Must be parseable as a valid date
    const ts = new Date(events[0].timestamp as string);
    expect(ts.getTime()).toBeGreaterThan(0);
    sdk.destroy();
  });

  it('each event has distinct_id (non-empty string)', async () => {
    const sdk = createAnalytics();
    sdk.init();
    sdk.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { events } = getLastPayload();
    expect(typeof events[0].distinct_id).toBe('string');
    expect((events[0].distinct_id as string).length).toBeGreaterThan(0);
    sdk.destroy();
  });

  it('source is always "frontend"', async () => {
    const sdk = createAnalytics();
    sdk.init();
    sdk.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { events } = getLastPayload();
    expect(events[0].source).toBe('frontend');
    sdk.destroy();
  });

  it('properties is an object', async () => {
    const sdk = createAnalytics();
    sdk.init();
    sdk.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { events } = getLastPayload();
    expect(typeof events[0].properties).toBe('object');
    expect(events[0].properties).not.toBeNull();
    sdk.destroy();
  });
});

// ---------------------------------------------------------------------------
// Contract: distinct_id is never a raw 0x wallet address
// ---------------------------------------------------------------------------

describe('Privacy contract', () => {
  const RAW_WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

  it('distinct_id on anonymous events is not a raw wallet address', async () => {
    const sdk = createAnalytics();
    sdk.init();
    sdk.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { events } = getLastPayload();
    expect((events[0].distinct_id as string)).not.toMatch(RAW_WALLET_RE);
    sdk.destroy();
  });

  it('$identify event carries wallet_hash in properties, not raw address', async () => {
    const sdk = createAnalytics({ batchSize: 1 });
    sdk.init();
    await sdk.identify('0xAbcDef1234567890AbcDef1234567890AbcDef12');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const lastPayload = getLastPayload();
    const identifyEvent = lastPayload.events.find(
      (e: AnalyticsEvent) => e.event_name === '$identify',
    );
    expect(identifyEvent).toBeDefined();
    // wallet_hash must be present and not be the raw address
    const walletHash = identifyEvent!.properties.wallet_hash as string;
    expect(walletHash).toBeDefined();
    expect(walletHash).not.toMatch(RAW_WALLET_RE);
    // distinct_id must also not be raw
    expect((identifyEvent!.distinct_id as string)).not.toMatch(RAW_WALLET_RE);
    sdk.destroy();
  });
});

// ---------------------------------------------------------------------------
// Contract: batching behavior matches gateway limits
// ---------------------------------------------------------------------------

describe('Batch size contract', () => {
  it('never sends more than 50 events in a single batch', async () => {
    // Gateway rejects batches > 50. SDK must respect this limit.
    const sdk = createAnalytics({ batchSize: 60 });
    sdk.init();
    // Capture 55 events manually
    for (let i = 0; i < 55; i++) {
      sdk.capture('page_viewed', { seq: i });
    }
    // Force flush
    sdk.flush();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // Each individual batch payload must be ≤ 50
    for (const call of fetchMock.mock.calls) {
      const payload = JSON.parse(call[1].body as string) as AnalyticsBatch;
      expect(payload.events.length).toBeLessThanOrEqual(50);
    }
    sdk.destroy();
  });
});

// ---------------------------------------------------------------------------
// Contract: UTM context propagates through to event properties
// ---------------------------------------------------------------------------

describe('UTM context contract', () => {
  it('UTM params from session are included in event properties', async () => {
    const sdk = createAnalytics({ batchSize: 1 });
    sdk.init();
    sdk.capture('page_viewed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { events } = getLastPayload();
    const props = events[0].properties as Record<string, unknown>;
    // utm_source=hn was set in window.location.search mock
    expect(props.utm_source).toBe('hn');
    expect(props.utm_medium).toBe('social');
    expect(props.utm_campaign).toBe('launch');
    sdk.destroy();
  });
});

// ---------------------------------------------------------------------------
// Contract: cta_clicked payload shape (landing page CTA)
// ---------------------------------------------------------------------------

describe('CTA event contract', () => {
  it('cta_clicked event includes cta_id, cta_text, cta_location', async () => {
    const sdk = createAnalytics({ batchSize: 1 });
    sdk.init();
    sdk.capture('cta_clicked', {
      cta_id: 'hero_get_started',
      cta_text: 'Get Started',
      cta_location: 'hero',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { events } = getLastPayload();
    expect(events[0].event_name).toBe('cta_clicked');
    const props = events[0].properties as Record<string, unknown>;
    expect(props.cta_id).toBe('hero_get_started');
    expect(props.cta_text).toBe('Get Started');
    expect(props.cta_location).toBe('hero');
    sdk.destroy();
  });
});

// ---------------------------------------------------------------------------
// Contract: deposit funnel events
// ---------------------------------------------------------------------------

describe('Deposit funnel event contract', () => {
  it('deposit_started event includes amount_usdc and chain_id', async () => {
    const sdk = createAnalytics({ batchSize: 1 });
    sdk.init();
    sdk.capture('deposit_started', {
      amount_usdc: 10.0,
      token_symbol: 'USDC',
      chain_id: 42161,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { events } = getLastPayload();
    const props = events[0].properties as Record<string, unknown>;
    expect(props.amount_usdc).toBe(10.0);
    expect(props.token_symbol).toBe('USDC');
    expect(props.chain_id).toBe(42161);
    sdk.destroy();
  });

  it('deposit_permit_signed event includes amount_usdc', async () => {
    const sdk = createAnalytics({ batchSize: 1 });
    sdk.init();
    sdk.capture('deposit_permit_signed', {
      amount_usdc: 10.0,
      token_symbol: 'USDC',
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const { events } = getLastPayload();
    expect(events[0].event_name).toBe('deposit_permit_signed');
    const props = events[0].properties as Record<string, unknown>;
    expect(props.amount_usdc).toBe(10.0);
    sdk.destroy();
  });
});
