// Shared, retryable on-demand loaders. Nothing is fetched until an export/import asks.
const pending = new Map();
const definitions = {
    pdf: ['https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => !!window.jspdf?.jsPDF],
    table: ['https://unpkg.com/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.js', () => !!window.jspdf?.jsPDF?.API?.autoTable],
    canvas: ['https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => !!window.html2canvas],
    reader: ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js', () => !!window.pdfjsLib],
    ocr: ['https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', () => !!window.Tesseract]
};
async function load(name) {
    if (!definitions[name]) throw new Error(`Unknown document library: ${name}`);
    if (name === 'table') await load('pdf');
    const [src, ready] = definitions[name];
    if (ready()) return;
    if (!pending.has(name)) {
        const request = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            let timer;
            const fail = () => {
                clearTimeout(timer);
                script.remove();
                reject(new Error('Could not load document tools. Check your connection and try again.'));
            };
            script.onload = () => { if (!ready()) return fail(); clearTimeout(timer); resolve(); };
            script.onerror = fail;
            timer = setTimeout(fail, 30000);
            document.head.appendChild(script);
        }).catch(error => { pending.delete(name); throw error; });
        pending.set(name, request);
    }
    return pending.get(name);
}
export async function loadDocumentLibraries(...names) {
    try { await Promise.all(names.map(load)); }
    catch (error) {
        window.dispatchEvent(new CustomEvent('ocean:document-load-error', { detail: error.message }));
        throw error;
    }
}
