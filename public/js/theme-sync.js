/* 主题偏好：auto（跟随系统）/ light / dark，早期同步避免闪屏 */
(function () {
  const KEY = 'rh.theme';
  const META = { light: '#FAF9F6', dark: '#111413' };
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function read() {
    try {
      const value = localStorage.getItem(KEY);
      return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
    } catch {
      return 'auto';
    }
  }

  function effective(pref) {
    const mode = pref || read();
    return mode === 'auto' ? (media.matches ? 'dark' : 'light') : mode;
  }

  function apply(pref) {
    const mode = pref || read();
    const theme = effective(mode);
    const root = document.documentElement;
    root.dataset.theme = theme;
    root.dataset.themeMode = mode;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META[theme] || META.light);
    document.dispatchEvent(new CustomEvent('rh:theme', { detail: { mode, theme } }));
  }

  function set(pref) {
    try {
      localStorage.setItem(KEY, pref);
    } catch {
      // 隐私模式仅本次生效
    }
    apply(pref);
    return pref;
  }

  function cycle() {
    const mode = read();
    const system = media.matches ? 'dark' : 'light';
    const other = system === 'dark' ? 'light' : 'dark';
    let next;
    if (mode === 'auto') next = other;
    else if (mode === other) next = system;
    else next = 'auto';
    set(next);
    return { mode: next, theme: effective(next) };
  }

  if (media.addEventListener) {
    media.addEventListener('change', () => {
      if (read() === 'auto') apply('auto');
    });
  } else if (media.addListener) {
    media.addListener(() => {
      if (read() === 'auto') apply('auto');
    });
  }

  apply();

  window.RHTheme = { read, effective, apply, set, cycle };
})();
