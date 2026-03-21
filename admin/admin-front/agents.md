# AGENTS Guidelines for This Repository

This repository contains a Next.js + TypeScript application. To ensure the code remains maintainable, highly cohesive, and loosely coupled even as features scale, all agents must adhere to the following architectural and workflow standards.

## 1. Architectural Principles

### High Cohesion & Low Coupling

#### Feature-Based Structure

Group code by feature (e.g., `features/auth`, `features/orders`), not just by technical type. Each feature should be a self-contained module.

#### Separation of Concerns

- UI (Functional): Keep React components "lean." Use functional components and Hooks for UI state.
- Logic (Object-Oriented): Encapsulate complex business logic, API orchestrations, and data transformations into Service Classes. Avoid "Fat Hooks" or "Fat Components."

#### Component Reuse

Extract generic UI patterns into `/src/components` (Atomic Design). Ensure components are highly configurable via props, not hardcoded logic.

### Object-Oriented Logic & Strict Typing

#### No Untyped JSON

Do not use raw `any` or generic JSON objects for internal logic.

#### Domain Models

Represent data using TypeScript Interfaces or Classes.

#### Data Encapsulation

When data requires behavior (validation, derived fields), use Classes. This ensures data and the logic that operates on it stay together (High Cohesion).

## 2. Testing & Quality Assurance

### Unit Tests are Mandatory

Every critical component, utility, or Service class must have a corresponding `.test.ts` or `.tsx` file.

### Test Behavior, Not Implementation

Focus on verifying that the component/class meets requirements from a user or consumer perspective.

## 3. Post-Modification Verification Flow

Crucial: After every significant modification and before declaring a task complete, the agent MUST execute the following verification pipeline to ensure no regressions:

- Linting: Fix any styling or static analysis errors.
- Testing: Ensure all new and existing tests pass.
- Build Check: Perform a production build to catch environment-specific or Type-checking errors that dev mode might miss.

## 4. Useful Commands Recap

| Command | Purpose | When to Run |
| --- | --- | --- |
| `npm run dev` | Start Next.js dev server with HMR. | During active coding/iteration. |
| `npm run lint` | Run ESLint/Prettier checks. | After modification. |
| `npm run test` | Execute the test suite. | After modification (Mandatory). |
| `npm run build` | Production build & Type check. | Before final submission/commit. |

### Note on HMR

Always use `npm run dev` while iterating. Do not keep the dev server running while executing `npm run build` as it may lead to inconsistent states in the `.next` directory.

## 5. Development Workflow Guidelines

### Keep Dependencies in Sync

If adding packages, update the lockfile (`package-lock.json`) and restart the dev server.

### Coding Conventions

- Prefer TypeScript (`.ts`/`.tsx`) exclusively.
- Co-locate styles (Tailwind/CSS Modules) with the component.
- Don't Repeat Yourself (DRY): Before creating a new utility or component, check the existing library to see if a reusable solution exists.