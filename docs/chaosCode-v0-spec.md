# ChaosCode v0 — Technical Specification

**Project:** ChaosCode  
**Version:** 0.1.0  
**Author:** Nae (ADHDesigns)  
**Brand:** ADHDesigns — Agentic Development of Human Designs  
**Status:** Pre-build spec

---

## Overview

ChaosCode is a custom multi-LLM agentic IDE built with Electron, React, and TypeScript. It combines a Monaco-based code editor with a collaborative dual-LLM panel where **Gemini implements** and **Claude reviews and edits** — all while the developer (the user) acts as Director.

This is v0: the smallest buildable version that proves the core loop works.

---

## The Core Loop

```
User defines a plan
→ Gemini implements, file by file
→ Claude reviews and edits each file in the background (parallel)
→ Breaking issues: Claude interrupts immediately
→ Minor issues: Claude fixes silently
→ User reviews the final, already-edited output
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Shell | Electron |
| Frontend | React + TypeScript |
| Code Editor | Monaco Editor (embedded) |
| LLM 1 | Google Generative AI SDK (Gemini) |
| LLM 2 | Anthropic SDK (Claude) |
| Styling | TailwindCSS |

---

## Role Definitions

### Gemini — The Implementer
- Responds **first** to all user messages
- Writes code fast and commits to answers
- Does not look back at files it has already passed
- Aware that Claude will review its output

### Claude — The Editor-in-Chief
- Responds **second**, after seeing Gemini's response
- Reviews and directly edits Gemini's output
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
Sequential: **Gemini → Claude**, always.

### Addressing
Toggle control with three modes:
- `Both` (default)
- `Gemini only`
- `Claude only`

### File Context Injection
The currently open file in Monaco is **automatically injected** into every message sent to both LLMs. Neither LLM needs to ask for the file — they always have it.

---

## Agentic Coding Mode

When the user initiates an agentic task (e.g. "build the file tree component"):

1. User defines the plan in the chat panel
2. Gemini implements, file by file, without stopping
3. Claude reviews each file **in parallel** (non-blocking)
4. Two-tier response system:

| Issue Severity | Claude's Action |
|---|---|
| **Breaking** (bad interfaces, wrong architecture, logic errors that will cascade) | Interrupt immediately — stop Gemini, surface the issue to the user |
| **Minor** (typos, style issues, small logic improvements) | Fix silently, log to review panel |

5. User reviews final output — already edited by Claude

---

## System Prompts

### Gemini System Prompt
```
You are a collaborative coding assistant inside ChaosCode, a multi-LLM agentic IDE built by ADHDesigns. You will always be given the contents of the currently open file as context.

You respond first. Give your best, direct answer. Be concrete and actionable. Do not hedge excessively. Commit to your implementation decisions.

Another AI (Claude) will review your response after you. Write as though your work will be reviewed.
```

### Claude System Prompt
```
You are a collaborative coding assistant inside ChaosCode, a multi-LLM agentic IDE built by ADHDesigns. You will always be given the contents of the currently open file as context.

You respond after Gemini. Your job is to act as Editor-in-Chief:
- Review Gemini's response critically
- Validate what is correct
- Directly fix what is wrong or incomplete — do not just leave notes
- If you fully agree with Gemini's output, say so briefly and add any remaining value

In agentic coding mode:
- Minor issues (style, small logic improvements): fix silently and log the change
- Breaking issues (bad interfaces, cascading logic errors, architectural problems): interrupt immediately and surface the issue to the user

Do not repeat what Gemini said. You own the final output.
```

---

## v0 Feature Scope

### IN v0
- [ ] Electron app shell
- [ ] Monaco Editor (single file view)
- [ ] Basic file tree (open/navigate files)
- [ ] Multi-LLM chat panel (Gemini + Claude, side by side)
- [ ] File context auto-injection on every message
- [ ] Sequential turn-taking (Gemini → Claude)
- [ ] LLM toggle (Both / Gemini only / Claude only)
- [ ] Agentic mode (Gemini implements, Claude reviews in background)
- [ ] Review log panel (Claude's minor fix notes)
- [ ] Interrupt system (Claude surfaces breaking issues)

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
│   │   │   └── ReviewLog/     # Claude's background edits
│   │   ├── hooks/
│   │   ├── services/
│   │   │   ├── gemini.ts      # Gemini API service
│   │   │   └── claude.ts      # Anthropic API service
│   │   └── App.tsx
├── package.json
└── electron.config.ts
```

---

## API Keys Required

- `ANTHROPIC_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`

Store in `.env` — never commit to GitHub.

---

## Definition of Done (v0)

ChaosCode v0 is complete when:
1. A user can open a file and see it in Monaco
2. A user can send a message and receive sequential responses from Gemini then Claude
3. Both LLMs demonstrably have the open file as context
4. In agentic mode, Claude reviews files in parallel without blocking Gemini
5. Breaking issues surface as interrupts; minor issues appear in the review log
