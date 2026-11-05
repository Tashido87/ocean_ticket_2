import { state } from './state.js';
import { addVisaApplication, updateVisaApplication, deleteVisaApplication } from './db.js';
import { showToast, escapeHtml, parseSheetDate, formatDateForSheet } from './utils.js';
import { openModal, closeModal, showConfirmModal } from './ui.js';
import { uploadPassportPhoto, deletePassportPhoto, openPhotoLightbox } from './passport.js';
import { ocrPassport } from './passport-ocr.js';
import { computePassportExpiryStatus, normalizeClientKey } from './clients.js';

function parseDate(str) {
    if (!str) return null;
    const d = parseSheetDate(str);
    return (d && !isNaN(d.getTime()) && d.getTime() > 0) ? d : null;
}

function formatDate(date) {
    if (!date) return '';
    return formatDateForSheet(date);
}

async function showConfirm(message) {
    if (typeof showConfirmModal === 'function') {
        return showConfirmModal('Confirm Action', message);
    }
    return window.confirm(message);
}

function renderPagination(container, totalItems, rowsPerPage, currentPage, onPageChange) {
    if (!container) return;
    container.innerHTML = '';
    const totalPages = Math.ceil(totalItems / rowsPerPage) || 1;
    if (totalPages <= 1) return;

    const createBtn = (label, page, disabled = false, active = false) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `pagination-btn${active ? ' active' : ''}`;
        btn.innerHTML = label;
        btn.disabled = disabled;
        if (!disabled) btn.addEventListener('click', () => onPageChange(page));
        return btn;
    };

    container.appendChild(createBtn('&laquo;', currentPage - 1, currentPage <= 1));
    for (let i = 1; i <= totalPages; i++) {
        container.appendChild(createBtn(String(i), i, false, i === currentPage));
    }
    container.appendChild(createBtn('&raquo;', currentPage + 1, currentPage >= totalPages));
}

export const VISA_COUNTRIES = {
    Taiwan: {
        visaTypes: ['Tourist (single)', 'Tourist (multiple)'],
        currency: 'USD',
        defaultFees: {
            'Tourist (single)': 50,
            'Tourist (multiple)': 100
        },
        notes: [
            'Processing: 3 working days standard, 2 working days urgent (extra fee).',
            'Validity: single-entry is valid 3 months with up to 14–30 days stay per stamp.',
            'TAC (Travel Authorization Certificate — free online): Myanmar citizens qualify ONLY if holding a valid or ≤ 10-year-expired visa/resident card from US, Canada, UK, Schengen, Australia, New Zealand, Japan, or Korea (or a prior Taiwan visa without violation).'
        ],
        checklist: [
            { key: 'passport_copy', label: 'Passport bio-page copy', hint: 'Valid ≥ 6 months + ≥ 2 blank pages' },
            { key: 'photo', label: '2× color photos (35×45 mm)', hint: 'White background, taken within 6 months' },
            { key: 'nrc_front', label: 'NRC front copy', hint: 'Original shown at submission' },
            { key: 'nrc_back', label: 'NRC back copy', hint: 'Original shown at submission' },
            { key: 'household_booklet', label: 'Household registration list', hint: 'အိမ်ထောင်စုစာရင်း copy + original' },
            { key: 'bank_statement', label: 'Bank statement (3–6 months)', hint: 'Or updated passbook, ≥ US$2,000 equivalent' },
            { key: 'flight_booking', label: 'Round-trip flight booking', hint: 'Reservation / PNR printout' },
            { key: 'itinerary', label: 'Travel itinerary + hotel booking', hint: 'Day-by-day plan + confirmed hotel' },
            { key: 'parental_consent', label: 'Parental consent letter', hint: 'Required if applicant is under 18', under18Only: true },
            { key: 'parent_id_copy', label: "Parents' NRC / passport copy", hint: 'Required if applicant is under 18', under18Only: true }
        ]
    },
    Thailand: {
        visaTypes: ['Tourist TR (single)', 'Tourist TR (multiple)'],
        currency: 'THB',
        defaultFees: {
            'Tourist TR (single)': 1000,
            'Tourist TR (multiple)': 5000
        },
        notes: [
            'Bilateral 14-day visa exemption: Myanmar ordinary passport holders arriving by international airport for tourism ≤ 14 days do NOT need a visa (TDAC digital arrival card required within 72 h of arrival).',
            'Stays > 14 days or any land-border entry require a Tourist Visa (TR) via Thai e-Visa (thaievisa.go.th) or the Royal Thai Embassy in Yangon.',
            'Processing: 3–10 working days via e-Visa. Single-entry validity 3 months (up to 60 days stay); Multiple-entry validity 6 months (60 days per entry).'
        ],
        checklist: [
            { key: 'passport_copy', label: 'Passport bio-page scan', hint: 'Valid ≥ 6 months + ≥ 2 blank pages' },
            { key: 'photo', label: 'Photo (4×6 cm, white background)', hint: 'Taken within 6 months, no glasses' },
            { key: 'flight_booking', label: 'Confirmed round-trip air ticket', hint: 'Showing entry and exit within stay' },
            { key: 'hotel_booking', label: 'Hotel booking / accommodation proof', hint: 'Or host invitation + Thai ID / house book' },
            { key: 'bank_statement', label: 'Bank statement (last 3–6 months)', hint: '≥ 20,000 THB (~US$600) single / 40,000 THB family' },
            { key: 'declaration', label: 'Signed declaration form', hint: 'Thai e-Visa declaration page' },
            { key: 'cover_letter', label: 'Employment / purpose letter', hint: 'Required for multiple-entry TR', multiEntryOnly: true }
        ]
    },
    China: {
        visaTypes: ['Tourist (L)', 'Business (M)', 'Family visit (Q2/S2)'],
        currency: 'USD',
        defaultFees: {},
        notes: [
            'COVA online form (cova.mfa.gov.cn) must be completed and printed before appointment at Chinese Embassy Yangon / Consulate Mandalay.',
            'Biometrics (10 fingerprints) required in person for ages 14–70 unless exempt.',
            'Processing: 4 working days regular, 3 working days express, 2 working days urgent. Typical L validity: 3 months single-entry, up to 30 days stay.'
        ],
        checklist: [
            { key: 'passport_copy', label: 'Passport bio-page copy + old China visas', hint: 'Valid ≥ 6 months + ≥ 2 blank pages' },
            { key: 'photo', label: 'COVA digital photo + 1× paper (48×33 mm)', hint: 'White background, bare ears/forehead, no glasses/jewelry' },
            { key: 'nrc_front', label: 'NRC front copy', hint: 'Original shown at submission' },
            { key: 'nrc_back', label: 'NRC back copy', hint: 'Original shown at submission' },
            { key: 'household_booklet', label: 'Household registration list', hint: 'အိမ်ထောင်စုစာရင်း copy + original' },
            { key: 'bank_statement', label: 'Bank statement (last 3–6 months)', hint: 'Official bank stamp, ~US$2,000+ balance' },
            { key: 'flight_booking', label: 'Round-trip flight reservation', hint: 'Matching travel dates on COVA' },
            { key: 'itinerary', label: 'Day-by-day travel itinerary in China', hint: 'Required if no inviting person in China' },
            { key: 'hotel_booking', label: 'Hotel bookings for entire stay', hint: 'Or Chinese host invitation + ID front/back' },
            { key: 'invitation_letter', label: 'Invitation letter + inviter ID', hint: 'Required for Q2/S2 family visit or M business', businessFamilyOnly: true }
        ]
    },
    Other: {
        visaTypes: [],
        currency: 'USD',
        defaultFees: {},
        notes: [
            'Custom destination country — add or customize required embassy checklist documents below.'
        ],
        checklist: [
            { key: 'passport_copy', label: 'Passport bio-page copy', hint: 'Valid ≥ 6 months' },
            { key: 'photo', label: 'Visa photo', hint: 'Per destination embassy specs' }
        ]
    }
};

export const VISA_STATUS_META = {
    draft:      { label: 'Draft',      tone: 'neutral' },
    collecting: { label: 'Collecting', tone: 'amber'   },
    submitted:  { label: 'Submitted',  tone: 'sky'     },
    processing: { label: 'Processing', tone: 'sky'     },
    approved:   { label: 'Approved',   tone: 'mint'    },
    refused:    { label: 'Refused',    tone: 'coral'   },
    withdrawn:  { label: 'Withdrawn',  tone: 'neutral' },
    collected:  { label: 'Collected',  tone: 'teal'    }
};

let currentEditingVisaId = null;
let currentChecklistItems = [];
let _ocrFilledValues = {};
let _paymentStatusManuallySet = false;
let _lastSelectedCountry = 'Taiwan';

export function formatVisaRef(id) {
    if (!id) return 'VSA-NEW';
    return 'VSA-' + String(id).slice(0, 6).toUpperCase();
}

export function computeVisaProfit(v) {
    if (!v) return 0;
    return (Number(v.service_fee_mmk) || 0)
        - (Number(v.other_costs_mmk) || 0)
        - (Number(v.service_fee_refund_mmk) || 0);
}

export function computeChecklistSummary(documents) {
    const list = Array.isArray(documents) ? documents : [];
    const total = list.length;
    const received = list.filter(d => d && (d.status === 'received' || d.status === 'verified')).length;
    const verified = list.filter(d => d && d.status === 'verified').length;
    const missing = list.filter(d => !d || d.status === 'missing');
    const pct = total > 0 ? Math.round((received / total) * 100) : 0;
    return { total, received, verified, missing, pct, complete: total > 0 && received === total };
}

function isApplicantUnder18(dobStr, travelFromStr) {
    const dob = parseDate(dobStr);
    if (!dob) return false;
    const refDate = parseDate(travelFromStr) || new Date();
    let age = refDate.getFullYear() - dob.getFullYear();
    const m = refDate.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && refDate.getDate() < dob.getDate())) {
        age--;
    }
    return age >= 0 && age < 18;
}

function getEffectiveChecklistSpec(countryKey) {
    const cfg = VISA_COUNTRIES[countryKey] || VISA_COUNTRIES.Other;
    const dobStr = document.getElementById('visa_dob')?.value || '';
    const travelFromStr = document.getElementById('visa_travel_from')?.value || '';
    const under18 = isApplicantUnder18(dobStr, travelFromStr);
    const entries = document.querySelector('input[name="visa_entries"]:checked')?.value || 'single';
    const visaType = getSelectedVisaTypeValue();
    const purpose = document.getElementById('visa_purpose')?.value || 'Tourism';

    return (cfg.checklist || []).filter(item => {
        if (item.under18Only && !under18) return false;
        if (item.multiEntryOnly && entries !== 'multiple' && !/multiple/i.test(visaType)) return false;
        if (item.businessFamilyOnly) {
            const isBizOrFam = /Business|Family|Q2|S2|\(M\)/i.test(visaType) || purpose === 'Business' || purpose === 'Visit family';
            if (!isBizOrFam) return false;
        }
        return true;
    });
}

function getSelectedCountryValue() {
    const sel = document.getElementById('visa_country')?.value || 'Taiwan';
    if (sel === 'Other') {
        const custom = document.getElementById('visa_country_other')?.value.trim();
        return custom || 'Other';
    }
    return sel;
}

function getSelectedCountryKey() {
    const sel = document.getElementById('visa_country')?.value || 'Taiwan';
    return VISA_COUNTRIES[sel] ? sel : 'Other';
}

function getSelectedVisaTypeValue() {
    const key = getSelectedCountryKey();
    if (key === 'Other') {
        return document.getElementById('visa_type_other')?.value.trim() || '';
    }
    return document.getElementById('visa_type')?.value || '';
}

export function initVisaSystem() {
    const newBtn = document.getElementById('newVisaBtn');
    const cancelBtn = document.getElementById('cancelVisaBtn');
    const form = document.getElementById('newVisaForm');
    const searchBtn = document.getElementById('visaSearchBtn');
    const clearBtn = document.getElementById('visaClearBtn');
    const searchInput = document.getElementById('visaSearchText');
    const statusFilter = document.getElementById('visaStatusFilter');
    const countryFilter = document.getElementById('visaCountryFilter');

    if (newBtn && !newBtn.dataset.wired) {
        newBtn.dataset.wired = '1';
        newBtn.addEventListener('click', () => showNewVisaForm());
    }
    if (cancelBtn && !cancelBtn.dataset.wired) {
        cancelBtn.dataset.wired = '1';
        cancelBtn.addEventListener('click', hideVisaForm);
    }
    if (form && !form.dataset.wired) {
        form.dataset.wired = '1';
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            saveVisaApplication();
        });
    }

    if (searchBtn && !searchBtn.dataset.wired) {
        searchBtn.dataset.wired = '1';
        searchBtn.addEventListener('click', () => { state.visaPage = 1; renderVisaApplications(); });
    }
    if (clearBtn && !clearBtn.dataset.wired) {
        clearBtn.dataset.wired = '1';
        clearBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (statusFilter) statusFilter.value = 'all';
            if (countryFilter) countryFilter.value = 'all';
            state.visaPage = 1;
            renderVisaApplications();
        });
    }
    if (searchInput && !searchInput.dataset.wired) {
        searchInput.dataset.wired = '1';
        searchInput.addEventListener('input', () => { state.visaPage = 1; renderVisaApplications(); });
    }
    if (statusFilter && !statusFilter.dataset.wired) {
        statusFilter.dataset.wired = '1';
        statusFilter.addEventListener('change', () => { state.visaPage = 1; renderVisaApplications(); });
    }
    if (countryFilter && !countryFilter.dataset.wired) {
        countryFilter.dataset.wired = '1';
        countryFilter.addEventListener('change', () => { state.visaPage = 1; renderVisaApplications(); });
    }

    wirePassportOcrDropzone();
    wireAuxDocumentUploads();
    wireApplicantAutosuggest();
    wireCountryAndTripControls();
    wireChecklistAddRow();
    wireFeeAndPaymentControls();
    initVisaDatepickers();
}

function initVisaDatepickers() {
    if (typeof window.Datepicker === 'undefined') return;
    const dateIds = [
        'visa_dob',
        'visa_passport_issue_date',
        'visa_passport_expiry',
        'visa_travel_from',
        'visa_travel_to',
        'visa_previous_visit_from',
        'visa_previous_visit_to',
        'visa_application_date',
        'visa_submission_date',
        'visa_expected_collection_date',
        'visa_decision_date',
        'visa_collection_date',
        'visa_valid_from',
        'visa_valid_until',
        'visa_payment_date'
    ];
    dateIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.datepickerInit) {
            try {
                new window.Datepicker(el, { format: 'dd/mm/yyyy', autohide: true, todayHighlight: true });
                el.dataset.datepickerInit = 'true';
                el.addEventListener('changeDate', () => {
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });
            } catch (err) {
                console.warn('Datepicker init failed for', id, err);
            }
        }
    });
}

function wirePassportOcrDropzone() {
    const dropzone = document.getElementById('visa_passport_dropzone');
    const fileInput = document.getElementById('visa_passport_file');
    const viewBtn = document.getElementById('visa_passport_view_btn');
    const removeBtn = document.getElementById('visa_passport_remove_btn');

    if (!dropzone || dropzone.dataset.wired) return;
    dropzone.dataset.wired = '1';

    dropzone.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        fileInput?.click();
    });
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('is-dragover');
    });
    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('is-dragover');
    });
    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('is-dragover');
        const file = e.dataTransfer?.files?.[0];
        if (file) handlePassportFileSelected(file);
    });
    fileInput?.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) handlePassportFileSelected(file);
        fileInput.value = '';
    });

    viewBtn?.addEventListener('click', () => {
        const url = document.getElementById('visa_passport_photo_url')?.value;
        const name = document.getElementById('visa_applicant_name')?.value || 'Passport photo';
        if (url) openPhotoLightbox(url, name);
    });

    removeBtn?.addEventListener('click', async () => {
        const prevPath = document.getElementById('visa_passport_photo_path')?.value;
        if (prevPath) deletePassportPhoto(prevPath).catch(() => {});
        setPassportPreview('', '');
        clearOcrFilledFieldsIfUnchanged();
        const statusEl = document.getElementById('visa_ocr_status');
        if (statusEl) {
            statusEl.textContent = '';
            statusEl.removeAttribute('data-tone');
        }
        syncDocFromAux('passport_copy', '', '');
    });
}

function setPassportPreview(url, path, labelText) {
    const urlInput = document.getElementById('visa_passport_photo_url');
    const pathInput = document.getElementById('visa_passport_photo_path');
    const preview = document.getElementById('visa_passport_preview');
    const img = document.getElementById('visa_passport_preview_img');
    const nameEl = document.getElementById('visa_passport_preview_name');
    const dz = document.getElementById('visa_passport_dropzone');

    if (urlInput) urlInput.value = url || '';
    if (pathInput) pathInput.value = path || '';
    if (img) img.src = url || '';
    if (nameEl) nameEl.textContent = labelText || 'Passport bio-page photo';
    if (preview) preview.classList.toggle('is-visible', Boolean(url));
    if (dz) dz.classList.toggle('has-photo', Boolean(url));
}

function setOcrField(fieldId, value) {
    if (!value) return;
    const el = document.getElementById(fieldId);
    if (!el) return;
    const current = (el.value || '').trim();
    const prevAuto = _ocrFilledValues[fieldId];
    if (!current || current === prevAuto) {
        el.value = value;
        _ocrFilledValues[fieldId] = value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

function clearOcrFilledFieldsIfUnchanged() {
    Object.entries(_ocrFilledValues).forEach(([fieldId, autoVal]) => {
        if (fieldId === '__gender') return;
        const el = document.getElementById(fieldId);
        if (el && el.value === autoVal) {
            el.value = fieldId === 'visa_nationality' ? 'MMR' : '';
        }
    });
    _ocrFilledValues = {};
    updatePassportExpiryWarning();
}

async function handlePassportFileSelected(file) {
    const dz = document.getElementById('visa_passport_dropzone');
    const progressBar = document.getElementById('visa_passport_progress');
    const statusEl = document.getElementById('visa_ocr_status');
    const prevPath = document.getElementById('visa_passport_photo_path')?.value;

    dz?.classList.add('is-uploading');
    if (progressBar) progressBar.style.width = '5%';
    if (statusEl) {
        statusEl.textContent = 'Scanning passport with Gemini OCR…';
        statusEl.dataset.tone = 'info';
    }

    const runOcrChain = async () => {
        try {
            const { scanPassportWithGemini } = await import('./ui.js');
            if (typeof scanPassportWithGemini === 'function') {
                const gemResult = await scanPassportWithGemini(file, {
                    onStatus: (s) => {
                        if (statusEl && s?.message) statusEl.textContent = s.message;
                    }
                });
                if (gemResult && (gemResult.passport_no || gemResult.name || gemResult.passport_expiry)) {
                    return gemResult;
                }
            }
        } catch (err) {
            console.warn('Gemini OCR fallback to Tesseract:', err);
        }
        return ocrPassport(file, {
            onStatus: (s) => {
                if (statusEl && s?.message) statusEl.textContent = s.message;
            }
        });
    };

    const [uploadOutcome, ocrOutcome] = await Promise.allSettled([
        uploadPassportPhoto(file, {
            onProgress: (pct) => {
                if (progressBar) progressBar.style.width = `${Math.max(5, Math.round(pct * 100))}%`;
            }
        }),
        runOcrChain()
    ]);

    dz?.classList.remove('is-uploading');
    if (progressBar) setTimeout(() => { progressBar.style.width = '0%'; }, 350);

    if (uploadOutcome.status === 'fulfilled' && uploadOutcome.value) {
        const { url, path } = uploadOutcome.value;
        if (prevPath && prevPath !== path) {
            deletePassportPhoto(prevPath).catch(() => {});
        }
        setPassportPreview(url, path, file.name || 'Passport photo');
        syncDocFromAux('passport_copy', url, path);
    } else {
        showToast(uploadOutcome.reason?.message || 'Failed to upload passport photo.', 'error');
    }

    if (ocrOutcome.status === 'fulfilled' && ocrOutcome.value) {
        const parsed = ocrOutcome.value;
        const filled = [];
        if (parsed.name) {
            setOcrField('visa_applicant_name', String(parsed.name).toUpperCase());
            filled.push('Name');
        }
        if (parsed.passport_no) {
            setOcrField('visa_passport_no', String(parsed.passport_no).toUpperCase());
            filled.push('Passport No.');
        }
        if (parsed.passport_expiry) {
            setOcrField('visa_passport_expiry', parsed.passport_expiry);
            filled.push('Expiry');
        }
        if (parsed.dob) {
            setOcrField('visa_dob', parsed.dob);
            filled.push('DOB');
        }
        if (parsed.nationality) {
            setOcrField('visa_nationality', String(parsed.nationality).toUpperCase());
            filled.push('Nationality');
        }
        if (parsed.title === 'MS' || parsed.sex === 'F' || parsed.gender === 'F') {
            const fRadio = document.getElementById('visa_gender_f');
            if (fRadio) fRadio.checked = true;
            _ocrFilledValues.__gender = 'F';
        } else if (parsed.title === 'MR' || parsed.sex === 'M' || parsed.gender === 'M') {
            const mRadio = document.getElementById('visa_gender_m');
            if (mRadio) mRadio.checked = true;
            _ocrFilledValues.__gender = 'M';
        }

        if (statusEl) {
            if (filled.length > 0) {
                statusEl.textContent = `Auto-filled ${filled.join(' · ')} — please verify against passport`;
                statusEl.dataset.tone = parsed.mrzValid ? 'ok' : 'warn';
            } else {
                statusEl.textContent = 'Photo uploaded — could not read MRZ automatically, please type fields below';
                statusEl.dataset.tone = 'warn';
            }
        }
        updatePassportExpiryWarning();
        refreshChecklistDynamicVisibility();
    }
}

function wireAuxDocumentUploads() {
    const auxTypes = [
        { key: 'nrc_front', label: 'NRC Front' },
        { key: 'nrc_back', label: 'NRC Back' },
        { key: 'household_booklet', label: 'Household Booklet' }
    ];

    auxTypes.forEach(({ key, label }) => {
        const fileInput = document.getElementById(`visa_${key}_file`);
        const viewBtn = document.querySelector(`[data-aux-view="${key}"]`);
        const removeBtn = document.querySelector(`[data-aux-remove="${key}"]`);

        if (fileInput && !fileInput.dataset.wired) {
            fileInput.dataset.wired = '1';
            fileInput.addEventListener('change', async () => {
                const file = fileInput.files?.[0];
                fileInput.value = '';
                if (!file) return;
                const visaId = currentEditingVisaId || 'draft';
                try {
                    showToast(`Uploading ${label}…`, 'info');
                    const prevPath = document.getElementById(`visa_${key}_path`)?.value;
                    const { url, path } = await uploadPassportPhoto(file, {
                        storagePath: `visa-documents/{uid}/${visaId}/${key}-{stamp}.jpg`
                    });
                    if (prevPath && prevPath !== path) {
                        deletePassportPhoto(prevPath).catch(() => {});
                    }
                    setAuxPreview(key, url, path);
                    syncDocFromAux(key, url, path);
                    showToast(`${label} uploaded.`, 'success');
                } catch (err) {
                    showToast(err?.message || `Failed to upload ${label}.`, 'error');
                }
            });
        }

        if (viewBtn && !viewBtn.dataset.wired) {
            viewBtn.dataset.wired = '1';
            viewBtn.addEventListener('click', () => {
                const url = document.getElementById(`visa_${key}_url`)?.value;
                if (url) openPhotoLightbox(url, label);
            });
        }

        if (removeBtn && !removeBtn.dataset.wired) {
            removeBtn.dataset.wired = '1';
            removeBtn.addEventListener('click', () => {
                const prevPath = document.getElementById(`visa_${key}_path`)?.value;
                if (prevPath) deletePassportPhoto(prevPath).catch(() => {});
                setAuxPreview(key, '', '');
                syncDocFromAux(key, '', '');
            });
        }
    });
}

function setAuxPreview(key, url, path) {
    const urlInput = document.getElementById(`visa_${key}_url`);
    const pathInput = document.getElementById(`visa_${key}_path`);
    const preview = document.getElementById(`visa_${key}_preview`);
    const img = document.getElementById(`visa_${key}_img`);
    if (urlInput) urlInput.value = url || '';
    if (pathInput) pathInput.value = path || '';
    if (img) img.src = url || '';
    if (preview) preview.hidden = !url;
}

function syncDocFromAux(docKey, url, path) {
    const item = currentChecklistItems.find(d => d.key === docKey);
    if (!item) return;
    if (url) {
        item.file_url = url;
        item.file_path = path || '';
        if (item.status === 'missing') item.status = 'received';
        item.uploaded_at = formatDate(new Date());
    } else {
        item.file_url = '';
        item.file_path = '';
        item.status = 'missing';
        item.uploaded_at = '';
    }
    renderChecklistRows();
}

function wireApplicantAutosuggest() {
    const nameInput = document.getElementById('visa_applicant_name');
    const box = document.getElementById('visa_applicant_autosuggest');
    if (!nameInput || !box || nameInput.dataset.wired) return;
    nameInput.dataset.wired = '1';

    nameInput.addEventListener('input', () => {
        const q = (nameInput.value || '').trim().toUpperCase();
        if (q.length < 2) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }
        const matches = (state.allClients || []).filter(c => {
            const n = (c.name || '').toUpperCase();
            const p = (c.passport_no || '').toUpperCase();
            const ph = (c.phone || '');
            return n.includes(q) || p.includes(q) || ph.includes(q);
        }).slice(0, 6);

        if (matches.length === 0) {
            box.hidden = true;
            box.innerHTML = '';
            return;
        }

        box.innerHTML = matches.map((c, idx) => `
            <div class="autosuggest-item" data-client-idx="${idx}">
                <div class="autosuggest-main">
                    <strong>${escapeHtml(c.name || '')}</strong>
                    ${c.passport_no ? `<span class="autosuggest-badge">${escapeHtml(c.passport_no)}</span>` : ''}
                </div>
                <div class="autosuggest-sub">
                    ${escapeHtml(c.phone || 'No phone')} · ${escapeHtml(c.account_name || 'Direct')}
                </div>
            </div>
        `).join('');
        box.hidden = false;

        box.querySelectorAll('.autosuggest-item').forEach(el => {
            el.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const c = matches[Number(el.dataset.clientIdx)];
                if (c) applyClientPrefillToVisaForm(c);
                box.hidden = true;
            });
        });
    });

    nameInput.addEventListener('blur', () => {
        setTimeout(() => { box.hidden = true; }, 180);
    });
}

export function applyClientPrefillToVisaForm(client) {
    if (!client) return;
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el && val) el.value = val;
    };
    setVal('visa_client_key', client.key || '');
    setVal('visa_applicant_name', (client.name || '').toUpperCase());
    setVal('visa_phone', client.phone || '');
    setVal('visa_passport_no', (client.passport_no || '').toUpperCase());
    setVal('visa_passport_expiry', client.passport_expiry || '');
    setVal('visa_dob', client.dob || '');
    setVal('visa_nationality', (client.nationality || 'MMR').toUpperCase());
    setVal('visa_nrc_no', client.nrc_no || '');
    if (client.title === 'MS' || client.gender === 'F') {
        const f = document.getElementById('visa_gender_f');
        if (f) f.checked = true;
    } else if (client.title === 'MR' || client.gender === 'M') {
        const m = document.getElementById('visa_gender_m');
        if (m) m.checked = true;
    }
    if (client.passport_photo_url) {
        setPassportPreview(client.passport_photo_url, client.passport_photo_path || '', 'Existing client passport photo');
        syncDocFromAux('passport_copy', client.passport_photo_url, client.passport_photo_path || '');
    }
    updatePassportExpiryWarning();
    refreshChecklistDynamicVisibility();
}

function wireCountryAndTripControls() {
    const countrySelect = document.getElementById('visa_country');
    const visaTypeSelect = document.getElementById('visa_type');
    const entriesRadios = document.querySelectorAll('input[name="visa_entries"]');
    const purposeSelect = document.getElementById('visa_purpose');
    const dobInput = document.getElementById('visa_dob');
    const expiryInput = document.getElementById('visa_passport_expiry');
    const travelFromInput = document.getElementById('visa_travel_from');
    const travelToInput = document.getElementById('visa_travel_to');
    const entryRouteSelect = document.getElementById('visa_entry_route');
    const hostToggle = document.getElementById('visa_host_toggle');
    const prevVisitRadios = document.querySelectorAll('input[name="visa_previous_visit"]');
    const prevRefusalCheck = document.getElementById('visa_previous_refusal');

    if (countrySelect && !countrySelect.dataset.wired) {
        countrySelect.dataset.wired = '1';
        countrySelect.addEventListener('change', async () => {
            const newCountry = countrySelect.value;
            const ok = await handleCountrySwitch(newCountry, true);
            if (!ok) {
                countrySelect.value = _lastSelectedCountry;
                return;
            }
            _lastSelectedCountry = newCountry;
        });
    }

    if (visaTypeSelect && !visaTypeSelect.dataset.wired) {
        visaTypeSelect.dataset.wired = '1';
        visaTypeSelect.addEventListener('change', () => {
            const val = visaTypeSelect.value;
            if (/multiple/i.test(val)) {
                const m = document.getElementById('visa_entries_multiple');
                if (m) m.checked = true;
            } else if (/single/i.test(val)) {
                const s = document.getElementById('visa_entries_single');
                if (s) s.checked = true;
            }
            applyDefaultFeeForCountryAndType(getSelectedCountryKey(), val);
            refreshChecklistDynamicVisibility();
        });
    }

    entriesRadios.forEach(r => {
        if (r.dataset.wired) return;
        r.dataset.wired = '1';
        r.addEventListener('change', () => {
            const countryKey = getSelectedCountryKey();
            const entries = r.value;
            if (countryKey === 'Taiwan' || countryKey === 'Thailand') {
                const typeSel = document.getElementById('visa_type');
                if (typeSel) {
                    const matchOpt = Array.from(typeSel.options).find(o =>
                        entries === 'multiple' ? /multiple/i.test(o.value) : /single/i.test(o.value)
                    );
                    if (matchOpt) {
                        typeSel.value = matchOpt.value;
                        applyDefaultFeeForCountryAndType(countryKey, matchOpt.value);
                    }
                }
            }
            refreshChecklistDynamicVisibility();
        });
    });

    if (purposeSelect && !purposeSelect.dataset.wired) {
        purposeSelect.dataset.wired = '1';
        purposeSelect.addEventListener('change', () => refreshChecklistDynamicVisibility());
    }

    if (dobInput && !dobInput.dataset.wired) {
        dobInput.dataset.wired = '1';
        dobInput.addEventListener('change', () => refreshChecklistDynamicVisibility());
        dobInput.addEventListener('input', () => refreshChecklistDynamicVisibility());
    }

    if (expiryInput && !expiryInput.dataset.wired) {
        expiryInput.dataset.wired = '1';
        expiryInput.addEventListener('change', updatePassportExpiryWarning);
        expiryInput.addEventListener('input', updatePassportExpiryWarning);
    }

    if (travelFromInput && !travelFromInput.dataset.wired) {
        travelFromInput.dataset.wired = '1';
        travelFromInput.addEventListener('change', () => {
            updatePassportExpiryWarning();
            updateThailandExemptionNotice();
            refreshChecklistDynamicVisibility();
        });
        travelFromInput.addEventListener('input', () => {
            updatePassportExpiryWarning();
            updateThailandExemptionNotice();
        });
    }

    if (travelToInput && !travelToInput.dataset.wired) {
        travelToInput.dataset.wired = '1';
        travelToInput.addEventListener('change', updateThailandExemptionNotice);
        travelToInput.addEventListener('input', updateThailandExemptionNotice);
    }

    if (entryRouteSelect && !entryRouteSelect.dataset.wired) {
        entryRouteSelect.dataset.wired = '1';
        entryRouteSelect.addEventListener('change', updateThailandExemptionNotice);
    }

    if (hostToggle && !hostToggle.dataset.wired) {
        hostToggle.dataset.wired = '1';
        hostToggle.addEventListener('click', () => {
            const body = document.getElementById('visa_host_body');
            if (!body) return;
            const open = body.hidden;
            body.hidden = !open;
            hostToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    prevVisitRadios.forEach(r => {
        if (r.dataset.wired) return;
        r.dataset.wired = '1';
        r.addEventListener('change', () => {
            const fields = document.getElementById('visa_prev_visit_fields');
            if (fields) fields.hidden = r.value !== 'yes' || !r.checked;
        });
    });

    if (prevRefusalCheck && !prevRefusalCheck.dataset.wired) {
        prevRefusalCheck.dataset.wired = '1';
        prevRefusalCheck.addEventListener('change', () => {
            const grp = document.getElementById('visa_prev_refusal_note_group');
            if (grp) grp.hidden = !prevRefusalCheck.checked;
        });
    }
}

function checkPassportSixMonthValidity(expiryStr, travelFromStr) {
    const expDate = parseDate(expiryStr);
    if (!expDate) return { valid: true, status: computePassportExpiryStatus(expiryStr) };
    const baseDate = parseDate(travelFromStr) || new Date();
    const minRequired = new Date(baseDate.getFullYear(), baseDate.getMonth() + 6, baseDate.getDate());
    const status = computePassportExpiryStatus(expiryStr);
    if (expDate < minRequired) {
        const diffDays = Math.ceil((expDate.getTime() - baseDate.getTime()) / 86400000);
        return {
            valid: false,
            diffDays,
            status,
            message: diffDays < 0
                ? `Passport is EXPIRED before travel (${expiryStr}). Embassies require ≥ 6 months validity beyond travel date.`
                : `Passport expires in ${diffDays} days from travel (${expiryStr}) — less than the 6-month minimum required by China, Taiwan & Thailand.`
        };
    }
    return { valid: true, status };
}

function updatePassportExpiryWarning() {
    const warnEl = document.getElementById('visa_passport_expiry_warning');
    if (!warnEl) return;
    const expiryStr = document.getElementById('visa_passport_expiry')?.value || '';
    const travelFromStr = document.getElementById('visa_travel_from')?.value || '';
    if (!expiryStr.trim()) {
        warnEl.hidden = true;
        warnEl.innerHTML = '';
        return;
    }
    const check = checkPassportSixMonthValidity(expiryStr, travelFromStr);
    if (!check.valid) {
        warnEl.hidden = false;
        warnEl.className = 'visa-expiry-warning is-danger';
        warnEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${escapeHtml(check.message)}</span>`;
    } else if (check.status.state === 'expiring' || check.status.state === 'expired') {
        warnEl.hidden = false;
        warnEl.className = 'visa-expiry-warning is-amber';
        warnEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>Passport status: ${escapeHtml(check.status.label)}</span>`;
    } else {
        warnEl.hidden = true;
        warnEl.innerHTML = '';
    }
}

function updateThailandExemptionNotice() {
    const box = document.getElementById('visa_thailand_exemption_warning');
    if (!box) return;
    const countryKey = getSelectedCountryKey();
    if (countryKey !== 'Thailand') {
        box.hidden = true;
        return;
    }
    const route = document.getElementById('visa_entry_route')?.value || 'air';
    const dFrom = parseDate(document.getElementById('visa_travel_from')?.value || '');
    const dTo = parseDate(document.getElementById('visa_travel_to')?.value || '');
    if (route === 'air' && dFrom && dTo && dTo >= dFrom) {
        const stayDays = Math.round((dTo.getTime() - dFrom.getTime()) / 86400000) + 1;
        box.hidden = stayDays > 14;
    } else {
        box.hidden = true;
    }
}

async function handleCountrySwitch(countryKey, interactive = false) {
    const cfg = VISA_COUNTRIES[countryKey] || VISA_COUNTRIES.Other;
    const otherCountryGrp = document.getElementById('visa_country_other_group');
    const typeSelectGrp = document.getElementById('visa_type_select_group');
    const typeOtherGrp = document.getElementById('visa_type_other_group');
    const typeSelect = document.getElementById('visa_type');
    const entryRouteGrp = document.getElementById('visa_entry_route_group');
    const otherDocAddBar = document.getElementById('visa_other_doc_add_bar');

    const newSpec = getEffectiveChecklistSpec(countryKey);
    const newKeys = new Set(newSpec.map(s => s.key));

    if (interactive && currentChecklistItems.length > 0 && countryKey !== 'Other') {
        const droppedWithFiles = currentChecklistItems.filter(
            d => !newKeys.has(d.key) && (d.file_url || d.status === 'received' || d.status === 'verified')
        );
        if (droppedWithFiles.length > 0) {
            const names = droppedWithFiles.map(d => d.label).join(', ');
            const proceed = await showConfirm(
                `Switching to ${countryKey} will remove checklist item(s) that already have status/files (${names}). Continue?`
            );
            if (!proceed) return false;
        }
    }

    if (otherCountryGrp) otherCountryGrp.hidden = countryKey !== 'Other';
    if (typeSelectGrp) typeSelectGrp.hidden = countryKey === 'Other';
    if (typeOtherGrp) typeOtherGrp.hidden = countryKey !== 'Other';
    if (entryRouteGrp) entryRouteGrp.hidden = countryKey !== 'Thailand';
    if (otherDocAddBar) otherDocAddBar.hidden = countryKey !== 'Other';

    if (typeSelect && cfg.visaTypes.length > 0) {
        typeSelect.innerHTML = cfg.visaTypes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
        typeSelect.value = cfg.visaTypes[0];
    }

    const currencySelect = document.getElementById('visa_fee_currency');
    if (currencySelect && cfg.currency) {
        currencySelect.value = cfg.currency;
    }

    applyDefaultFeeForCountryAndType(countryKey, typeSelect?.value || '');
    renderCountryNotesBanner(countryKey);
    rebuildChecklistForCountry(countryKey);
    updateThailandExemptionNotice();
    return true;
}

function applyDefaultFeeForCountryAndType(countryKey, visaTypeVal) {
    const cfg = VISA_COUNTRIES[countryKey] || VISA_COUNTRIES.Other;
    const feeInput = document.getElementById('visa_fee_amount');
    if (!feeInput) return;

    if (countryKey === 'China') {
        feeInput.placeholder = 'Check embassy — varies by nationality/entries';
        if (!currentEditingVisaId) feeInput.value = '';
    } else if (cfg.defaultFees && cfg.defaultFees[visaTypeVal] !== undefined) {
        feeInput.placeholder = 'Embassy fee';
        if (!currentEditingVisaId || !feeInput.value) {
            feeInput.value = cfg.defaultFees[visaTypeVal];
        }
    } else {
        feeInput.placeholder = 'Embassy fee';
        if (!currentEditingVisaId && countryKey === 'Other') feeInput.value = '';
    }
    recalculateVisaFinancials();
}

function renderCountryNotesBanner(countryKey) {
    const banner = document.getElementById('visa_country_notes_banner');
    if (!banner) return;
    const cfg = VISA_COUNTRIES[countryKey] || VISA_COUNTRIES.Other;
    banner.innerHTML = `
        <div class="visa-notes-title"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(countryKey)} Embassy &amp; Filing Notes</div>
        <ul class="visa-notes-list">
            ${(cfg.notes || []).map(n => `<li>${escapeHtml(n)}</li>`).join('')}
        </ul>
    `;
}

function rebuildChecklistForCountry(countryKey) {
    const spec = getEffectiveChecklistSpec(countryKey);
    const existingByKey = new Map(currentChecklistItems.map(item => [item.key, item]));

    const nextItems = spec.map(s => {
        const prev = existingByKey.get(s.key);
        if (prev) {
            return {
                ...prev,
                label: s.label,
                hint: s.hint || prev.hint || ''
            };
        }
        const auxUrl = s.key === 'passport_copy'
            ? document.getElementById('visa_passport_photo_url')?.value
            : document.getElementById(`visa_${s.key}_url`)?.value;
        const auxPath = s.key === 'passport_copy'
            ? document.getElementById('visa_passport_photo_path')?.value
            : document.getElementById(`visa_${s.key}_path`)?.value;

        return {
            key: s.key,
            label: s.label,
            hint: s.hint || '',
            status: auxUrl ? 'received' : 'missing',
            file_url: auxUrl || '',
            file_path: auxPath || '',
            note: '',
            uploaded_at: auxUrl ? formatDate(new Date()) : ''
        };
    });

    if (countryKey === 'Other') {
        currentChecklistItems.forEach(item => {
            if (!nextItems.some(n => n.key === item.key)) {
                nextItems.push(item);
            }
        });
    }

    currentChecklistItems = nextItems;
    renderChecklistRows();
}

function refreshChecklistDynamicVisibility() {
    const countryKey = getSelectedCountryKey();
    rebuildChecklistForCountry(countryKey);
}

function wireChecklistAddRow() {
    const addBtn = document.getElementById('visa_add_doc_row_btn');
    const labelInput = document.getElementById('visa_new_doc_label');
    if (!addBtn || addBtn.dataset.wired) return;
    addBtn.dataset.wired = '1';

    addBtn.addEventListener('click', () => {
        const label = (labelInput?.value || '').trim();
        if (!label) {
            showToast('Enter a document name to add.', 'warning');
            return;
        }
        const key = 'custom_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now().toString(36).slice(-3);
        currentChecklistItems.push({
            key,
            label,
            hint: 'Custom checklist document',
            status: 'missing',
            file_url: '',
            file_path: '',
            note: '',
            uploaded_at: '',
            isCustom: true
        });
        if (labelInput) labelInput.value = '';
        renderChecklistRows();
    });
}

function renderChecklistRows() {
    const container = document.getElementById('visa_checklist_container');
    const progText = document.getElementById('visa_checklist_progress_text');
    const progPct = document.getElementById('visa_checklist_progress_pct');
    const progFill = document.getElementById('visa_checklist_bar_fill');
    if (!container) return;

    const summary = computeChecklistSummary(currentChecklistItems);
    if (progText) progText.textContent = `${summary.received} / ${summary.total} documents received (${summary.verified} verified)`;
    if (progPct) progPct.textContent = `${summary.pct}%`;
    if (progFill) progFill.style.width = `${summary.pct}%`;

    const countryKey = getSelectedCountryKey();

    container.innerHTML = currentChecklistItems.map((doc, idx) => {
        const status = doc.status || 'missing';
        const statusLabel = status === 'verified' ? 'Verified' : status === 'received' ? 'Received' : 'Missing';
        const pillClass = status === 'verified' ? 'is-verified' : status === 'received' ? 'is-received' : 'is-missing';
        const isReceivedOrVerified = status === 'received' || status === 'verified';

        return `
            <div class="visa-checklist-row ${pillClass}" data-doc-idx="${idx}" data-doc-key="${escapeHtml(doc.key)}">
                <div class="visa-checklist-info">
                    <div class="visa-checklist-title-line">
                        <span class="visa-checklist-label">${escapeHtml(doc.label)}</span>
                        <span class="visa-doc-status-pill ${pillClass}">${statusLabel}</span>
                    </div>
                    ${doc.hint ? `<div class="visa-checklist-hint">${escapeHtml(doc.hint)}</div>` : ''}
                </div>

                <div class="visa-checklist-controls">
                    <button type="button" class="btn-doc-sm ${isReceivedOrVerified ? 'is-active' : ''}" data-doc-action="toggle-received" data-idx="${idx}" title="Mark Received / Missing">
                        <i class="fa-solid ${isReceivedOrVerified ? 'fa-check-circle' : 'fa-circle'}"></i>
                        ${isReceivedOrVerified ? 'Received' : 'Mark Received'}
                    </button>

                    <label class="visa-verified-toggle ${!isReceivedOrVerified ? 'is-disabled' : ''}" title="Verify document">
                        <input type="checkbox" data-doc-action="toggle-verified" data-idx="${idx}" ${status === 'verified' ? 'checked' : ''} ${!isReceivedOrVerified ? 'disabled' : ''}>
                        <span>Verified</span>
                    </label>

                    <label class="btn-doc-sm" title="Upload scan / photo">
                        <i class="fa-solid fa-cloud-arrow-up"></i> ${doc.file_url ? 'Replace' : 'Upload'}
                        <input type="file" accept="image/*" data-doc-action="upload-file" data-idx="${idx}" hidden>
                    </label>

                    ${doc.file_url ? `
                        <button type="button" class="visa-doc-thumb-btn" data-doc-action="view-file" data-idx="${idx}" title="View uploaded scan">
                            <img src="${escapeHtml(doc.file_url)}" alt="${escapeHtml(doc.label)}">
                        </button>
                        <button type="button" class="btn-doc-sm btn-doc-danger" data-doc-action="remove-file" data-idx="${idx}" title="Remove file">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    ` : ''}

                    ${(countryKey === 'Other' && doc.isCustom) ? `
                        <button type="button" class="btn-doc-sm btn-doc-danger" data-doc-action="delete-row" data-idx="${idx}" title="Remove custom row">
                            <i class="fa-solid fa-xmark"></i>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }).join('');

    container.querySelectorAll('[data-doc-action="toggle-received"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = currentChecklistItems[Number(btn.dataset.idx)];
            if (!item) return;
            if (item.status === 'missing') {
                item.status = 'received';
                if (!item.uploaded_at) item.uploaded_at = formatDate(new Date());
            } else {
                item.status = 'missing';
            }
            renderChecklistRows();
        });
    });

    container.querySelectorAll('[data-doc-action="toggle-verified"]').forEach(chk => {
        chk.addEventListener('change', () => {
            const item = currentChecklistItems[Number(chk.dataset.idx)];
            if (!item) return;
            item.status = chk.checked ? 'verified' : 'received';
            renderChecklistRows();
        });
    });

    container.querySelectorAll('[data-doc-action="upload-file"]').forEach(input => {
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            input.value = '';
            const idx = Number(input.dataset.idx);
            const item = currentChecklistItems[idx];
            if (!file || !item) return;

            const visaId = currentEditingVisaId || 'draft';
            try {
                showToast(`Uploading ${item.label}…`, 'info');
                const prevPath = item.file_path;
                const { url, path } = await uploadPassportPhoto(file, {
                    storagePath: `visa-documents/{uid}/${visaId}/${item.key}-{stamp}.jpg`
                });
                if (prevPath && prevPath !== path) {
                    deletePassportPhoto(prevPath).catch(() => {});
                }
                item.file_url = url;
                item.file_path = path;
                if (item.status === 'missing') item.status = 'received';
                item.uploaded_at = formatDate(new Date());

                if (item.key === 'passport_copy') {
                    setPassportPreview(url, path, file.name);
                } else if (['nrc_front', 'nrc_back', 'household_booklet'].includes(item.key)) {
                    setAuxPreview(item.key, url, path);
                }
                renderChecklistRows();
                showToast(`${item.label} uploaded.`, 'success');
            } catch (err) {
                showToast(err?.message || 'Upload failed.', 'error');
            }
        });
    });

    container.querySelectorAll('[data-doc-action="view-file"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = currentChecklistItems[Number(btn.dataset.idx)];
            if (item?.file_url) openPhotoLightbox(item.file_url, item.label);
        });
    });

    container.querySelectorAll('[data-doc-action="remove-file"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = currentChecklistItems[Number(btn.dataset.idx)];
            if (!item) return;
            if (item.file_path) deletePassportPhoto(item.file_path).catch(() => {});
            item.file_url = '';
            item.file_path = '';
            item.status = 'missing';
            if (item.key === 'passport_copy') {
                setPassportPreview('', '');
            } else if (['nrc_front', 'nrc_back', 'household_booklet'].includes(item.key)) {
                setAuxPreview(item.key, '', '');
            }
            renderChecklistRows();
        });
    });

    container.querySelectorAll('[data-doc-action="delete-row"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const idx = Number(btn.dataset.idx);
            const item = currentChecklistItems[idx];
            if (item?.file_path) deletePassportPhoto(item.file_path).catch(() => {});
            currentChecklistItems.splice(idx, 1);
            renderChecklistRows();
        });
    });
}

function wireFeeAndPaymentControls() {
    const calcIds = [
        'visa_fee_amount',
        'visa_fee_rate_mmk',
        'visa_service_fee_mmk',
        'visa_other_costs_mmk',
        'visa_service_fee_refund_mmk',
        'visa_fee_refund_mmk',
        'visa_amount_paid_mmk'
    ];

    calcIds.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.dataset.wired) {
            el.dataset.wired = '1';
            el.addEventListener('input', recalculateVisaFinancials);
            el.addEventListener('change', recalculateVisaFinancials);
        }
    });

    const paymentStatusSelect = document.getElementById('visa_payment_status');
    if (paymentStatusSelect && !paymentStatusSelect.dataset.wired) {
        paymentStatusSelect.dataset.wired = '1';
        paymentStatusSelect.addEventListener('change', () => {
            _paymentStatusManuallySet = true;
            const status = paymentStatusSelect.value;
            const total = parseFloat(document.getElementById('visa_customer_total_mmk')?.value) || 0;
            const paidInput = document.getElementById('visa_amount_paid_mmk');
            const dateInput = document.getElementById('visa_payment_date');
            if (status === 'paid') {
                if (paidInput && (parseFloat(paidInput.value) || 0) === 0 && total > 0) {
                    paidInput.value = total;
                }
                if (dateInput && !dateInput.value) {
                    dateInput.value = formatDate(new Date());
                }
            } else if (status === 'unpaid' && paidInput) {
                paidInput.value = 0;
            }
        });
    }
}

export function recalculateVisaFinancials() {
    const feeAmount = parseFloat(document.getElementById('visa_fee_amount')?.value) || 0;
    const feeRate = parseFloat(document.getElementById('visa_fee_rate_mmk')?.value) || 0;
    const serviceFee = parseFloat(document.getElementById('visa_service_fee_mmk')?.value) || 0;
    const otherCosts = parseFloat(document.getElementById('visa_other_costs_mmk')?.value) || 0;
    const serviceRefund = parseFloat(document.getElementById('visa_service_fee_refund_mmk')?.value) || 0;

    const visaFeeMmk = Math.round(feeAmount * feeRate);
    const customerTotalMmk = visaFeeMmk + serviceFee + otherCosts;
    const profitMmk = serviceFee - otherCosts - serviceRefund;

    const feeMmkInput = document.getElementById('visa_fee_mmk');
    const custTotalInput = document.getElementById('visa_customer_total_mmk');
    if (feeMmkInput) feeMmkInput.value = visaFeeMmk;
    if (custTotalInput) custTotalInput.value = customerTotalMmk;

    const sumTotalEl = document.getElementById('visa_summary_customer_total');
    const sumProfitEl = document.getElementById('visa_summary_profit');
    const sumPassEl = document.getElementById('visa_summary_passthrough');

    if (sumTotalEl) sumTotalEl.textContent = `${customerTotalMmk.toLocaleString()} MMK`;
    if (sumProfitEl) {
        const sign = profitMmk >= 0 ? '+' : '';
        sumProfitEl.textContent = `${sign}${profitMmk.toLocaleString()} MMK`;
        sumProfitEl.classList.toggle('is-negative', profitMmk < 0);
    }
    if (sumPassEl) sumPassEl.textContent = `${visaFeeMmk.toLocaleString()} MMK`;

    if (!_paymentStatusManuallySet) {
        const paid = parseFloat(document.getElementById('visa_amount_paid_mmk')?.value) || 0;
        const statusSel = document.getElementById('visa_payment_status');
        if (statusSel) {
            if (paid <= 0) statusSel.value = 'unpaid';
            else if (customerTotalMmk > 0 && paid >= customerTotalMmk) statusSel.value = 'paid';
            else statusSel.value = 'partial';
        }
    }
}

export function showNewVisaForm(prefillClient = null) {
    currentEditingVisaId = null;
    _ocrFilledValues = {};
    _paymentStatusManuallySet = false;
    _lastSelectedCountry = 'Taiwan';

    const form = document.getElementById('newVisaForm');
    if (form) form.reset();

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };
    setVal('visa_id', '');
    setVal('visa_client_key', '');
    setVal('visa_nationality', 'MMR');
    setVal('visa_country', 'Taiwan');
    setVal('visa_status', 'collecting');
    setVal('visa_application_date', formatDate(new Date()));
    setVal('visa_other_costs_mmk', '0');
    setVal('visa_service_fee_refund_mmk', '0');
    setVal('visa_fee_refund_mmk', '0');
    setVal('visa_amount_paid_mmk', '0');
    setVal('visa_payment_status', 'unpaid');

    setPassportPreview('', '');
    setAuxPreview('nrc_front', '', '');
    setAuxPreview('nrc_back', '', '');
    setAuxPreview('household_booklet', '', '');

    const ocrStatus = document.getElementById('visa_ocr_status');
    if (ocrStatus) {
        ocrStatus.textContent = '';
        ocrStatus.removeAttribute('data-tone');
    }

    currentChecklistItems = [];
    handleCountrySwitch('Taiwan', false);

    if (prefillClient) {
        applyClientPrefillToVisaForm(prefillClient);
    }

    const titleEl = document.getElementById('visaFormTitle');
    if (titleEl) titleEl.innerHTML = '<i class="fa-solid fa-passport"></i> New Visa Application';

    const saveBtn = document.getElementById('saveVisaBtn');
    if (saveBtn) saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Save Visa Application';

    document.getElementById('visa-display-container').style.display = 'none';
    document.getElementById('visa-form-container').style.display = 'block';
    initVisaDatepickers();
    recalculateVisaFinancials();
}

export function hideVisaForm() {
    const formContainer = document.getElementById('visa-form-container');
    const displayContainer = document.getElementById('visa-display-container');
    if (formContainer) formContainer.style.display = 'none';
    if (displayContainer) displayContainer.style.display = 'block';
    currentEditingVisaId = null;
}

export async function saveVisaApplication() {
    const val = (id) => (document.getElementById(id)?.value || '').trim();
    const numVal = (id) => parseFloat(document.getElementById(id)?.value) || 0;

    const applicantName = val('visa_applicant_name').toUpperCase();
    const country = getSelectedCountryValue();
    const countryKey = getSelectedCountryKey();
    const visaType = getSelectedVisaTypeValue();
    const travelFrom = val('visa_travel_from');
    const phone = val('visa_phone');
    const email = val('visa_email');
    const status = val('visa_status') || 'draft';

    if (!applicantName) {
        showToast('Applicant Full Name (EN) is required.', 'warning');
        return;
    }
    if (!country) {
        showToast('Country is required.', 'warning');
        return;
    }
    if (!visaType) {
        showToast('Visa Type is required.', 'warning');
        return;
    }
    if (!travelFrom) {
        showToast('Travel From date is required.', 'warning');
        return;
    }
    if (!phone && !email) {
        showToast('Please provide either a contact Phone or Email.', 'warning');
        return;
    }

    const passportExpiry = val('visa_passport_expiry');
    if (passportExpiry) {
        const expCheck = checkPassportSixMonthValidity(passportExpiry, travelFrom);
        if (!expCheck.valid) {
            const proceed = await showConfirm(`${expCheck.message}\n\nDo you still want to save this visa application?`);
            if (!proceed) return;
        }
    }

    const blockedStatuses = ['submitted', 'processing', 'approved', 'collected'];
    if (blockedStatuses.includes(status)) {
        const summary = computeChecklistSummary(currentChecklistItems);
        if (!summary.complete) {
            const missingNames = summary.missing.map(d => d.label).join(', ');
            showToast(
                `Cannot mark as "${VISA_STATUS_META[status]?.label || status}" — missing required document(s): ${missingNames}`,
                'error'
            );
            return;
        }
    }

    const passportNo = val('visa_passport_no').toUpperCase();
    const nrcNo = val('visa_nrc_no');
    const clientKey = val('visa_client_key') || normalizeClientKey(applicantName, passportNo || nrcNo, phone);

    const feeAmount = numVal('visa_fee_amount');
    const feeRateMmk = numVal('visa_fee_rate_mmk');
    const visaFeeMmk = Math.round(feeAmount * feeRateMmk);
    const serviceFeeMmk = numVal('visa_service_fee_mmk');
    const otherCostsMmk = numVal('visa_other_costs_mmk');
    const serviceFeeRefundMmk = numVal('visa_service_fee_refund_mmk');
    const visaFeeRefundMmk = numVal('visa_fee_refund_mmk');
    const customerTotalMmk = visaFeeMmk + serviceFeeMmk + otherCostsMmk;
    const profitMmk = serviceFeeMmk - otherCostsMmk - serviceFeeRefundMmk;
    const amountPaidMmk = numVal('visa_amount_paid_mmk');

    const gender = document.querySelector('input[name="visa_gender"]:checked')?.value || 'M';
    const entries = document.querySelector('input[name="visa_entries"]:checked')?.value || 'single';
    const prevVisit = document.querySelector('input[name="visa_previous_visit"]:checked')?.value === 'yes';

    const companionsRaw = val('visa_companions');
    const companions = companionsRaw
        ? companionsRaw.split(/\n|,/).map(s => s.trim()).filter(Boolean)
        : [];

    const existing = currentEditingVisaId
        ? (state.allVisas || []).find(v => v.id === currentEditingVisaId)
        : null;

    const visaData = {
        client_key: clientKey,
        applicant_name: applicantName,
        applicant_name_mm: val('visa_applicant_name_mm'),
        phone,
        email,
        gender,
        dob: val('visa_dob'),
        nationality: val('visa_nationality').toUpperCase() || 'MMR',
        place_of_birth: val('visa_place_of_birth'),
        passport_no: passportNo,
        passport_issue_date: val('visa_passport_issue_date'),
        passport_expiry: passportExpiry,
        passport_photo_url: val('visa_passport_photo_url'),
        passport_photo_path: val('visa_passport_photo_path'),
        nrc_no: nrcNo,
        nrc_front_url: val('visa_nrc_front_url'),
        nrc_front_path: val('visa_nrc_front_path'),
        nrc_back_url: val('visa_nrc_back_url'),
        nrc_back_path: val('visa_nrc_back_path'),
        household_booklet_url: val('visa_household_booklet_url'),
        household_booklet_path: val('visa_household_booklet_path'),

        country,
        country_key: countryKey,
        visa_type: visaType,
        entries,
        purpose: val('visa_purpose') || 'Tourism',
        entry_route: countryKey === 'Thailand' ? (val('visa_entry_route') || 'air') : '',
        travel_from: travelFrom,
        travel_to: val('visa_travel_to'),
        destination_city: val('visa_destination_city'),
        accommodation: val('visa_accommodation'),
        host_name: val('visa_host_name'),
        host_relationship: val('visa_host_relationship'),
        host_phone: val('visa_host_phone'),
        host_address: val('visa_host_address'),
        occupation: val('visa_occupation'),
        employer: val('visa_employer'),
        work_address: val('visa_work_address'),
        monthly_income_mmk: numVal('visa_monthly_income_mmk'),
        address_mm: val('visa_address_mm'),
        emergency_contact_name: val('visa_emergency_contact_name'),
        emergency_contact_phone: val('visa_emergency_contact_phone'),
        emergency_contact_relation: val('visa_emergency_contact_relation'),
        companions,
        previous_visit: prevVisit,
        previous_visa_no: prevVisit ? val('visa_previous_visa_no') : '',
        previous_visit_from: prevVisit ? val('visa_previous_visit_from') : '',
        previous_visit_to: prevVisit ? val('visa_previous_visit_to') : '',
        previous_refusal: Boolean(document.getElementById('visa_previous_refusal')?.checked),
        previous_refusal_note: document.getElementById('visa_previous_refusal')?.checked ? val('visa_previous_refusal_note') : '',
        previous_overstay: Boolean(document.getElementById('visa_previous_overstay')?.checked),

        documents: currentChecklistItems.map(d => ({
            key: d.key,
            label: d.label,
            hint: d.hint || '',
            status: d.status || 'missing',
            file_url: d.file_url || '',
            file_path: d.file_path || '',
            note: d.note || '',
            uploaded_at: d.uploaded_at || '',
            ...(d.isCustom ? { isCustom: true } : {})
        })),
        status,
        application_date: val('visa_application_date') || formatDate(new Date()),
        submission_date: val('visa_submission_date'),
        expected_collection_date: val('visa_expected_collection_date'),
        decision_date: val('visa_decision_date'),
        collection_date: val('visa_collection_date'),
        visa_no: val('visa_no').toUpperCase(),
        visa_valid_from: val('visa_valid_from'),
        visa_valid_until: val('visa_valid_until'),
        stay_days: parseInt(val('visa_stay_days'), 10) || 0,

        source: 'self',
        visa_fee_amount: feeAmount,
        visa_fee_currency: val('visa_fee_currency') || 'USD',
        visa_fee_rate_mmk: feeRateMmk,
        visa_fee_mmk: visaFeeMmk,
        visa_fee_paid: val('visa_fee_paid') === 'paid',
        service_fee_mmk: serviceFeeMmk,
        other_costs_mmk: otherCostsMmk,
        customer_total_mmk: customerTotalMmk,
        profit_mmk: profitMmk,
        amount_paid_mmk: amountPaidMmk,
        payment_status: val('visa_payment_status') || 'unpaid',
        payment_method: val('visa_payment_method'),
        payment_date: val('visa_payment_date'),
        receipt_no: val('visa_receipt_no'),
        service_fee_refund_mmk: serviceFeeRefundMmk,
        visa_fee_refund_mmk: visaFeeRefundMmk,
        notes: val('visa_notes'),

        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_by: existing?.created_by || state.currentUser?.email || 'Admin'
    };

    const saveBtn = document.getElementById('saveVisaBtn');
    if (saveBtn) saveBtn.disabled = true;

    try {
        if (currentEditingVisaId) {
            await updateVisaApplication(currentEditingVisaId, visaData);
            showToast('Visa application updated.', 'success');
        } else {
            await addVisaApplication(visaData);
            showToast('Visa application saved.', 'success');
        }
        hideVisaForm();
        renderVisaApplications();
    } catch (err) {
        console.error('Error saving visa application:', err);
        showToast('Failed to save visa application.', 'error');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

export function editVisaApplication(id) {
    const v = (state.allVisas || []).find(item => item.id === id);
    if (!v) return;

    currentEditingVisaId = v.id;
    _ocrFilledValues = {};
    _paymentStatusManuallySet = true;

    const countryKey = VISA_COUNTRIES[v.country] ? v.country : 'Other';
    _lastSelectedCountry = countryKey;

    const setVal = (elId, value) => {
        const el = document.getElementById(elId);
        if (el) el.value = value ?? '';
    };

    setVal('visa_id', v.id);
    setVal('visa_client_key', v.client_key || '');
    setVal('visa_applicant_name', v.applicant_name || '');
    setVal('visa_applicant_name_mm', v.applicant_name_mm || '');
    setVal('visa_phone', v.phone || '');
    setVal('visa_email', v.email || '');
    setVal('visa_dob', v.dob || '');
    setVal('visa_nationality', v.nationality || 'MMR');
    setVal('visa_place_of_birth', v.place_of_birth || '');
    setVal('visa_passport_no', v.passport_no || '');
    setVal('visa_passport_issue_date', v.passport_issue_date || '');
    setVal('visa_passport_expiry', v.passport_expiry || '');
    setVal('visa_nrc_no', v.nrc_no || '');

    const gRadio = document.getElementById(v.gender === 'F' ? 'visa_gender_f' : 'visa_gender_m');
    if (gRadio) gRadio.checked = true;

    setPassportPreview(v.passport_photo_url || '', v.passport_photo_path || '', 'Passport bio-page photo');
    setAuxPreview('nrc_front', v.nrc_front_url || '', v.nrc_front_path || '');
    setAuxPreview('nrc_back', v.nrc_back_url || '', v.nrc_back_path || '');
    setAuxPreview('household_booklet', v.household_booklet_url || '', v.household_booklet_path || '');

    setVal('visa_country', countryKey);
    if (countryKey === 'Other') {
        setVal('visa_country_other', v.country === 'Other' ? '' : (v.country || ''));
    }

    const eRadio = document.getElementById(v.entries === 'multiple' ? 'visa_entries_multiple' : 'visa_entries_single');
    if (eRadio) eRadio.checked = true;

    setVal('visa_purpose', v.purpose || 'Tourism');
    setVal('visa_entry_route', v.entry_route || 'air');
    setVal('visa_travel_from', v.travel_from || '');
    setVal('visa_travel_to', v.travel_to || '');
    setVal('visa_destination_city', v.destination_city || '');
    setVal('visa_accommodation', v.accommodation || '');
    setVal('visa_host_name', v.host_name || '');
    setVal('visa_host_relationship', v.host_relationship || '');
    setVal('visa_host_phone', v.host_phone || '');
    setVal('visa_host_address', v.host_address || '');

    const hostBody = document.getElementById('visa_host_body');
    if (hostBody) hostBody.hidden = !(v.host_name || v.host_phone || v.host_address);

    setVal('visa_occupation', v.occupation || '');
    setVal('visa_employer', v.employer || '');
    setVal('visa_work_address', v.work_address || '');
    setVal('visa_monthly_income_mmk', v.monthly_income_mmk || '');
    setVal('visa_address_mm', v.address_mm || '');
    setVal('visa_emergency_contact_name', v.emergency_contact_name || '');
    setVal('visa_emergency_contact_phone', v.emergency_contact_phone || '');
    setVal('visa_emergency_contact_relation', v.emergency_contact_relation || '');
    setVal('visa_companions', Array.isArray(v.companions) ? v.companions.join('\n') : (v.companions || ''));

    const pvRadio = document.getElementById(v.previous_visit ? 'visa_prev_visit_yes' : 'visa_prev_visit_no');
    if (pvRadio) pvRadio.checked = true;
    const pvFields = document.getElementById('visa_prev_visit_fields');
    if (pvFields) pvFields.hidden = !v.previous_visit;
    setVal('visa_previous_visa_no', v.previous_visa_no || '');
    setVal('visa_previous_visit_from', v.previous_visit_from || '');
    setVal('visa_previous_visit_to', v.previous_visit_to || '');

    const refCheck = document.getElementById('visa_previous_refusal');
    if (refCheck) refCheck.checked = Boolean(v.previous_refusal);
    const refGrp = document.getElementById('visa_prev_refusal_note_group');
    if (refGrp) refGrp.hidden = !v.previous_refusal;
    setVal('visa_previous_refusal_note', v.previous_refusal_note || '');

    const overCheck = document.getElementById('visa_previous_overstay');
    if (overCheck) overCheck.checked = Boolean(v.previous_overstay);

    currentChecklistItems = Array.isArray(v.documents) ? v.documents.map(d => ({ ...d })) : [];
    handleCountrySwitch(countryKey, false);

    if (countryKey === 'Other') {
        setVal('visa_type_other', v.visa_type || '');
    } else {
        setVal('visa_type', v.visa_type || '');
    }

    setVal('visa_status', v.status || 'draft');
    setVal('visa_application_date', v.application_date || '');
    setVal('visa_submission_date', v.submission_date || '');
    setVal('visa_expected_collection_date', v.expected_collection_date || '');
    setVal('visa_decision_date', v.decision_date || '');
    setVal('visa_collection_date', v.collection_date || '');
    setVal('visa_no', v.visa_no || '');
    setVal('visa_valid_from', v.visa_valid_from || '');
    setVal('visa_valid_until', v.visa_valid_until || '');
    setVal('visa_stay_days', v.stay_days || 0);

    setVal('visa_fee_amount', v.visa_fee_amount ?? '');
    setVal('visa_fee_currency', v.visa_fee_currency || 'USD');
    setVal('visa_fee_rate_mmk', v.visa_fee_rate_mmk ?? '');
    setVal('visa_fee_mmk', v.visa_fee_mmk || 0);
    setVal('visa_fee_paid', v.visa_fee_paid ? 'paid' : 'unpaid');
    setVal('visa_service_fee_mmk', v.service_fee_mmk ?? '');
    setVal('visa_other_costs_mmk', v.other_costs_mmk || 0);
    setVal('visa_service_fee_refund_mmk', v.service_fee_refund_mmk || 0);
    setVal('visa_fee_refund_mmk', v.visa_fee_refund_mmk || 0);
    setVal('visa_customer_total_mmk', v.customer_total_mmk || 0);
    setVal('visa_amount_paid_mmk', v.amount_paid_mmk || 0);
    setVal('visa_payment_status', v.payment_status || 'unpaid');
    setVal('visa_payment_method', v.payment_method || '');
    setVal('visa_payment_date', v.payment_date || '');
    setVal('visa_receipt_no', v.receipt_no || '');
    setVal('visa_notes', v.notes || '');

    updatePassportExpiryWarning();
    updateThailandExemptionNotice();
    recalculateVisaFinancials();

    const titleEl = document.getElementById('visaFormTitle');
    if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-pen"></i> Edit Visa Application (${escapeHtml(formatVisaRef(v.id))})`;

    const saveBtn = document.getElementById('saveVisaBtn');
    if (saveBtn) saveBtn.innerHTML = '<i class="fa-solid fa-check"></i> Update Visa Application';

    document.getElementById('visa-display-container').style.display = 'none';
    document.getElementById('visa-form-container').style.display = 'block';
    initVisaDatepickers();
}

export async function deleteVisaApplicationAction(id) {
    const v = (state.allVisas || []).find(item => item.id === id);
    const label = v ? `${v.applicant_name} (${formatVisaRef(v.id)})` : 'this visa application';
    const confirmed = await showConfirm(`Are you sure you want to delete ${label}? This cannot be undone.`);
    if (!confirmed) return;

    try {
        if (v) {
            const paths = [
                v.passport_photo_path,
                v.nrc_front_path,
                v.nrc_back_path,
                v.household_booklet_path,
                ...(Array.isArray(v.documents) ? v.documents.map(d => d.file_path) : [])
            ].filter(Boolean);
            paths.forEach(p => deletePassportPhoto(p).catch(() => {}));
        }
        await deleteVisaApplication(id);
        showToast('Visa application deleted.', 'success');
        renderVisaApplications();
    } catch (err) {
        console.error('Error deleting visa application:', err);
        showToast('Failed to delete visa application.', 'error');
    }
}

export function renderVisaKpis() {
    const grid = document.getElementById('visaKpiGrid');
    if (!grid) return;

    const all = state.allVisas || [];
    const active = all.filter(v => v.status !== 'withdrawn');
    const inProgress = all.filter(v => ['collecting', 'submitted', 'processing'].includes(v.status)).length;
    const approvedCount = all.filter(v => ['approved', 'collected'].includes(v.status)).length;
    const totalProfit = active.reduce((sum, v) => sum + computeVisaProfit(v), 0);

    grid.innerHTML = `
        <div class="booking-kpi-card">
            <div class="kpi-label">Active Applications</div>
            <div class="kpi-value">${active.length}</div>
            <div class="kpi-sub">${all.length} total recorded</div>
        </div>
        <div class="booking-kpi-card due-soon">
            <div class="kpi-label">In Progress</div>
            <div class="kpi-value">${inProgress}</div>
            <div class="kpi-sub">Collecting · Submitted · Processing</div>
        </div>
        <div class="booking-kpi-card">
            <div class="kpi-label">Approved / Collected</div>
            <div class="kpi-value" style="color: var(--teal);">${approvedCount}</div>
            <div class="kpi-sub">Ready or handed back</div>
        </div>
        <div class="booking-kpi-card">
            <div class="kpi-label">Total Service Profit</div>
            <div class="kpi-value" style="color: var(--teal);">${totalProfit.toLocaleString()} <small>MMK</small></div>
            <div class="kpi-sub">Service fee − costs − refunds</div>
        </div>
    `;
}

export function renderVisaApplications() {
    renderVisaKpis();
    const container = document.getElementById('visaTableContainer');
    const paginationContainer = document.getElementById('visaPagination');
    if (!container) return;

    const searchText = (document.getElementById('visaSearchText')?.value || '').toLowerCase().trim();
    const statusFilter = document.getElementById('visaStatusFilter')?.value || 'all';
    const countryFilter = document.getElementById('visaCountryFilter')?.value || 'all';

    const filtered = (state.allVisas || []).filter(v => {
        if (statusFilter !== 'all' && v.status !== statusFilter) return false;
        if (countryFilter !== 'all') {
            const cKey = VISA_COUNTRIES[v.country] ? v.country : 'Other';
            if (countryFilter === 'Other' ? cKey !== 'Other' : v.country !== countryFilter) return false;
        }
        if (searchText) {
            const ref = formatVisaRef(v.id).toLowerCase();
            const hay = [
                v.applicant_name,
                v.applicant_name_mm,
                v.passport_no,
                v.nrc_no,
                v.phone,
                v.country,
                v.visa_type,
                v.visa_no,
                ref
            ].filter(Boolean).join(' ').toLowerCase();
            if (!hay.includes(searchText)) return false;
        }
        return true;
    });

    filtered.sort((a, b) => {
        const dA = parseDate(a.application_date) || new Date(a.created_at || 0);
        const dB = parseDate(b.application_date) || new Date(b.created_at || 0);
        return dB - dA;
    });

    state.filteredVisas = filtered;

    if (filtered.length === 0) {
        container.innerHTML = `<p style="text-align: center; padding: 2rem; color: var(--muted);">No visa applications found.</p>`;
        if (paginationContainer) paginationContainer.innerHTML = '';
        return;
    }

    const rowsPerPage = state.rowsPerPage || 15;
    const totalPages = Math.max(1, Math.ceil(filtered.length / rowsPerPage));
    if (state.visaPage > totalPages) state.visaPage = totalPages;
    const start = (state.visaPage - 1) * rowsPerPage;
    const pageRows = filtered.slice(start, start + rowsPerPage);

    let html = `
        <table>
            <thead>
                <tr>
                    <th>Application Date</th>
                    <th>Ref</th>
                    <th>Applicant &amp; Passport</th>
                    <th>Country &amp; Type</th>
                    <th>Travel Dates</th>
                    <th>Docs</th>
                    <th>Customer Total</th>
                    <th>Profit</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
    `;

    pageRows.forEach(v => {
        const ref = formatVisaRef(v.id);
        const docSummary = computeChecklistSummary(v.documents);
        const profit = computeVisaProfit(v);
        const stMeta = VISA_STATUS_META[v.status] || VISA_STATUS_META.draft;
        const payStatus = v.payment_status || 'unpaid';
        const payBadgeClass = payStatus === 'paid' ? 'status-paid' : payStatus === 'partial' ? 'status-partial' : 'status-unpaid';
        const payLabel = payStatus === 'paid' ? 'Paid' : payStatus === 'partial' ? 'Partial' : 'Unpaid';
        const docCompleteClass = docSummary.complete ? 'is-complete' : docSummary.received > 0 ? 'is-partial' : 'is-empty';

        html += `
            <tr class="visa-table-row" data-visa-id="${escapeHtml(v.id)}">
                <td>${escapeHtml(v.application_date || '-')}</td>
                <td><span class="visa-ref-pill">${escapeHtml(ref)}</span></td>
                <td>
                    <div class="visa-cell-primary">${escapeHtml(v.applicant_name || '-')}</div>
                    <div class="visa-cell-sub">${escapeHtml(v.passport_no || 'No passport')} ${v.phone ? `· ${escapeHtml(v.phone)}` : ''}</div>
                </td>
                <td>
                    <div class="visa-cell-primary">${escapeHtml(v.country || '-')}</div>
                    <div class="visa-cell-sub">${escapeHtml(v.visa_type || '-')} · ${escapeHtml(v.entries || 'single')}</div>
                </td>
                <td>
                    <div class="visa-cell-primary">${escapeHtml(v.travel_from || '-')}</div>
                    ${v.travel_to ? `<div class="visa-cell-sub">to ${escapeHtml(v.travel_to)}</div>` : ''}
                </td>
                <td>
                    <span class="visa-docs-chip ${docCompleteClass}" title="${docSummary.received} of ${docSummary.total} received">
                        <i class="fa-solid ${docSummary.complete ? 'fa-circle-check' : 'fa-folder-open'}"></i>
                        ${docSummary.received}/${docSummary.total}
                    </span>
                </td>
                <td style="font-weight: 700;">${(Number(v.customer_total_mmk) || 0).toLocaleString()} MMK</td>
                <td style="font-weight: 700; color: var(--teal);">${profit >= 0 ? '+' : ''}${profit.toLocaleString()} MMK</td>
                <td><span class="visa-status-badge tone-${stMeta.tone}">${escapeHtml(stMeta.label)}</span></td>
                <td><span class="status-badge ${payBadgeClass}">${payLabel}</span></td>
                <td class="actions-cell">
                    <button class="action-btn view-btn" data-visa-action="view" data-id="${escapeHtml(v.id)}" title="View Details"><i class="fa-solid fa-eye"></i></button>
                    <button class="action-btn edit-btn" data-visa-action="edit" data-id="${escapeHtml(v.id)}" title="Edit"><i class="fa-solid fa-pen"></i></button>
                    <button class="action-btn delete-btn" data-visa-action="delete" data-id="${escapeHtml(v.id)}" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </td>
            </tr>
        `;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;

    container.querySelectorAll('[data-visa-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            const action = btn.dataset.visaAction;
            if (action === 'view') showVisaDetailsAction(id);
            else if (action === 'edit') editVisaApplication(id);
            else if (action === 'delete') deleteVisaApplicationAction(id);
        });
    });

    container.querySelectorAll('tr.visa-table-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            showVisaDetailsAction(row.dataset.visaId);
        });
    });

    if (paginationContainer) {
        renderPagination(paginationContainer, filtered.length, rowsPerPage, state.visaPage, (newPage) => {
            state.visaPage = newPage;
            renderVisaApplications();
        });
    }
}

export function showVisaDetailsAction(id) {
    const v = (state.allVisas || []).find(item => item.id === id);
    if (!v) return;

    const ref = formatVisaRef(v.id);
    const stMeta = VISA_STATUS_META[v.status] || VISA_STATUS_META.draft;
    const docSummary = computeChecklistSummary(v.documents);
    const profit = computeVisaProfit(v);
    const total = Number(v.customer_total_mmk) || 0;
    const paid = Number(v.amount_paid_mmk) || 0;
    const balance = Math.max(0, total - paid);
    const expStatus = computePassportExpiryStatus(v.passport_expiry);

    const docsHtml = (v.documents || []).map(d => {
        const st = d.status || 'missing';
        const pillClass = st === 'verified' ? 'is-verified' : st === 'received' ? 'is-received' : 'is-missing';
        const stLabel = st === 'verified' ? 'Verified' : st === 'received' ? 'Received' : 'Missing';
        return `
            <div class="visa-modal-doc-card ${pillClass}">
                <div class="visa-modal-doc-head">
                    <strong>${escapeHtml(d.label)}</strong>
                    <span class="visa-doc-status-pill ${pillClass}">${stLabel}</span>
                </div>
                ${d.file_url ? `
                    <button type="button" class="visa-modal-doc-thumb" data-lightbox-url="${escapeHtml(d.file_url)}" data-lightbox-caption="${escapeHtml(d.label)}">
                        <img src="${escapeHtml(d.file_url)}" alt="${escapeHtml(d.label)}">
                        <span><i class="fa-solid fa-magnifying-glass-plus"></i> View scan</span>
                    </button>
                ` : `<div class="visa-modal-doc-empty">No scan attached</div>`}
            </div>
        `;
    }).join('');

    const content = `
        <div class="visa-detail-modal">
            <div class="visa-modal-header">
                <div class="visa-modal-title-wrap">
                    <span class="visa-modal-icon"><i class="fa-solid fa-passport"></i></span>
                    <div>
                        <h2>${escapeHtml(v.country || 'Visa')} — ${escapeHtml(v.visa_type || 'Application')}</h2>
                        <div class="visa-modal-sub">
                            <span class="visa-ref-pill">${escapeHtml(ref)}</span>
                            <button type="button" class="btn-doc-sm" id="visaModalCopyRefBtn" title="Copy Reference">
                                <i class="fa-regular fa-copy"></i> Copy Ref
                            </button>
                            <span class="visa-status-badge tone-${stMeta.tone}">${escapeHtml(stMeta.label)}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="visa-modal-kpi-strip">
                <div class="visa-modal-kpi">
                    <span>Documents</span>
                    <strong>${docSummary.received} / ${docSummary.total} received</strong>
                </div>
                <div class="visa-modal-kpi">
                    <span>Customer Total</span>
                    <strong>${total.toLocaleString()} MMK</strong>
                </div>
                <div class="visa-modal-kpi">
                    <span>Your Profit</span>
                    <strong style="color: var(--teal);">${profit >= 0 ? '+' : ''}${profit.toLocaleString()} MMK</strong>
                </div>
                <div class="visa-modal-kpi">
                    <span>Balance Due</span>
                    <strong style="color: ${balance > 0 ? 'var(--coral)' : 'var(--teal)'};">${balance.toLocaleString()} MMK</strong>
                </div>
            </div>

            <div class="visa-modal-grid">
                <div class="visa-modal-panel">
                    <h4><i class="fa-solid fa-id-card"></i> Applicant &amp; Passport</h4>
                    <div class="visa-kv-list">
                        <div><span>Full Name</span><strong>${escapeHtml(v.applicant_name || '-')} ${v.applicant_name_mm ? `(${escapeHtml(v.applicant_name_mm)})` : ''}</strong></div>
                        <div><span>Gender / DOB</span><strong>${escapeHtml(v.gender || 'M')} · ${escapeHtml(v.dob || '-')}</strong></div>
                        <div><span>Phone / Email</span><strong>${escapeHtml(v.phone || '-')} ${v.email ? `· ${escapeHtml(v.email)}` : ''}</strong></div>
                        <div><span>Passport No.</span><strong>${escapeHtml(v.passport_no || '-')} (${escapeHtml(v.nationality || 'MMR')})</strong></div>
                        <div><span>Passport Expiry</span><strong>${escapeHtml(v.passport_expiry || '-')} <em class="visa-exp-chip state-${expStatus.state}">${escapeHtml(expStatus.label)}</em></strong></div>
                        <div><span>NRC No.</span><strong>${escapeHtml(v.nrc_no || '-')}</strong></div>
                    </div>
                    ${v.passport_photo_url ? `
                        <button type="button" class="btn-doc-sm" style="margin-top:8px;" data-lightbox-url="${escapeHtml(v.passport_photo_url)}" data-lightbox-caption="Passport — ${escapeHtml(v.applicant_name || '')}">
                            <i class="fa-regular fa-image"></i> View Passport Bio-Page Photo
                        </button>
                    ` : ''}
                </div>

                <div class="visa-modal-panel">
                    <h4><i class="fa-solid fa-plane"></i> Trip &amp; Background</h4>
                    <div class="visa-kv-list">
                        <div><span>Country &amp; Type</span><strong>${escapeHtml(v.country || '-')} · ${escapeHtml(v.visa_type || '-')} (${escapeHtml(v.entries || 'single')})</strong></div>
                        <div><span>Purpose</span><strong>${escapeHtml(v.purpose || '-')} ${v.entry_route ? `· Entry: ${escapeHtml(v.entry_route.toUpperCase())}` : ''}</strong></div>
                        <div><span>Travel Dates</span><strong>${escapeHtml(v.travel_from || '-')} → ${escapeHtml(v.travel_to || '-')}</strong></div>
                        <div><span>City / Hotel</span><strong>${escapeHtml(v.destination_city || '-')} ${v.accommodation ? `· ${escapeHtml(v.accommodation)}` : ''}</strong></div>
                        <div><span>Occupation</span><strong>${escapeHtml(v.occupation || '-')} ${v.employer ? `(${escapeHtml(v.employer)})` : ''}</strong></div>
                        <div><span>Visa Approval No.</span><strong>${escapeHtml(v.visa_no || 'Pending')} ${v.visa_valid_until ? `(valid until ${escapeHtml(v.visa_valid_until)})` : ''}</strong></div>
                    </div>
                </div>
            </div>

            <div class="visa-modal-section">
                <h4><i class="fa-solid fa-folder-open"></i> Embassy Checklist (${docSummary.received}/${docSummary.total})</h4>
                <div class="visa-modal-docs-grid">
                    ${docsHtml}
                </div>
            </div>

            <div class="visa-modal-grid">
                <div class="visa-modal-panel">
                    <h4><i class="fa-solid fa-coins"></i> Fees Breakdown</h4>
                    <div class="visa-kv-list">
                        <div><span>Embassy Fee (Pass-Through)</span><strong>${Number(v.visa_fee_amount || 0).toLocaleString()} ${escapeHtml(v.visa_fee_currency || 'USD')} × ${Number(v.visa_fee_rate_mmk || 0).toLocaleString()} = ${(Number(v.visa_fee_mmk) || 0).toLocaleString()} MMK</strong></div>
                        <div><span>Service Fee</span><strong>${(Number(v.service_fee_mmk) || 0).toLocaleString()} MMK</strong></div>
                        <div><span>Other Costs</span><strong>${(Number(v.other_costs_mmk) || 0).toLocaleString()} MMK</strong></div>
                        <div><span>Customer Total</span><strong>${total.toLocaleString()} MMK</strong></div>
                        <div><span>Amount Paid</span><strong>${paid.toLocaleString()} MMK (${escapeHtml((v.payment_status || 'unpaid').toUpperCase())} ${v.payment_method ? `via ${escapeHtml(v.payment_method)}` : ''})</strong></div>
                        <div><span>Your Net Profit</span><strong style="color: var(--teal);">${profit >= 0 ? '+' : ''}${profit.toLocaleString()} MMK</strong></div>
                    </div>
                </div>

                <div class="visa-modal-panel">
                    <h4><i class="fa-solid fa-clock"></i> Workflow Timeline</h4>
                    <div class="visa-kv-list">
                        <div><span>Application Handed In</span><strong>${escapeHtml(v.application_date || '-')}</strong></div>
                        <div><span>Submitted to Embassy</span><strong>${escapeHtml(v.submission_date || '-')}</strong></div>
                        <div><span>Expected Collection</span><strong>${escapeHtml(v.expected_collection_date || '-')}</strong></div>
                        <div><span>Decision Date</span><strong>${escapeHtml(v.decision_date || '-')}</strong></div>
                        <div><span>Passport Collected</span><strong>${escapeHtml(v.collection_date || '-')}</strong></div>
                        ${v.notes ? `<div><span>Notes</span><strong>${escapeHtml(v.notes)}</strong></div>` : ''}
                    </div>
                </div>
            </div>

            <div class="visa-modal-footer">
                <button type="button" class="btn btn-secondary" id="visaModalCloseBtn">Cancel</button>
                <button type="button" class="btn btn-secondary" id="visaModalCopySummaryBtn">
                    <i class="fa-solid fa-share-nodes"></i> Copy Summary
                </button>
                <button type="button" class="btn btn-primary" id="visaModalEditBtn">
                    <i class="fa-solid fa-pen"></i> Edit Application
                </button>
            </div>
        </div>
    `;

    openModal(content, 'large-modal');

    document.getElementById('visaModalCloseBtn')?.addEventListener('click', closeModal);
    document.getElementById('visaModalCopyRefBtn')?.addEventListener('click', () => {
        navigator.clipboard?.writeText(ref);
        showToast(`Copied ${ref}`, 'success');
    });
    document.getElementById('visaModalCopySummaryBtn')?.addEventListener('click', () => {
        const missingList = docSummary.missing.map(d => d.label);
        const lines = [
            `OCEAN TRAVEL — VISA APPLICATION (${ref})`,
            `Applicant: ${v.applicant_name || '-'} (${v.passport_no || 'No Passport'})`,
            `Visa: ${v.country || '-'} — ${v.visa_type || '-'} (${v.entries || 'single'})`,
            `Travel: ${v.travel_from || '-'} to ${v.travel_to || '-'}`,
            `Status: ${stMeta.label}`,
            `Documents: ${docSummary.received}/${docSummary.total} received${missingList.length ? ` (Missing: ${missingList.join(', ')})` : ' (Complete)'}`,
            `Total Fee: ${total.toLocaleString()} MMK | Paid: ${paid.toLocaleString()} MMK | Balance: ${balance.toLocaleString()} MMK`
        ];
        navigator.clipboard?.writeText(lines.join('\n'));
        showToast('Visa summary copied for Viber / Messenger.', 'success');
    });
    document.getElementById('visaModalEditBtn')?.addEventListener('click', () => {
        closeModal();
        const visaSection = document.getElementById('visa-view');
        if (visaSection && visaSection.style.display === 'none') {
            window.location.hash = '#/visa';
            setTimeout(() => editVisaApplication(v.id), 120);
        } else {
            editVisaApplication(v.id);
        }
    });

    document.querySelectorAll('[data-lightbox-url]').forEach(btn => {
        btn.addEventListener('click', () => {
            openPhotoLightbox(btn.dataset.lightboxUrl, btn.dataset.lightboxCaption || 'Document scan');
        });
    });
}
