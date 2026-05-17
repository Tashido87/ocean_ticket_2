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
    maxInstances: 10,
    serviceAccount: PARAM_SERVICE_ACCOUNT
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
        // Browser clients must be able to reach the Cloud Run endpoint. The
        // function body below still enforces Firebase Auth before calling DocAI.
        invoker: 'public',
        // Cap body size — Document AI sync API limit is ~20 MB.
        // Tune this lower if you only expect compressed phone photos.
        // Note: callable functions accept up to 10 MB by default.
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
