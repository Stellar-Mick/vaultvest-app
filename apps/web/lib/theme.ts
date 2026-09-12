/**
 * theme.ts — shared theme constants. Deliberately a plain module (no
 * `'use client'`) so the server-rendered layout can inline the boot script
 * and the client-side toggle can read the same key.
 */

export const THEME_KEY = 'vaultvest:theme';

/**
 * Applied inline in the root layout before hydration so the first paint is
 * already in the right theme. A build-time constant, not user input.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_KEY
)});var d=t?t==='dark':window.matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;
