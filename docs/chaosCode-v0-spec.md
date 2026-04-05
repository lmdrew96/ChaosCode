# ChaosCode v0 — Technical Specification

**Project:** ChaosCode  
**Version:** 0.1.0  
**Author:** Nae (ADHDesigns)  
**Brand:** ADHDesigns — Agentic Development of Human Designs  
**Status:** Pre-build spec

---

## Overview

ChaosCode is a custom multi-LLM agentic IDE built with Electron, React, and TypeScript. It combines a Monaco-based code editor with a collaborative dual-LLM panel where **Haiku plans and implements** and **Sonnet reviews and edits** — all while the developer (the user) acts as Director.

This is v0: the smallest buildable version that proves the core loop works.

---

## The Core Loop

```
User defines a plan
→ Haiku implements, file by file
→ Sonnet reviews and edits each file in the background (parallel)
→ Breaking issues: Sonnet interrupts immediately
→ Minor issues: Sonnet fixes silently
→ User reviews the final, already-edited output
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron |
| Frontend | React + TypeScript |
| Code Editor | Monaco Editor (embedded) |
| LLM 1 | Anthropic SDK (Claude Haiku) |
| LLM 2 | Anthropic SDK (Claude Sonnet) |
| Styling | TailwindCSS |

---

## Role Definitions

### Haiku Planner / Haiku Implementer
- Responds **first** to all user messages
- Writes code fast and commits to answers
- Does not look back at files it has already passed
- Aware that Sonnet will review its output

### Sonnet Reviewer / Sonnet Final Reviewer
- Responds **second**, after seeing Haiku's response
- Reviews and directly edits Haiku's output
- Does not just leave notes — it fixes the code
- Flags breaking issues immediately; handles minor issues silently
- Acts as quality gatekeeper before output reaches the user

### User — The Director
- Defines the plan and approves output
- Steers direction at checkpoints
- Uses toggle to address one or both LLMs

---

## LLM Panel Behavior

### Shared Context
Both LLMs share full conversation context and see each other's responses. Neither is siloed.

### Turn Order
Sequential: **Haiku → Sonnet**, always.

### Addressing
Toggle control with three modes:
- `Both` (default)
- `Haiku only`
- `Sonnet only`

### File Context Injection
The currently open file in Monaco is **automatically injected** into every message sent to both LLMs. Neither LLM needs to ask for the file — they always have it.

---

## Agentic Coding Mode

When the user initiates an agentic task (e.g. "build the file tree component"):

1. User defines the plan in the chat panel
2. Haiku implements, file by file, without stopping
3. Sonnet reviews each file **in parallel** (non-blocking)
4. Two-tier response system:

| Issue Severity | Sonnet's Action |
|---|---|
| **Breaking** (bad interfaces, wrong architecture, logic errors that will cascade) | Interrupt immediately — stop Haiku, surface the issue to the user |
| **Minor** (typos, style issues, small logic improvements) | Fix silently, log to review panel |

5. User reviews final output — already edited by Sonnet

---

## System Prompts

Prompt templates are centralized in `src/main/prompts.ts` and use a Continue-style contract:

- Layered instructions (`identity` + `behavior` + `rules` + strict output contracts)
- XML-style envelopes for task/context boundaries
- Deterministic machine-readable agentic output (`<file>`, `<review>`, etc.)
- Explicit anti-drift rules (no hidden tool claims, no prose outside required tags in agentic mode)

### Runtime Prompting Pattern

1. Renderer builds structured payloads (`<chat_input>`, `<context_bundle>`, `<agentic_task_input>`)
2. Main process applies role-specific Claude system prompt (Haiku/Sonnet/chat/agentic)
3. Agentic responses are parsed by XML tags and auto-reviewed per file

This keeps prompting auditable and makes parser failures less likely during long sessions.

---

## v0 Feature Scope

### IN v0
- [ ] Electron app shell
- [ ] Monaco Editor (single file view)
- [ ] Basic file tree (open/navigate files)
- [ ] Multi-LLM chat panel (Haiku + Sonnet, side by side)
- [ ] File context auto-injection on every message
- [ ] Sequential turn-taking (Haiku → Sonnet)
- [ ] LLM toggle (Both / Haiku only / Sonnet only)
- [ ] Agentic mode (Haiku implements, Sonnet reviews in background)
- [ ] Review log panel (Sonnet's minor fix notes)
- [ ] Interrupt system (Sonnet surfaces breaking issues)

### NOT in v0
- Terminal
- Git integration
- Themes / customization UI
- Multi-file context (beyond currently open file)
- Settings UI
- Extension system
- Tab management

---

## Project Structure (Suggested)

```
chaosCode/
├── src/
│   ├── main/              # Electron main process
│   ├── renderer/          # React frontend
│   │   ├── components/
│   │   │   ├── Editor/        # Monaco wrapper
│   │   │   ├── FileTree/      # File navigation
│   │   │   ├── LLMPanel/      # Multi-LLM chat
│   │   │   └── ReviewLog/     # Sonnet's background edits
│   │   ├── hooks/
│   │   ├── services/
│   │   │   ├── haiku.ts       # Haiku API service
│   │   │   └── sonnet.ts      # Sonnet API service
│   │   └── App.tsx
├── package.json
└── electron.config.ts
```

---

## API Keys Required

- `ANTHROPIC_API_KEY`

Store in `.env` — never commit to GitHub.

---

## Definition of Done (v0)

ChaosCode v0 is complete when:
1. A user can open a file and see it in Monaco
2. A user can send a message and receive sequential responses from Haiku then Sonnet
3. Both LLMs demonstrably have the open file as context
4. In agentic mode, Sonnet reviews files in parallel without blocking Haiku
5. Breaking issues surface as interrupts; minor issues appear in the review log
