// Optional, decorative enhancement. Business controls never enter the GPU layer.
const selector = '#main-header, #home-view .dashboard-period-controls, .pnr-detail-dialog .trip-ticket-header, #sellForm > #section-payment';
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const transparency = matchMedia('(prefers-reduced-transparency: reduce)');
const contrast = matchMedia('(forced-colors: active)');
const desktop = matchMedia('(min-width: 900px)');
const hosts = new Map();
let renderer;
let rendererFailed = false;
let refreshQueued = false;

function eligible() {
    return isSecureContext && !!navigator.gpu && desktop.matches && !reduced.matches && !transparency.matches && !contrast.matches && !document.hidden;
}

function unmount(record) {
    record.generation = (record.generation || 0) + 1;
    record.cancelled = true;
    clearTimeout(record.timeout);
    record.scene?.dispose();
    record.scene = null;
    record.layer?.remove();
    record.layer = null;
    record.host.classList.remove('ocean-glass-ready');
    record.pending = false;
}

async function mount(record) {
    if (record.pending || record.layer || record.failed || rendererFailed || !eligible() || !record.visible) return;
    record.pending = true;
    record.cancelled = false;
    const generation = record.generation || 0;
    try {
        renderer ||= navigator.gpu.requestAdapter({ powerPreference: 'low-power' }).then(adapter => {
            if (!adapter) throw new Error('WebGPU adapter unavailable');
            return import('./vendor/liquid-glass.js?v=1');
        }).catch(error => { rendererFailed = true; throw error; });
        const { createGlassScene } = await renderer;
        if (generation !== (record.generation || 0) || record.cancelled || !eligible() || !record.visible || !record.host.isConnected) return;
        const layer = document.createElement('div');
        layer.className = 'ocean-glass-layer lg-scene';
        layer.setAttribute('aria-hidden', 'true');
        layer.inert = true;
        const content = document.createElement('div');
        content.className = 'ocean-glass-backdrop lg-content';
        // Explicit decorative backdrop avoids capturing customer data or moving controls.
        content.innerHTML = '<span class="ocean-glass-orb"></span><span class="ocean-glass-orb secondary"></span>';
        const surface = document.createElement('div');
        surface.className = 'ocean-glass-surface lg-surface';
        layer.append(content, surface);
        record.layer = layer;
        record.host.prepend(layer);
        const fail = () => { record.failed = true; unmount(record); };
        record.scene = createGlassScene(layer, {
            maxSurfaces: 1,
            onDiagnostic: diagnostic => {
                if (diagnostic.error) queueMicrotask(fail);
                else if (diagnostic.maps > 0) {
                    clearTimeout(record.timeout);
                    record.host.classList.add('ocean-glass-ready');
                }
            }
        });
        record.scene.setContent(content);
        record.scene.addSurface(surface, {
            material: 'regular', radius: 16, refraction: 10,
            appearance: document.body.classList.contains('dark-theme') ? 'dark' : 'light',
            interactive: false, fluid: false, motion: 'none'
        });
        record.timeout = setTimeout(() => {
            if (!record.host.classList.contains('ocean-glass-ready')) fail();
        }, 8000);
    } catch {
        record.failed = true;
        unmount(record);
    } finally { if (generation === (record.generation || 0)) record.pending = false; }
}

const visibility = new IntersectionObserver(entries => {
    for (const entry of entries) {
        const record = hosts.get(entry.target);
        if (!record) continue;
        record.visible = entry.isIntersecting;
        if (record.visible) void mount(record);
        else unmount(record);
    }
});

function refresh() {
    refreshQueued = false;
    for (const [host, record] of hosts) {
        if (!host.isConnected) {
            unmount(record);
            visibility.unobserve(host);
            hosts.delete(host);
        }
    }
    document.querySelectorAll(selector).forEach(host => {
        if (hosts.has(host)) return;
        const record = { host, visible: false, failed: false, pending: false };
        hosts.set(host, record);
        host.classList.add('ocean-glass-host');
        visibility.observe(host);
    });
}
const mutations = new MutationObserver(() => {
    if (!refreshQueued) { refreshQueued = true; requestAnimationFrame(refresh); }
});
mutations.observe(document.body, { childList: true, subtree: true });
function reset() {
    for (const record of hosts.values()) { unmount(record); void mount(record); }
}
for (const query of [reduced, transparency, contrast, desktop]) query.addEventListener('change', reset);
document.addEventListener('visibilitychange', reset);
let dark = document.body.classList.contains('dark-theme');
new MutationObserver(() => {
    const next = document.body.classList.contains('dark-theme');
    if (next !== dark) { dark = next; reset(); }
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
window.addEventListener('pagehide', () => { for (const record of hosts.values()) unmount(record); });
window.addEventListener('pageshow', reset);
refresh();
