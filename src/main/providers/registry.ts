import type { ModelEntry, ProviderInfo } from './types'
import { anthropicProvider } from './anthropic'

class ProviderRegistry {
  private providers: ProviderInfo[] = [anthropicProvider]

  register(provider: ProviderInfo): void {
    this.providers.push(provider)
  }

  allModels(): ModelEntry[] {
    return this.providers.flatMap((p) =>
      p.models.map((m) => ({ ...m, providerId: p.id, providerName: p.name }))
    )
  }

  findModel(modelId: string): ModelEntry | null {
    for (const p of this.providers) {
      const m = p.models.find((m) => m.id === modelId)
      if (m) return { ...m, providerId: p.id, providerName: p.name }
    }
    return null
  }

  isValid(modelId: string): boolean {
    return this.findModel(modelId) !== null
  }
}

export const providerRegistry = new ProviderRegistry()
