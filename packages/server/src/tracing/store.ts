// Trace Store — persists operations and steps to SQLite.
// Write timing: each step is written as soon as it completes (not batched at operation end),
// because the operation might crash mid-way — partial trace is better than no trace.

export class TraceStore {
  // TODO: implement
}
