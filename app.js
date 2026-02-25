/* ============================================================
   ParkIQ — Smart Corporate Parking Management
   app.js  Part 1: Data Store, State Machine, Core Logic
   ============================================================ */

/* ============================================================
   Part 2: Render Functions, Charts & Initialization
   ============================================================ */

// ── Auth & API ────────────────────────────────────────────────
// איתור אוטומטי של סביבת העבודה (מקומי לעומת ייצור ב-GitHub Pages)
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const PRODUCTION_SERVER = 'https://parking-qgzw.onrender.com'; // נעדכן את זה ברגע שהשרת יעלה לאוויר

const BASE_URL = isLocal ? 'http://localhost:3000' : PRODUCTION_SERVER;
const API_URL = `${BASE_URL}/api`;
const SOCKET_URL = BASE_URL;

let socket = null;

function initSocketConnection(token) {
    if (socket) return;
    socket = io(SOCKET_URL);

    socket.on('connect', () => {
        console.log("Connected to Real-Time Server", socket.id);
    });

    // Listen for state push from server
    socket.on('state_updated', async () => {
        console.log("Received state_updated from server. Triggering refresh.");
        await fetchBackendState(token);
        if (typeof renderAll === 'function') renderAll();
    });
}

async function checkAuth() {
    const token = localStorage.getItem('parkiq_token');
    const userJson = localStorage.getItem('parkiq_user');

    if (!token || !userJson) return false;

    STATE.currentUserId = JSON.parse(userJson).id;
    const ok = await fetchBackendState(token);
    if (!ok) {
        doLogout();
        return false;
    }
    document.getElementById('empName').textContent = JSON.parse(userJson).name;
    const topBar = document.getElementById('topBarUserName');
    if (topBar) topBar.textContent = JSON.parse(userJson).name;

    const role = JSON.parse(userJson).role;
    const adminNavTab = document.getElementById('adminNavTab');
    if (adminNavTab) adminNavTab.style.display = (role === 'admin') ? 'flex' : 'none';

    initSocketConnection(token); // Launch real-time connection on reload
    return true;
}

async function doLogin() {
    const user = document.getElementById('loginUsername').value.trim();
    const pass = document.getElementById('loginPassword').value.trim();
    const errorEl = document.getElementById('loginError');
    errorEl.style.display = 'none';

    if (!user || !pass) {
        errorEl.textContent = 'נא להזין שם משתמש וסיסמא.';
        errorEl.style.display = 'block';
        return;
    }

    document.getElementById('loginBtn').textContent = 'מתחבר...';
    try {
        const res = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'שגיאת התחברות');

        localStorage.setItem('parkiq_token', data.token);
        localStorage.setItem('parkiq_user', JSON.stringify(data.user));
        STATE.currentUserId = data.user.id;

        await fetchBackendState(data.token);

        document.getElementById('loginOverlay').classList.add('hidden');
        document.getElementById('empName').textContent = data.user.name;

        const topBar = document.getElementById('topBarUserName');
        if (topBar) topBar.textContent = data.user.name;

        const adminNavTab = document.getElementById('adminNavTab');
        if (adminNavTab) adminNavTab.style.display = (data.user.role === 'admin') ? 'flex' : 'none';

        initSocketConnection(data.token); // Launch real-time connection on local login

        init(); // Continue initialization
        document.getElementById('empName').textContent = data.user.name;

        init(); // Continue initialization
    } catch (err) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
    } finally {
        document.getElementById('loginBtn').textContent = 'התחבר למערכת';
    }
}

function doLogout() {
    localStorage.removeItem('parkiq_token');
    localStorage.removeItem('parkiq_user');
    document.getElementById('loginOverlay').classList.remove('hidden');
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
}

async function fetchBackendState(token) {
    try {
        const res = await fetch(`${API_URL}/state`, { headers: { 'Authorization': `Bearer ${token}` } });
        if (!res.ok) return false;
        const data = await res.json();

        USERS.length = 0; USERS.push(...data.users);
        SPOTS.length = 0; SPOTS.push(...data.spots);
        BOOKINGS.length = 0; BOOKINGS.push(...data.bookings);
        if (data.settings.capacity) STATE.capacity = parseInt(data.settings.capacity);
        if (data.settings.vipSpots) STATE.vipSpots = parseInt(data.settings.vipSpots);
        if (data.settings.carpoolSpots) STATE.carpoolSpots = parseInt(data.settings.carpoolSpots);
        if (data.settings.evSpots) STATE.evSpots = parseInt(data.settings.evSpots);

        checkPendingOffers();
        return true;
    } catch (e) {
        console.error("Backend fetch error:", e);
        return false;
    }
}

// ── Global State ──────────────────────────────────────────────
const STATE = {
    capacity: 30,
    vipSpots: 3,
    carpoolSpots: 5,
    gracePeriod: 20,        // minutes
    middayMax: 3,           // hours
    offerWindow: 10,        // minutes
    trafficExtension: 15,   // minutes
    bookingOpen: '18:00',
    bookingClose: '08:00',
    currentUserId: 'u1',
    notifications: [],
    notifCount: 0
};

// ── Users ──────────────────────────────────────────────────────
const USERS = [
    { id: 'u1', name: 'Alex Cohen', tier: 3, email: 'alex@corp.com', noShows: 0, waitHistory: 2, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null, ecoPoints: 150 },
    { id: 'u2', name: 'Maya Levi', tier: 4, email: 'maya@corp.com', noShows: 1, waitHistory: 0, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null, ecoPoints: 420 },
    { id: 'u3', name: 'Yoni Shapiro', tier: 2, email: 'yoni@corp.com', noShows: 3, waitHistory: 5, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 1, banned: true, banEnds: Date.now() + 86400000, ecoPoints: 50 },
    { id: 'u4', name: 'Dana Mizrahi', tier: 5, email: 'dana@corp.com', noShows: 0, waitHistory: 1, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null, ecoPoints: 850 },
    { id: 'u5', name: 'Rotem Bar', tier: 1, email: 'rotem@corp.com', noShows: 2, waitHistory: 3, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null, ecoPoints: 0 },
    { id: 'u6', name: 'Noa Peretz', tier: 3, email: 'noa@corp.com', noShows: 0, waitHistory: 4, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null, ecoPoints: 200 },
    { id: 'u7', name: 'Tal Katz', tier: 2, email: 'tal@corp.com', noShows: 1, waitHistory: 0, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null, ecoPoints: 310 },
    { id: 'u8', name: 'Ilan Gross', tier: 4, email: 'ilan@corp.com', noShows: 0, waitHistory: 2, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null, ecoPoints: 600 },
];

// ── Spots ──────────────────────────────────────────────────────
// States: 'available' | 'reserved' | 'occupied' | 'temp-away' | 'carpool' | 'vip'
function buildSpots(total) {
    const spots = [];
    for (let i = 1; i <= total; i++) {
        spots.push({
            id: `S${i}`,
            num: i,
            state: 'available',
            userId: null,
            reservedAt: null,
            graceTimer: null,
            isCarpool: i <= 5,
            isVIP: i > total - 3
        });
    }
    return spots;
}
let SPOTS = buildSpots(STATE.capacity);

// ── Bookings ───────────────────────────────────────────────────
// { id, userId, date, time, spotId|null, status:'reserved'|'waitlist'|'occupied'|'completed'|'cancelled', carpoolWith:[], noShow:false }
let BOOKINGS = [];
let WAITLIST = []; // { userId, score, requestedAt, offerExpiry:null }
let OFFER_TIMER_ID = null;
let OFFER_USER_ID = null;
let OFFER_SPOT_ID = null;
let OFFER_SECONDS = 0;

// ── History for analytics ──────────────────────────────────────
const HISTORY = {
    weeklyOccupancy: [72, 85, 91, 78, 63, 88, 95],   // Mon-Sun %
    noShowsWeek: [2, 3, 1, 4, 2, 1, 3],
    heatmap: buildHeatmapData()
};

function buildHeatmapData() {
    const rows = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    return rows.map(w => days.map(() => Math.floor(Math.random() * 60) + 30));
}

// ── State Machine ──────────────────────────────────────────────
const TRANSITIONS = {
    available: ['reserved'],
    reserved: ['occupied', 'available'],     // occupied=check-in, available=auto-release/cancel
    occupied: ['completed', 'temp-away'],
    'temp-away': ['occupied', 'available'],   // return or auto-release after middayMax
    completed: []
};

function transitionSpot(spot, newState, userId = null) {
    const allowed = TRANSITIONS[spot.state] || [];
    if (!allowed.includes(newState)) {
        console.warn(`Invalid transition: ${spot.state} → ${newState} for spot ${spot.id}`);
        return false;
    }
    spot.state = newState;
    spot.userId = userId;
    if (newState === 'reserved') {
        spot.reservedAt = Date.now();
        startGraceTimer(spot);
    } else if (newState === 'available') {
        spot.reservedAt = null;
        clearGraceTimerForSpot(spot);
    }
    return true;
}

// ── Priority Score ─────────────────────────────────────────────
function calcPriority(user, carpoolCount = 0) {
    const w1 = 1.0, w2 = 3.0, w3 = 2.5, w4 = 0.8;
    return (w1 * user.tier) + (w2 * carpoolCount) - (w3 * user.noShows) + (w4 * user.waitHistory);
}

// ── Booking Logic ──────────────────────────────────────────────
async function submitBooking() {
    const user = getUser();
    if (!user) return;

    if (user.banned) {
        if (user.banEnds && Date.now() < user.banEnds) {
            const hrs = Math.ceil((user.banEnds - Date.now()) / 3600000);
            showToast('error', '🚫 חסימת הזמנה', `החשבון חסום ל-${hrs} שעות עקב אי-הגעה חוזרת.`);
            return;
        } else { user.banned = false; }
    }

    const dateVal = document.getElementById('bookingDate').value;
    const timeVal = document.getElementById('bookingTime').value;
    const carpools = getCarpoolTagIds();

    if (!dateVal) { showToast('warn', '⚠️ חסר תאריך', 'אנא בחר תאריך.'); return; }

    const carpoolVerified = carpools.length > 0;
    const score = calcPriority(user, carpools.length);

    // Check available spots
    const freeSpots = SPOTS.filter(s => s.state === 'available' && !s.isVIP);
    const carpoolFreeSpots = freeSpots.filter(s => s.isCarpool);
    const regularFreeSpots = freeSpots.filter(s => !s.isCarpool);

    const existingBooking = BOOKINGS.find(b => b.userId === user.id && b.date === dateVal && b.status !== 'cancelled');
    if (existingBooking) {
        showToast('warn', 'כבר הוזמן', `יש לך כבר חניה מוזמנת ל-${dateVal}.`); return;
    }

    // Try to assign a spot
    let assignedSpot = null;
    if (carpoolVerified && carpoolFreeSpots.length > 0) {
        assignedSpot = carpoolFreeSpots[0];
        showToast('success', '⭐ עדיפות קארפול!', 'זכית בחניית פרימיום קרובה למעלית!');
    } else if (regularFreeSpots.length > 0) {
        const sorted = [...regularFreeSpots].sort((a, b) => a.num - b.num);
        assignedSpot = sorted[0];
    } else if (freeSpots.length > 0) {
        assignedSpot = freeSpots[0];
    }

    if (carpools.length > 0 && assignedSpot) {
        user.ecoPoints = (user.ecoPoints || 0) + (carpools.length * 50);
        setTimeout(() => showToast('success', '🌱 נקודות Eco הוענקו!', `קיבלת +${carpools.length * 50} נקודות Eco על נסיעה משותפת.`), 2000);
    }

    if (assignedSpot) {
        try {
            const token = localStorage.getItem('parkiq_token');
            const res = await fetch(`${API_URL}/spots/${assignedSpot.id}/reserve`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ userId: user.id })
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'שגיאת הקצאה מול השרת');
            }

            showToast('success', '✅ חניה שמורה!', `חניה #${assignedSpot.num} שמורה עבורך. זכור לעשות צ'ק-אין תוך ${STATE.gracePeriod} דקות מזמן ההגעה.`);
            addNotif('success', 'הזמנה אושרה', `חניה #${assignedSpot.num} שמורה ל-${dateVal} בשעה ${timeVal}`);
            triggerConfetti(); // Phase 3: Celebrate!
        } catch (err) {
            showToast('error', 'שגיאה', err.message);
        }
    } else {
        const booking = {
            id: `B${Date.now()}`,
            userId: user.id,
            date: dateVal,
            time: timeVal,
            spotId: null,
            status: 'waitlist',
            carpoolWith: carpools,
            carpoolVerified,
            score,
            noShow: false,
            createdAt: Date.now()
        };
        BOOKINGS.push(booking);

        const pos = addToWaitlist(user, score, carpools.length);
        booking.waitlistPos = pos;
        showToast('warn', '📋 נוספת לרשימת ההמתנה', `אין חניות פנויות. אתה בתור #${pos} (ציון: ${score.toFixed(1)}).`);
        addNotif('warn', 'רשימת המתנה', `מיקום #${pos} ל-${dateVal}. נודיע לך כשחניה תתפנה.`);
    }

    clearCarpoolTags();
}

function addToWaitlist(user, score, carpoolCount) {
    const entry = { userId: user.id, score, requestedAt: Date.now(), offerExpiry: null };
    WAITLIST.push(entry);
    WAITLIST.sort((a, b) => b.score - a.score); // highest score first
    return WAITLIST.findIndex(e => e.userId === user.id) + 1;
}

// ── Auto-Release Callback ────────────────────────────────────────
// The backend now handles the 20 minute grace period timer.
// When it expires, it broadcasts a state_updated event.

// ── Penalties ──────────────────────────────────────────────────
// Penalty logic is now primarily handled by the backend upon grace period expiration.
// We keep this function to display notifications if needed, though the backend will update the user state.

function applyPenalty(user) {
    if (user.noShows === 1) {
        addNotif('warn', '⚠️ אזהרת אי-הגעה', `אי-הגעה ראשונה נרשמה. עבירות נוספות יפגעו בציון התעדוף שלך.`);
        showToast('warn', '⚠️ אזהרת אי-הגעה', `אזהרה: אי הגעה ראשונה של ${user.name}`);
    } else if (user.noShows === 2) {
        addNotif('error', '❌ קנס תעדוף', `אי-הגעה שנייה! ציון התעדוף שלך ירד ב-5 נקודות.`);
        showToast('error', '❌ ענישת תעדוף', `הציון של ${user.name} ירד (אי הגעה שנייה).`);
    } else if (user.noShows >= 3) {
        user.banned = true;
        user.banEnds = Date.now() + 48 * 3600000;
        addNotif('error', '🚫 הושעית ל-48 שעות', `אי הגעה שלישית. ההרשמה הושעתה ל-48 שעות.`);
        showToast('error', '🚫 השעיית מערכת', `${user.name} הושעה מניהול חניות ל-48 שעות.`);
    }
}

// ── Waitlist & Offer System (Backend Managed) ──────────────────
function checkPendingOffers() {
    const pendingSpot = SPOTS.find(s => s.userId === STATE.currentUserId && s.state === 'pending_offer');
    if (pendingSpot) {
        showOfferBanner(pendingSpot);
        if (!document.getElementById('offerModal').classList.contains('open')) {
            showOfferModal(pendingSpot);
        }
    } else {
        hideOfferBanner();
        const m = document.getElementById('offerModal');
        if (m && m.classList.contains('open')) closeModal('offerModal');
    }
}

async function acceptOffer() {
    const spot = SPOTS.find(s => s.userId === STATE.currentUserId && s.state === 'pending_offer');
    if (!spot) return;

    try {
        const token = localStorage.getItem('parkiq_token');
        const res = await fetch(`${API_URL}/spots/${spot.id}/offer/accept`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'שגיאת אישור הצעה');
        }
        showToast('success', '✅ החניה התקבלה!', `חניה #${spot.num} עכשיו שלך! אל תשכח צ'ק-אין בזמן.`);
        addNotif('success', 'חניה אושרה', `חניה #${spot.num} הוקצתה מרשימת ההמתנה.`);
    } catch (err) {
        showToast('error', 'שגיאה', err.message);
    }
}

async function declineOffer() {
    const spot = SPOTS.find(s => s.userId === STATE.currentUserId && s.state === 'pending_offer');
    if (!spot) return;

    try {
        const token = localStorage.getItem('parkiq_token');
        const res = await fetch(`${API_URL}/spots/${spot.id}/offer/decline`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'שגיאת דחיית הצעה');
        }
        showToast('info', 'ההצעה נדחתה', 'הצענו את החניה לבא בתור.');
    } catch (err) {
        showToast('error', 'שגיאה', err.message);
    }
}

// ── Check-In Modes ─────────────────────────────────────────────
function toggleGeo() {
    const geoToggle = document.getElementById('geoToggle');
    const qrToggle = document.getElementById('qrToggle');
    if (!geoToggle || !qrToggle) return;
    geoToggle.classList.add('on');
    qrToggle.classList.remove('on');

    document.getElementById('geoStatus').style.display = 'block';
    document.getElementById('geoActionBtn').style.display = 'block';

    const wrap = document.getElementById('magicScannerWrap');
    if (wrap) wrap.innerHTML = '';
}

function toggleQR() {
    const geoToggle = document.getElementById('geoToggle');
    const qrToggle = document.getElementById('qrToggle');
    if (!geoToggle || !qrToggle) return;
    qrToggle.classList.add('on');
    geoToggle.classList.remove('on');

    document.getElementById('geoStatus').style.display = 'none';
    document.getElementById('geoActionBtn').style.display = 'none';

    if (typeof startMagicScan === 'function') {
        startMagicScan();
    }
}

function simulateGeoCheck() {
    const stText = document.getElementById('geoStatusText');
    if (stText) {
        stText.innerHTML = '<span style="color:var(--accent-green)">מאומת (רדיוס 12מ\')</span>';
    }
    setTimeout(doCheckIn, 600);
}

let html5QrcodeScanner = null;

function startMagicScan() {
    const wrap = document.getElementById('magicScannerWrap');
    if (!wrap) return;

    wrap.innerHTML = '';
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(e => console.error(e));
    }

    html5QrcodeScanner = new Html5QrcodeScanner(
        "magicScannerWrap",
        { fps: 10, qrbox: { width: 250, height: 250 } },
        false
    );

    html5QrcodeScanner.render(async (decodedText, decodedResult) => {
        // Stop scan on success
        html5QrcodeScanner.clear();
        wrap.innerHTML = `<div style="padding:16px;background:rgba(16,185,129,0.2);color:var(--accent-green);border:1px solid var(--accent-green);border-radius:8px;">✅ קוד נסרק בהצלחה: ${decodedText}<br>מאמת מול השרת...</div>`;

        try {
            const token = localStorage.getItem('parkiq_token');
            const res = await fetch(`${API_URL}/qr-checkin`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ code: decodedText })
            });
            const data = await res.json();

            if (!res.ok) throw new Error(data.error || "קוד שגוי או פג תוקף.");

            showToast('success', '✅ הסורק הקסום', `אושר! חסום את חניה ${data.spotNum}. שער נפתח...`);
            addNotif('success', 'צ\'ק-אין דרך מצלמה', `זיהוי מדויק לחניה #${data.spotNum}`);
        } catch (err) {
            wrap.innerHTML = `<div style="padding:16px;background:rgba(239,68,68,0.2);color:var(--accent-red);border:1px solid var(--accent-red);border-radius:8px;">❌ שגיאה: ${err.message}</div>`;
            showToast('error', 'שגיאת סריקה', err.message);
        }
    }, (errorMessage) => {
        // ignore verbose background scanning errors
    });
}

// ── Check-In ───────────────────────────────────────────────────
async function doCheckIn() {
    const user = getUser();
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'reserved');
    if (!spot) { showToast('warn', 'אין הזמנה', 'לא נמצאה חניה שמורה עבורך להיום.'); return; }

    try {
        const token = localStorage.getItem('parkiq_token');
        const res = await fetch(`${API_URL}/spots/${spot.id}/checkin`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'שגיאת Check-in מול השרת');
        }
        showToast('success', '✅ בוצע צ\'ק-אין!', `עשית צ'ק-אין לחניה #${spot.num}. יום נפלא!`);
        addNotif('success', 'צ\'ק-אין אושר', `חניה #${spot.num} — סשן פעיל החל.`);
    } catch (err) {
        showToast('error', 'שגיאה', err.message);
    }
}

// ── Grace Extension ────────────────────────────────────────────
function requestGraceExtension() {
    const user = getUser();
    if (user.graceUsedToday) {
        showToast('warn', 'הגעת למכסה', 'כבר השתמשת בהארכת זמן היום.'); return;
    }
    if (user.graceUsedWeek >= 1) {
        showToast('warn', 'מכסה שבועית', 'כבר השתמשת בהארכת הזמן השבועית שלך.'); return;
    }
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'reserved');
    if (!spot) { showToast('warn', 'אין הזמנה', 'אין חניה פעילה להאריך עליה זמן.'); return; }
    clearGraceTimerForSpot(spot);
    const extMs = STATE.trafficExtension * 60 * 1000;
    graceTimers[spot.id] = setTimeout(() => {
        if (spot.state === 'reserved') autoReleaseSpot(spot, 'grace_expired_extended');
    }, extMs);
    user.graceUsedToday = true;
    user.graceUsedWeek++;
    showToast('success', `⏱ +${STATE.trafficExtension} דק' הארכה`, `הארכה אושרה. נא להגיע לחניה בהקדם!`);
    addNotif('info', 'הארכת זמן הופעלה', `הארכת פקקים אושרה (+${STATE.trafficExtension} דק'). נוצל: 1/ליום, ${user.graceUsedWeek}/בשבוע`);
    renderAll();
}

// ── Midday Exit ────────────────────────────────────────────────
async function submitMiddayExit() {
    const type = document.getElementById('departureType').value;
    const user = getUser();
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'occupied');
    if (!spot) { showToast('warn', 'ללא צ\'ק-אין', 'עליך לעשות צ\'ק-אין לפני יציאה.'); closeModal('middayModal'); return; }

    if (type === 'permanent') {
        try {
            const token = localStorage.getItem('parkiq_token');
            const res = await fetch(`${API_URL}/spots/${spot.id}/checkout`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || 'שגיאת Checkout מול השרת');
            }
            showToast('info', '🚪 היום הסתיים', 'החניה שוחררה. נתראה בפעם הבאה!');
            addNotif('info', 'סשן הסתיים', `חניה #${spot.num} הוחזרה למאגר.`);
        } catch (err) {
            showToast('error', 'שגיאה', err.message);
        }
    } else {
        const returnTime = document.getElementById('returnTime').value;
        spot.state = 'temp-away';
        spot.tempReturnTime = returnTime;
        const maxMs = STATE.middayMax * 3600000;
        spot.tempTimer = setTimeout(() => {
            if (spot.state === 'temp-away') {
                autoReleaseSpot(spot, 'midday_timeout');
                addNotif('error', 'חריגת יציאה זמנית', `זמן ההיעדרות המקסימלי (${STATE.middayMax} שעות) עבר. החניה שוחררה.`);
            }
        }, maxMs);
        showToast('warn', '⏸ החניה בהשהייה', `חניה #${spot.num} נשמרת. חזור עד ${returnTime} (מקסימום ${STATE.middayMax} שעות).`);
        addNotif('warn', 'יציאה זמנית', `חניה #${spot.num} מושהית עד ${returnTime}.`);
    }
    closeModal('middayModal');
    renderAll();
}

function returnFromMidday() {
    const user = getUser();
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'temp-away');
    if (!spot) { showToast('info', 'חזרת!', 'סטטוס החניה כבר מעודכן.'); return; }
    clearTimeout(spot.tempTimer);
    spot.state = 'occupied';
    showToast('success', 'ברוך שובך!', `חניה #${spot.num} שוב פעילה.`);
    renderAll();
}

// ── Carpool ────────────────────────────────────────────────────
let carpoolTagIds = [];

function getCarpoolTagIds() { return [...carpoolTagIds]; }

function addCarpoolTag() {
    const sel = document.getElementById('carpoolSelect');
    const uid = sel.value;
    if (!uid || carpoolTagIds.includes(uid)) return;
    carpoolTagIds.push(uid);
    sel.value = '';
    renderCarpoolTags('carpoolTags', carpoolTagIds, removeCarpoolTag);
    renderPriorityBreakdown();
}

function removeCarpoolTag(uid) {
    carpoolTagIds = carpoolTagIds.filter(x => x !== uid);
    renderCarpoolTags('carpoolTags', carpoolTagIds, removeCarpoolTag);
    renderPriorityBreakdown();
}

function clearCarpoolTags() {
    carpoolTagIds = [];
    const el = document.getElementById('carpoolTags');
    if (el) el.innerHTML = '';
}

let carpoolModal_tags = [];
function addCarpoolModalTag() {
    const sel = document.getElementById('carpoolModalSelect');
    const uid = sel.value;
    if (!uid || carpoolModal_tags.includes(uid)) return;
    carpoolModal_tags.push(uid);
    sel.value = '';
    renderCarpoolTags('carpoolModalTags', carpoolModal_tags, (u) => { carpoolModal_tags = carpoolModal_tags.filter(x => x !== u); renderCarpoolTags('carpoolModalTags', carpoolModal_tags, () => { }); });
}

function submitCarpool() {
    const user = getUser();
    user.carpoolWith = [...carpoolModal_tags];
    carpoolModal_tags = [];
    closeModal('carpoolModal');
    showToast('success', '🚗 קארפול נרשם!', `קבוצה של ${user.carpoolWith.length + 1} אנשים נרשמה. עדיפות בונוס הופעלה!`);
    addNotif('success', 'קבוצת קארפול נוצרה', `${user.carpoolWith.length} שותפים נוספו. ציון +${(3 * user.carpoolWith.length).toFixed(1)} נקודות`);
    renderAll();
}

function renderCarpoolTags(containerId, ids, removeFn) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = ids.map(id => {
        const u = getUserById(id);
        return `<span class="tag-chip">${u?.name || id} <span class="remove" onclick="(${removeFn.toString()})('${id}')">×</span></span>`;
    }).join('');
}

// ── Admin Actions ──────────────────────────────────────────────
async function adminCreateUser() {
    const id = document.getElementById('newUserId').value.trim();
    const name = document.getElementById('newUserName').value.trim();
    const email = document.getElementById('newUserEmail').value.trim();
    const pass = document.getElementById('newUserPass').value.trim();
    const tier = document.getElementById('newUserTier').value;
    const role = document.getElementById('newUserRole').value;
    const isEV = document.getElementById('newUserEV').checked;

    if (!id || !name) {
        showToast('error', 'שגיאה', 'חובה להזין מזהה ושם.');
        return;
    }

    try {
        const btn = event.target;
        btn.disabled = true;
        btn.textContent = 'יוצר...';

        const token = localStorage.getItem('parkiq_token');
        const res = await fetch(`${API_URL}/users`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ id, name, email, password: pass || '123456', tier: parseInt(tier), role, isEV })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast('success', '✅ משתמש נוצר', `משתמש ${name} נוסף בהצלחה.`);

        document.getElementById('newUserId').value = '';
        document.getElementById('newUserName').value = '';
        document.getElementById('newUserEmail').value = '';
        document.getElementById('newUserPass').value = '';
        document.getElementById('newUserEV').checked = false;
        document.getElementById('newUserEV').nextElementSibling.classList.remove('on');

        await fetchBackendState(token);
        renderAll();

    } catch (err) {
        showToast('error', 'שגיאה ביצירת משתמש', err.message);
    } finally {
        const btn = event?.target;
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'צור משתמש חדש';
        }
    }
}

async function generateGuestPass() {
    const name = document.getElementById('guestName').value.trim();
    if (!name) {
        showToast('error', 'שגיאה', 'יש להזין שם אורח');
        return;
    }

    try {
        const token = localStorage.getItem('parkiq_token');
        const res = await fetch(`${API_URL}/admin/guest-pass`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ name })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        document.getElementById('guestName').value = '';

        // Show result
        const resDiv = document.getElementById('guestPassResult');
        const codeDisplay = document.getElementById('guestCodeDisplay');
        if (resDiv && codeDisplay) {
            resDiv.style.display = 'block';
            codeDisplay.textContent = data.code || `QR-${data.guestId}`;
        }

        showToast('success', '✅ אישור הונפק', `אורח ${name} חולק חניה ${data.spotNum || 'בהמתנה'}. קוד: ${data.code}`);
        await fetchBackendState(token);
        renderAll();

    } catch (err) {
        showToast('error', 'שגיאה בהנפקת אישור אורך', err.message);
    }
}

async function fetchAdminLogs() {
    try {
        const token = localStorage.getItem('parkiq_token');
        if (!token) return [];
        const res = await fetch(`${API_URL}/admin/logs`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch logs');
        return await res.json();
    } catch (err) {
        console.error(err);
        return [];
    }
}

function updateCapacity(val) {
    document.getElementById('capacityDisplay').textContent = val;
}

function applyCapacityChanges() {
    const newCap = parseInt(document.getElementById('capacitySlider').value);
    const vip = parseInt(document.getElementById('vipSpots').value) || 0;
    const cp = parseInt(document.getElementById('carpoolSpots').value) || 0;
    const ev = parseInt(document.getElementById('evSpots').value) || 0;
    STATE.capacity = newCap;
    STATE.vipSpots = vip;
    STATE.carpoolSpots = cp;
    STATE.evSpots = ev;

    // Send to backend...
    const rulesToSave = {
        capacity: newCap,
        vipSpots: vip,
        carpoolSpots: cp,
        evSpots: ev
    };
    fetch(`${API_URL}/admin/rules`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('parkiq_token')}`
        },
        body: JSON.stringify(rulesToSave)
    }).then(() => {
        showToast('success', '✅ הקיבולת עודכנה', `סך הכל ${newCap} חניות. מתוכן ${vip} VIP ו-${cp} משותפות, ${ev} EV.`);
        addNotif('info', 'קיבולת שונתה', `מנהל מערכת עדכן תצורה בסיסית.`);
    }).catch(err => console.error(err));
}

function updateVIPSpots(v) { STATE.vipSpots = parseInt(v) || 0; }
function updateCarpoolSpots(v) { STATE.carpoolSpots = parseInt(v) || 0; }
function updateEVSpots(v) { STATE.evSpots = parseInt(v) || 0; }
function updateGracePeriod(v) { STATE.gracePeriod = parseInt(v) || 20; }
function updateMiddayMax(v) { STATE.middayMax = parseInt(v) || 3; }

function saveRules() {
    const rules = {
        gracePeriod: parseInt(document.getElementById('gracePeriod').value) || 20,
        middayMax: parseInt(document.getElementById('middayMax').value) || 3,
        offerWindow: parseInt(document.getElementById('offerWindow').value) || 10,
        trafficExtension: parseInt(document.getElementById('trafficExtension').value) || 15,
        bookingOpen: document.getElementById('bookingOpenTime').value,
        bookingClose: document.getElementById('bookingCloseTime').value
    };

    const token = localStorage.getItem('parkiq_token');
    fetch(`${API_URL}/admin/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(rules)
    })
        .then(r => r.json())
        .then(data => {
            if (data.success) {
                showToast('success', '✅ חוקים נשמרו', 'חוקי המערכת המעודכנים הופעלו מיידית.');
                addNotif('info', 'הגדרות עודכנו', 'מנהל מערכת ביצע שינוי בחוקי החניון.');
            } else {
                showToast('error', 'שגיאה', data.error || 'נכשל בעדכון חוקים');
            }
        })
        .catch(err => showToast('error', 'שגיאה', err.message));
}

function adminClearPenalty(uid) {
    const token = localStorage.getItem('parkiq_token');
    fetch(`${API_URL}/admin/clear-penalty`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId: uid })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast('success', 'קנס בוטל', `היסטוריית אי-ההגעה נוקתה.`);
                addNotif('info', 'עריכת מנהל', `בוטל רישום אי-הגעה.`);
            } else {
                showToast('error', 'שגיאה', data.error || 'Failed to clear');
            }
        })
        .catch(err => showToast('error', 'שגיאה', err.message));
}

function adminForceBook(uid) {
    const token = localStorage.getItem('parkiq_token');
    fetch(`${API_URL}/admin/force-book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ userId: uid })
    })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                showToast('success', 'הוקצה ידנית', `חניה #${data.spotNum} הוקצתה על ימי מנהל.`);
                addNotif('info', 'הקצאה יזומה', `חניה #${data.spotNum} הוקצתה בכוח`);
            } else {
                showToast('warn', 'אין חניות פנויות', data.error || 'אין מספיק חניות בשביל להקצות בכוח.');
            }
        })
        .catch(err => showToast('error', 'שגיאה', err.message));
}

function exportReport() {
    const avail = SPOTS.filter(s => s.state === 'available').length;
    const occ = SPOTS.filter(s => s.state === 'occupied' || s.state === 'reserved').length;
    const noshws = USERS.reduce((a, u) => a + u.noShows, 0);
    const report = `ParkIQ Report — ${new Date().toDateString()}
Total Spots: ${STATE.capacity}
Occupied/Reserved: ${occ}
Available: ${avail}
Total No-Shows: ${noshws}
Avg Occupancy (7d): ${(HISTORY.weeklyOccupancy.reduce((a, b) => a + b, 0) / 7).toFixed(1)}%`;
    alert(report);
}

// ── Utility helpers ────────────────────────────────────────────
function getUser() { return USERS.find(u => u.id === STATE.currentUserId); }
function getUserById(id) { return USERS.find(u => u.id === id); }
function today() { return new Date().toISOString().split('T')[0]; }

function getUserBookingToday(uid) {
    return BOOKINGS.find(b => b.userId === uid && b.date === today() && b.status !== 'cancelled');
}

function switchUser(uid) {
    STATE.currentUserId = uid;
    populateUserSelector();
    renderAll();
}

function switchView(name) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    const view = document.getElementById(`view-${name}`);
    const tab = document.querySelector(`[data-view="${name}"]`);
    if (view) view.classList.add('active');
    if (tab) tab.classList.add('active');
    if (name === 'checkin') renderCheckin();
    if (name === 'waitlist') renderWaitlist();
    if (name === 'admin') renderAdmin();
    if (name === 'analytics') renderAnalytics();
    if (name === 'booking') renderBookingView();
    if (name === 'employee') renderEmployee();
}

// ── Notifications ──────────────────────────────────────────────
function addNotif(type, title, msg) {
    STATE.notifications.unshift({ id: Date.now(), type, title, msg, time: new Date().toLocaleTimeString() });
    STATE.notifCount++;
    const badge = document.getElementById('notifBadge');
    if (badge) { badge.textContent = Math.min(STATE.notifCount, 99); badge.classList.remove('hidden'); }
    renderNotifList(); // Hotfix: Update live panel if open
}

function openNotifPanel() {
    STATE.notifCount = 0;
    const badge = document.getElementById('notifBadge');
    if (badge) {
        badge.textContent = '0';
        badge.classList.add('hidden');
    }
    renderNotifList();
    document.getElementById('notifPanel').classList.add('open');
    document.getElementById('notifBackdrop').classList.add('open');
}

function closeNotifPanel() {
    document.getElementById('notifPanel').classList.remove('open');
    document.getElementById('notifBackdrop').classList.remove('open');
}

function renderNotifList() {
    const el = document.getElementById('notifList');
    if (!el) return;
    if (!STATE.notifications.length) {
        el.innerHTML = '<div class="empty-state" style="margin-top:40px; text-align:center;"><span style="font-size:32px;">🔕</span><p style="color:var(--text-muted); margin-top:10px;">אין התראות כרגע.</p></div>'; return;
    }
    const icons = { success: '✅', warn: '⚠️', error: '❌', info: 'ℹ️' };
    el.innerHTML = STATE.notifications.slice(0, 20).map(n => `
    <div class="notif-item ${n.type}">
      <div class="notif-title"><span style="margin-right:6px;">${icons[n.type] || '🔔'}</span>${n.title}</div>
      <div class="notif-text">${n.msg}</div>
      <div class="notif-time">${n.time}</div>
    </div>`).join('');
}

function clearNotifs() {
    STATE.notifications = [];
    renderNotifList();
}

// ── Toast ──────────────────────────────────────────────────────
function showToast(type, title, msg, dur = 4000) {
    const icons = { success: '✅', warn: '⚠️', error: '❌', info: 'ℹ️' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span class="toast-icon">${icons[type] || '🔔'}</span><div class="toast-body"><strong>${title}</strong><p>${msg}</p></div>`;
    const container = document.getElementById('toast-container');
    container.appendChild(el);
    setTimeout(() => {
        el.style.animation = 'slideToast .3s ease reverse';
        setTimeout(() => el.remove(), 300);
    }, dur);
}

// ── Modal helpers ──────────────────────────────────────────────
function openModal(id) { const m = document.getElementById(id); if (m) m.classList.remove('hidden'); }
function closeModal(id) { const m = document.getElementById(id); if (m) m.classList.add('hidden'); }

// ── Profile Modal (Phase 3) ────────────────────────────────────
function openProfileModal() {
    const user = getUser();
    if (!user) return;

    document.getElementById('profileName').textContent = user.name;
    document.getElementById('profileTier').textContent = `Tier ${user.tier}`;
    document.getElementById('profileEcoPoints').textContent = user.ecoPoints || 0;

    // Generate a mock license plate based on user ID for flavor
    const numMatch = user.id.match(/\d+/);
    const mockId = numMatch ? numMatch[0] : '0';
    document.getElementById('profilePlate').textContent = `IL-${mockId.padStart(2, '0')}X-${(user.tier * 11).toString().padStart(2, '0')}Y`;

    openModal('profileModal');
}

function openCarpoolModal() {
    carpoolModal_tags = [];
    populateCarpoolSelects();
    openModal('carpoolModal');
    renderCarpoolTags('carpoolModalTags', [], () => { });
}

function openMiddayModal() {
    const user = getUser();
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'occupied');
    if (!spot) { showToast('warn', 'לא בוצע צ\'ק-אין', 'עליך להיות מחובר לחניה לפני יציאת אמצע היום.'); return; }
    openModal('middayModal');
}

function showOfferBanner(spot) {
    const banner = document.getElementById('offerBanner');
    const text = document.getElementById('offerText');
    if (banner) { banner.classList.remove('hidden'); }
    if (text) { text.innerHTML = `Spot #${spot.num} is available. You have <span id="offerCountdown" class="bold" style="color:var(--accent-yellow)">${STATE.offerWindow}:00</span> to accept.`; }
}

function hideOfferBanner() {
    const banner = document.getElementById('offerBanner');
    if (banner) banner.classList.add('hidden');
}

function showOfferModal(spot) {
    const content = document.getElementById('offerModalContent');
    if (content) content.innerHTML = `<div style="font-size:32px">🅿️</div><div><strong style="display:block;font-size:18px">Spot #${spot.num}</strong><span style="color:var(--text-secondary);font-size:13px">Near entrance • ${spot.isCarpool ? 'Carpool priority' : 'Regular spot'}</span></div>`;
    openModal('offerModal');
}

function updateOfferCountdowns() {
    const m = Math.floor(OFFER_SECONDS / 60);
    const s = (OFFER_SECONDS % 60).toString().padStart(2, '0');
    const txt = `${m}:${s}`;
    ['offerCountdown', 'offerModalTimer'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.textContent = txt; el.style.color = OFFER_SECONDS < 60 ? 'var(--accent-red)' : 'var(--accent-yellow)'; }
    });
}

function simulateGeoCheck() {
    const el = document.getElementById('geoStatusText');
    if (!el) return;
    el.textContent = 'מאתר מיקום...';
    setTimeout(() => {
        const pass = Math.random() > 0.3;
        el.textContent = pass ? '✅ בתוך 500 מטרים מהחניון' : '❌ מחוץ לטווח (אות חלש)';
        el.style.color = pass ? 'var(--accent-green)' : 'var(--accent-red)';
        if (pass) showToast('success', '📍 המיקום אומת', 'אתה בטווח החניון.', '3000');
        else showToast('warn', '📡 מחוץ לטווח', 'התקרב למתקן או סרוק את קוד ה-QR.', '3000');
    }, 1500);
}

let geoOn = true, qrOn = false;
function toggleGeo() { geoOn = !geoOn; document.getElementById('geoToggle').classList.toggle('on', geoOn); }
function toggleQR() { qrOn = !qrOn; document.getElementById('qrToggle').classList.toggle('on', qrOn); }

// ── Sidebar Menu ───────────────────────────────────────────────
function toggleMenu(forceState) {
    const menuTabs = document.getElementById('mainTabs');
    const backdrop = document.getElementById('menuBackdrop');

    if (menuTabs && backdrop) {
        if (typeof forceState === 'boolean') {
            menuTabs.classList.toggle('open', forceState);
            backdrop.classList.toggle('open', forceState);
        } else {
            menuTabs.classList.toggle('open');
            backdrop.classList.toggle('open');
        }
    }
}

// ── Theme Toggle (Phase 2) ─────────────────────────────────────
function toggleTheme() {
    const isLight = document.body.classList.toggle('light-theme');
    localStorage.setItem('parkiq_theme', isLight ? 'light' : 'dark');
    updateThemeUI(isLight);
}

function updateThemeUI(isLight) {
    const btn = document.getElementById('themeToggleBtn');
    if (btn) {
        if (isLight) btn.classList.add('on');
        else btn.classList.remove('on');
    }
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = isLight ? '☀️' : '🌙';
}

function initTheme() {
    const saved = localStorage.getItem('parkiq_theme');
    if (saved === 'light') {
        document.body.classList.add('light-theme');
        updateThemeUI(true);
    } else {
        updateThemeUI(false);
    }
}

// ── Confetti Celebration (Phase 3) ──────────────────────────────
function triggerConfetti() {
    if (typeof confetti !== 'undefined') {
        const duration = 2000;
        const end = Date.now() + duration;

        (function frame() {
            confetti({
                particleCount: 5,
                angle: 60,
                spread: 55,
                origin: { x: 0 },
                colors: ['#00d4ff', '#10b981', '#f59e0b']
            });
            confetti({
                particleCount: 5,
                angle: 120,
                spread: 55,
                origin: { x: 1 },
                colors: ['#00d4ff', '#10b981', '#f59e0b']
            });

            if (Date.now() < end) {
                requestAnimationFrame(frame);
            }
        }());
    }
}

