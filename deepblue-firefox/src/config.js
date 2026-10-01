// config.js - brand name + all tunables (selectors, ids, timings, palette).
//
// Single source of truth for every DOM selector, generated element id, and
// numeric constant used elsewhere. Change DeepSeek's markup or DeepBlue's
// tuning here first; nothing else in the extension should hardcode a selector.
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.

'use strict';

const BRAND_NAME = 'DeepBlue';

const CONFIG = {
  ids: {
    exportBtn: 'deepblue-export-pdf-btn',
    copyConversationBtn: 'deepblue-copy-conversation-btn',
    counter: 'deepblue-char-counter',
    countSpan: 'deepblue-char-count',
    renderStage: 'deepblue-pdf-render-stage',
    contextMeter: 'deepblue-context-meter',
    searchBar: 'deepblue-chat-search',
    searchInput: 'deepblue-search-input',
    searchPrev: 'deepblue-search-prev',
    searchNext: 'deepblue-search-next',
    searchCount: 'deepblue-search-count',
    searchClear: 'deepblue-search-clear',
    sidebarSearchBar: 'deepblue-sidebar-search',
    sidebarSearchInput: 'deepblue-sidebar-search-input',
    sidebarSearchClear: 'deepblue-sidebar-search-clear',
    folderSection: 'deepblue-folder-section',
    folderList: 'deepblue-folder-list',
    folderAddBtn: 'deepblue-folder-add-btn',
    folderMenu: 'deepblue-folder-menu',
    toneRow: 'deepblue-tone-row',
    toneAddBtn: 'deepblue-tone-add-btn',
    bookmarkLauncher: 'deepblue-bookmark-launcher',
    bookmarkBadge: 'deepblue-bookmark-badge',
    bookmarkPanel: 'deepblue-bookmark-panel',
    downloadMenu: 'deepblue-download-menu',
    promptLibraryBtn: 'deepblue-prompt-library-btn',
    promptLibraryPanel: 'deepblue-prompt-library-panel',
  },
  selectors: {
    fileInput: 'input[type="file"][multiple], input[type="file"]',
    textarea: [
      'textarea._27c9245',
      'textarea[placeholder*="Message DeepSeek"]',
      'textarea[placeholder*="Send a message"]',
    ],
    messages: ['.ds-message._63c77b1', '[class*="ds-message"]'],
    userMessageMarker: '.fbb737a4',
    markdown: '.ds-markdown',
    title: ['.afa34042', '.d00ed9c9'],
    titleContainer: ['.afa34042', '.d00ed9c9'],
    messageActionRow: ['.ds-flex._0a3d93b', '._0a3d93b'],
    messageButtonRow: ['.ds-flex._965abe9'],
    shareButton: '.ds-button[title*="Share" i]',
    headerActionButton: '.the-header .ds-button',
    // Sibling action row next to a user message (copy + edit icons,
    // hover-revealed via CSS but always present in the DOM). The edit
    // button is the LAST .ds-button inside it - copy is first, edit is
    // second/last, confirmed via DOM dump. Verified against a specific
    // DeepSeek build; if this class ever stops matching, the folder
    // fallback below (find-by-icon-position) can be used instead.
    userMessageActionRow: '._11d6b3a',
    // Sidebar "..." conversation options button, revealed on hover of a
    // conversation row.
    sidebarConversationMenuBtn: '._2090548',
    // Container wrapping the "..." button + folder-star affordances,
    // used to force it visible (DeepSeek hides it at width:0/height:0
    // until the row is actually hovered - see quick-actions.js).
    sidebarConversationMenuWrap: '._254829d',
    primaryCircleButton: '.ds-button.ds-button--primary.ds-button--filled.ds-button--circle',
    fitContentWrapper: 'div[style*="width: fit-content"]',
    headerContainer: 'header, .ds-header, [class*="header"]',
    virtualListItems: '.ds-virtual-list-items._6f2c522',
    visibleItems: '.ds-virtual-list-visible-items',
    sidebarNewChatRow: '._7b40dad',
    sidebarScrollArea: '._6d215eb.ds-scroll-area',
    sidebarListGroups: '._77cdc67._8a693f3',
    sidebarDateGroup: '._3098d02',
    sidebarDateLabel: '.f3d18f6a',
    sidebarConversationLink: 'a._546d736',
    sidebarConversationTitle: '.c08e6e93',
    sidebarConversationHref: 'a._546d736[href*="/chat/s/"]',
  },
  charCounter: {
    warnAt: 500,
    dangerAt: 1000,
    colors: {
      normal: 'var(--db-text-secondary)',
      warn: 'var(--db-warn)',
      danger: 'var(--db-danger)',
    },
  },
  tokenCounter: {
    latinCharsPerToken: 4,
    cjkCharsPerToken: 1.6,
  },
  contextWindow: {
    codeCharsPerToken: 3.0,
    limit: 1048576,
  },
  folders: {
    storageKey: 'deepblue-folders-v1',
    assignmentsKey: 'deepblue-folder-assignments-v1',
    palette: [
      { name: 'Blue', hex: '#3964fe' },
      { name: 'Purple', hex: '#6c5ce7' },
      { name: 'Green', hex: '#22c55e' },
      { name: 'Orange', hex: '#f97316' },
      { name: 'Red', hex: '#ef4444' },
      { name: 'Pink', hex: '#ec4899' },
      { name: 'Teal', hex: '#14b8a6' },
      { name: 'Gray', hex: '#6b7280' },
    ],
  },
  tone: {
    storageKey: 'deepblue-tone-v1',
    lastInjectedKey: 'deepblue-tone-last-injected-v1',
    // Appended verbatim (never hidden) as the message's last line, so what
    // you see is always exactly what DeepSeek received - no mismatch
    // between the chat log and the actual request, ever.
    presets: [
      { id: 'none', label: 'Off', emoji: '' },
      { id: 'friendly', label: 'Friendly', emoji: '😊' },
      { id: 'fun', label: 'Fun', emoji: '🎉' },
      { id: 'professional', label: 'Professional', emoji: '👔' },
      { id: 'concise', label: 'Concise', emoji: '✂️' },
      { id: 'empathetic', label: 'Empathetic', emoji: '💛' },
    ],
  },
  bookmarks: {
    storageKey: 'deepblue-bookmarks-v1',
    snippetLength: 90,
  },
  prompts: {
    storageKey: 'deepblue-prompts-v1',
    snippetLength: 110,
    // Seeded once, the very first time the library is opened (i.e. when
    // nothing has ever been saved to storageKey yet) - so the feature is
    // immediately useful instead of greeting a new user with an empty
    // list. If the user later deletes every prompt on purpose, storage
    // holds a real (empty) array by then, so these are never re-added.
    defaults: [
      {
        title: 'Explain simply',
        content:
          "Explain the following like I'm new to the topic. Use plain language and a short example:\n\n",
      },
      {
        title: 'Improve my writing',
        content:
          'Improve the clarity, grammar, and flow of the following text, keeping its original meaning and tone:\n\n',
      },
      {
        title: 'Summarize',
        content: 'Summarize the key points below as a short bulleted list:\n\n',
      },
      {
        title: 'Find the bug',
        content:
          "Here is some code that isn't behaving as expected. Find the bug, explain why it happens, and show the fix:\n\n",
      },
      {
        title: 'Pros and cons',
        content: 'List the strongest pros and cons of the following, in balanced, concise bullet points:\n\n',
      },
    ],
  },
  timing: {
    initialScanDelayMs: 1200,
    observerDebounceMs: 300,
    postClickRecheckDelaysMs: [0, 120, 350],
  },
  pdf: {
    pageWidthPt: 595.28,
    pageHeightPt: 841.89,
    marginPt: 36,
    contentWidthPx: 760,
    renderScale: 2,
    jpegQuality: 0.95,
    blockSpacingPt: 10,
  },
};
