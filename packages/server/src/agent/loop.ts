// Agent Loop — the core execution engine
// Each user message triggers one agentLoop() call, which runs
// as many turns as the model needs (tool calls → results → continue).
// Every step automatically produces a trace event (tracer is embedded, not bolted on).

export async function agentLoop() {
  // TODO: implement
}
