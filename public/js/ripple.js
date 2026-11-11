const RIPPLE_TARGETS = [
  '.btn',
  '.ghost-btn',
  '.icon-btn',
  '.side-item',
  '.chip',
  '.tag-chip',
  '.view-toggle button',
  '.upload-menu button',
  '.fab',
  '.file-card',
  '.file-row',
  '.galaxy-btn',
  '.grade-btn',
  '.deck-item',
  '.orbit-card',
].join(',');

export function initRipple(root = document) {
  const target = root === document ? document.documentElement : root;
  if (!target || target.dataset.rippleReady === '1') return;
  target.dataset.rippleReady = '1';

  target.addEventListener(
    'pointerdown',
    (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const host = event.target.closest(RIPPLE_TARGETS);
      if (!host) return;
      if (host.disabled || host.getAttribute('aria-disabled') === 'true') return;
      if (host.dataset.noRipple === '1') return;

      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      if (!host.classList.contains('md-ripple-host')) {
        host.classList.add('md-ripple-host');
      }
      if (getComputedStyle(host).position === 'static') {
        host.style.position = 'relative';
      }

      const size = Math.max(rect.width, rect.height) * 2.1;
      const ink = document.createElement('span');
      ink.className = 'md-ripple';
      ink.style.width = `${size}px`;
      ink.style.height = `${size}px`;
      ink.style.left = `${event.clientX - rect.left - size / 2}px`;
      ink.style.top = `${event.clientY - rect.top - size / 2}px`;

      host.appendChild(ink);
      const remove = () => ink.remove();
      ink.addEventListener('animationend', remove, { once: true });
      setTimeout(remove, 900);
    },
    { passive: true }
  );
}
