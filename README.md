# OpenCode ACE Plugin

Agentic Context Engine (ACE) integration for OpenCode - Self-improving AI agents that learn from experience with context-aware hierarchical memory.

## Features

- **Context-Aware Learning** - Automatically detects project type (Python/Django, React, etc.) and routes skills to appropriate skillbooks
- **Hierarchical Master Memory** - Global → Language → Framework → Project skill organization
- **Event-Driven Architecture** - Uses OpenCode SDK for automatic context injection and learning
- **Auto Context Injection** - Learned strategies injected at session start via `session.prompt(noReply)`
- **Auto Learning** - Patterns captured automatically when tasks complete
- **Async Learning** - Non-blocking background learning
- **Skill Deduplication** - Prevents duplicate patterns (0.85 similarity threshold)
- **Project Detection** - Filesystem-based detection (package.json, requirements.txt, tsconfig.json, etc.)
- **No Cross-Contamination** - Python skills stay separate from React skills
- **No Agent Modifications Required** - Works automatically via SDK events

## Installation

1. Install dependencies:
```bash
cd ~/.config/opencode/plugin/opencode-ace
bun install
pip install -r requirements.txt
```

2. Set up Python venv:
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

3. Build the plugin:
```bash
bun run build
```

4. Add to your OpenCode config (`~/.config/opencode/opencode.json`):
```json
{
  "plugin": ["./plugin/opencode-ace"]
}
```

## How It Works

1. **Session Start**: ACE subscribes to OpenCode events via SDK
2. **Context Injection**: When a session starts, learned strategies are injected using `session.prompt(noReply: true)`
3. **Learning**: When assistant messages complete, patterns are extracted and stored
4. **Deduplication**: Similar skills are merged instead of duplicated

## Configuration

Edit `config/ace-config.json`:

```json
{
  "enabled": true,
  "autoInjectContext": true,
  "autoLearn": true,
  "asyncLearning": true,
  "agents": {
    "openagent": { "enabled": true },
    "opencoder": { "enabled": true }
  }
}
```

## Commands

- `/ace-status` - View system status and skill counts
- `/ace-inspect <agent>` - View skills in skillbook
- `/ace-toggle` - Toggle ACE on/off
- `/ace-clear <agent>` - Clear skillbook (requires confirm)
- `/ace-enable-context` - Enable context-aware mode (with migration wizard)

## Tools (for LLM use)

- `ace_status` - Get system status
- `ace_inspect` - Inspect skills
- `ace_toggle` - Toggle settings
- `ace_clear` - Clear skillbook
- `ace_export` - Export to file
- `ace_import` - Import from file
- `ace_learn` - Manual learning trigger
- `ace_get_context` - Get formatted context
- `ace_detect_context` - Detect current project context
- `ace_list_contexts` - List all hierarchical skillbooks

## Context-Aware Mode

When enabled, ACE automatically detects your project type and routes skills to the appropriate skillbook:

**Hierarchy:**
```
Global/Universal (always loaded)
    ↓
Language-Specific (Python, TypeScript, JavaScript, Go, Rust)
    ↓
Framework-Specific (React, Django, FastAPI, Next.js, Vue)
    ↓
Project-Specific (optional, per-repository)
```

**Example:** Working on a Django project:
- Universal skills (e.g., "validate input") → `skillbooks/global/universal.json`
- Python skills (e.g., "use async/await") → `skillbooks/languages/python.json`
- Django skills (e.g., "use select_related()") → `skillbooks/frameworks/django.json`

**Detection:** Automatic via filesystem (package.json, requirements.txt, tsconfig.json, manage.py, etc.)

## Architecture

```
OpenCode Server
      ↓ (SSE events)
ACE Plugin (SDK client)
      ↓
┌─────────────────────────────────────────┐
│  Event Handler                          │
│  - session.created → detect context     │
│                   → inject hierarchical │
│  - message.completed → route & learn    │
└─────────────────────────────────────────┘
      ↓
Project Detector → Master Memory Router
      ↓                      ↓
Python Layer          Hierarchical Skillbooks
      ↓                      ↓
Skillbook Manager     Global/Language/Framework/Project
```

## Requirements

- Bun runtime
- Python 3.11+
- OpenCode SDK (@opencode-ai/sdk)

## License

MIT
