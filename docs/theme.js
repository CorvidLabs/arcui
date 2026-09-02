(() => {
    "use strict";
    const root = document.documentElement;
    const STORE_KEY = "corvid-theme";
    const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = () => root.dataset.theme === "dark" || (!root.dataset.theme && systemDark());
    const urlTheme = new URLSearchParams(location.search).get("theme");
    let saved = urlTheme;
    if (!saved) {
        try { saved = localStorage.getItem(STORE_KEY); } catch (_) {}
    }
    if (saved === "dark" || saved === "light") root.dataset.theme = saved;
    const buttons = document.querySelectorAll("[data-corvid-theme-toggle]");
    const reflect = () => {
        const dark = isDark();
        buttons.forEach((btn) => {
            btn.setAttribute("aria-pressed", String(dark));
            btn.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
        });
    };
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            root.dataset.theme = isDark() ? "light" : "dark";
            try { localStorage.setItem(STORE_KEY, root.dataset.theme); } catch (_) {}
            reflect();
        });
    });
    reflect();
})();
