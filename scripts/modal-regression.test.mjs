import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const ui = readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
const modalSource = ui.slice(ui.indexOf('let lastFocusedElementBeforeModal'), ui.indexOf('export function showConfirmModal')).replaceAll('export function ', 'function ');
function setup() {
    const frames = new Map(); let nextFrame = 0;
    function element() {
        const attrs = new Map(), classes = new Set();
        return {
            tagName: 'DIV', id: '', innerHTML: '',
            classList: { add: (...xs) => xs.forEach(x => classes.add(x)), remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) },
            setAttribute: (k, v) => attrs.set(k, v), getAttribute: k => attrs.get(k) ?? null,
            hasAttribute: k => attrs.has(k), removeAttribute: k => attrs.delete(k),
            contains: () => false, querySelector: () => null, querySelectorAll: () => [],
            focus() { this.focused = true; }
        };
    }
    const modal = element(), body = element(), app = element(), preInert = element(), trigger = element(), content = element();
    preInert.setAttribute('inert', ''); preInert.setAttribute('aria-hidden', 'true');
    app.setAttribute('aria-hidden', 'false'); modal.classList.add('modal');
    modal.querySelector = s => s === '.modal-content' ? content : null;
    body.children = [app, preInert, modal];
    const context = vm.createContext({
        document: { body, activeElement: trigger, getElementById: id => id === 'modal' ? modal : content, addEventListener() {}, removeEventListener() {} },
        window: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) },
        requestAnimationFrame: cb => { frames.set(++nextFrame, cb); return nextFrame; },
        cancelAnimationFrame: id => frames.delete(id)
    });
    vm.runInContext(modalSource, context);
    return { context, app, preInert, trigger, frames, modal };
}
test('replacing a dialog retains background ownership and restores original aria state', () => {
    const { context, app, preInert, trigger, frames } = setup();
    context.openModal('PNR detail');
    context.openModal('Payment');
    context.openModal('Partial payment');
    assert.equal(app.hasAttribute('inert'), true);
    assert.equal(frames.size, 1);
    context.closeModal();
    assert.equal(app.hasAttribute('inert'), false);
    assert.equal(app.getAttribute('aria-hidden'), 'false');
    assert.equal(preInert.hasAttribute('inert'), true);
    assert.equal(trigger.focused, true);
    assert.equal(frames.size, 0);
    context.closeModal();
    context.openModal('Next payment');
    context.closeModal();
    assert.equal(app.hasAttribute('inert'), false);
});
test('dashboard ignores hidden updates and coalesces visible updates per frame', () => {
    const main = readFileSync(new URL('../dashboard.js', import.meta.url), 'utf8');
    const source = main.slice(main.indexOf('let dashboardRenderFrame'), main.indexOf('function renderDashboardData()')).replace('export function', 'function');
    let active = false, renders = 0; const frames = [];
    const context = vm.createContext({ document: { getElementById: () => ({ classList: { contains: () => active } }) }, requestAnimationFrame: cb => frames.push(cb), renderDashboardData: () => renders++ });
    vm.runInContext(source, context);
    context.updateDashboardData(); assert.equal(frames.length, 0);
    active = true;
    for (let i = 0; i < 10; i++) context.updateDashboardData();
    assert.equal(frames.length, 1);
    frames.shift()(); assert.equal(renders, 1);
    context.updateDashboardData(); active = false;
    frames.shift()(); assert.equal(renders, 1);
});
