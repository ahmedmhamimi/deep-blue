// deepblue-bridge.js
//
// Runs in the PAGE'S MAIN WORLD - injected as a <script src="..."> tag by the
// isolated-world content script (see Bridge.inject() in content.js). This is
// the only file in the extension that touches window.XMLHttpRequest/fetch
// directly, and it is deliberately narrow in scope:
//
//   - It only inspects requests to DeepSeek's own chat-completion endpoint.
//   - It only reads two fields out of the SSE stream: `model_type` and
//     `accumulated_token_usage` (both already sent by DeepSeek's backend to
//     the page - this isn't reading anything the page wasn't already given).
//   - It relays only those two numbers back to the content script via
//     window.postMessage. No prompts, no auth headers, no full response
//     bodies, no other request data ever leaves this file.
//   - It never modifies request/response data - purely observational.
//
(function () {
  'use strict';

  const MSG_TYPE = '__deepblue_bridge_token_usage__';
  const COMPLETION_PATH = '/api/v0/chat/completion';

  function post(payload) {
    window.postMessage({ source: 'deepblue-bridge', type: MSG_TYPE, ...payload }, '*');
  }

  /**
   * Feed a new raw chunk of SSE text into `state`, pulling out model_type /
   * accumulated_token_usage as they appear. Chunks from XHR's `progress`
   * event (or a fetch stream reader) are NOT guaranteed to break on line
   * boundaries - a single JSON line can arrive split across two chunks - so
   * incomplete trailing lines are buffered and prepended to the next chunk
   * rather than parsed (and silently dropped) immediately.
   */
  function feedChunk(newText, state) {
    state.buffer = (state.buffer || '') + newText;
    const lines = state.buffer.split(/\r?\n/);
    // The last element is either '' (buffer ended exactly on a newline) or an
    // incomplete line - either way, hold it back for the next call.
    state.buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;

      let json;
      try {
        json = JSON.parse(raw);
      } catch (err) {
        continue; // not JSON (e.g. a stray blank/data-less line) - skip
      }

      // "ready" event: {"request_message_id":..,"response_message_id":..,"model_type":"default"}
      if (typeof json.model_type === 'string' && !state.modelType) {
        state.modelType = json.model_type;
      }

      // First full-object frame: {"v":{"response":{...,"accumulated_token_usage":242,...}}}
      if (typeof json?.v?.response?.accumulated_token_usage === 'number') {
        state.tokenUsage = json.v.response.accumulated_token_usage;
      }

      // Batched patch-op frame: {"p":"response","o":"BATCH","v":[{"p":"accumulated_token_usage","v":391},...]}
      if (Array.isArray(json.v)) {
        for (const op of json.v) {
          if (op && op.p === 'accumulated_token_usage' && typeof op.v === 'number') {
            state.tokenUsage = op.v;
          }
        }
      }

      // Single patch-op frame with a full path.
      if (json.p === 'response/accumulated_token_usage' && typeof json.v === 'number') {
        state.tokenUsage = json.v;
      }
    }
  }

  function isTargetUrl(url) {
    return typeof url === 'string' && url.includes(COMPLETION_PATH);
  }

  // ---- XHR path (what DeepSeek's web app actually uses today) ----
  const OrigXHR = window.XMLHttpRequest;
  const origOpen = OrigXHR.prototype.open;
  OrigXHR.prototype.open = function (method, url, ...rest) {
    this.__deepblueUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  const origSend = OrigXHR.prototype.send;
  OrigXHR.prototype.send = function (...args) {
    const url = this.__deepblueUrl;
    if (isTargetUrl(url)) {
      const state = { tokenUsage: null, modelType: null, buffer: '' };
      let lastLength = 0;

      this.addEventListener('progress', () => {
        try {
          const text = this.responseText || '';
          if (text.length <= lastLength) return;
          feedChunk(text.slice(lastLength), state);
          lastLength = text.length;
          if (state.tokenUsage != null || state.modelType) {
            post({ tokenUsage: state.tokenUsage, modelType: state.modelType, done: false });
          }
        } catch (err) {
          // Never let a parsing hiccup break the page's own request handling.
        }
      });

      this.addEventListener('loadend', () => {
        post({ tokenUsage: state.tokenUsage, modelType: state.modelType, done: true });
      });
    }
    return origSend.apply(this, args);
  };

  // ---- fetch path (belt-and-suspenders, in case a future build switches to it) ----
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = async function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url;
      const res = await origFetch.call(this, input, init);

      if (isTargetUrl(url) && res.body && typeof res.body.tee === 'function') {
        const state = { tokenUsage: null, modelType: null, buffer: '' };
        const [passthrough, forInspection] = res.body.tee();

        (async () => {
          try {
            const reader = forInspection.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              feedChunk(decoder.decode(value, { stream: true }), state);
              post({ tokenUsage: state.tokenUsage, modelType: state.modelType, done: false });
            }
            post({ tokenUsage: state.tokenUsage, modelType: state.modelType, done: true });
          } catch (err) {
            // Ignore - the passthrough stream still reaches the page untouched.
          }
        })();

        return new Response(passthrough, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
      }

      return res;
    };
  }
})();
