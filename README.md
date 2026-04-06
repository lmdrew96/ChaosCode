# ChaosCode

An Electron-based IDE where agentic AI models collaboratively plan, implement, and review code changes in real-time.

## Tech Stack

- **Electron** – Desktop application framework
- **React** – UI component library
- **TypeScript** – Type-safe JavaScript
- **Tailwind CSS** – Utility-first styling
- **Vite** – Build tooling
- **Anthropic API** – Claude models for agentic execution

## Model Roles

- **Haiku** – Agentic implementer. Proposes multi-file task plans and writes complete, runnable code.
- **Sonnet** – Code reviewer. Reviews Haiku's implementation plans and provides feedback before code is written.

## Local Development

### Prerequisites

- Node.js 16+ and npm 7+

### Running the Project

```bash
npm install
npm run dev
```

This starts the development server with hot-reload enabled. The Electron app will open automatically with the ChaosCode IDE interface.

## Project Structure

- `src/main/` – Electron main process, provider integrations, and AI prompt logic
- `src/renderer/` – React UI components, hooks, and agentic execution services
- `docs/` – Architecture and investigation notes

## Features

- **Agentic Code Execution** – AI models propose, implement, and review multi-file changes
- **Real-Time File Editing** – Integrated editor with file tree and terminal
- **Streaming LLM Responses** – Live token-by-token output from Claude models
- **Security-First Design** – Tool sandboxing and command validation