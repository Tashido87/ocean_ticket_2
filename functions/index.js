/**
 * @fileoverview Firebase Cloud Function — passport OCR via Google Cloud Document AI.
 *
 * The browser sends a base64 image; this function relays it to Document AI
 * using the runtime service-account credentials, then returns the recognised
 * text + structured entities.
 *
 * IMPORTANT — auth model:
 *   Production:  Uses Application Default Credentials (the Cloud Functions
 *                runtime service account). NO JSON key is shipped in the
 *                deployment. You must grant that service account the
 *                "Document AI API User" role in your GCP project.
 *   Local emul.: Set GOOGLE_APPLICATION_CREDENTIALS to the path of your
 *                downloaded JSON key (see functions/README.md).
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { setGlobalOptions } = require('firebase-functions/v2');
const { defineString } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;

admin.initializeApp();

// Configurable parameters — set via firebase deploy or .env file.
// You can also hard-code these values below if you prefer.
const PARAM_PROJECT_ID = defineString('GCP_PROJECT_ID', {
    default: 'ocean-ticket-bf235',
    description: 'Google Cloud project ID where the Document AI processor lives.'
});
const PARAM_LOCATION = defineString('DOCAI_LOCATION', {
    default: 'us',
    description: 'Document AI processor location, e.g. "us" or "eu".'
});
const PARAM_PROCESSOR_ID = defineString('DOCAI_PROCESSOR_ID', {
    default: '',
    description: 'Document AI processor ID. REQUIRED — set before deploy.'
});
const PARAM_SERVICE_ACCOUNT = defineString('DOCAI_SERVICE_ACCOUNT', {
    default: 'ocean-travel@ocean-ticket-bf235.iam.gserviceaccount.com',
    description: 'Runtime service account that has the Document AI API User role.'
});

setGlobalOptions({
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
    maxInstances: 10
});

// Re-use the client across invocations (faster cold start of subsequent calls).
const docaiClients = new Map();
function getClient(location) {
    if (!docaiClients.has(location)) {
        // Document AI requires a regional endpoint, e.g. us-documentai.googleapis.com
        const apiEndpoint = `${location}-documentai.googleapis.com`;
        docaiClients.set(location, new DocumentProcessorServiceClient({ apiEndpoint }));
    }
    return docaiClients.get(location);
}

/**
 * HTTPS callable: ocrPassport
 *   Request:  { imageBase64: string, mimeType?: string }
 *   Response: { text: string, entities: Array<{type, value, confidence}>,
 *               processorType: string, pageCount: number }
 *
 * Client uses Firebase Auth automatically; reject anonymous calls.
 */
exports.ocrPassport = onCall(
    {
        cors: true,
        invoker: 'public',
        serviceAccount: PARAM_SERVICE_ACCOUNT
    },
    async (request) => {
        if (!request.auth) {
            throw new HttpsError(
                'unauthenticated',
                'You must be signed in to scan passports.'
            );
        }

        const projectId = PARAM_PROJECT_ID.value();
        const location = PARAM_LOCATION.value();
        const processorId = PARAM_PROCESSOR_ID.value();

        if (!processorId) {
            throw new HttpsError(
                'failed-precondition',
                'DOCAI_PROCESSOR_ID is not configured. See functions/README.md.'
            );
        }

        const { imageBase64, mimeType = 'image/jpeg' } = request.data || {};
        if (!imageBase64 || typeof imageBase64 !== 'string') {
            throw new HttpsError('invalid-argument', 'imageBase64 is required.');
        }

        // Strip data-URL prefix if present.
        const base64Content = imageBase64.replace(/^data:[^;]+;base64,/, '');

        const client = getClient(location);
        const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;

        try {
            const [result] = await client.processDocument({
                name,
                rawDocument: {
                    content: base64Content,
                    mimeType
                }
            });

            const doc = result.document || {};
            const text = doc.text || '';

            // Identity-document processors return entities; OCR processor does not.
            const entities = (doc.entities || []).map(e => {
                const normalized = e.normalizedValue || {};
                const dateValue = normalized.dateValue
                    ? [
                        normalized.dateValue.year,
                        String(normalized.dateValue.month || '').padStart(2, '0'),
                        String(normalized.dateValue.day || '').padStart(2, '0')
                    ].filter(Boolean).join('-')
                    : '';

                return {
                    type: e.type,
                    value: e.mentionText || normalized.text || dateValue || '',
                    confidence: e.confidence || 0
                };
            });

            return {
                text,
                entities,
                processorType: entities.length > 0 ? 'ID_DOCUMENT' : 'OCR',
                pageCount: (doc.pages || []).length
            };
        } catch (err) {
            console.error('Document AI error:', err);
            const code = err.code === 7 || err.code === 'PERMISSION_DENIED'
                ? 'permission-denied'
                : 'internal';
            throw new HttpsError(code, err.message || 'Document AI request failed.');
        }
    }
);

/**
 * Scheduled Function: checkBookingDeadlines
 * Runs every 10 minutes to notify via Telegram when an active booking
 * deadline is near (under 1 hour). (Trigger redeploy to verify IAM permissions)
 */
exports.checkBookingDeadlines = onSchedule(
    {
        schedule: '*/10 * * * *',
        timeZone: 'Asia/Yangon',
        memory: '256MiB',
    },
    async (event) => {
        const db = admin.firestore();
        const now = new Date();

        try {
            const snapshot = await db.collection('bookings')
                .where('status', '==', 'active')
                .get();

            const bookings = snapshot.docs.map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() }));

            // Group bookings by PNR if PNR is present and valid,
            // otherwise keep them separate (to prevent grouping different client bookings without PNRs).
            const groups = [];
            const processedIds = new Set();

            for (const b of bookings) {
                if (processedIds.has(b.id)) continue;

                const pnrVal = String(b.pnr || '').trim().toUpperCase();

                if (pnrVal && pnrVal !== 'NO PNR' && pnrVal !== '—' && pnrVal !== '-') {
                    // Find all bookings sharing this PNR
                    const legs = bookings.filter(other => 
                        !processedIds.has(other.id) &&
                        String(other.pnr || '').trim().toUpperCase() === pnrVal
                    );

                    legs.forEach(leg => processedIds.add(leg.id));

                    // Collect unique passenger names (strip gender prefix)
                    const passengerNames = [];
                    legs.forEach(leg => {
                        const cleanName = String(leg.name || '').trim().replace(/^(MR|MS|MSTR|MISS)\s+/i, '');
                        if (cleanName && !passengerNames.includes(cleanName)) {
                            passengerNames.push(cleanName);
                        }
                    });

                    // Collect unique routes/legs to avoid duplicate route listings in the notification
                    const uniqueLegs = [];
                    legs.forEach(leg => {
                        const dep = String(leg.departure || '').trim();
                        const dest = String(leg.destination || '').trim();
                        const date = String(leg.departing_on || '').trim();
                        if (!uniqueLegs.some(l => l.departure === dep && l.destination === dest && l.departing_on === date)) {
                            uniqueLegs.push(leg);
                        }
                    });

                    groups.push({
                        pnr: pnrVal,
                        clientName: passengerNames.join(', '),
                        legs: uniqueLegs,
                        rawLegs: legs, // Keep references to all original Firestore documents
                        deadlineAt: b.deadlineAt,
                        enddate: b.enddate,
                        endtime: b.endtime,
                        notified1hWarning: legs.some(leg => leg.notified1hWarning)
                    });
                } else {
                    processedIds.add(b.id);
                    const cleanName = String(b.name || '').replace(/^(MR|MS|MSTR|MISS)\s+/i, '');
                    groups.push({
                        pnr: '',
                        clientName: cleanName,
                        legs: [b],
                        rawLegs: [b],
                        deadlineAt: b.deadlineAt,
                        enddate: b.enddate,
                        endtime: b.endtime,
                        notified1hWarning: b.notified1hWarning
                    });
                }
            }

            for (const group of groups) {
                if (!group.deadlineAt) continue;

                const deadline = new Date(group.deadlineAt);
                if (Number.isNaN(deadline.getTime())) continue;

                const timeLeftMs = deadline.getTime() - now.getTime();
                const timeLeftMins = Math.round(timeLeftMs / 60000);

                // Format Route & Date Info
                let routeInfo = '';
                if (group.legs.length > 1) {
                    // Sort legs by departing_on date to order them (outbound -> return)
                    const sortedLegs = [...group.legs].sort((x, y) => {
                        const parseDate = (dStr) => {
                            if (!dStr) return 0;
                            const parts = String(dStr).split('/');
                            if (parts.length === 3) {
                                return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
                            }
                            return 0;
                        };
                        return parseDate(x.departing_on) - parseDate(y.departing_on);
                    });

                    sortedLegs.forEach((leg, index) => {
                        const label = index === 0 ? 'OB' : (index === 1 ? 'RT' : `Leg ${index + 1}`);
                        routeInfo += `✈️ *Route (${label}):* ${leg.departure || 'N/A'} ➔ ${leg.destination || 'N/A'}\n` +
                                     `📅 *Departure Date (${label}):* ${leg.departing_on || 'N/A'}\n`;
                    });
                } else {
                    const leg = group.legs[0];
                    routeInfo += `✈️ *Route:* ${leg.departure || 'N/A'} ➔ ${leg.destination || 'N/A'}\n` +
                                 `📅 *Departure Date:* ${leg.departing_on || 'N/A'}\n`;
                }

                // Case 1: Deadline has passed (expired)
                if (timeLeftMins <= 0) {
                    const clientLabel = group.clientName.includes(',') ? 'Clients' : 'Client';
                    const message = `❌ *HOLD DEADLINE EXPIRED*\n\n` +
                                    `👤 *${clientLabel}:* ${group.clientName}\n` +
                                    routeInfo +
                                    `🎫 *PNR:* ${group.pnr || 'N/A'}\n` +
                                    `⏰ *Deadline:* ${group.enddate || ''} ${group.endtime || ''}\n\n` +
                                    `🚫 This booking has passed its hold deadline and is now marked as *EXPIRED*.`;

                    await sendTelegramAlert(message);

                    // Update status in Firestore for all legs in the group
                    for (const leg of group.rawLegs) {
                        await db.collection('bookings').doc(leg.id).update({
                            status: 'expired',
                            remark: 'end',
                            expiredAt: now.toISOString()
                        });
                    }
                }
                // Case 2: Deadline is near (under 1 hour left)
                else if (timeLeftMins > 0 && timeLeftMins <= 60 && !group.notified1hWarning) {
                    const clientLabel = group.clientName.includes(',') ? 'Clients' : 'Client';
                    const message = `⚠️ *HOLD DEADLINE WARNING* (Less than 1 hour!)\n\n` +
                                    `👤 *${clientLabel}:* ${group.clientName}\n` +
                                    routeInfo +
                                    `🎫 *PNR:* ${group.pnr || 'N/A'}\n` +
                                    `⏰ *Deadline:* ${group.enddate || ''} ${group.endtime || ''}\n` +
                                    `⏳ *Time Left:* ${timeLeftMins} mins`;

                    await sendTelegramAlert(message);

                    // Mark all legs in the group so we don't send duplicate notifications
                    for (const leg of group.rawLegs) {
                        await db.collection('bookings').doc(leg.id).update({ notified1hWarning: true });
                    }
                }
            }
        } catch (error) {
            console.error('Error in checkBookingDeadlines scheduler:', error);
        }
    }
);

async function sendTelegramAlert(text) {
    const BOT_TOKEN = '8156964921:AAHDYIjKgVbqsShuRGyIJlgL80NNqqSWi0Y';
    const CHAT_ID = '1101682157';
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: CHAT_ID,
                text: text,
                parse_mode: 'Markdown'
            })
        });
        if (!response.ok) {
            const errText = await response.text();
            console.error(`Telegram API responded with status ${response.status}: ${errText}`);
        }
    } catch (error) {
        console.error('Failed to send Telegram notification:', error);
    }
}

