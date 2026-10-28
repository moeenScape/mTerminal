import { terminalLimits, type TerminalSize } from '../../../../shared/terminal.js';

interface TerminalGrid extends TerminalSize {
  resize: (cols: number, rows: number) => void;
}
export class TerminalSizing {
  private frame: number | undefined;
  private published: TerminalSize | undefined;
  private disposed = false;
  constructor(
    private readonly host: Pick<HTMLElement, 'clientWidth' | 'clientHeight'>,
    private readonly terminal: TerminalGrid,
    private readonly measure: () => TerminalSize | undefined,
    private readonly publish: (size: TerminalSize) => void,
  ) {}
  schedule(): void {
    if (this.disposed || this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      this.fitNow();
    });
  }
  fitNow(force = false): TerminalSize | undefined {
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.frame = undefined;
    }
    if (this.disposed || this.host.clientWidth <= 0 || this.host.clientHeight <= 0) return;
    const proposed = this.measure();
    if (
      !proposed ||
      !Number.isFinite(proposed.cols) ||
      !Number.isFinite(proposed.rows) ||
      proposed.cols < 1 ||
      proposed.rows < 1
    )
      return;
    const size = {
      cols: Math.max(
        terminalLimits.minCols,
        Math.min(terminalLimits.maxCols, Math.floor(proposed.cols)),
      ),
      rows: Math.max(
        terminalLimits.minRows,
        Math.min(terminalLimits.maxRows, Math.floor(proposed.rows)),
      ),
    };
    if (this.terminal.cols !== size.cols || this.terminal.rows !== size.rows)
      this.terminal.resize(size.cols, size.rows);
    if (force || this.published?.cols !== size.cols || this.published.rows !== size.rows) {
      this.publish(size);
      this.published = { ...size };
    }
    return size;
  }
  dispose(): void {
    this.disposed = true;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
  }
}
