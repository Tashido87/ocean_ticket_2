import { isPlaceholderDate } from './utils.js'; // to make it valid module if needed
const state = {
    allClients: [
        { client_key: '1', name: 'Myo Min Myint' }
    ]
};
function normalize(value) { return String(value || '').toUpperCase().replace(/\s+/g, ' ').trim(); }
function queryTokens(query) { return normalize(query).split(/\s+/).filter(token => token.length >= 2); }
function digitsOnly(value) { return String(value || '').replace(/\D/g, ''); }
function getResultId(result) {
    if (typeof result === 'string') return result;
    if (result.kind === 'client') return 'client:' + (result.data.client_key || result.data.name);
    return JSON.stringify(result);
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
    
    if (q.length >= 3 && name.includes(q)) return { score: 740, quality: 'best' };
    
    if (isMulti) {
        if (hasAllTokensInField(name, tokens)) return { score: 620, quality: 'best' };
    }
    return { score: 0, quality: 'none' };
}

function buildClientResult(client, query) {
    const rank = rankRecord(client, 'client', query);
    return { kind: 'client', id: client.client_key, data: client, score: rank.score, quality: rank.quality };
}

function testQuery(query) {
    const q = query.trim();
    const tokens = queryTokens(normalize(q));
    
    const all = [buildClientResult(state.allClients[0], q)];
    const bestOnly = all.filter(r => r.quality === 'best');
    const top = bestOnly[0] ? [bestOnly[0]] : [];
    const topIds = new Set(top.map(getResultId));
    
    const clientBest = bestOnly.filter(r => r.kind === 'client' && !topIds.has(getResultId(r)));
    let clients = [...clientBest];
    
    const allNameMatches = state.allClients
        .filter(c => {
            const n = normalize(c.name);
            return tokens.every(t => n.includes(t)) && !topIds.has(c.client_key);
        })
        .map(c => buildClientResult(c, q));
        
    let showMore = false;
    if (tokens.length === 1) {
        clients = allNameMatches.slice(0, 6);
    } else {
        const directMatches = allNameMatches.slice(0, 6);
        const directIds = new Set(directMatches.map(getResultId));
        const rankedClients = clientBest.filter(r => !directIds.has(getResultId(r)));
        clients = [...directMatches, ...rankedClients].slice(0, 6);
    }
    
    console.log(`Query "${query}": top=${top.length}, clients=${clients.length}`);
}

testQuery('Myo');
testQuery('Myo Myint');
testQuery('Myo Min Myint');

