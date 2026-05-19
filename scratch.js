import { isPlaceholderDate } from './utils.js'; // wait I can't import easily

function getDisplayDate(str) {
    const s = String(str || '').trim();
    if (!s) return '';
    const clean = s.replace(/[^\d]/g, '');
    if (clean === '01011970' || clean === '01011900' || clean === '00000000') return '';
    return s;
}

console.log(getDisplayDate('01/01/1970'));
console.log(getDisplayDate(''));
console.log(getDisplayDate('12/03/1990'));
