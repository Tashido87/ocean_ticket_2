function normalize(value) {
    return String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
}
function queryTokens(query) {
    return normalize(query).split(/\s+/).filter(token => token.length >= 2);
}
function hasAllTokensInField(field, tokens) {
    const text = normalize(field);
    return tokens.length > 0 && tokens.every(token => text.includes(token));
}
function hasAnyTokenInField(field, tokens) {
    const text = normalize(field);
    return tokens.some(token => text.includes(token));
}
function rankRecord(record, type, query) {
    const q = normalize(query);
    const tokens = queryTokens(q);
    const isMulti = tokens.length > 1;
    const name = normalize(record.name);
    
    if (name.startsWith(q) && q.length >= 3) return { score: 820, quality: 'best', reasons: ['Name starts with query'] };
    if (q.length >= 3 && name.includes(q)) return { score: 740, quality: 'best', reasons: ['Name contains phrase'] };
    
    if (isMulti) {
        if (hasAllTokensInField(name, tokens)) return { score: 620, quality: 'best', reasons: ['All words in name'] };
    }
    
    if (isMulti) return { score: 0, quality: 'none', reasons: [] };
    
    let partial = 0;
    if (hasAnyTokenInField(name, tokens)) partial += 70;
    if (!partial) return { score: 0, quality: 'none', reasons: [] };
    return { score: partial, quality: 'related', reasons: ['Partial match'] };
}

const names = [
    "SUTT NAW AUNG",
    "AUNG PYA SONE",
    "AUNG MYO",
    "MYO MIN MYINT"
];

function testQ(q) {
    console.log(`\n--- Query: ${q} ---`);
    const results = names.map(n => {
        const r = rankRecord({name: n}, 'client', q);
        return { name: n, score: r.score };
    }).filter(r => r.score > 0).sort((a,b) => b.score - a.score);
    console.dir(results);
}

testQ("AUNG");
testQ("MYO MYINT");
testQ("SUTT NAW AUNG");
