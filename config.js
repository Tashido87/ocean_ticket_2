// Configuration for Google Sheets API and application settings
export const CONFIG = {
    SHEET_ID: '1SGc80isz0VRVt447R_q-fBdZ_me52H_Z32W5HauHMWQ',
    API_KEY: 'AIzaSyC9JSD6VWXMQ7Pe8VPf-gIlNUtcwQhkG1o', // It is strongly recommended to move this to a secure backend.
    CLIENT_ID: '254093944424-mfvk48avc9n86de6jit9oai7kqrsr2f7.apps.googleusercontent.com', // IMPORTANT: REPLACE WITH YOUR CLIENT ID
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets',
    DISCOVERY_DOC: 'https://sheets.googleapis.com/$discovery/rest?version=v4',
    SHEET_NAME: '2025',
    BOOKING_SHEET_NAME: 'booking',
    HISTORY_SHEET: 'history', // Consolidated history sheet
    SETTLE_SHEET_NAME: 'settle'
};

// City data for flight type toggle
export const CITIES = {
    DOMESTIC: ["Bhamo (BMO)", "Bokpyin (VBP)", "Dawei (TVY)", "Heho (HEH)", "Hommalinn (HOX)", "Kalemyo (KMV)", "Kengtung (KET)", "Khamti (KHM)", "Kyaukpyu (KYP)", "Lashio (LSH)", "Loikaw (LIW)", "Mandalay (MDL)", "Mawlamyaing (MNU)", "Monywa (NYW)", "Myeik (MGZ)", "Myitkyina (MYT)", "Nay Pyi Taw (NYT)", "Nyaung U (NYU)", "Putao (PBU)", "Sittwe (AKY)", "Tachilek (THL)", "Thandwe (SNW)", "Yangon (RGN)"],
    INTERNATIONAL: ["Mandalay (MDL)", "Yangon (RGN)", "Ann (VBA)", "Anni Sakhan (VBK)", "Bangalore (BLR)", "Bangkok (BKK)", "Bassein (BSX)", "Brisbane (BNE)", "Busan (PUS)", "Chengdu (CTU)", "Chaing Mai (CNX)", "Coco Islands (VCC)", "Colombo (CMB)", "Cox's bazar (CXB)", "Denpasar (DPS)", "Dhaka (DAC)", "Don Mueang (DMK)", "Fukuoka (FUK)", "Gaya (GAY)", "Haikou (HAK)", "Hanoi (HAN)", "Ho Chi Minh City (SGN)", "Hong Kong (HKG)", "Incheon (ICN)", "Jakarta (CGK)", "Kolkata (CCU)", "Krabi (KBV)", "Kuala Lumpur (KUL)", "Kumming (KMG)", "Mae Sot (MAQ)", "Manaung (MGU)", "Mangrere (AKL)", "Mangshi (LUM)", "Manila (MNL)", "Melbourne (MEL)", "Monghsat (MOG)", "Mumbai (BOM)", "Nagoya (NGO)", "Naming (NMS)", "Nanning (NNG)", "Phuket (HKT)", "Siem Reap (SAI)", "Singapore (SIN)", "Subang (SZB)", "Surbung (SRU)", "Sydney (SYD)", "Taipei (TPE)", "Tokyo - Narita (NRT)", "Vientiane (VTE)", "Xiamen (XMN)"]
};