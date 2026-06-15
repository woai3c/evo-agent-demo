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
    case 'alibaba': {
      const alibaba = createOpenAI({
        apiKey: requireEnv('ALIBABA_API_KEY'),
        baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      })
      return alibaba(modelId)
    }
    case 'zhipu': {
      const zhipu = createOpenAI({
        apiKey: requireEnv('ZHIPU_API_KEY'),
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      })
      return zhipu(modelId)
    }
    case 'moonshotai': {
      const moonshot = createOpenAI({
        apiKey: requireEnv('MOONSHOT_API_KEY'),
        baseURL: 'https://api.moonshot.cn/v1',
      })
      return moonshot(modelId)
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
