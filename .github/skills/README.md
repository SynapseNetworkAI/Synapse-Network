# Frontend / Product / UI Skills

This repository installs a focused local skill set for Synapse frontend and product work.

Installed into `.github/skills/`:

- `frontend-skill`
- `frontend-design`
- `figma-implement-design`
- `web-design-guidelines`
- `react-best-practices`
- `playwright`
- `webapp-testing`
- `brand-guidelines`

## Why these 8

Synapse has a mixed frontend workload:

- owner-facing product UI in `apps/frontend`
- brand and landing-page presentation requirements
- repeated UI implementation from design intent
- browser interaction validation needs
- React and Next.js implementation quality requirements

These 8 skills cover the highest-frequency frontend and product tasks in this repo:

- visual design direction
- design-to-code implementation
- UI quality review
- React and Next.js implementation patterns
- browser flow validation
- brand consistency

## Not installed in this pass

- `canvas-design`
  Good for more exploratory visual experiments, but lower frequency for the current Synapse product surfaces.
- `vercel-deploy-claimable`
  Useful for preview deployment workflows, but not part of the core UI/design quality loop for this repo. The current upstream snapshot we inspected also did not expose this skill folder directly.

## Upstream sources

- OpenAI skills commit: `736f600bf6ecbc000c04f1d2710b990899f28903`
- Anthropic skills commit: `98669c11ca63e9c81c11501e1437e5c47b556621`
- Vercel agent skills commit: `6f3fa3191d089d7810e332a562ad2a0ff5f7f239`

Installed from:

- `openai/skills`
- `anthropics/skills`
- `vercel-labs/agent-skills`

## Repo fit

Use these skills when working on:

- `apps/frontend` pages and components
- landing / demo / product presentation surfaces
- Figma-to-code implementation tasks
- accessibility and UX review passes
- React and Next.js performance-oriented refactors
- browser-driven UI verification

## Refreshing skills

To update later, re-sync the matching folders from the upstream repositories and keep their `LICENSE.txt` or related notice files.

After skill changes, restart the coding agent session so the new local skill set can be picked up cleanly.