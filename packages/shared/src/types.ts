import type { ProviderName, ToolName } from './constants.js'

// ── Operation (one user submit → agent done/failed) ──

export interface Operation {
  operationId: string
  userId: string
  model: string
  provider: ProviderName
  status: 'success' | 'error' | 'interrupted'
  totalSteps: number
  totalDuration: number
  totalTokens: TokenUsage
  cost: number
  errorSummary: string | null
  createdAt: string
}

export interface TokenUsage {
  input: number
  output: number
  cached: number
}

// ── Step (one LLM call or one tool call) ──

export interface Step {
  stepId: string
  operationId: string
  stepIndex: number
  type: 'call_llm' | 'call_tool'
  durationMs: number
  tokens: TokenUsage | null
  toolName: ToolName | null
  toolInput: Record<string, unknown> | null
  toolOutputSize: number | null
  toolOutput: Record<string, unknown> | null
  toolSuccess: boolean | null
  llmResponse: string | null
  error: StepError | null
  contextSnapshot: ContextSnapshot | null
  createdAt: string
}

export interface StepError {
  code: string
  message: string
  providerStatus: number | null
}

export interface ContextSnapshot {
  totalTokens: number
  windowUsagePct: number
  compressionTriggered: boolean
}

// ── Error (extracted from failed steps) ──

export interface TracedError {
  errorId: string
  operationId: string
  stepId: string
  provider: ProviderName
  errorType: string
  statusCode: number | null
  message: string
  toolName: ToolName | null
  patternId: string | null
  createdAt: string
}

// ── Pattern ──

export interface Pattern {
  patternId: string
  name: string
  category: 'user_error' | 'provider_error' | 'harness_bug'
  provider: string
  errorType: string
  matchRule: MatchRule
  hitCount: number
  firstSeen: string
  lastSeen: string
  status: 'active' | 'resolved' | 'investigating'
  createdBy: string
}

export interface MatchRule {
  statusCode?: number
  provider?: string
  toolName?: string
  messageRegex?: string
  errorType?: string
}

// ── Inspection ──

export interface Inspection {
  inspectionId: string
  round: number
  startedAt: string
  finishedAt: string | null
  tracesAnalyzed: number
  newPatterns: number
  harnessBugs: number
  tokensUsed: TokenUsage | null
  cost: number
  summary: string
  details: InspectionDetails | null
}

export interface InspectionDetails {
  newPatterns: Pattern[]
  bugs: HarnessBug[]
}

export interface HarnessBug {
  title: string
  description: string
  rootCause: string
  suggestedFix: string
  severity: 'low' | 'medium' | 'high'
}

// ── Behavior (semantic clustering + health evaluation) ──

export interface Behavior {
  behaviorId: string
  name: string
  description: string
  toolSequence: string
  operationCount: number
  successRate: number
  avgDuration: number
  avgSteps: number
  avgTokens: number
  avgCost: number
  toolErrorRate: number
  healthScore: number
  healthFlags: string[]
  suggestion: string
  suggestionSeverity: 'none' | 'critical' | 'suggestion'
  fixStatus: 'none' | 'unfixed' | 'branch_created' | 'pr_created' | 'merged'
  fixPrUrl: string | null
  sampleOperations: string[]
  firstSeen: string
  lastSeen: string
  createdBy: string
}

// ── Chat ──

export interface Conversation {
  conversationId: string
  userId: string
  title: string
  model: string
  provider: ProviderName
  createdAt: string
  updatedAt: string
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// ── SSE event types (server → web) ──

export type StreamEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; toolName: ToolName; input: Record<string, unknown> }
  | { type: 'tool-result'; toolName: ToolName; success: boolean; outputSize: number }
  | { type: 'error'; message: string }
  | { type: 'done'; operationId: string }
