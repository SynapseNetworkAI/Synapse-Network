```markdown
# Design System Strategy: The Sovereign Infrastructure

## 1. Overview & Creative North Star
**Creative North Star: "The Terminal Elite"**
This design system rejects the "playful" aesthetics of consumer tech in favor of a high-performance, authoritative environment tailored for the Cyber CTO and Hacker Founder. We are building "The Settlement Layer for AI Agents"—this requires a visual language that communicates absolute reliability, extreme information density, and "Dev-Luxury."

The system breaks the standard "SaaS template" by utilizing intentional asymmetry, editorial-grade typography, and a "HUD" (Heads-Up Display) layout philosophy. We move away from rounded, friendly containers toward a precision-engineered aesthetic where depth is created through tonal shifts and light, not borders. It is Apple Pro hardware meets a high-end Linux kernel.

---

## 2. Colors & Surface Philosophy
The palette is rooted in `Deep Space Black (#050505)` to minimize eye strain during deep-work sessions, accented by the surgical precision of `Fluorescent Green (#00FF41)`.

### The "No-Line" Rule
Traditional 1px solid borders are strictly prohibited for sectioning. They create visual noise that distracts from high-density data. Boundaries must be defined solely through background color shifts:
*   **Surface Hierarchy:** Place a `surface-container-low (#131313)` element on a `surface (#0e0e0e)` background.
*   **Nesting:** Use the tier system (`lowest` to `highest`) to create logical grouping. An inner data module should be `surface-container-high (#202020)` sitting inside a `surface-container (#1a1919)` parent.

### The Glass & Gradient Rule
*   **Glassmorphism:** Use for floating elements (Command Palettes, Popovers) using `surface-container` colors at 70% opacity with a `20px` backdrop-blur.
*   **Linear Accents:** Use subtle gradients (e.g., `primary` to `primary-container`) only for active money flow or status pulses. Never use gradients for decorative "fluff."

---

## 3. Typography: The Editorial Command Line
We utilize a high-contrast sans-serif hierarchy to differentiate between "Hard Data" and "System Guidance."

*   **Display & Headline (Inter):** Set with tight letter-spacing (-0.02em) and Bold/Black weights. This is the "Authority" layer.
*   **Body (Inter):** Set in Regular weight for maximum legibility. 
*   **Labels (Space Grotesk):** Used for all technical annotations, data points, and code-adjacent strings. This monospaced-leaning font signals the "Infrastructure" layer.

**Hierarchy Strategy:**
*   **Display-LG (3.5rem):** Use for hero statements like the slogan.
*   **Label-SM (0.6875rem):** Use for "Metadata"—server status, latency, and hash rates.

---

## 4. Elevation & Depth: Tonal Layering
Depth in this system is a product of light and layering, not shadows.

*   **The Layering Principle:** Stack `surface-container` tiers. A `surface-container-lowest (#000000)` card placed on a `surface-container-low (#131313)` section creates a "sunken" terminal effect that feels integrated into the hardware.
*   **Ambient Shadows:** For floating modals, use a "Dark Glow" rather than a shadow. Color: `primary` at 4% opacity, Blur: `40px`, Spread: `0px`.
*   **The "Ghost Border" Fallback:** If accessibility requires a stroke, use `outline-variant (#484848)` at 15% opacity. It should be felt, not seen.
*   **Interaction Micro-glow:** Upon hovering an interactive element, transition the background to `surface-bright (#2c2c2c)` and add a 1px `primary` top-border to simulate a "lit" hardware button.

---

## 5. Components

### Capsule Navigation
Navigation must be a floating "Capsule" (Radius: `full`). Use `surface-container-high` with a `20px` backdrop blur. Active states are indicated by a `Titanium White` text shift and a `primary` 4px dot below the label.

### Liquid Sliders
Used for resource allocation (e.g., Compute/Gas limits). The track is `surface-container-highest`, and the fill is `primary`. On interaction, the fill should have a "liquid" easing (cubic-bezier(0.22, 1, 0.36, 1)) to feel premium and responsive.

### Infrastructure Cards
*   **Rules:** No dividers. Separate content using `Spacing-6 (1.3rem)`.
*   **Header:** Title in `title-sm`, Metadata in `label-sm` using `secondary (#9d9da2)`.
*   **Status:** Use a `primary (#00e639)` pulse for "Active" and `error (#ed7f64)` for "Halted."

### Data Inputs
*   **Style:** Minimalist. Only a bottom-border using `outline-variant` at 20% opacity. 
*   **Focus State:** The bottom-border transitions to `primary`, and the label shifts to `primary_dim`.
*   **Error State:** Text shifts to `error`, and the container takes a subtle `error_container` background tint.

### Elite Infrastructure Chips
*   **Action Chips:** Rectangular with `sm (0.125rem)` radius. 
*   **Visuals:** `surface-container-highest` background. No border. On hover, the `on-primary-container` green text glows slightly.

---

## 6. Do’s and Don'ts

### Do:
*   **Prioritize Density:** High-level users want to see more data, not more white space. Use `Spacing-2` and `Spacing-3` for tight data clusters.
*   **Use Asymmetry:** Place a heavy display heading on the left and a dense block of monospaced `label-sm` data on the right to create an editorial "Pro" feel.
*   **Respect the "Hacker" Persona:** Use technical jargon and real-time data feeds as part of the visual aesthetic.

### Don't:
*   **No "Web3 Fluff":** Absolutely no 3D icons, purple/pink gradients, or "to the moon" imagery.
*   **No Heavy Borders:** If the UI looks like a grid of boxes, it has failed. It should look like a seamless piece of dark glass.
*   **No Rounded Corners on Logic:** Use `sm (0.125rem)` or `none` for technical components (data tables, code blocks). Reserve `full` or `xl` only for top-level navigation and floating containers.

---

## 7. Spacing & Rhythm
Use the **2:1 Ratio Rule** for vertical rhythm. If the gap between two logical groups is `Spacing-8 (1.75rem)`, the gap between elements within that group must be `Spacing-4 (0.9rem)`. This mathematical precision ensures the "Elite Infra" persona is maintained across every page.