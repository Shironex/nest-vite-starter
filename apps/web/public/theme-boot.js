// Flicker-free theme: apply dark class synchronously before React renders.
// Loaded from index.html as an external script so a strict CSP can drop
// 'unsafe-inline' from script-src.
(function () {
  try {
    var stored = localStorage.getItem('ui-store');
    if (stored) {
      var theme = JSON.parse(stored).state.theme;
      var isDark =
        theme === 'dark' ||
        (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) document.documentElement.classList.add('dark');
    } else {
      // No stored preference: follow system default
      if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('dark');
      }
    }
  } catch (_e) {
    // Ignore parse errors
  }
})();
