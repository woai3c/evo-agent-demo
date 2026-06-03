export const DEFAULT_MODEL = 'deepseek-chat'
export const DEFAULT_PROVIDER = 'deepseek'

export const PROVIDERS = ['deepseek', 'openai', 'anthropic'] as const
export type ProviderName = (typeof PROVIDERS)[number]

export const TOOL_NAMES = ['webSearch', 'webFetch', 'readFile', 'codeRunner', 'dbQuery', 'sendEmail'] as const
export type ToolName = (typeof TOOL_NAMES)[number]
