import { randomUUID } from 'node:crypto';
import { validateSshQuestion, type SshQuestion, type SshChallenge } from '../../shared/ssh.js';

export class SshChallenges {
  private readonly pending = new Map<string, { token: string; answer: (value: unknown) => void }>();
  constructor(private readonly send: (challenge: SshChallenge) => void) {}
  ask(id: string, value: SshQuestion, signal: AbortSignal): Promise<string[]> {
    const question = validateSshQuestion(value);
    if (signal.aborted || this.pending.has(id))
      return Promise.reject(new Error('Authentication cancelled.'));
    if (!question.prompts.length) return Promise.resolve([]);
    return new Promise((resolve, reject) => {
      const token = randomUUID();
      const abort = () => complete();
      const timer = setTimeout(abort, 60000);
      const complete = (answers?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.pending.delete(id);
        if (
          !Array.isArray(answers) ||
          answers.length !== question.prompts.length ||
          answers.some((a) => typeof a !== 'string' || a.length > 4096)
        )
          reject(new Error('Authentication cancelled.'));
        else resolve(answers as string[]);
      };
      signal.addEventListener('abort', abort, { once: true });
      this.pending.set(id, { token, answer: complete });
      try {
        this.send({ ...question, id, token });
      } catch {
        complete();
      }
    });
  }
  answer(id: string, token: string, answers: unknown): void {
    const pending = this.pending.get(id);
    if (pending?.token === token) pending.answer(answers);
  }
}
