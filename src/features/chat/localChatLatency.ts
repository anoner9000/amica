// Developer-only local chat latency tracker for the Deiphobe text-submit path.
// All output goes to console.debug — no UI changes, no audio side effects.
// Inspect mid-session: window.__amicaLocalChatLatency

interface LocalChatLatencyMarks {
  t_submit?: number;
  t_fetch_start?: number;
  t_fetch_done?: number;
  t_first_chunk?: number;
  t_committed?: number;
}

function _now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function _fmt(a: number | undefined, b: number | undefined): string {
  return a !== undefined && b !== undefined ? `${(b - a).toFixed(1)}ms` : "n/a";
}

class LocalChatLatencyTracker {
  private marks: LocalChatLatencyMarks = {};

  recordSubmit(): void {
    this.marks = { t_submit: _now() };
    if (typeof window !== "undefined") {
      (window as any).__amicaLocalChatLatency = this.marks;
    }
  }

  recordFetchStart(): void {
    this.marks.t_fetch_start = _now();
  }

  recordFetchDone(): void {
    this.marks.t_fetch_done = _now();
  }

  recordFirstChunk(): void {
    if (this.marks.t_first_chunk === undefined) {
      this.marks.t_first_chunk = _now();
    }
  }

  recordCommitted(): void {
    this.marks.t_committed = _now();
    this._log();
  }

  getMarks(): Readonly<LocalChatLatencyMarks> {
    return { ...this.marks };
  }

  private _log(): void {
    const m = this.marks;
    if (m.t_submit === undefined) return;
    console.debug(
      "[amica-latency]",
      `submit→fetch: ${_fmt(m.t_submit, m.t_fetch_start)}`,
      `| fetch→response: ${_fmt(m.t_fetch_start, m.t_fetch_done)}`,
      `| response→first_chunk: ${_fmt(m.t_fetch_done, m.t_first_chunk)}`,
      `| first_chunk→committed: ${_fmt(m.t_first_chunk, m.t_committed)}`,
      `| total: ${_fmt(m.t_submit, m.t_committed)}`,
    );
  }
}

export const localChatLatency = new LocalChatLatencyTracker();
