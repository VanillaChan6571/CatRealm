import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../modelStore', () => ({ loadModelFile: vi.fn(async () => new ArrayBuffer(8)) }));

type Request = { id: number; name: string; args: unknown[] };

class FakeWorker {
  static instances: FakeWorker[] = [];
  terminated = false;
  private onMessage: ((event: { data: unknown }) => void) | null = null;

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: unknown }) => void) {
    if (type === 'message') this.onMessage = listener;
  }

  postMessage({ id, name, args }: Request) {
    const texts = name === 'translate' ? (args[0] as { texts: { text: string }[] }).texts : [];
    const result = name === 'translate' ? texts.map(({ text }) => ({ target: { text: `EN(${text})` } })) : undefined;
    queueMicrotask(() => {
      if (!this.terminated) this.onMessage?.({ data: { id, result } });
    });
  }

  terminate() {
    this.terminated = true;
  }
}

describe('bergamotEngine idle shutdown', () => {
  let translateWithBergamot: typeof import('../bergamotEngine').translateWithBergamot;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    ({ translateWithBergamot } = await import('../bergamotEngine'));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function translate(text: string) {
    const result = translateWithBergamot(text, 'es', 'en');
    await vi.advanceTimersByTimeAsync(50);
    return result;
  }

  it('terminates the worker after a minute without translations', async () => {
    expect(await translate('hola')).toBe('EN(hola)');
    const [worker] = FakeWorker.instances;
    await vi.advanceTimersByTimeAsync(59_000);
    expect(worker.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(worker.terminated).toBe(true);
  });

  it('keeps the worker alive while translations keep arriving', async () => {
    await translate('hola');
    await vi.advanceTimersByTimeAsync(45_000);
    await translate('adiós');
    await vi.advanceTimersByTimeAsync(45_000);
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].terminated).toBe(false);
  });

  it('starts a fresh worker for the next translation after shutting down', async () => {
    await translate('hola');
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await translate('gracias')).toBe('EN(gracias)');
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances[1].terminated).toBe(false);
  });
});
