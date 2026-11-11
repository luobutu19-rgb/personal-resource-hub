export function toast(message, { type = 'info', duration = 3200 } = {}) {
  const root = document.getElementById('toastRoot');
  if (!root) return;

  const element = document.createElement('div');
  element.className = `toast ${type}`;
  const dot = document.createElement('span');
  dot.className = 'toast-dot';
  const text = document.createElement('p');
  text.textContent = message;
  element.append(dot, text);
  root.appendChild(element);

  requestAnimationFrame(() => element.classList.add('in'));
  setTimeout(() => {
    element.classList.remove('in');
    setTimeout(() => element.remove(), 240);
  }, duration);
}
