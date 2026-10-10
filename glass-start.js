// Keep optional GPU work out of the authenticated dashboard's first paint.
(() => {
    let scheduled = false;
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => {
            const start = () => import('./liquid-glass-ui.js?v=3').catch(() => { /* CSS fallback remains usable. */ });
            if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 5000 });
            else setTimeout(start, 1000);
        }, 2000);
    }
    window.addEventListener('ocean:app-ready', schedule, { once: true });
})();
