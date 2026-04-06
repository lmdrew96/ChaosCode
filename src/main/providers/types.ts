export interface ModelInfo {
  id: string
  label: string
  contextWindow: number
  /** USD per 1M input tokens */
  costInputPer1M: number
  /** USD per 1M output tokens */
  costOutputPer1M: number
}

export interface ProviderInfo {
  id: string
  name: string
  models: ReadonlyArray<ModelInfo>
}

export interface ModelEntry extends ModelInfo {
  providerId: string
  providerName: string
}
