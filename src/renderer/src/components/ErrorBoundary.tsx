import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Optional label shown in the error UI to help locate which boundary caught the error */
  label?: string
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label ?? 'unknown', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 p-4 text-center select-none">
        <div className="text-2xl text-danger/40">⚠</div>
        <p className="text-[11px] font-semibold text-danger/80 uppercase tracking-wider">
          {this.props.label ?? 'Something went wrong'}
        </p>
        <p className="text-[10px] text-muted max-w-xs break-all leading-relaxed">
          {error.message}
        </p>
        <button
          onClick={this.reset}
          className="mt-1 px-3 py-1 text-[10px] rounded border border-border text-secondary hover:text-primary hover:border-border-strong transition-colors"
        >
          Try again
        </button>
      </div>
    )
  }
}
