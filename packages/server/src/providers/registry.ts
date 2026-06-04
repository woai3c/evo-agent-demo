import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAI } from '@ai-sdk/openai'
import type { LanguageModelV1 } from 'ai'

import type { ProviderName } from '@evo/shared'

export function getModel(provider: ProviderName, modelId: string): LanguageModelV1 {
  switch (provider) {
    case 'deepseek': {
      const deepseek = createDeepSeek({ apiKey: requireEnv('DEEPSEEK_API_KEY') })
      return deepseek(modelId)
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey: requireEnv('OPENAI_API_KEY') })
      return openai(modelId)
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: requireEnv('ANTHROPIC_API_KEY') })
      return anthropic(modelId)
    }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

function requireEnv(key: string): string {
  const val = process.env[key]
  if (!val) throw new Error(`Missing env var: ${key}. Add it to your .env file.`)
  return val
}
