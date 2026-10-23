export const THEMES = Object.freeze({
  original: {
    label: 'Kurionyx Original',
    description: 'The current warm glass workspace with orange, grey and teal.'
  },
  tokyo: {
    label: 'Tokyo After Dark',
    description: 'A midnight skyscraper view with deep navy glass and restrained city light.'
  },
  amoled: {
    label: 'AMOLED 95',
    description: 'True black Windows 95-inspired surfaces with washed grey, orange and blue.'
  }
});

const STORAGE_KEY = 'kurionyx-theme';

export function getTheme() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return Object.hasOwn(THEMES, saved) ? saved : 'original';
}

export function applyTheme(theme, { persist = true } = {}) {
  const nextTheme = Object.hasOwn(THEMES, theme) ? theme : 'original';
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme === 'original' ? 'light' : 'dark';
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    meta.content = nextTheme === 'amoled' ? '#000000' : nextTheme === 'tokyo' ? '#07111f' : '#103f47';
  });
  if (persist) localStorage.setItem(STORAGE_KEY, nextTheme);
  window.dispatchEvent(new CustomEvent('kurionyx:themechange', { detail: { theme: nextTheme } }));
  return nextTheme;
}

export function initTheme() {
  return applyTheme(getTheme(), { persist: false });
}

initTheme();
