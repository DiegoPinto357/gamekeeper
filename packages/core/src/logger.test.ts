import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  log,
  getLogger,
  setLogger,
  silentLogger,
  consoleLogger,
  type Logger,
} from './logger';

describe('logger', () => {
  const original = getLogger();

  beforeEach(() => {
    setLogger(silentLogger);
  });

  afterEach(() => {
    setLogger(original);
  });

  it('defaults to the silent logger', () => {
    expect(getLogger()).toBe(silentLogger);
  });

  it('silent logger does nothing', () => {
    expect(() => {
      silentLogger.debug('d');
      silentLogger.info('i');
      silentLogger.warn('w');
      silentLogger.error('e');
    }).not.toThrow();
  });

  it('setLogger replaces the active logger and getLogger returns it', () => {
    const fake: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    setLogger(fake);
    expect(getLogger()).toBe(fake);
  });

  it('the `log` proxy delegates to the active logger', () => {
    const fake: Logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    setLogger(fake);

    log.debug('a', 1);
    log.info('b', 2);
    log.warn('c', 3);
    log.error('d', 4);

    expect(fake.debug).toHaveBeenCalledWith('a', 1);
    expect(fake.info).toHaveBeenCalledWith('b', 2);
    expect(fake.warn).toHaveBeenCalledWith('c', 3);
    expect(fake.error).toHaveBeenCalledWith('d', 4);
  });

  it('consoleLogger writes to the console', () => {
    const spies = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
    };

    consoleLogger.info('hello');
    consoleLogger.warn('careful');
    consoleLogger.error('boom');
    consoleLogger.debug('detail');

    expect(spies.log).toHaveBeenCalledWith('hello');
    expect(spies.warn).toHaveBeenCalledWith('careful');
    expect(spies.error).toHaveBeenCalledWith('boom');
    expect(spies.debug).toHaveBeenCalledWith('detail');

    vi.restoreAllMocks();
  });
});
