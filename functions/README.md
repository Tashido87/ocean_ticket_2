# Ocean Ticket — Cloud Functions (Passport OCR)

This folder contains a Firebase Cloud Function that performs server-side
passport OCR using **Google Cloud Document AI**.

The browser sends the passport image to this function, which holds the
Google service-account credentials and forwards the request to Document AI.

> ⚠️ **Never put your service-account JSON in client-side code.** It contains
> a private key. The whole point of this function is to keep that key on
> the server.

---

## 1. Prerequisites

| Tool | Version | Install |
| --- | --- | --- |
| Node.js | 20.x | https://nodejs.org |
| Firebase CLI | latest | `npm install -g firebase-tools` |
| Google Cloud SDK | latest (optional, for IAM) | https://cloud.google.com/sdk/install |

You also need **Firebase Blaze (pay-as-you-go) plan** enabled because Cloud
Functions need outbound internet access to call Document AI.

---

## 2. Enable APIs in Google Cloud

In [Google Cloud Console](https://console.cloud.google.com/) for project
`ocean-ticket-bf235`, enable:

- **Cloud Document AI API**
- **Cloud Functions API**
- **Cloud Build API**
- **Artifact Registry API**

---

## 3. Create your Document AI processor (one-time)

1. Open https://console.cloud.google.com/ai/document-ai/processors
2. Click **Create Processor**
3. Pick one of:
   - **Document OCR** — generic OCR. Returns text only. Cheapest, most flexible. ✅ Recommended.
   - **Identity Document Proofing / Passport Parser** — returns structured passport fields directly. Higher accuracy on passports but limited to supported countries and slightly pricier.
4. Pick a **region** (e.g. `us` or `eu`).
5. Note the **Processor ID** shown after creation (long string of letters/digits).

You will need:

| Value | Example |
| --- | --- |
| Project ID | `ocean-ticket-bf235` |
| Location | `us` |
| Processor ID | `a1b2c3d4e5f6g7h8` |

---

## 4. Grant the runtime service account permission

This project pins the Cloud Function runtime service account to:

```text
ocean-travel@ocean-ticket-bf235.iam.gserviceaccount.com
```

That service account needs permission to call Document AI.

In Cloud Console → IAM:

1. Find the principal `ocean-travel@ocean-ticket-bf235.iam.gserviceaccount.com`.
2. Click the pencil → **Add another role** → `Document AI API User`.
3. Save.

> No JSON key is required in production — the function uses the runtime
> credentials automatically.

If deploy fails with a service-account/`actAs` error, grant the deploying
Google user `Service Account User` on the same service account.

---

## 5. Configure the function parameters

Set the processor ID **before** deploy. Two options:

### Option A — `.env` file (simplest)

Create `functions/.env`:

```bash
GCP_PROJECT_ID=ocean-ticket-bf235
DOCAI_LOCATION=us
DOCAI_PROCESSOR_ID=YOUR_PROCESSOR_ID_HERE
DOCAI_SERVICE_ACCOUNT=ocean-travel@ocean-ticket-bf235.iam.gserviceaccount.com
```

This file is gitignored so it never leaves your machine.

### Option B — hard-code in `index.js`

Edit the `defineString(...)` defaults near the top of `functions/index.js`.

---

## 6. Local emulator (optional)

To run the function locally without deploying:

```bash
cd functions
npm install
# Tell Google Cloud client lib where to find your downloaded JSON key:
export GOOGLE_APPLICATION_CREDENTIALS="$(pwd)/keys/ocean-ticket-bf235-3029c424b8e8.json"
mkdir -p keys
mv ~/Downloads/ocean-ticket-bf235-3029c424b8e8.json keys/
npm run serve
```

The emulator is at `http://127.0.0.1:5001`.

> The `keys/` folder is gitignored.

---

## 7. Deploy

```bash
cd functions
npm install
firebase deploy --only functions
```

You only need to do this once (and again whenever you change `index.js`).

---

## 8. Verify

1. Open the deployed app.
2. Upload a passport photo.
3. Check logs: `firebase functions:log`
4. You should see `Document AI` requests succeed.

---

## Cost estimate

- Document AI **Document OCR**: ~$1.50 per 1000 pages.
- Cloud Functions: free tier covers light use; ~$0.40 per 1M invocations afterwards.

For 100 passport scans per day → ≈ **$5 / month**.

---

## Troubleshooting

**`PERMISSION_DENIED`** — runtime service account is missing the
`Document AI API User` role, or the deployed function is not running as the
service account configured in `DOCAI_SERVICE_ACCOUNT`. Re-check step 4 and
redeploy the function.

**`NOT_FOUND`** — wrong processor ID or wrong location. Use the exact ID
from the Document AI console.

**`failed-precondition: DOCAI_PROCESSOR_ID is not configured`** —
you forgot step 5.

**Anonymous request rejected** — the user must be signed in (Firebase Auth)
before calling the function. The login flow already handles this.
