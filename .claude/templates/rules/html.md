---
paths:
  - "**/*.html"
  - "**/*.htm"
---

# HTML Rules

> Modern HTML best practices — semantics, accessibility, performance, and security.
> Formatting is delegated to Prettier (see `javascript.md`). The "write modern code" principle
> from `coding-principles.md` §5 applies: prefer native elements and current APIs; avoid
> deprecated attributes and legacy patterns.

## Document Foundation

- Always start with `<!DOCTYPE html>`. The short form is canonical.
- Declare the document language: `<html lang="en">` (or the appropriate BCP 47 tag). Add
  `dir="rtl"` when needed; never rely on visual-only layout for text direction.
- `<meta charset="utf-8">` must be the **first child** of `<head>` — before `<title>` and
  any resource-loading tags.
- Include `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- `<title>` is mandatory, unique per page, and meaningful out of context (used by screen
  readers, bookmarks, and search results). Do not leave it empty or generic.

## Semantic HTML First

- Use the right element for the meaning, not the appearance. `header`, `nav`, `main`,
  `article`, `section`, `aside`, `footer` — prefer these over generic `div`.
- One `<main>` per page. Do not nest `<main>`.
- Headings (`h1`–`h6`) must follow document outline order. One `<h1>` per page. Never skip
  levels (e.g., `h2` → `h4`). Do not choose a heading level for its visual size — use CSS.
- Use `<ul>`/`<ol>` for lists, `<table>` for tabular data (with `<caption>`, `<th scope>`),
  `<figure>`/`<figcaption>` for captioned media, `<time datetime="...">` for dates,
  `<address>` for contact info.
- Do not repurpose elements for visual effect (e.g., `<blockquote>` for indentation,
  `<br>` for spacing). Appearance belongs in CSS.

## Accessibility (a11y)

- **Prefer native semantics over ARIA.** A native `<button>` is better than
  `<div role="button">`. "No ARIA is better than bad ARIA."
- Do not override native semantics with `role` unless you fully implement the required
  keyboard behavior and state management.
- Every meaningful `<img>` needs a descriptive `alt`. Decorative images: `alt=""`.
  Complex images (charts, diagrams): describe in adjacent text or `aria-describedby`.
- Every form control needs a visible `<label>` associated via `for`/`id` or wrapping. Do
  not use `placeholder` as the only label — it disappears on input.
- All interactive elements must be keyboard-accessible. Use `<button>` for actions, `<a>`
  for navigation. Never attach `onclick` to `div` or `span`.
- Preserve focus visibility. Do not write `outline: none` without a custom focus style.
- `tabindex` values greater than `0` are forbidden. `tabindex="0"` to include custom
  elements in natural tab order; `tabindex="-1"` to allow programmatic focus only.
- Use `aria-live` regions for dynamic content updates (e.g., notifications, loading states).
- Target WCAG 2.2 AA minimum: sufficient color contrast (4.5:1 normal text, 3:1 large),
  text alternatives, keyboard operability, and no reliance on color alone.

## Links, Buttons & Native Interaction

- Navigation → `<a href="...">`. Action → `<button type="button">`. Never swap them.
- `<a>` without `href` is not a link. Give it a meaningful text label, not just an icon.
- `target="_blank"` requires `rel="noopener noreferrer"` to prevent tab-napping and
  referrer leakage.
- Prefer **native platform UI** over custom JavaScript implementations:
  - Modal dialogs → `<dialog>` with `showModal()` / `close()` (built-in focus trap,
    backdrop, `Escape` key).
  - Disclosure → `<details>` / `<summary>` (no JS required).
  - Tooltips / popovers → Popover API (`popover` attribute + `popovertarget`), available
    in all modern browsers as of 2024.
  - Custom `<select>` alternatives → Customizable Select (`appearance: base-select`) where
    browser support allows; fall back to `<select>` before reaching for a JS widget.

## Forms

- Always specify `type` on `<input>`: `text`, `email`, `tel`, `url`, `number`, `date`,
  `time`, `password`, `checkbox`, `radio`, `file`, `submit`, `button`, `hidden`.
- Add `name` to every control that should be submitted. Add `autocomplete` to help
  browsers and password managers (e.g., `autocomplete="email"`, `"current-password"`).
- Use `inputmode` to request the correct virtual keyboard without changing semantics
  (e.g., `inputmode="numeric"` on a text input expecting a PIN).
- Leverage native validation attributes: `required`, `pattern`, `minlength`, `maxlength`,
  `min`, `max`, `step`. Supplement with JS for complex rules; never replace native
  validation entirely.
- Group related controls with `<fieldset>` + `<legend>`. Required for radio/checkbox
  groups.
- Do not use `placeholder` as a substitute for `<label>`. `placeholder` is a hint, not a
  label — it fails contrast requirements and disappears when the user starts typing.
- Explicitly set `type="submit"` on submit buttons and `type="button"` on non-submit
  buttons inside a `<form>`.

## Images & Media

- Specify intrinsic `width` and `height` on every `<img>` (or set `aspect-ratio` in CSS)
  to allow the browser to reserve layout space and prevent Cumulative Layout Shift (CLS).
- For responsive images, use `srcset` + `sizes`. For art direction (different crops at
  different breakpoints), use `<picture>` + `<source media="...">`.
- Offer modern formats via `<picture>`: serve AVIF first, then WebP, then the legacy
  format as a fallback.
- Below-the-fold images: add `loading="lazy" decoding="async"`.
- LCP (Largest Contentful Paint) images: **do not lazy-load**. Add
  `<link rel="preload" as="image">` in `<head>` for the LCP image when it is
  dynamically chosen.
- For `<video>` and `<audio>`: include `<track kind="captions">` / `<track kind="subtitles">`
  for accessibility. Provide `controls`. Do not autoplay with audio unless `muted`.

## Head, Metadata & SEO

- Required in every `<head>`: `<title>`, `<meta name="description">`, canonical
  `<link rel="canonical">`.
- Open Graph (`og:title`, `og:description`, `og:image`, `og:url`) and Twitter Card
  (`twitter:card`, etc.) tags for shareable pages.
- Provide a favicon via `<link rel="icon">`. Use SVG for a scalable icon that works at
  any size and supports dark-mode media queries.
- Add structured data (JSON-LD in a `<script type="application/ld+json">`) for content
  types that benefit from rich results (articles, products, events, FAQs, etc.).
- Do not duplicate `charset` or `viewport` `<meta>` tags.

## Performance

- Scripts that are not render-critical must not block parsing. Use:
  - `<script defer src="...">` for classic scripts that need the DOM.
  - `<script type="module" src="...">` — modules are deferred by default.
  - `<script async src="...">` only for truly independent scripts (analytics, ads).
  - Never place a synchronous `<script>` in `<head>` without `async` or `defer`.
- Preload render-critical resources (fonts, hero images, CSS used above-the-fold):

  ```html
  <link rel="preload" href="font.woff2" as="font" type="font/woff2" crossorigin>
  ```

- Warm up third-party origins early:

  ```html
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="dns-prefetch" href="https://analytics.example.com">
  ```

- Avoid large inline `<style>` or `<script>` blocks. Externalize them to benefit from
  HTTP caching. Critical CSS (above-the-fold only) is the one justified exception.
- Use `fetchpriority="high"` on the LCP image and `fetchpriority="low"` on below-the-fold
  images when fine-tuning resource scheduling.

## Security

- Design for a **Content Security Policy (CSP)**: avoid inline event handlers
  (`onclick="..."`, `onload="..."`) and inline `<script>` blocks without nonces. Move
  logic to external JS files.
- Sanitize all user-supplied content before inserting it into HTML. Never set
  `innerHTML` with untrusted data.
- For `target="_blank"` links, always include `rel="noopener noreferrer"` (see §Links).
- `<iframe>` must carry the `sandbox` attribute with the minimum required permissions.
  Add `loading="lazy"` for below-the-fold iframes. Set `title` for accessibility.
- Serve pages over HTTPS. Reference all subresources with HTTPS URLs or protocol-relative
  URLs — never plain `http:` in HTML delivered over HTTPS.
- Forms submitting sensitive data (passwords, PII) must use `method="post"` and HTTPS.

## Coding Style & Formatting

- All element names and attribute names must be **lowercase**.
- All attribute values must be wrapped in **double quotes** (`""`).
- Delegate all formatting (indentation, line length, trailing whitespace) to **Prettier**.
  Do not format HTML by hand.
- Void elements (`<br>`, `<hr>`, `<img>`, `<input>`, `<link>`, `<meta>`, etc.) do not
  need a self-closing slash. Let Prettier decide based on the project config.
- Do not rely on optional tag omission (e.g., omitting `</li>` or `</td>`). Write all
  closing tags explicitly.
- Boolean attributes: write without a value — `disabled`, `required`, `checked`. Do not
  write `disabled="disabled"` or `disabled=""`.
- Omit `type="text/javascript"` from `<script>` and `type="text/css"` from `<style>` —
  both are the HTML5 default.
- Avoid divitis: do not wrap content in `<div>` or `<span>` when a semantic element
  would do. Do not add wrapper `<div>` layers solely for CSS hooks when a class on the
  existing element suffices.
- Attribute order (for human-written markup before Prettier normalizes it):
  `id`, `class`, `name`, `type`, `src`/`href`, `value`, `for`/`aria-*`, `data-*`.
  Consistency matters more than the exact order.

## Validation & Tooling

- Validate HTML with the **Nu Html Checker** (`validator.w3.org/nu/`) or its CLI
  (`vnu-jar`). Run it in CI and keep zero errors.
- Lint with **`html-validate`** for project-level rules (indentation, attribute ordering,
  deprecated features). Configure it in `.htmlvalidate.json`.
- Run **axe** (browser extension or `@axe-core/cli`) and **Lighthouse** accessibility
  audits. Target zero axe violations and Lighthouse accessibility score ≥ 95.
- Use browser DevTools — Accessibility panel, Coverage, and Performance — to verify
  semantic structure, unused CSS, and Core Web Vitals (LCP, CLS, INP).
