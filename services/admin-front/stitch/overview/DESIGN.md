# Design System Strategy: The Sentinel Interface

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Monolithic Sentinel."** 

In an era of cluttered enterprise dashboards, this system moves in the opposite direction: toward an authoritative, architectural stillness. It is designed to feel like a high-altitude "control tower"—an interface that doesn't just display data but "guards" it. We achieve this by rejecting the "template" look. We move away from generic grids and 1px borders, favoring **tonal layering**, **intentional asymmetry**, and **cinematic depth**. The login experience should feel like stepping into a secure vault; it is quiet, focused, and undeniably premium.

---

## 2. Color & Surface Philosophy
The palette is built on a foundation of "Deep Logic"—using navy and charcoal to establish a base of trust, punctuated by "Tech-Forward" luminescence.

*   **The "No-Line" Rule:** We strictly prohibit 1px solid borders for sectioning or container definition. To define a boundary, use a background shift. For example, a `surface-container-lowest` card must sit on a `surface-container-low` background. The contrast between these two tokens is the "line."
*   **Surface Hierarchy & Nesting:** Treat the UI as physical layers of high-grade material. 
    *   **Level 0 (Background):** `surface` (#f8f9fa).
    *   **Level 1 (The 'Stage'):** `surface-container-low` (#f3f4f5).
    *   **Level 2 (The Component):** `surface-container-lowest` (#ffffff).
*   **The "Glass & Gradient" Rule:** For the 'Synapse Network' login, the primary CTA should not be a flat block. Use a subtle linear gradient from `primary` (#000000) to `primary_container` (#101b30) to give the button a "forged" feel.
*   **Glassmorphism:** For high-security overlays or tooltips, use `surface_container_highest` at 80% opacity with a `20px` backdrop-blur. This creates an "obsidian glass" effect that feels modern and impenetrable.

---

## 3. Typography: The Editorial Edge
We utilize a dual-typeface system to balance technical precision with authoritative scale.

*   **The Display Voice (Manrope):** Used for `display` and `headline` roles. Manrope’s geometric nature provides the "Tower" feel. Use `display-md` for the "Synapse Network" branding to establish an immediate sense of scale.
*   **The Functional Voice (Inter):** Used for `title`, `body`, and `label` roles. Inter is chosen for its mathematical clarity. 
*   **Hierarchy Strategy:** Never use bold for everything. Use `label-md` in `on_surface_variant` (#44474c) for input labels to create a sophisticated, muted contrast against the high-contrast `body-lg` user input.

---

## 4. Elevation & Depth: Tonal Layering
Traditional drop shadows are too "web-standard." We use **Ambient Depth**.

*   **The Layering Principle:** Instead of a shadow, place the login card (`surface-container-lowest`) inside a larger, slightly darker frame (`surface-container-low`). The eye perceives the elevation change through color math, not blurry lines.
*   **Ambient Shadows:** If a shadow is required for the "Control Center" card, use a 3-tier spread:
    *   `0px 4px 20px rgba(25, 28, 29, 0.04)`
    *   `0px 12px 40px rgba(25, 28, 29, 0.08)`
    *   The shadow should be tinted with `on_surface` to keep it "in the room."
*   **The "Ghost Border" Fallback:** If a container needs more definition (e.g., in high-glare environments), use `outline_variant` at **15% opacity**. It should be felt, not seen.

---

## 5. Components: The Sentinel Kit

### Input Fields
*   **Container:** No bottom line. Use `surface-container-high` with a `DEFAULT` (0.25rem) radius.
*   **Focus State:** Do not use a glow. Transition the background to `surface-container-highest` and change the leading icon to `tertiary` (#000000).
*   **Visual Feedback:** On security validation, the input background should pulse once using a subtle gradient of `secondary_container` (#c2dcff).

### Buttons (The "Command" Style)
*   **Primary:** A gradient of `primary` to `on_primary_container`. Padding: `spacing-4` vertical, `spacing-10` horizontal.
*   **Secondary:** `surface-container-highest` background with `on_surface` text. No border.
*   **Tertiary:** Text-only, using `secondary` (#47607e). Use for "Forgot Password."

### Security Feedback (Chips & Toasts)
*   **Status Chips:** Use `secondary_container` for neutral security states and `error_container` for breaches.
*   **Pro-Tip:** For the 'Synapse' login, use a **Security Progress Bar** at the top of the card using `tertiary_fixed_dim` (#4cd6fb) to indicate MFA loading.

### Lists & Cards
*   **No Dividers:** Separate list items with `spacing-3` of vertical white space. Use a `surface-variant` hover state to define the row boundary.

---

## 6. Do’s and Don’ts

### Do
*   **Do** use asymmetrical white space. Offset the login card slightly to the right or left of center to create a more custom, editorial feel.
*   **Do** use `letter-spacing: -0.02em` on all `display` and `headline` text to make it feel "tight" and engineered.
*   **Do** use the `spacing-24` (5.5rem) token for the hero margin to give the interface room to "breathe" like a high-end gallery.

### Don't
*   **Don't** use 100% black (#000000) for text. Always use `on_surface` (#191c1d) to maintain a premium, ink-on-paper look.
*   **Don't** use rounded corners larger than `xl` (0.75rem). The "Sentinel" look requires the structural integrity of tighter, more architectural corners.
*   **Don't** use "Alert Red" for everything. Use `error` (#ba1a1a) sparingly; for subtle warnings, use the `secondary` navy tones to keep the user calm and in control.