const q = "aung";
const names = ["SUTT NAW AUNG", "AUNG PYA SONE", "AUNG MYO"];

function normalize(value) { return String(value || '').toUpperCase().replace(/\s+/g, ' ').trim(); }
function queryTokens(query) { return normalize(query).split(/\s+/).filter(token => token.length >= 2); }
const tokens = queryTokens(q);

const allNameMatches = names
    .filter(n => tokens.every(t => n.includes(t)))
    .map(n => {
        let score = 0;
        if (n.startsWith(normalize(q))) score = 820;
        else if (n.includes(normalize(q))) score = 740;
        return { name: n, score };
    })
    .sort((a, b) => b.score - a.score);

console.dir(allNameMatches);
