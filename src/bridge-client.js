// bridge-client.js - relays exact token-usage numbers from the page's main world.
//
// Injects deepblue-bridge.js (a separate, web-accessible script that runs in
// the page's own JS context) and listens for postMessage updates from it.
// Depends on: config.js (BRAND_NAME), utils.js (conversationIdFromHref).
//
// Loaded as a classic (non-module) content script listed in manifest.json.
// Content scripts injected this way share a single JS realm, so top-level
// `const`/`let` bindings declared here are visible to every file listed
// AFTER this one in manifest.json's content_scripts[].js array. Keep that
// array in dependency order; do not wrap module bodies in their own IIFE
// or this sharing breaks.
//
// --- Why this file tracks a conversation id at all -------------------------
// `latestTokenUsage`/`latestModelType` are what context-meter.js actually
// renders, and they used to be simple globals: whatever the last bridge
// message said, no matter which conversation it was about. DeepSeek is an
// SPA, so switching to a different chat window never reloads the page and
// never clears them - they just keep showing whatever number the
// PREVIOUSLY open conversation last reported, until the user sends a new
// message in the new window and a fresh number happens to overwrite it.
// That's the exact bug reported by a user: "you have to chat in every
// window before its usage updates".
//
// The fix has two cooperating parts:
//   1. `_usageByConversation` remembers the last known exact usage per
//      conversation id (from conversationIdFromHref - see utils.js), so
//      switching to a chat already used this session shows its real number
//      immediately, and switching to one that hasn't shows nothing (letting
//      context-meter.js fall back to its own DOM-based estimate) instead of
//      a stale figure from whatever was open before.
//   2. deepblue-bridge.js now tags every message with the conversation id
//      that was current when the underlying request was actually SENT, not
//      when its response arrives. Without that, a reply still streaming in
//      after the user has already clicked over to a different window would
//      get attributed to wherever they ended up instead of where it came
//      from - a race the id-per-request tagging closes.

'use strict';

const Bridge = {
  MSG_TYPE: '__deepblue_bridge_token_usage__',
  scriptId: 'deepblue-bridge-script',
  latestTokenUsage: null,
  latestModelType: null,

  // conversationId -> { tokenUsage, modelType }. Bounded below so a long
  // session that touches many conversations can't grow this forever.
  _usageByConversation: new Map(),
  _MAX_CACHED_CONVERSATIONS: 50,

  // undefined = syncConversation() hasn't run yet at all; null = it has run
  // and the user is on a not-yet-saved "new chat" screen with no slug in the
  // URL; a string = the real conversation id currently open. Keeping
  // "never synced" distinct from "synced, no id" matters on the very first
  // tick after page load - see syncConversation().
  _trackedConversationId: undefined,
  _navigationWatched: false,

  inject() {
    if (document.getElementById(this.scriptId)) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) return;
    const script = document.createElement('script');
    script.id = this.scriptId;
    script.src = chrome.runtime.getURL('deepblue-bridge.js');
    script.onload = () => script.remove();
    script.onerror = () => {
      console.debug(
        `${BRAND_NAME}: bridge script failed to load - falling back to estimation only.`
      );
    };
    (document.head || document.documentElement).appendChild(script);
  },

  listen() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== 'deepblue-bridge' || data.type !== this.MSG_TYPE) return;

      // The id the underlying request was actually sent for (see
      // deepblue-bridge.js), not necessarily where the user is looking now.
      const requestConvId = typeof data.conversationId === 'string' ? data.conversationId : null;
      // Lazily computed rather than trusting _trackedConversationId, in case
      // this message arrives before syncConversation() has ever run once.
      const viewingConvId =
        this._trackedConversationId !== undefined
          ? this._trackedConversationId
          : conversationIdFromHref(location.pathname);

      const hasTokenUsage = typeof data.tokenUsage === 'number';
      const hasModelType = typeof data.modelType === 'string';
      if (!hasTokenUsage && !hasModelType) return;

      // Keep that request's own conversation slot current regardless of
      // where the user has navigated to since - so switching back to it
      // later shows the real number instead of an estimate. A request
      // fired from a brand-new, not-yet-saved chat (no id yet) is
      // deliberately never cached here: syncConversation() alone handles
      // that one specific case, once/if it's assigned a real id.
      if (requestConvId) {
        this._cacheUsage(
          requestConvId,
          hasTokenUsage ? data.tokenUsage : this._usageByConversation.get(requestConvId)?.tokenUsage,
          hasModelType ? data.modelType : this._usageByConversation.get(requestConvId)?.modelType
        );
      }

      // Only drive the on-screen meter if this update actually belongs to
      // whatever conversation is currently open. A request captured with no
      // id at all is always let through: at send time there was nothing
      // else it could have been about, and the "no id yet -> real id"
      // rewrite that follows a first reply is handled in
      // syncConversation(), not here.
      if (requestConvId !== null && requestConvId !== viewingConvId) return;
      if (hasTokenUsage) this.latestTokenUsage = data.tokenUsage;
      if (hasModelType) this.latestModelType = data.modelType;
    });
  },

  // Patches the History API so a same-page conversation switch (DeepSeek
  // never does a full navigation for this) is noticed the instant it
  // happens, rather than waiting for the next debounced DOM scan. This is
  // belt-and-suspenders, not the only line of defense: syncConversation()
  // is also called from bootstrap.js's runScan() on every tick, which is
  // driven off the message-list mutation a real conversation switch always
  // causes regardless of which API DeepSeek used to get there. Idempotent -
  // safe to call more than once.
  watchNavigation() {
    if (this._navigationWatched) return;
    this._navigationWatched = true;

    const resync = () => this.syncConversation();

    ['pushState', 'replaceState'].forEach((method) => {
      const original = history[method];
      if (typeof original !== 'function') return;
      history[method] = function (...args) {
        const result = original.apply(this, args);
        resync();
        return result;
      };
    });

    window.addEventListener('popstate', resync);
    window.addEventListener('hashchange', resync);
  },

  // Reconciles latestTokenUsage/latestModelType with whichever conversation
  // is actually open right now. No-op unless the id has actually changed
  // since the last call.
  syncConversation() {
    const currentId = conversationIdFromHref(location.pathname);
    if (currentId === this._trackedConversationId) return;

    const previousId = this._trackedConversationId;
    this._trackedConversationId = currentId;

    // A brand-new, not-yet-saved chat has no slug in its URL. The very
    // first exchange in it gets one retroactively once the backend creates
    // the conversation - the URL is rewritten out from under the user
    // without them navigating anywhere. It's still the exact same
    // conversation the whole time, so this one specific transition (no id
    // -> a real id) is treated as a non-event for the live numbers: keep
    // showing whatever the in-flight response already reported, just start
    // filing it under the new id from now on.
    if (previousId === null && currentId !== null) {
      this._cacheUsage(currentId, this.latestTokenUsage, this.latestModelType);
      return;
    }

    // A genuine switch: to a different real conversation, to the blank
    // "new chat" screen, or away from one real conversation into another.
    // Whatever was on screen belonged to the conversation just left -
    // file it under that id (if it's a real, nameable one) so coming back
    // to it later restores the exact figure instead of an estimate. Then
    // load in whatever's already known for the conversation being switched
    // to, or nothing at all if it's never been chatted with this session -
    // letting context-meter.js's own DOM estimate take over immediately
    // rather than showing a number that belongs to somewhere else.
    if (previousId) this._cacheUsage(previousId, this.latestTokenUsage, this.latestModelType);

    const cached = currentId ? this._usageByConversation.get(currentId) : null;
    this.latestTokenUsage = cached ? cached.tokenUsage : null;
    this.latestModelType = cached ? cached.modelType : null;
  },

  _cacheUsage(convId, tokenUsage, modelType) {
    if (!convId || typeof tokenUsage !== 'number') return;
    // Re-inserting an existing key (delete then set) keeps Map iteration
    // order so the LEAST recently touched conversation - not just the
    // oldest ever seen - is the one evicted once the cap is hit.
    if (this._usageByConversation.has(convId)) {
      this._usageByConversation.delete(convId);
    } else if (this._usageByConversation.size >= this._MAX_CACHED_CONVERSATIONS) {
      const oldestKey = this._usageByConversation.keys().next().value;
      this._usageByConversation.delete(oldestKey);
    }
    this._usageByConversation.set(convId, { tokenUsage, modelType: modelType || null });
  },
};
