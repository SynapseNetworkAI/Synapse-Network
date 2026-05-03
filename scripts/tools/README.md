# scripts/tools — Developer Tool Scripts

Reusable scripts for frontend development, verification, and docs QA.

---

## screenshot_docs.js

**Purpose:** Take EN and ZH screenshots of any docs page to visually verify i18n rendering.

**Requirements:**

- `npm install playwright` (in project root or user-front)
- `npx playwright install chromium` (first time only)
- Next.js dev server running at `http://localhost:3000`

**Usage:**

```bash
# Default: consumer guide
node scripts/tools/screenshot_docs.js

# Any docs page
node scripts/tools/screenshot_docs.js /get-started/api-providers
node scripts/tools/screenshot_docs.js /api-reference
node scripts/tools/screenshot_docs.js /sdks/typescript output/playwright

# Output: output/playwright/<slug>_en.png and <slug>_zh.png
```

**What it verifies:**

- English UI + English code comments
- Chinese UI + Chinese code comments (when i18n is correct)
- The language switch key is `synapse_lang` stored in `localStorage`

---

## audit_i18n_comments.js

**Purpose:** Scan `services/docs-front/content/docs` for hardcoded CJK (Chinese/Japanese/Korean) characters inside `//` comments.

**Usage:**

```bash
# Default: checks services/docs-front/content/docs
node scripts/tools/audit_i18n_comments.js

# Custom directory
node scripts/tools/audit_i18n_comments.js services/docs-front/content/docs

# Exit 0 = clean. Exit 1 = hardcoded i18n comments found.
```

**Run this before every PR** that touches docs-front content to catch accidental language-specific code comments.
