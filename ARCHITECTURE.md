# OpenCode ACE Plugin Architecture

## Overview

This plugin **extends** the [Agentic Context Engine (ACE)](https://github.com/kayba-ai/agentic-context-engine) with OpenCode-specific features, particularly **context-aware hierarchical learning** for multi-project development workflows.

## Component Relationship

```
┌─────────────────────────────────────────────────────────┐
│                  OpenCode ACE Plugin                    │
│                  (This Repository)                      │
│                                                         │
│  ┌──────────────────────────────────────────────────┐  │
│  │   TypeScript Layer (src/)                        │  │
│  │   - OpenCode SDK Integration                     │  │
│  │   - Event Handlers (session.created, etc.)      │  │
│  │   - Project Detection                            │  │
│  │   - Master Memory Router                         │  │
│  │   - Skillbook Migrator                           │  │
│  └──────────────────────────────────────────────────┘  │
│                        ↓                                │
│  ┌──────────────────────────────────────────────────┐  │
│  │   Python Extensions (src/python/ace_opencode/)  │  │
│  │   - Context-Aware Skillbook Manager              │  │
│  │   - Learning with Context Tagging                │  │
│  │   - Hierarchical Routing Logic                   │  │
│  └──────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                        ↓ (uses)
┌─────────────────────────────────────────────────────────┐
│        ACE Base Package (kayba-ai/ace)                  │
│        (Python Package: ace-framework on PyPI)          │
│                                                         │
│  - Core Skillbook Storage (skillbook.py)               │
│  - LLM Provider Integrations (llm.py)                  │
│  - Deduplication Algorithms (deduplication/)           │
│  - Prompt Engineering (prompts.py)                     │
│  - Observability (observability/)                      │
│  - Role Management (roles.py)                          │
│  - Async Learning (async_learning.py)                 │
│  - Feature Management (features.py)                    │
└─────────────────────────────────────────────────────────┘
```

## What Each Layer Provides

### Base ACE Package (kayba-ai/agentic-context-engine)

**Repository**: https://github.com/kayba-ai/agentic-context-engine  
**PyPI**: `ace-framework`

Provides core ACE functionality:

| Module | Purpose |
|--------|---------|
| `skillbook.py` | Core skill storage, CRUD operations, JSON serialization |
| `llm.py` | LLM provider abstraction (OpenAI, Anthropic, etc.) |
| `deduplication/` | Similarity detection, embedding-based deduplication |
| `prompts.py` | System prompts for skill extraction and learning |
| `observability/` | Monitoring, metrics, tracing integration |
| `roles.py` | Agent role definitions and templates |
| `async_learning.py` | Background learning workers |
| `features.py` | Feature flags and configuration |

**Total**: ~11,000 lines of Python

### OpenCode Plugin Extensions (This Repo)

**Repository**: This repository  
**Package**: `opencode-ace` (OpenCode plugin)

Adds OpenCode-specific features:

#### TypeScript Layer (`src/`)

| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry, OpenCode SDK event subscription |
| `project-detection.ts` | Filesystem-based project type detection |
| `master-memory.ts` | Hierarchical skill routing (Global→Language→Framework) |
| `skillbook-migrator.ts` | Migration from legacy agent skillbooks |
| `learning.ts` | Learning triggers, Python bridge |

**Total**: ~1,500 lines of TypeScript

#### Python Extensions (`src/python/ace_opencode/`)

| File | Purpose |
|------|---------|
| `skillbook_manager.py` | Extends ACE skillbook with context tags (language, framework, projectType) |
| `learn.py` | Learning logic with context-aware routing |

**Total**: ~650 lines of Python

**Key Extension**: Context tagging - every skill stores which language/framework/project it came from.

## Data Flow

### 1. Session Start (Context Injection)

```
User starts OpenCode session
         ↓
Plugin receives session.created event (TypeScript)
         ↓
ProjectDetector.detect() → detects project type
         ↓
MasterMemoryRouter.loadMasterContext() → loads hierarchical skills
         |
         ├─ Global/universal.json (always)
         ├─ languages/python.json (if Python project)
         └─ frameworks/django.json (if Django detected)
         ↓
Format skills into prompt
         ↓
Inject via session.prompt(noReply: true)
         ↓
Agent receives context automatically
```

### 2. Learning (Skill Capture)

```
User completes a task successfully
         ↓
Plugin receives message.completed event (TypeScript)
         ↓
Trigger learning logic (learning.ts)
         ↓
Call Python: learn.py with context
         ↓
ace_opencode.skillbook_manager
         |
         ├─ Extract skill from task
         ├─ Add context tags (language, framework)
         └─ Check deduplication (uses ACE base)
         ↓
MasterMemoryRouter.routeSkill()
         |
         ├─ Analyze skill scope (universal? language-specific?)
         ├─ Decide target skillbook
         └─ Framework-specific → frameworks/django.json
                Universal → global/universal.json
         ↓
Save to appropriate skillbook
```

## Key Differences from Base ACE

| Feature | Base ACE | This Plugin |
|---------|----------|-------------|
| **Target** | General-purpose Python library | OpenCode-specific integration |
| **Integration** | Manual, requires code changes | Automatic via SDK events |
| **Skillbooks** | Flat structure, per-agent | Hierarchical: Global→Language→Framework |
| **Context** | Agent-centric | Project-centric (detects Python/React/etc.) |
| **Routing** | N/A (stores all skills together) | Smart routing based on content analysis |
| **LLM Providers** | Multiple providers via litellm | Uses OpenCode SDK session |
| **Deduplication** | Embedding-based (ace.deduplication) | Uses ACE's deduplication + context-aware routing |
| **Observability** | Built-in (opik integration) | TBD (future) |

## Why This Architecture?

### Benefits of Extension Approach

1. **Leverage Core ACE**: Don't reinvent skillbook storage, deduplication, LLM logic
2. **Add OpenCode Features**: Context-aware routing, project detection
3. **Clear Separation**: Base ACE = generic, Plugin = OpenCode-specific
4. **Maintainability**: Bug fixes in base ACE automatically benefit plugin
5. **Reusability**: Context-aware features could be contributed back to base ACE

### Alternative Approaches Considered

**❌ Fork ACE**: Would lose upstream updates, create maintenance burden  
**❌ Reimplement from scratch**: Duplicate 11K lines, reinvent deduplication  
**✅ Extend via plugin**: Best of both worlds

## Future: Potential Upstreaming

Context-aware features that could be contributed back to base ACE:

- `ProjectDetector` → ACE could support project-based contexts
- `MasterMemoryRouter` → Hierarchical skillbooks useful beyond OpenCode
- Context tagging → `language`, `framework`, `projectType` fields in `Skill` class

## File Organization

```
opencode-ace/
├── src/
│   ├── index.ts                    # OpenCode SDK integration
│   ├── project-detection.ts        # Project type detection
│   ├── master-memory.ts            # Hierarchical routing
│   ├── skillbook-migrator.ts       # Migration tools
│   ├── learning.ts                 # Learning triggers
│   └── python/
│       └── ace_opencode/           # OpenCode-specific extensions
│           ├── __init__.py
│           ├── skillbook_manager.py  # Context-aware manager
│           └── learn.py              # Learning with context
├── config/
│   └── ace-config.json             # Configuration (detection rules, routing)
├── skillbooks/
│   ├── global/
│   │   └── universal.json          # Universal skills
│   ├── languages/
│   │   ├── python.json
│   │   └── typescript.json
│   └── frameworks/
│       ├── django.json
│       └── react.json
├── requirements.txt                # Includes ace-framework>=0.7.1
├── package.json                    # TypeScript dependencies
├── README.md                       # User-facing documentation
└── ARCHITECTURE.md                 # This file
```

## Dependencies

### Python
```
ace-framework>=0.7.1  # Base ACE package (kayba-ai)
litellm>=1.78.0       # Required by ACE
pydantic>=2.0.0       # Required by ACE
python-dotenv>=1.0.0  # Required by ACE
tenacity>=8.0.0       # Required by ACE
instructor>=1.0.0     # Required by ACE
```

### TypeScript
```
@opencode-ai/plugin   # Plugin SDK
@opencode-ai/sdk      # OpenCode client SDK
```

## Summary

This plugin is an **OpenCode-specific extension** of the base ACE package, adding:
- Automatic OpenCode integration via SDK events
- Context-aware project detection
- Hierarchical skill organization
- Smart routing based on content analysis

It **uses** the base ACE package for:
- Core skillbook storage and management
- Deduplication algorithms
- LLM provider integrations
- Prompt engineering

This architecture allows us to leverage the full power of ACE while adding OpenCode-specific features on top.
