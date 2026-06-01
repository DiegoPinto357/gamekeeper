import { useEffect } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';

type Theme = 'light' | 'dark';

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setTheme] = useLocalStorage<Theme>('theme', systemTheme());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggle = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  return { theme, toggle };
}
