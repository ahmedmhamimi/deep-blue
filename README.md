# DeepBlue - architecture

This is a refactor of the original single-file `content.js` (2,400 lines) into
one file per concern. **No behavior was changed** - every line of logic was
moved, not rewritten. See "How this was verified" below.

## Why this structure

The old `content.js` had ~17 modules (`CONFIG`, `DOM`, `Toolbar`,
`ChatSearch`, `Folders`, `PdfExport`, ...) all defined as `const` objects
inside one 2,400-line IIFE. That made it hard to:

- find the code for a given feature (grep across one huge file),
- change one feature without scrolling past sixteen others,
- reason about what depends on what,
- review a diff (every PR touched "content.js").

Splitting by module fixes all of that while keeping the runtime model
identical.

## How the modules talk to each other

Chrome content scripts listed in `manifest.json`'s `content_scripts[].js`
array are injected **in that order**, into the **same JS realm** (the same
way multiple `<script>` tags on one page share a global scope). That means a
top-level `const CONFIG = {...}` declared in `src/config.js` is directly
visible, unqualified, to every file listed after it - no bundler, no
`window.DeepBlue` namespace, no `import`/`export` needed.

**This is why file order in `manifest.json` matters and why no module file
wraps its body in its own IIFE** - either of those would break the sharing.
Each file's header comment lists what it depends on and confirms this.

Because nearly everything here only *defines* functions/objects at load
time (the actual DOM work happens later, inside methods, triggered by
`bootstrap.js`'s `MutationObserver` well after every file has finished
loading), strict load-order-vs-usage-order mismatches are harmless - but
files are still listed in dependency order for readability.

## File map

```
manifest.json               Loads everything below, in order.
deepblue-bridge.js           Runs in the page's MAIN world (via <script src>,
                              not a content script). Sniffs DeepSeek's own
                              network responses for exact token counts.
vendor/                       Unmodified third-party libs (html2canvas, jsPDF).

src/
  config.js                  BRAND_NAME + every selector/id/tunable (CONFIG).
  utils.js                   debounce, queryFirst, escapeHtml, etc.
  store.js                   localStorage wrapper for folder data.
  dom.js                     All DeepSeek-page DOM lookups.
  bridge-client.js           Isolated-world half of the token-usage bridge;
                              injects + listens to deepblue-bridge.js.

  features/
    generation-timer.js      Time between "message sent" and "reply done".
    char-counter.js          Composer character counter.
    token-counter.js         Per-message estimated token badges.
    context-estimator.js     Whole-conversation token estimate (fallback).
    context-meter.js         Context-window usage progress bar.
    toolbar.js               Injects the export button + char counter.
    chat-search.js           In-chat search bar (next/prev, virtual-list aware).
    sidebar-search.js        Filters the sidebar conversation list.
    folders.js               Sidebar folders (colors, drag-in, storage).

  pdf/
    extractor.js             Reads the live chat DOM -> {title, messages[]}.
    renderer.js               Builds the off-screen printable HTML/CSS stage.
    pdf-export.js             Orchestrates extract -> render -> html2canvas -> jsPDF.

  bootstrap.js                Entry point: MutationObserver + start(). Always
                               last in manifest.json.
```

## Making changes safely

- **Selectors/tunables** (DeepSeek changes their markup, or you want to tweak
  a delay/threshold): edit `src/config.js` only.
- **A specific feature is broken** (e.g. search stopped highlighting): the
  file map above tells you exactly which file owns it.
- **Adding a new feature module**: create `src/features/your-thing.js`
  following the header-comment convention (purpose + dependencies), add it to
  `manifest.json`'s `js` array after the files it depends on, and call it
  from `bootstrap.js`'s `runScan()` if it needs to re-sync on every DOM change.
- Do **not** wrap a module file's body in its own `(function () { ... })()` -
  that hides its `const` from every file after it and breaks the whole
  approach described above.

## How this refactor was verified

1. Every module's code block was extracted from the original `content.js`
   using exact line ranges (verified against the file's own section-comment
   markers) - copy, not retype, so no logic could be accidentally altered.
2. Each resulting file was checked individually with `node --check` for
   syntax validity.
3. All 18 files were then executed together, in `manifest.json` order,
   inside a simulated `chat.deepseek.com` page (jsdom) to confirm every
   module (`CONFIG`, `DOM`, `Toolbar`, `PdfExport`, ...) loads without error
   and is visible to the files after it - i.e. the split behaves exactly like
   the original single file at runtime.
