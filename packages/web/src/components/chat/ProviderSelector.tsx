interface ProviderSelectorProps {
  provider: string
  model: string
  onProviderChange: (provider: string) => void
  onModelChange: (model: string) => void
}

const PROVIDER_MODELS: Record<string, { label: string; models: { id: string; label: string }[] }> = {
  deepseek: {
    label: 'DeepSeek',
    models: [
      { id: 'deepseek-v4-flash', label: 'V4 Flash' },
      { id: 'deepseek-v4-pro', label: 'V4 Pro' },
    ],
  },
  openai: {
    label: 'OpenAI',
    models: [
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.5', label: 'GPT-5.5' },
    ],
  },
  anthropic: {
    label: 'Anthropic',
    models: [
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: 'claude-opus-4-6', label: 'Opus 4.6' },
    ],
  },
  alibaba: {
    label: 'Qwen (通义)',
    models: [
      { id: 'qwen-max', label: 'Qwen Max' },
      { id: 'qwen-plus', label: 'Qwen Plus' },
      { id: 'qwen-turbo', label: 'Qwen Turbo' },
    ],
  },
  zhipu: {
    label: 'GLM (智谱)',
    models: [
      { id: 'glm-4-plus', label: 'GLM-4 Plus' },
      { id: 'glm-4-flash', label: 'GLM-4 Flash' },
    ],
  },
  moonshotai: {
    label: 'Kimi (月之暗面)',
    models: [{ id: 'kimi-k2.5', label: 'Kimi K2.5' }],
  },
}

export function ProviderSelector({ provider, model, onProviderChange, onModelChange }: ProviderSelectorProps) {
  const providerConfig = PROVIDER_MODELS[provider]
  const models = providerConfig?.models ?? []

  const handleProviderChange = (newProvider: string) => {
    onProviderChange(newProvider)
    const firstModel = PROVIDER_MODELS[newProvider]?.models[0]?.id
    if (firstModel) onModelChange(firstModel)
  }

  return (
    <div className="flex items-center gap-3 text-sm">
      <label className="text-gray-500">供应商</label>
      <select
        value={provider}
        onChange={(e) => handleProviderChange(e.target.value)}
        className="rounded-md border bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {Object.entries(PROVIDER_MODELS).map(([key, cfg]) => (
          <option key={key} value={key}>
            {cfg.label}
          </option>
        ))}
      </select>
      <label className="text-gray-500">模型</label>
      <select
        value={model}
        onChange={(e) => onModelChange(e.target.value)}
        className="rounded-md border bg-white px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  )
}
