/**
 * @fileoverview One-time migration script: Google Sheets -> Firebase Firestore.
 *
 * Prerequisites:
 * 1. cd scripts && npm install
 * 2. Go to Firebase Console -> Project Settings -> Service Accounts -> Generate new private key
 * 3. Save the downloaded JSON as `service-account-key.json` in this scripts/ folder.
 * 4. Run: npm run migrate
 */

import { google } from 'googleapis';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- CONFIGURATION ---
const SHEET_ID = '1SGc80isz0VRVt447R_q-fBdZ_me52H_Z32W5HauHMWQ';
const API_KEY = 'AIzaSyC9JSD6VWXMQ7Pe8VPf-gIlNUtcwQhkG1o';

const SHEETS = [
    { name: '2025', collection: 'tickets', range: '2025!A:V', parser: parseTicketRow },
    { name: 'booking', collection: 'bookings', range: 'booking!A:M', parser: parseBookingRow },
    { name: 'history', collection: 'history', range: 'history!A:D', parser: parseHistoryRow },
    { name: 'settle', collection: 'settlements', range: 'settle!A:G', parser: parseSettlementRow }
];

// --- INITIALIZE FIREBASE ADMIN ---
const serviceAccount = JSON.parse(readFileSync(join(__dirname, 'service-account-key.json'), 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// --- GOOGLE SHEETS CLIENT ---
const sheets = google.sheets({ version: 'v4', auth: API_KEY });

async function fetchSheetData(range) {
    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: range,
    });
    return res.data.values || [];
}

// --- PARSERS (match existing app logic) ---

function normalizeHeaders(headers) {
    return headers.map(h => String(h).toLowerCase().replace(/\s+/g, '_'));
}

function parseTicketRow(headers, row, index) {
    const obj = {};
    headers.forEach((h, i) => {
        let key = h.replace('nrc', 'id');
        let val = row[i] || '';
        if (typeof val === 'string') val = val.trim();
        obj[key] = val;
    });

    // Normalize numeric fields
    ['base_fare', 'net_amount', 'commission', 'extra_fare', 'date_change'].forEach(k => {
        obj[k] = parseFloat(String(obj[k]).replace(/,/g, '')) || 0;
    });

    // Normalize boolean
    obj.paid = String(obj.paid).toUpperCase() === 'TRUE';

    // Store original row index for reference
    obj.legacyRowIndex = index + 2;

    // Add timestamps for Firestore ordering
    obj.createdAt = Timestamp.now();
    obj.updatedAt = Timestamp.now();

    return obj;
}

function parseBookingRow(headers, row, index) {
    const obj = {};
    headers.forEach((h, i) => {
        let key = h.replace('nrc_no', 'id_no');
        let val = row[i] || '';
        if (typeof val === 'string') val = val.trim();
        obj[key] = val;
    });
    obj.legacyRowIndex = index + 2;
    obj.createdAt = Timestamp.now();
    obj.updatedAt = Timestamp.now();
    return obj;
}

function parseHistoryRow(headers, row, index) {
    return {
        date: row[0] || '',
        name: row[1] || '',
        pnr: row[2] || '',
        details: row[3] || '',
        legacyRowIndex: index + 2,
        createdAt: Timestamp.now(),
    };
}

function parseSettlementRow(headers, row, index) {
    const obj = {};
    headers.forEach((h, i) => {
        let val = row[i] || '';
        if (typeof val === 'string') val = val.trim();
        obj[h] = val;
    });
    obj.amount_paid = parseFloat(String(obj.amount_paid).replace(/,/g, '')) || 0;
    obj.legacyRowIndex = index + 2;
    obj.createdAt = Timestamp.now();
    return obj;
}

// --- MIGRATE A SINGLE SHEET ---
async function migrateSheet({ name, collection, range, parser }) {
    console.log(`\n📄 Migrating sheet: "${name}" -> collection: "${collection}"`);
    const values = await fetchSheetData(range);

    if (values.length < 2) {
        console.log(`   ⚠️  Sheet "${name}" is empty or has no data rows.`);
        return { collection, count: 0 };
    }

    const headers = normalizeHeaders(values[0]);
    const rows = values.slice(1);
    const colRef = db.collection(collection);

    // Use batch writes for efficiency (500 per batch max)
    let batch = db.batch();
    let batchCount = 0;
    let totalCount = 0;
    const batchSize = 400;

    for (let i = 0; i < rows.length; i++) {
        const data = parser(headers, rows[i], i);
        const docRef = colRef.doc(); // auto-generated ID
        batch.set(docRef, data);
        batchCount++;
        totalCount++;

        if (batchCount >= batchSize) {
            await batch.commit();
            console.log(`   ✅ Committed ${batchCount} docs...`);
            batch = db.batch();
            batchCount = 0;
        }
    }

    if (batchCount > 0) {
        await batch.commit();
        console.log(`   ✅ Committed final ${batchCount} docs.`);
    }

    console.log(`   🎉 Migrated ${totalCount} documents to "${collection}".`);
    return { collection, count: totalCount };
}

// --- MAIN ---
async function main() {
    console.log('🚀 Starting migration from Google Sheets to Firebase Firestore...');
    console.log(`   Project ID: ${serviceAccount.project_id || 'unknown'}`);

    const results = [];
    for (const sheet of SHEETS) {
        try {
            const result = await migrateSheet(sheet);
            results.push(result);
        } catch (err) {
            console.error(`   ❌ Failed to migrate "${sheet.name}":`, err.message);
            results.push({ collection: sheet.collection, count: 0, error: err.message });
        }
    }

    console.log('\n📊 Migration Summary:');
    console.log('-----------------------');
    results.forEach(r => {
        const status = r.error ? `❌ ERROR: ${r.error}` : `✅ ${r.count} docs`;
        console.log(`   ${r.collection.padEnd(14)} -> ${status}`);
    });
    console.log('\nDone!');
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
