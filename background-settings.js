/* Runs before paint; storage is optional (private browsing must still work). */
(() => {
    const key = 'ocean-background';
    const normalize = value => value === 'duo-night' ? 'duo-night' : 'plain';
    let selected = 'plain';
    try { selected = normalize(localStorage.getItem(key)); } catch { /* Keep plain default. */ }
    document.documentElement.dataset.background = selected;
    function apply(value, save = true) {
        selected = normalize(value);
        document.documentElement.dataset.background = selected;
        document.querySelectorAll('input[name="app-background"]').forEach(input => { input.checked = input.value === selected; });
        let persisted = true;
        if (save) try { localStorage.setItem(key, selected); } catch { persisted = false; }
        const status = document.getElementById('background-choice-status');
        if (status) status.textContent = `${selected === 'duo-night' ? 'Night Dunes background selected.' : 'Original background selected.'} ${persisted ? 'Saved on this browser.' : 'Storage unavailable; applied for this session.'}`;
        window.dispatchEvent(new Event('ocean-background-change'));
    }
    document.addEventListener('DOMContentLoaded', () => {
        const backdrop = document.createElement('div');
        backdrop.id = 'app-wallpaper-backdrop';
        backdrop.setAttribute('aria-hidden', 'true');
        document.body.prepend(backdrop);
        apply(selected, false);
        document.querySelectorAll('input[name="app-background"]').forEach(input => input.addEventListener('change', () => apply(input.value)));
        document.getElementById('reset-settings-btn')?.addEventListener('click', () => apply('plain'));
    });
    window.addEventListener('storage', event => { if (event.key === key || event.key === null) apply(event.newValue, false); });
})();
