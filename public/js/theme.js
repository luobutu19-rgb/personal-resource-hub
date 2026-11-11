import { toast } from './toast.js';

const LABELS = { auto: '跟随系统', light: '浅色', dark: '深色' };
const SIDE_LABELS = { auto: '跟随系统', light: '浅色模式', dark: '深色模式' };

function icon(name) {
  return `<svg class="icon"><use href="/icons.svg#i-${name}"></use></svg>`;
}

function currentMode() {
  return window.RHTheme?.read() || 'auto';
}

function render() {
  const mode = currentMode();
  const iconName = mode === 'auto' ? 'auto' : mode === 'dark' ? 'moon' : 'sun';

  const topButton = document.getElementById('themeBtn');
  if (topButton) {
    topButton.innerHTML = icon(iconName);
    topButton.title = `主题：${LABELS[mode]}（点击切换）`;
    topButton.setAttribute('aria-label', `主题：${LABELS[mode]}，点击切换`);
  }

  const sideButton = document.getElementById('themeBtnSide');
  if (sideButton) {
    sideButton.innerHTML = `${icon(iconName)}<span>${SIDE_LABELS[mode]}</span>`;
    sideButton.title = '点击切换：跟随系统 / 浅色 / 深色';
  }
}

export function initTheme() {
  window.RHTheme?.apply();
  render();
  document.addEventListener('rh:theme', render);
}

export function toggleTheme() {
  if (!window.RHTheme) return;
  const result = window.RHTheme.cycle();
  toast(`主题已切换：${LABELS[result.mode]}`, { type: 'info', duration: 2200 });
}
