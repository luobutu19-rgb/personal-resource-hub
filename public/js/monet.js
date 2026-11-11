/* 莫奈取色：像 Android Material You 一样，从图片或主题色生成整套配色 */
(function () {
  const KEY = 'rh.seed';
  const VARS = ['--accent', '--accent-ink', '--accent-soft', '--accent-glow'];

  const PRESETS = [
    { name: '睡莲', seed: '#5c8f7d' },
    { name: '鸢尾', seed: '#6d5ba3' },
    { name: '日出', seed: '#c47a4f' },
    { name: '雾蓝', seed: '#4a6d88' },
    { name: '玫瑰', seed: '#b25f74' },
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function hexToHsl(hex) {
    let value = String(hex || '').replace('#', '').trim();
    if (value.length === 3) value = value.split('').map((char) => char + char).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(value)) return null;
    const r = parseInt(value.slice(0, 2), 16) / 255;
    const g = parseInt(value.slice(2, 4), 16) / 255;
    const b = parseInt(value.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('')}`;
  }

  function readSeed() {
    try {
      return localStorage.getItem(KEY) || '';
    } catch {
      return '';
    }
  }

  function apply(seed) {
    const root = document.documentElement;
    if (!seed) {
      VARS.forEach((name) => root.style.removeProperty(name));
      return;
    }
    const hsl = hexToHsl(seed);
    if (!hsl) return;
    const h = hsl.h;
    const sat = clamp(hsl.s, 26, 72);
    const dark = root.dataset.theme === 'dark';
    const set = (name, value) => root.style.setProperty(name, value);

    if (dark) {
      set('--accent', `hsl(${h}, ${Math.round(sat * 0.8)}%, 70%)`);
      set('--accent-ink', `hsl(${h}, ${Math.round(sat * 0.72)}%, 84%)`);
      set('--accent-soft', `hsl(${h}, ${Math.round(clamp(sat * 0.5, 20, 38))}%, 20%)`);
      set('--accent-glow', `hsla(${h}, ${sat}%, 62%, 0.18)`);
    } else {
      set('--accent', `hsl(${h}, ${sat}%, 36%)`);
      set('--accent-ink', `hsl(${h}, ${sat}%, 27%)`);
      set('--accent-soft', `hsl(${h}, ${Math.round(clamp(sat * 0.45, 18, 40))}%, 93%)`);
      set('--accent-glow', `hsla(${h}, ${sat}%, 45%, 0.16)`);
    }
  }

  function setSeed(seed) {
    try {
      if (seed) localStorage.setItem(KEY, seed);
      else localStorage.removeItem(KEY);
    } catch {
      // 隐私模式下仅本次生效
    }
    apply(seed);
  }

  function extractSeedFromImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const size = 72;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(img, 0, 0, size, size);
          const { data } = ctx.getImageData(0, 0, size, size);

          const bins = new Map();
          let fallback = { r: 0, g: 0, b: 0, weight: 0 };
          for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3];
            if (alpha < 128) continue;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const l = (max + min) / 2;
            const s = max === min ? 0 : (max - min) / (max + min);
            const weight = s * (1 - Math.abs(l - 128) / 160);

            fallback.r += r * weight;
            fallback.g += g * weight;
            fallback.b += b * weight;
            fallback.weight += weight;

            if (s < 0.12 || l < 24 || l > 236) continue;
            let h = 0;
            const d = max - min;
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;

            const bucket = Math.round(h / 15) % 24;
            const entry = bins.get(bucket) || { r: 0, g: 0, b: 0, weight: 0 };
            entry.r += r * weight;
            entry.g += g * weight;
            entry.b += b * weight;
            entry.weight += weight;
            bins.set(bucket, entry);
          }

          const best = [...bins.values()].sort((a, b) => b.weight - a.weight)[0];
          let seed = '';
          if (best && best.weight > 0) {
            seed = rgbToHex(best.r / best.weight, best.g / best.weight, best.b / best.weight);
          } else if (fallback.weight > 0) {
            seed = rgbToHex(
              fallback.r / fallback.weight,
              fallback.g / fallback.weight,
              fallback.b / fallback.weight
            );
          }
          URL.revokeObjectURL(url);
          if (!seed) reject(new Error('这张图片里没有可用的颜色'));
          else resolve(seed);
        } catch (error) {
          URL.revokeObjectURL(url);
          reject(error);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('图片读取失败'));
      };
      img.src = url;
    });
  }

  apply(readSeed());

  try {
    new MutationObserver(() => apply(readSeed())).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  } catch {
    // 不支持时忽略
  }

  window.RHMonet = { presets: PRESETS, getSeed: readSeed, setSeed, apply, extractSeedFromImage };
})();
