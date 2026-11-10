import { describe, expect, it, vi } from 'vitest';
import { opendir, stat } from 'node:fs/promises';
import { completeLocalPaths } from '../../src/main/terminal/path-completion.js';
vi.mock('node:fs/promises', () => ({ opendir: vi.fn(), stat: vi.fn() }));
it('closes a bounded directory iterator when entries do not match', async () => {
  let visited = 0,
    closed = false;
  async function* entries() {
    try {
      for (let n = 0; n < 20000; n++) {
        visited++;
        yield {
          name: `other-${n}`,
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
        };
      }
    } finally {
      closed = true;
    }
  }
  vi.mocked(opendir).mockResolvedValueOnce(
    entries() as unknown as Awaited<ReturnType<typeof opendir>>,
  );
  expect(await completeLocalPaths('/fixture', 'cat MATCH')).toEqual([]);
  expect(visited).toBeLessThanOrEqual(2049);
  expect(closed).toBe(true);
  expect(stat).not.toHaveBeenCalled();
});
describe('matching and symlink bounds', () => {
  it('resolves at most 40 matching links and returns at most 20 suggestions', async () => {
    async function* entries() {
      for (let n = 0; n < 2000; n++)
        yield {
          name: `file-${n}`,
          isDirectory: () => false,
          isFile: () => false,
          isSymbolicLink: () => true,
        };
    }
    vi.mocked(opendir).mockResolvedValueOnce(
      entries() as unknown as Awaited<ReturnType<typeof opendir>>,
    );
    vi.mocked(stat).mockResolvedValue({ isFile: () => true, isDirectory: () => false } as Awaited<
      ReturnType<typeof stat>
    >);
    expect(await completeLocalPaths('/fixture', 'cat file')).toHaveLength(20);
    expect(stat).toHaveBeenCalledTimes(40);
  });
});
