function normalize(value) {
    return String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
}
function queryTokens(query) {
    return normalize(query).split(/\s+/).filter(token => token.length >= 2);
}
function getResultId(result) {
    if (typeof result === 'string') return result;
    if (result.kind === 'client') return 'client:' + (result.data.client_key || result.data.name);
    if (result.kind === 'ticket') return 'ticket:' + (result.data.id || result.data.booking_reference);
    return JSON.stringify(result);
}

const state = {
    allClients: [
        { client_key: '1', name: 'Myo Min Myint', account_name: 'test' }
    ]
};

const q = 'myo myint';
const tokens = queryTokens(normalize(q));
const topIds = new Set();

const allNameMatches = state.allClients
    .filter(c => {
        const n = normalize(c.name);
        return tokens.every(t => n.includes(t)) && !topIds.has(c.client_key);
    })
    .map(c => {
        // mock buildClientResult
        return {
            kind: 'client',
            id: c.client_key,
            data: c,
            score: 620,
            quality: 'best',
            label: c.name
        };
    })
    .sort((a, b) => b.score - a.score);

console.log("allNameMatches:", allNameMatches.length);

let clients = [];
if (tokens.length === 1) {
    clients = allNameMatches.slice(0, 6);
} else {
    const directMatches = allNameMatches.slice(0, 6);
    const directIds = new Set(directMatches.map(getResultId));
    // rankedClients is empty here
    clients = [...directMatches].slice(0, 6);
}

console.log("clients before filter:", clients.length);

const accountNamesShown = new Set();
const filteredClients = clients.filter(c => !accountNamesShown.has(normalize(c.data.account_name || '')));

console.log("filteredClients:", filteredClients.length);
