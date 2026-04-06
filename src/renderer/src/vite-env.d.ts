/// <reference types="vite/client" />

declare module '*?worker' {
  const WorkerFactory: {
    new (): Worker
  }
  export default WorkerFactory
}

declare global {
  interface Window {
    api: {
      openFolder: () => Promise<string | null>
      readFile: (path: string) => Promise<string>
      writeFile: (path: string, content: string) => Promise<void>
      listDir: (path: string) => Promise<import('@/types').FileNode[]>
      cancelRequest: (requestId: string) => Promise<void>
      sendToHaiku: (messages: { role: string; content: string }[], requestId: string, rootPath?: string | null) => Promise<string>
      sendToSonnet: (messages: { role: string; content: string }[], requestId: string, rootPath?: string | null) => Promise<string>
      sendToHaikuAgentic: (userTask: string, requestId: string) => Promise<string>
      sonnetAgenticReview: (args: { filePath: string; content: string; userTask: string }) => Promise<string>
      onHaikuToken: (cb: (token: string) => void) => void
      onHaikuDone: (cb: () => void) => void
      onHaikuAgenticToken: (requestId: string, cb: (token: string) => void) => (() => void)
      onHaikuAgenticDone: (requestId: string, cb: () => void) => (() => void)
      onSonnetToken: (cb: (token: string) => void) => void
      onSonnetDone: (cb: () => void) => void
      removeAllListeners: (channel: string) => void
    }
    MonacoEnvironment?: {
      getWorker: (_: unknown, label: string) => Worker
    }
  }
}

export {}

