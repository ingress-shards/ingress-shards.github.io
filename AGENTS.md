# ingress-shards.github.io

Interactive Ingress shard map web application (`@ingress-shards/ingress-shards-map`).

## Stack & Commands
- **Stack:** TypeScript + legacy ESNext JS (`src/js/`) + Webpack + **NPM** (`npm`). **Never** use `yarn`.
- **Validate:** `npm run validate` (clean, lint, typecheck, vitest, prod Webpack build).
- **Preview:** `npm run preview` for local CI build artifact testing.

## Repo Conventions
- **Typing:** Strict TypeScript in `src/` (avoid `any`); JSDoc type hints where beneficial in legacy `src/js/`.
- **Styling:** Never use inline styles; define CSS classes in stylesheets (e.g., `src/assets/main.css`).
- **Dates & time:** Use `temporal-polyfill/fns` functional imports (tree-shakeable); avoid native `Date`.
- **Naming:** `kebab-case` folders and legacy JS source files in `src/js/`; `PascalCase` for TypeScript class modules in `src/` (`index.ts` for barrels).
- **Releases:** `semantic-release` on `main` publishes deployments from git tags; keep `package.json` version at `0.0.0-semantically-released`.
- **Dependencies:** Consumes `@ingress-shards/ingress-events-core` via strict SemVer from GitHub Packages (never local link protocols).
- **Shared AI Kit (optional):** Organization-wide rules, skills, and command guardrails live in `https://github.com/ingress-shards/ingress-events-ai-kit` (see its README for Antigravity and Claude Code setup).
