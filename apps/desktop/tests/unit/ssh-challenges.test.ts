import { describe, expect, it, vi } from 'vitest';
import { SshChallenges } from '../../src/main/terminal/ssh-challenges.js';
import { validateSshCredentials, type SshChallenge } from '../../src/shared/ssh.js';
const question = {
  title: 'Login',
  instructions: 'Server text',
  prompts: [{ prompt: 'OTP', echo: false }],
};
describe('SSH authentication challenges', () => {
  it('scopes answers to the exact session and challenge and ignores stale replies', async () => {
    const sent: SshChallenge[] = [];
    const broker = new SshChallenges((challenge) => sent.push(challenge));
    const pending = broker.ask('one', question, new AbortController().signal);
    broker.answer('another', sent[0]!.token, ['wrong']);
    broker.answer('one', 'stale', ['wrong']);
    broker.answer('one', sent[0]!.token, ['123456']);
    expect(await pending).toEqual(['123456']);
    const next = broker.ask('one', question, new AbortController().signal);
    broker.answer('one', sent[0]!.token, ['stale']);
    broker.answer('one', sent[1]!.token, ['new']);
    expect(await next).toEqual(['new']);
  });
  it('rejects malformed replies and cancels pending prompts on abort or timeout', async () => {
    vi.useFakeTimers();
    try {
      let sent!: SshChallenge;
      const broker = new SshChallenges((challenge) => {
        sent = challenge;
      });
      const malformed = broker.ask('one', question, new AbortController().signal);
      const rejected = expect(malformed).rejects.toThrow();
      broker.answer('one', sent.token, ['too', 'many']);
      await rejected;
      const controller = new AbortController();
      const cancelled = broker.ask('one', question, controller.signal);
      const aborted = expect(cancelled).rejects.toThrow();
      controller.abort();
      await aborted;
      const timeout = broker.ask('one', question, new AbortController().signal);
      const timedOut = expect(timeout).rejects.toThrow();
      vi.advanceTimersByTime(60000);
      await timedOut;
    } finally {
      vi.useRealTimers();
    }
  });
  it('bounds server requests and excludes irrelevant credential fields', async () => {
    const broker = new SshChallenges(() => {});
    expect(() =>
      broker.ask(
        'one',
        { ...question, prompts: Array(9).fill(question.prompts[0]) },
        new AbortController().signal,
      ),
    ).toThrow();
    expect(
      await broker.ask('one', { ...question, prompts: [] }, new AbortController().signal),
    ).toEqual([]);
    const credentials = validateSshCredentials({
      username: 'user',
      fingerprint: 'SHA256:' + 'a'.repeat(43),
      method: 'keyboard-interactive',
      password: 'unused',
      privateKey: 'unused',
    });
    expect(credentials).not.toHaveProperty('password');
    expect(credentials).not.toHaveProperty('privateKey');
    expect(() =>
      validateSshCredentials({ ...credentials, method: 'privateKey', privateKey: '' }),
    ).toThrow();
    expect(() => validateSshCredentials({ ...credentials, method: 'agent' })).toThrow();
  });
});
