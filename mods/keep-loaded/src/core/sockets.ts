/**
 * What the websocket readings say about a kept tab. Pure: the counters are collected
 * in `platform/sockets.ts`, which is where the question this spike exists to answer
 * lives — whether a parent-process listener sees frames at all (M04.C04a-D, D020).
 */

import { formatAge } from "./liveness.ts";

export interface SocketRecord {
  /** Short space id, for logging only. */
  space: string;
  url: string;
  /** False when the tab had no inner window to attach to, e.g. still lazy. */
  watching: boolean;
  /**
   * Sockets seen opening *since the listener attached*. A socket that was already
   * open is never counted, so this reads 0 for a healthy long-lived connection —
   * measured, not assumed (D020).
   */
  open: number;
  framesIn: number;
  framesOut: number;
  /** Null while nothing has arrived, which is not the same as long ago. */
  lastFrameAt: number | null;
}

/** Never-heard-from first, then longest silent: the order they need looking at in. */
const byQuiet = (a: SocketRecord, b: SocketRecord) => {
  if (a.lastFrameAt === null || b.lastFrameAt === null) {
    return (a.lastFrameAt === null ? 0 : 1) - (b.lastFrameAt === null ? 0 : 1);
  }
  return a.lastFrameAt - b.lastFrameAt;
};

const rowOf = (record: SocketRecord, now: number): string => {
  const { space, url, open, framesIn, framesOut, lastFrameAt } = record;
  if (!record.watching) {
    return `${space} ${url} not watched`;
  }
  const counts = `${open} opened, ${framesIn} in, ${framesOut} out`;
  return lastFrameAt === null
    ? `${space} ${url} ${counts}, no frames yet`
    : `${space} ${url} ${counts}, last ${formatAge(now - lastFrameAt)}`;
};

export function socketSummary(
  records: readonly SocketRecord[],
  now: number,
): { message: string; lines: string[] } {
  if (!records.length) {
    return { message: "sockets: nothing kept", lines: [] };
  }

  const sorted = [...records].sort(byQuiet);
  const lines = sorted.map(record => rowOf(record, now));
  const watching = sorted.filter(record => record.watching);
  const frames = watching.reduce((sum, r) => sum + r.framesIn + r.framesOut, 0);

  if (!frames) {
    // The spike's negative result, stated rather than left to be inferred from a
    // table of zeroes: it decides whether C04 can be precise or only a timer.
    return {
      message: `sockets: ${watching.length} watched, no frames seen at all — a parent-process listener may not receive them`,
      lines,
    };
  }

  const receiving = watching.filter(record => record.framesIn + record.framesOut > 0);
  const freshest = Math.max(...watching.map(record => record.lastFrameAt ?? 0));
  return {
    message: `sockets: ${watching.length} watched, ${receiving.length} receiving, ${frames} frame(s), freshest ${formatAge(now - freshest)}`,
    lines,
  };
}
