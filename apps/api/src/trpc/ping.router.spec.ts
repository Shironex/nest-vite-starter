import { PingRouter } from './ping.router';

describe('PingRouter', () => {
  let router: PingRouter;

  beforeEach(() => {
    router = new PingRouter();
  });

  it('echoes the provided message and returns a numeric timestamp', () => {
    const before = Date.now();
    const result = router.ping('hello');
    const after = Date.now();

    expect(result.pong).toBe('hello');
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
    expect(result.timestamp).toBeLessThanOrEqual(after);
  });

  it("falls back to 'pong' when no message is provided", () => {
    const before = Date.now();
    const result = router.ping();
    expect(result.pong).toBe('pong');
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
  });
});
