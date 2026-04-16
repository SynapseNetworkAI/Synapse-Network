import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SynapseAnalytics, type AnalyticsEvent } from '../analytics';

// ---------------------------------------------------------------------------
// Browser-global mocks (vitest environment is "node")
// ---------------------------------------------------------------------------

function makeStore(): Storage {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, val: string) => {
      store[key] = val;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(store)) delete store[k];
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn(() => null),
  };
}

let mockSessionStorage: Storage;
let mockLocalStorage: Storage;

beforeEach(() => {
  mockSessionStorage = makeStore();
  mockLocalStorage = makeStore();

  // Stub browser globals
  vi.stubGlobal('sessionStorage', mockSessionStorage);
  vi.stubGlobal('localStorage', mockLocalStorage);

  vi.stubGlobal('window', {
    location: {
      pathname: '/',
      search: '',
    },
    addEventListener: vi.fn(),
  });

  vi.stubGlobal('document', {
    title: 'Test Page',
    referrer: 'https://google.com',
    addEventListener: vi.fn(),
    visibilityState: 'visible',
  });

  vi.stubGlobal('navigator', {
    sendBeacon: vi.fn(() => false), // force fetch path
  });

  // crypto.randomUUID + crypto.subtle
  vi.stubGlobal('crypto', {
    randomUUID: vi.fn(() => '00000000-0000-0000-0000-000000000000'),
    subtle: {
      digest: vi.fn(async (_algo: string, data: ArrayBuffer) => {
        // Deterministic fake hash: take first 32 bytes padded with zeros
        const input = new Uint8Array(data as ArrayBuffer);
        const out = new Uint8Array(32);
        for (let i = 0; i < Math.min(input.length, 32); i++) {
          out[i] = input[i];
        }
        return out.buffer;
      }),
    },
  });

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true }),
  );

  vi.stubGlobal('TextEncoder', globalThis.TextEncoder);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function createAnalytics(overrides?: Partial<ConstructorParameters<typeof SynapseAnalytics>[0]>) {
  return new SynapseAnalytics({
    endpoint: '/api/v1/events',
    env: 'local',
    batchSize: 3,
    flushIntervalMs: 60_000,
    debug: false,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SynapseAnalytics', () => {
  let sdk: SynapseAnalytics;

  beforeEach(() => {
    sdk = createAnalytics();
    sdk.init();
  });

  afterEach(() => {
    sdk.destroy();
  });

  // 1. Correct event structure
  it('should capture events with correct structure', async () => {
    sdk.capture('ev1', { foo: 1 });
    sdk.capture('ev2', { bar: 2 });
    sdk.capture('ev3', { baz: 3 }); // triggers flush at batchSize=3

    // flush is synchronous splice + fetch call
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    const wrapper = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as { events: AnalyticsEvent[] };

    expect(wrapper).toHaveProperty('events');
    const body = wrapper.events;
    expect(body).toHaveLength(3);
    for (const ev of body) {
      expect(ev).toMatchObject({
        event_id: expect.any(String),
        event_name: expect.any(String),
        timestamp: expect.any(String),
        distinct_id: expect.any(String),
        source: 'frontend',
      });
      expect(ev.properties).toHaveProperty('role');
      expect(ev.properties).toMatchObject({
        session_id: expect.any(String),
        env: 'local',
      });
    }
  });

  // 2. Consistent session_id
  it('should inject session_id consistently', async () => {
    sdk.capture('a');
    sdk.capture('b');
    sdk.capture('c');

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    const wrapper = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as { events: AnalyticsEvent[] };

    const body = wrapper.events;
    const sessionIds = body.map((e) => e.properties.session_id);
    expect(new Set(sessionIds).size).toBe(1);
  });

  // 3. Surface detection from pathname
  it('should detect surface from pathname', async () => {
    // Override pathname
    vi.stubGlobal('window', {
      location: { pathname: '/provider/services', search: '' },
      addEventListener: vi.fn(),
    });

    const localSdk = createAnalytics();
    localSdk.init();

    localSdk.capture('x');
    localSdk.capture('y');
    localSdk.capture('z');

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as { events: AnalyticsEvent[] };

    expect(body.events[0].properties.surface).toBe('provider_console');

    localSdk.destroy();
  });

  // 4. Parse and persist UTM params
  it('should parse and persist UTM params', async () => {
    vi.stubGlobal('window', {
      location: {
        pathname: '/',
        search: '?utm_source=twitter&utm_medium=social&utm_campaign=launch',
      },
      addEventListener: vi.fn(),
    });

    const localSdk = createAnalytics();
    localSdk.init();

    localSdk.capture('u1');
    localSdk.capture('u2');
    localSdk.capture('u3');

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as { events: AnalyticsEvent[] };

    expect(body.events[0].properties.utm_source).toBe('twitter');
    expect(body.events[0].properties.utm_medium).toBe('social');
    expect(body.events[0].properties.utm_campaign).toBe('launch');

    localSdk.destroy();
  });

  // 5. Hash wallet on identify
  it('should hash wallet on identify', async () => {
    // Use batchSize 1 so the $identify event flushes immediately
    const localSdk = createAnalytics({ batchSize: 1 });
    localSdk.init();

    await localSdk.identify('0xAbC123');

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as { events: AnalyticsEvent[] };

    const identifyEvent = body.events.find((e) => e.event_name === '$identify');
    expect(identifyEvent).toBeDefined();
    expect(identifyEvent!.properties.anonymous_id).toBeDefined();
    expect(identifyEvent!.properties.wallet_hash).toEqual(expect.any(String));
    expect((identifyEvent!.properties.wallet_hash as string).length).toBeGreaterThan(0);

    localSdk.destroy();
  });

  // 6. Should NOT flush before batchSize
  it('should not flush before batchSize', () => {
    sdk.capture('one');
    sdk.capture('two');

    expect(fetch).not.toHaveBeenCalled();
  });

  // 7. Re-enqueue on flush failure
  it('should re-enqueue on flush failure', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down'),
    );

    sdk.capture('fail1');
    sdk.capture('fail2');
    sdk.capture('fail3'); // triggers flush → fetch rejects

    // Wait for the rejected promise to settle and re-enqueue
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    // Allow microtask for the catch handler
    await new Promise((r) => setTimeout(r, 50));

    // Now set fetch to succeed and capture enough to trigger another flush
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    // The re-enqueued 3 events should still be in the queue.
    // Capture nothing extra — just manually flush.
    sdk.flush();

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[1][1].body as string,
    ) as { events: AnalyticsEvent[] };

    // We should get the original 3 events back
    expect(body.events).toHaveLength(3);
    expect(body.events.map((e) => e.event_name)).toEqual(['fail1', 'fail2', 'fail3']);
  });

  // 8. page_viewed with correct properties
  it('should emit page_viewed with correct properties', async () => {
    const localSdk = createAnalytics({ batchSize: 1 });
    localSdk.init();

    localSdk.page('/dashboard');

    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalled();
    });

    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    ) as { events: AnalyticsEvent[] };

    const pageEvent = body.events.find((e) => e.event_name === 'page_viewed');
    expect(pageEvent).toBeDefined();
    expect(pageEvent!.properties.page_path).toBe('/dashboard');
    expect(pageEvent!.properties.page_title).toBe('Test Page');
    expect(pageEvent!.properties.referrer).toBe('https://google.com');

    localSdk.destroy();
  });
});
