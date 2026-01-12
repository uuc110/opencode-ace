# OpenCode ACE Plugin

Agentic Context Engine (ACE) integration for OpenCode - Self-improving AI agents that learn from experience with context-aware hierarchical memory.

## Overview

This plugin integrates the [Agentic Context Engine (ACE)](https://github.com/kayba-ai/agentic-context-engine) Python package with OpenCode, adding context-aware hierarchical learning specifically designed for multi-project development workflows.

## Features

### Context-Aware Learning
- **Automatic Project Detection** - Detects Python/Django, React, TypeScript, Go projects automatically
- **Hierarchical Master Memory** - Global → Language → Framework → Project skill organization
- **No Cross-Contamination** - Python skills stay separate from React skills
- **Smart Routing** - Skills automatically routed to appropriate skillbooks based on content

### Core ACE Features (from base package)
- **Event-Driven Architecture** - Uses OpenCode SDK for automatic context injection and learning
- **Auto Context Injection** - Learned strategies injected at session start
- **Auto Learning** - Patterns captured automatically when tasks complete
- **Async Learning** - Non-blocking background learning
- **Skill Deduplication** - Prevents duplicate patterns (0.85 similarity threshold)
- **No Agent Modifications Required** - Works automatically via SDK events

### OpenCode-Specific Extensions
- **Project Detection** - Filesystem-based detection (package.json, requirements.txt, tsconfig.json, etc.)
- **Master Memory Router** - Hierarchical skill routing system
- **Migration Tools** - Migrate existing agent skillbooks to hierarchical structure
- **LLM Fallback** - Optional LLM-based skill classification with graceful degradation

## Installation

### Prerequisites
- Bun runtime
- Python 3.11+
- OpenCode SDK (@opencode-ai/sdk)

### Setup

1. **Clone or install the plugin:**
```bash
cd ~/.config/opencode/plugin
git clone <your-repo-url> opencode-ace
cd opencode-ace
```

2. **Install Node dependencies:**
```bash
bun install
```

3. **Install Python dependencies:**
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

4. **Build the plugin:**
```bash
bun run build
```

5. **Add to your OpenCode config** (`~/.config/opencode/opencode.json`):
```json
{
  "plugin": ["./plugin/opencode-ace"]
}
```

## Configuration

Edit `config/ace-config.json`:

```json
{
  "enabled": true,
  "autoInjectContext": true,
  "autoLearn": true,
  "asyncLearning": true,
  "contextAware": {
    "enabled": true,
    "detectionMode": "both",
    "fallbackToGlobal": true
  },
  "agents": {
    "openagent": { "enabled": true },
    "opencoder": { "enabled": true }
  }
}
```

## Context-Aware Mode

When enabled, ACE automatically detects your project type and routes skills to the appropriate skillbook:

### Hierarchy:
```
Global/Universal (always loaded)
    ↓
Language-Specific (Python, TypeScript, JavaScript, Go, Rust)
    ↓
Framework-Specific (React, Django, FastAPI, Next.js, Vue)
    ↓
Project-Specific (optional, per-repository)
```

### Example: Working on a Django project
- Universal skills (e.g., "validate input") → `skillbooks/global/universal.json`
- Python skills (e.g., "use async/await") → `skillbooks/languages/python.json`
- Django skills (e.g., "use select_related()") → `skillbooks/frameworks/django.json`

### Detection
Automatic via filesystem markers:
- **Python**: `requirements.txt`, `pyproject.toml`, `*.py`
- **Django**: `manage.py`, `settings.py`, django in requirements
- **TypeScript**: `tsconfig.json`, `*.ts`, `*.tsx`
- **React**: `package.json` with react dependencies, `/components/` directory
- **Next.js**: `next.config.js`, `/app/` or `/pages/` directory
- **Go**: `go.mod`, `*.go`
- **Rust**: `Cargo.toml`, `*.rs`

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

## Architecture

```
OpenCode Server
      ↓ (SSE events)
ACE Plugin (TypeScript - SDK client)
      ↓
┌─────────────────────────────────────────┐
│  Event Handler                          │
│  - session.created → detect context     │
│                   → inject hierarchical │
│  - message.completed → route & learn    │
└─────────────────────────────────────────┘
      ↓                      ↓
Project Detector      Master Memory Router
      ↓                      ↓
ACE Python Package    OpenCode Extensions
(kayba-ai/ACE)       (ace_opencode/)
      ↓                      ↓
Core Skillbook Mgmt   Context-Aware Routing
      ↓                      ↓
         Hierarchical Skillbooks
    (Global/Language/Framework/Project)
```

## Components

### TypeScript Layer (`src/`)
- **index.ts** - Main plugin entry point, OpenCode SDK integration
- **project-detection.ts** - Filesystem-based project detection
- **master-memory.ts** - Hierarchical skill routing and promotion
- **skillbook-migrator.ts** - Migration from legacy agent skillbooks
- **learning.ts** - Learning triggers and Python integration

### Python Layer (`src/python/ace_opencode/`)
- **skillbook_manager.py** - Context-aware skillbook management (extends ACE)
- **learn.py** - Learning and reflection logic with context tagging

### Configuration (`config/`)
- **ace-config.json** - Main configuration file
  - Context-aware settings
  - Detection rules (languages, frameworks, project types)
  - Routing rules (hierarchy, priority, LLM fallback)
  - Promotion rules (auto-promotion criteria)

## Relationship to Original ACE

This plugin **extends** the [Agentic Context Engine](https://github.com/kayba-ai/agentic-context-engine) with:

1. **OpenCode Integration** - Event-driven architecture using OpenCode SDK
2. **Context-Aware Features** - Project-specific skill organization
3. **Hierarchical Memory** - Multi-level skill storage and routing
4. **Migration Tools** - Tooling for existing OpenCode agent skillbooks

The base ACE package (`ace-framework` on PyPI) provides:
- Core skillbook storage and management
- LLM provider integrations
- Deduplication algorithms
- Observability and monitoring
- Prompt engineering

This plugin adds OpenCode-specific features on top.

## Development

### Build
```bash
bun run build
```

### Test Python
```bash
python -m pytest src/python/tests/
```

### Lint
```bash
bun run lint
bun run lint:fix
```

### Format
```bash
bun run format
```

## Migration from Legacy Agent Skillbooks

If you have existing agent skillbooks (openagent.json, opencoder.json), use the migration wizard:

```bash
# In OpenCode
/ace-enable-context
```

This will:
1. Analyze existing skills
2. Route them to appropriate hierarchical skillbooks
3. Detect duplicates (0.85 similarity threshold)
4. Create backups before migration

## Troubleshooting

### LLM Fallback Connection Errors

If you see "Unable to connect" errors, this is expected when OpenCode server isn't running. The plugin will automatically fall back to heuristic routing.

### Python Module Not Found

```bash
cd ~/.config/opencode/plugin/opencode-ace
.venv/bin/pip install -r requirements.txt
```

### TypeScript Build Errors

```bash
bun install
bun run build
```

## License

MIT

## Credits

- Based on [Agentic Context Engine (ACE)](https://github.com/kayba-ai/agentic-context-engine) by kayba-ai
- Context-aware extensions and OpenCode integration by contributors
