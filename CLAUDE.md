# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build and Development Commands

### API Service (`services/api/`)
```bash
npm install          # Install dependencies
npm run build        # Type-check (tsc --noEmit)
npm run lint         # ESLint
npm run format       # Prettier check
npm test             # Run tests with vitest
npx vitest run <file>  # Run a single test file
```

### Web App (`apps/web/`)
```bash
npm install
npm run dev          # Start Vite dev server (http://localhost:5173)
npm run build        # Production build
npm run lint         # ESLint
```

### Mobile App (`apps/mobile/`)
```bash
flutter pub get
flutter test
flutter run \
  --dart-define=API_BASE_URL=<url> \
  --dart-define=AWS_REGION=us-east-1 \
  --dart-define=USER_POOL_ID=<id> \
  --dart-define=USER_POOL_CLIENT_ID=<id>
```

### Infrastructure (`infra/`)
```bash
npm install
npm run build        # TypeScript compile
npm run synth        # CDK synthesize
npm run deploy       # Deploy to AWS
npm run diff         # Show pending changes
```

### Shared Package (`packages/shared/`)
```bash
npm install          # Also runs the build (prepare script)
npm run build        # Compile to dist/ — REQUIRED after editing src/
```
Domain entity types (Trip, Expense, Receipt, …) and the itemized split math
live here. `services/api` and `apps/web` depend on it via `file:` links and
re-export from their own `src/types.ts`. Add types used by both sides here,
never in both packages; consumers import from `../types` as before. After
changing `packages/shared/src/`, run its build so `dist/` is current — the
consumers (tsc, Vite, Lambda bundling) resolve the compiled output.

## Architecture Overview

This is a monorepo for a multi-tool utility platform. A single shared backend serves multiple frontend experiences (web + mobile). Modules are pluggable—each tool surfaces through both apps via a registry pattern.

### Core Data Flow
- **DynamoDB single-table design**: All entities use PK/SK with GSI1-GSI3 for access patterns
- **Cognito auth**: User Pool with email sign-in, triggers `postConfirmation` Lambda to create user records
- **S3 + Textract**: Receipt images upload to S3 → triggers `textractProcessor` Lambda for OCR
- **HTTP API Gateway**: All routes go through a single `http.ts` Lambda handler, authorized via Cognito JWT

### Module System
Both frontends use a registry pattern for modules:
- **Web**: `apps/web/src/modules/registry.tsx` - defines `ModuleDefinition` with id, path, maturity, tags
- **Mobile**: `apps/mobile/lib/modules/module_registry.dart` - mirrors the structure with `ModuleDefinition` class

To add a new module:
1. Add handlers in `services/api/src/handlers/`
2. Register routes in CDK stack (`infra/src/stacks/`)
3. Add to web registry + create pages under `apps/web/src/pages/`
4. Add to mobile registry + create screens under `apps/mobile/lib/modules/<name>/`

### Key Directories
- `services/api/src/handlers/` - Lambda entry points (http.ts is the main router)
- `services/api/src/services/` - Business logic
- `services/api/src/data/` - DynamoDB data access
- `apps/web/src/pages/` - React route components
- `apps/web/src/components/` - Shared UI components
- `infra/src/stacks/group-expenses-stack.ts` - All AWS resources (Cognito, API GW, DynamoDB, S3, Lambdas)

### Environment Configuration
- **Web**: Copy `.env.example` to `.env.local`, fill in `VITE_API_URL`, `VITE_REGION`, `VITE_USER_POOL_ID`, `VITE_USER_POOL_CLIENT_ID`
- **Mobile**: Pass `--dart-define` flags at runtime (reads from `lib/app_config.dart`)
- CDK outputs provide all values after `npm run deploy`
