// Theme plumbing shared by the server layout and the client toggle.

export const THEME_COOKIE = "ms_admin_theme";
export type Theme = "light" | "dark";

// 1 year, scoped to the admin subtree.
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Inline, render-blocking script placed as the FIRST child of #admin-root. It
 * runs synchronously during HTML parse — before the rest of the subtree paints —
 * so there is no flash of the wrong theme:
 *   - if the cookie is set, it matches the server-rendered class (no-op);
 *   - if no cookie, it falls back to the OS preference (the server can't read
 *     that, so this is where the system default is applied).
 * Uses document.currentScript.parentElement so it targets #admin-root without
 * an id lookup race.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var r=(document.currentScript&&document.currentScript.parentElement)||document.getElementById('admin-root');
if(!r)return;
var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=([^;]*)/);
if(m){if(decodeURIComponent(m[1])==='dark'){r.classList.add('dark');}else{r.classList.remove('dark');}}
else if(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches){r.classList.add('dark');}
}catch(e){}})();`;
