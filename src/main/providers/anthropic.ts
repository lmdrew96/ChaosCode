import type { ProviderInfo } from './types'

export const anthropicProvider: ProviderInfo = {
  id: 'anthropic',
  name: 'Anthropic',
  models: [
    {
      id: 'claude-haiku-4-5',
      label: 'Haiku 4.5',
      contextWindow: 200_000,
      costInputPer1M: 0.80,
      costOutputPer1M: 4.00,
    },
    {
      id: 'claude-sonnet-4-6',
      label: 'Sonnet 4.6',
      contextWindow: 200_000,
      costInputPer1M: 3.00,
      costOutputPer1M: 15.00,
    },
    {
      id: 'claude-opus-4-6',
      label: 'Opus 4.6',
      contextWindow: 200_000,
      costInputPer1M: 15.00,
      costOutputPer1M: 75.00,
    },
  ],
}
