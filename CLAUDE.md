# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run setup        # Initial setup: install deps, generate Prisma client, run migrations
npm run dev          # Start dev server with Turbopack
npm run build        # Production build
npm run lint         # ESLint via Next.js
npm test             # Run all tests (Vitest)
npm run db:reset     # Reset and reseed database
```

Run a single test file: `npx vitest path/to/test.ts`

The dev server requires `NODE_OPTIONS='--require ./node-compat.cjs'` (already included in npm scripts) due to a Node.js 25+ Web Storage SSR compatibility issue.

Set `ANTHROPIC_API_KEY` in `.env` to enable real AI generation; without it the app falls back to a `MockLanguageModel` that returns static component code.

## Architecture

### Overview

UIGen is an AI-powered React component generator with live preview. Users describe components in natural language; Claude generates them using tool calls that operate on an in-memory virtual file system.

### Key Data Flow

1. User sends chat message → `/api/chat` route
2. Server streams response from Claude (claude-haiku-4-5) via Vercel AI SDK
3. Claude invokes tools to create/edit files in the `VirtualFileSystem`
4. File changes propagate via React context to the preview iframe and code editor
5. On save (authenticated users), project state is serialized to Prisma `Project.data` JSON

### Virtual File System (`src/lib/file-system.ts`)

All component files exist only in memory. The `VirtualFileSystem` class manages file operations and is serialized to/from the `Project.data` JSON column in SQLite. Context is exposed via `src/lib/contexts/file-system-context.tsx`.

### AI Tools (`src/lib/tools/`)

Claude uses two tools:

- **`str_replace_editor`** — creates and edits file contents
- **`file_manager`** — renames and deletes files

Tool definitions live in `src/lib/tools/`; the system prompt is in `src/lib/prompts/generation.tsx`.

### Authentication

JWT sessions in httpOnly cookies. Two user tiers:

- **Authenticated:** Projects persisted to SQLite via Prisma
- **Anonymous:** Work tracked in localStorage (`src/lib/anon-work-tracker.ts`); prompts sign-up on save

Server Actions in `src/actions/` handle auth (signUp, signIn, signOut) and project CRUD. Middleware at `src/middleware.ts` protects API routes.

### Database Schema

```prisma
User    { id, email, password, projects[] }
Project { id, name, userId, messages: String (JSON), data: String (JSON) }
```

`messages` stores chat history; `data` stores the serialized VirtualFileSystem.

### UI Layout

`src/app/main-content.tsx` is the main shell with two resizable panels:

- Left (35%): Chat interface (`src/components/chat/`)
- Right (65%): Togglable preview iframe / code editor

### Path Aliases

`@/*` maps to `./src/*` (configured in `tsconfig.json`).

## Style

Use humor when naming variables and writing comments. Clever names and witty remarks are encouraged — as long as the code remains readable.
