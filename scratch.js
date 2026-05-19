function normalize(value) {
    return String(value || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function digitsOnly(value) {
    return String(value || '').replace(/\D/g, '');
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
    if (!q) return { score: 40, quality: 'best', reasons: ['No query'] };

    const tokens = queryTokens(q);
    const isMulti = tokens.length > 1;
    const fields = type === 'client'
        ? {
            name: record.name,
            phone: record.phone,
            account: record.account_name,
            accountType: record.account_type,
            pnr: '',
            route: '',
            airline: ''
        }
        : {
            name: record.name,
            phone: record.phone,
            account: record.account_name,
            accountType: record.account_type,
            pnr: record.booking_reference,
            route: `${record.departure || ''} ${record.destination || ''}`,
            airline: record.airline
        };

    const name = normalize(fields.name);
    const account = normalize(fields.account);
    const phone = digitsOnly(fields.phone);
    const pnr = normalize(fields.pnr);
    const qDigits = digitsOnly(q);
    const haystack = Object.values(fields).map(normalize).join(' ');
    const allAcrossFields = tokens.length > 0 && tokens.every(token => haystack.includes(token));

    /* ---------- BEST ---------- */
    if (pnr && pnr === q) return { score: 1000, quality: 'best', reasons: ['Exact PNR'] };
    if (phone && qDigits && phone === qDigits) return { score: 950, quality: 'best', reasons: ['Exact phone'] };
    if (name && name === q) return { score: 900, quality: 'best', reasons: ['Exact name'] };
    if (account && account === q) return { score: 860, quality: 'best', reasons: ['Exact account'] };

    if (name.startsWith(q) && q.length >= 3) return { score: 820, quality: 'best', reasons: ['Name starts with query'] };
    if (account.startsWith(q) && q.length >= 3) return { score: 780, quality: 'best', reasons: ['Account starts with query'] };
    if (q.length >= 3 && name.includes(q)) return { score: 740, quality: 'best', reasons: ['Name contains phrase'] };
    if (q.length >= 3 && account.includes(q)) return { score: 720, quality: 'best', reasons: ['Account contains phrase'] };
    if (pnr && pnr.includes(q) && q.length >= 4) return { score: 700, quality: 'best', reasons: ['PNR contains query'] };

    if (isMulti) {
        if (hasAllTokensInField(name, tokens)) return { score: 620, quality: 'best', reasons: ['All words in name'] };
        if (hasAllTokensInField(account, tokens)) return { score: 580, quality: 'best', reasons: ['All words in account'] };
    }

    /* ---------- RELATED ---------- */
    if (isMulti && allAcrossFields) {
        return { score: 220, quality: 'related', reasons: ['All words across fields'] };
    }

    // Multi-word: must not promote single-token partial matches
    if (isMulti) return { score: 0, quality: 'none', reasons: [] };

    // Single token: weak partials -> 'related'
    let partial = 0;
    if (hasAnyTokenInField(name, tokens)) partial += 70;
    if (hasAnyTokenInField(account, tokens)) partial += 45;
    if (hasAnyTokenInField(fields.accountType, tokens)) partial += 18;
    if (hasAnyTokenInField(fields.route, tokens)) partial += 25;
    if (hasAnyTokenInField(fields.airline, tokens)) partial += 25;
    if (qDigits && phone.includes(qDigits)) partial += 60;

    if (!partial) return { score: 0, quality: 'none', reasons: [] };
    return { score: partial, quality: 'related', reasons: ['Partial match'] };
}

const rec1 = { name: "MYO MIN MYINT" };
console.log(rankRecord(rec1, 'client', 'Myo Myint'));

const rec2 = { name: "MYO MYINT TUN" };
console.log(rankRecord(rec2, 'client', 'Myo Myint'));

