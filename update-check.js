/* Shared simulator update notice: check only after tab/app return, at most once per 5 minutes. */
(() => {
  'use strict';
  const COOLDOWN_MS = 5 * 60 * 1000;
  const target = new URL('index.html', window.location.href);
  let loadedRevision = null;
  let lastCheckAt = 0;
  let checking = false;
  let wasAway = false;
  let updateAvailable = false;
  let notice = null;
  let dismissedAt = 0;

  function responseRevision(response) {
    const etag = response.headers.get('ETag');
    if (etag) return 'etag:' + etag;
    const modified = response.headers.get('Last-Modified');
    if (modified) return 'modified:' + modified;
    const length = response.headers.get('Content-Length');
    return length ? 'length:' + length : null;
  }

  function showNotice() {
    if (!document.body) return;
    if (!notice) {
      const style = document.createElement('style');
      style.textContent = `
        #sim-update-notice{position:fixed;z-index:2147483600;top:max(10px,env(safe-area-inset-top));left:12px;right:12px;max-width:640px;margin:0 auto;display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;background:#fff8e9;border:1px solid #c5a46b;border-radius:9px;box-shadow:0 5px 22px #33271330;color:#4a3f2c;font:14px/1.5 Arial,'Malgun Gothic',sans-serif}
        #sim-update-notice .sim-update-message{flex:1 1 210px;min-width:0}
        #sim-update-notice .sim-update-message strong{display:block;font-size:15px;margin-bottom:2px}
        #sim-update-notice .sim-update-actions{display:flex;gap:6px;flex-shrink:0}
        #sim-update-notice button{min-height:40px;padding:8px 12px;border-radius:6px;border:1px solid #c5a46b;background:#fff;color:#65542f;font:600 14px/1.2 Arial,'Malgun Gothic',sans-serif;cursor:pointer}
        #sim-update-notice .sim-update-reload{background:#65542f;color:white;border-color:#65542f}
        #sim-update-notice button:focus-visible{outline:3px solid #dfa24c;outline-offset:2px}
        @media(max-width:460px){#sim-update-notice{gap:9px;padding:11px 12px}#sim-update-notice .sim-update-actions{width:100%}#sim-update-notice button{flex:1}}
      `;
      document.head.appendChild(style);
      notice = document.createElement('section');
      notice.id = 'sim-update-notice';
      notice.setAttribute('role', 'status');
      notice.setAttribute('aria-live', 'polite');
      notice.innerHTML = '<div class="sim-update-message"><strong>새로운 버전이 있습니다.</strong><span>최신 기능을 적용하려면 새로고침하세요.</span></div><div class="sim-update-actions"><button type="button" class="sim-update-reload">새로고침</button><button type="button" class="sim-update-later">나중에</button></div>';
      notice.querySelector('.sim-update-reload').addEventListener('click', () => {
        try {
          // Existing simulators save their input data to localStorage.
          if (typeof window.saveState === 'function') window.saveState();
          else if (typeof window.persist === 'function') window.persist();
        } catch (_) { /* Keep refresh available even if storage is blocked. */ }
        // A cache-busting navigation fetches the newly deployed HTML.
        const next = new URL(window.location.href);
        next.searchParams.set('__updated', String(Date.now()));
        window.location.replace(next.href);
      });
      notice.querySelector('.sim-update-later').addEventListener('click', () => {
        dismissedAt = Date.now();
        notice.style.display = 'none';
      });
      document.body.appendChild(notice);
    }
    notice.style.display = 'flex';
  }

  async function checkForUpdate() {
    if (checking || updateAvailable || Date.now() - lastCheckAt < COOLDOWN_MS) return;
    checking = true;
    lastCheckAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const url = new URL(target.href);
      url.searchParams.set('__version_check', String(Date.now()));
      const response = await fetch(url.href, {
        method: 'HEAD', cache: 'no-store', credentials: 'same-origin', signal: controller.signal
      });
      if (!response.ok) return;
      const revision = responseRevision(response);
      if (!revision) return; // Unknown hosting environments: do not display false warnings.
      if (loadedRevision === null) loadedRevision = revision;
      else if (revision !== loadedRevision) {
        updateAvailable = true;
        showNotice();
      }
    } catch (_) {
      // Offline or temporary server errors must never interrupt calculator use.
    } finally {
      clearTimeout(timeout);
      checking = false;
    }
  }

  function resume() {
    if (!wasAway || document.visibilityState === 'hidden') return;
    wasAway = false;
    if (updateAvailable) {
      if (Date.now() - dismissedAt >= COOLDOWN_MS) showNotice();
      return;
    }
    void checkForUpdate();
  }

  function init() {
    // One lightweight baseline HEAD request on initial load; no background polling.
    void checkForUpdate();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') wasAway = true;
      else resume();
    });
    window.addEventListener('blur', () => { wasAway = true; });
    window.addEventListener('focus', resume);
    window.addEventListener('pagehide', () => { wasAway = true; });
    window.addEventListener('pageshow', event => { if (event.persisted) resume(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
