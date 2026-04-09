# scripts/tools — Developer Tool Scripts

Reusable scripts for frontend development, verification, and docs QA.

---

## screenshot_docs.js

**Purpose:** Take EN and ZH screenshots of any docs page to visually verify i18n rendering.

**Requirements:**
- `npm install playwright` (in project root or user-front)
- `npx playwright install chromium`  (first time only)
- Next.js dev server running at `http://localhost:3000`

**Usage:**
```bash
# Default: consumer guide
node scripts/tools/screenshot_docs.js

# Any docs page
node scripts/tools/screenshot_docs.js /docs/getting-started/provider
node scripts/tools/screenshot_docs.js /docs/api-reference
node scripts/tools/screenshot_docs.js /docs/sdk/typescript output/playwright

# Output: output/playwright/<slug>_en.png and <slug>_zh.png
```

**What it verifies:**
- English UI + English code comments
- Chinese UI + Chinese code comments (when i18n is correct)
- The language switch key is `synapse_lang` stored in `localStorage`

---

## audit_i18n_comments.js

**Purpose:** Scan `services/user-front/src/app/docs` for hardcoded CJK (Chinese/Japanese/Korean) characters inside `//` comments that should be extracted to i18n resource arrays.

**Usage:**
```bash
# Default: checks services/user-front/src/app/docs
node scripts/tools/audit_i18n_comments.js

# Custom directory
node scripts/tools/audit_i18n_comments.js services/user-front/src/app

# Exit 0 = clean. Exit 1 = hardcoded i18n comments found.
```

**Run this before every PR** that touches `docs/**` pages to catch accidental hardcoded CJK text.

---

## i18n Pattern for Code Block Comments

When code blocks need multilingual comments, use the array-join pattern:

```tsx
// In page.tsx — declare the comment arrays
const cAuth = tList("docsPage.consumerCodeAuth");

// In JSX — use array join instead of template literal
<CodeBlock lang="typescript" code={[
  `// ${cAuth[0]}`,          // i18n string from resource
  `const x = await fetch(...)`,
  ``,
  `// ${cAuth[1]}`,
].join('\n')} />
```

Add new comment arrays to:
- `services/user-front/src/i18n/resources/en/docsPage.ts`
- `services/user-front/src/i18n/resources/zh/docsPage.ts`
- `services/user-front/src/i18n/schema.ts` (TypeScript type)
