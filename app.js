/* ============================================================
   ParkIQ — Smart Corporate Parking Management
   app.js  Part 1: Data Store, State Machine, Core Logic
   ============================================================ */

/* ============================================================
   Part 2: Render Functions, Charts & Initialization
   ============================================================ */

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
function submitBooking() {
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

    const booking = {
        id: `B${Date.now()}`,
        userId: user.id,
        date: dateVal,
        time: timeVal,
        spotId: assignedSpot ? assignedSpot.id : null,
        status: assignedSpot ? 'reserved' : 'waitlist',
        carpoolWith: carpools,
        carpoolVerified,
        score,
        noShow: false,
        createdAt: Date.now()
    };

    if (carpools.length > 0 && assignedSpot) {
        user.ecoPoints = (user.ecoPoints || 0) + (carpools.length * 50);
        setTimeout(() => showToast('success', '🌱 נקודות Eco הוענקו!', `קיבלת +${carpools.length * 50} נקודות Eco על נסיעה משותפת.`), 2000);
    }

    BOOKINGS.push(booking);

    if (assignedSpot) {
        transitionSpot(assignedSpot, 'reserved', user.id);
        showToast('success', '✅ חניה שמורה!', `חניה #${assignedSpot.num} שמורה עבורך. זכור לעשות צ'ק-אין תוך ${STATE.gracePeriod} דקות מזמן ההגעה.`);
        addNotif('success', 'הזמנה אושרה', `חניה #${assignedSpot.num} שמורה ל-${dateVal} בשעה ${timeVal}`);
        triggerConfetti(); // Phase 3: Celebrate!
    } else {
        const pos = addToWaitlist(user, score, carpools.length);
        booking.waitlistPos = pos;
        showToast('warn', '📋 נוספת לרשימת ההמתנה', `אין חניות פנויות. אתה בתור #${pos} (ציון: ${score.toFixed(1)}).`);
        addNotif('warn', 'רשימת המתנה', `מיקום #${pos} ל-${dateVal}. נודיע לך כשחניה תתפנה.`);
    }

    clearCarpoolTags();
    renderAll();
}

function addToWaitlist(user, score, carpoolCount) {
    const entry = { userId: user.id, score, requestedAt: Date.now(), offerExpiry: null };
    WAITLIST.push(entry);
    WAITLIST.sort((a, b) => b.score - a.score); // highest score first
    return WAITLIST.findIndex(e => e.userId === user.id) + 1;
}

// ── Grace Timer & Auto-Release ─────────────────────────────────
const graceTimers = {};

function startGraceTimer(spot) {
    clearGraceTimerForSpot(spot);
    const ms = STATE.gracePeriod * 60 * 1000;
    graceTimers[spot.id] = setTimeout(() => {
        if (spot.state === 'reserved') {
            autoReleaseSpot(spot, 'grace_expired');
        }
    }, ms);
}

function clearGraceTimerForSpot(spot) {
    if (graceTimers[spot.id]) {
        clearTimeout(graceTimers[spot.id]);
        delete graceTimers[spot.id];
    }
}

function autoReleaseSpot(spot, reason = 'manual') {
    const userId = spot.userId;
    transitionSpot(spot, 'available');
    // Mark booking
    const bk = BOOKINGS.find(b => b.spotId === spot.id && b.userId === userId && b.status === 'reserved');
    if (bk) {
        bk.status = 'cancelled';
        bk.noShow = true;
    }
    // Penalty
    if (userId && reason === 'grace_expired') {
        const u = getUserById(userId);
        if (u) {
            u.noShows++;
            applyPenalty(u);
        }
    }
    showToast('warn', '⏱ חניה שוחררה', `חניה #${spot.num} שוחררה אוטומטית. רשימת המתנה עודכנה.`);
    if (userId === STATE.currentUserId) addNotif('error', 'החניה שוחררה', `החניה שלך #${spot.num} שוחררה אוטומטית (זמן עבר).`);
    setTimeout(() => notifyNextInWaitlist(spot), 500);
    renderAll();
}

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

// ── Waitlist & Offer System ────────────────────────────────────
function notifyNextInWaitlist(spot) {
    if (!spot) spot = SPOTS.find(s => s.state === 'available' && !s.isVIP);
    if (!spot) return;
    if (WAITLIST.length === 0) return;

    const next = WAITLIST[0];
    OFFER_SPOT_ID = spot.id;
    OFFER_USER_ID = next.userId;
    OFFER_SECONDS = STATE.offerWindow * 60;
    next.offerExpiry = Date.now() + OFFER_SECONDS * 1000;

    const u = getUserById(next.userId);
    addNotif('success', '🎉 חניה התפנתה!', `חניה #${spot.num} פנויה. אשר תוך ${STATE.offerWindow} דקות!`);

    if (next.userId === STATE.currentUserId) {
        showOfferBanner(spot);
        showOfferModal(spot);
    } else {
        showToast('info', '📢 הצעה נשלחה', `חניה #${spot.num} הוצעה ל-${u?.name}. ממתין לתשובה...`);
    }

    clearInterval(OFFER_TIMER_ID);
    OFFER_TIMER_ID = setInterval(() => {
        OFFER_SECONDS--;
        updateOfferCountdowns();
        if (OFFER_SECONDS <= 0) {
            clearInterval(OFFER_TIMER_ID);
            expireOffer(spot);
        }
    }, 1000);

    renderAll();
}

function expireOffer(spot) {
    const expired = WAITLIST.shift();
    if (expired) {
        const u = getUserById(expired.userId);
        if (u) { /* record missed point – no direct penalty but tracked */ }
        addNotif('warn', 'ההצעה פגה', `ההצעה עבור ${u?.name} פגה. עוברים לבא בתור.`);
    }
    hideOfferBanner();
    closeModal('offerModal');
    setTimeout(() => notifyNextInWaitlist(spot), 800);
}

function acceptOffer() {
    clearInterval(OFFER_TIMER_ID);
    const spot = SPOTS.find(s => s.id === OFFER_SPOT_ID);
    const user = getUserById(OFFER_USER_ID);
    if (!spot || !user) return;

    WAITLIST.shift();
    transitionSpot(spot, 'reserved', user.id);
    const bk = BOOKINGS.find(b => b.userId === user.id && b.status === 'waitlist');
    if (bk) { bk.status = 'reserved'; bk.spotId = spot.id; }

    hideOfferBanner();
    closeModal('offerModal');
    showToast('success', '✅ החניה התקבלה!', `חניה #${spot.num} עכשיו שלך! אל תשכח צ'ק-אין תוך ${STATE.gracePeriod} דקות.`);
    addNotif('success', 'חניה אושרה', `חניה #${spot.num} הוקצתה מרשימת ההמתנה.`);
    renderAll();
}

function declineOffer() {
    clearInterval(OFFER_TIMER_ID);
    const spot = SPOTS.find(s => s.id === OFFER_SPOT_ID);
    WAITLIST.shift();
    hideOfferBanner();
    closeModal('offerModal');
    showToast('info', 'ההצעה נדחתה', 'מודיע לבא בתור...');
    setTimeout(() => notifyNextInWaitlist(spot), 800);
    renderAll();
}

function simulateSpotRelease() {
    const occupied = SPOTS.find(s => s.state === 'occupied' || s.state === 'reserved');
    if (occupied) {
        autoReleaseSpot(occupied, 'user_cancelled');
    } else {
        showToast('info', 'אין חניות תפוסות', 'כל החניות פנויות כרגע או שאין היום הזמנות.');
    }
}

// ── Check-In ───────────────────────────────────────────────────
function doCheckIn() {
    const user = getUser();
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'reserved');
    if (!spot) { showToast('warn', 'אין הזמנה', 'לא נמצאה חניה שמורה עבורך להיום.'); return; }
    clearGraceTimerForSpot(spot);
    transitionSpot(spot, 'occupied', user.id);
    const bk = BOOKINGS.find(b => b.spotId === spot.id && b.userId === user.id && b.status === 'reserved');
    if (bk) bk.status = 'occupied';
    showToast('success', '✅ בוצע צ\'ק-אין!', `עשית צ'ק-אין לחניה #${spot.num}. יום נפלא!`);
    addNotif('success', 'צ\'ק-אין אושר', `חניה #${spot.num} — סשן פעיל החל.`);
    renderAll();
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
function submitMiddayExit() {
    const type = document.getElementById('departureType').value;
    const user = getUser();
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'occupied');
    if (!spot) { showToast('warn', 'ללא צ\'ק-אין', 'עליך לעשות צ\'ק-אין לפני יציאה.'); closeModal('middayModal'); return; }
    if (type === 'permanent') {
        transitionSpot(spot, 'available');
        const bk = BOOKINGS.find(b => b.spotId === spot.id && b.userId === user.id && b.status === 'occupied');
        if (bk) bk.status = 'completed';
        showToast('info', '🚪 היום הסתיים', 'החניה שוחררה. נתראה בפעם הבאה!');
        addNotif('info', 'סשן הסתיים', `חניה #${spot.num} הוחזרה למאגר.`);
        setTimeout(() => notifyNextInWaitlist(spot), 500);
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
function updateCapacity(val) {
    document.getElementById('capacityDisplay').textContent = val;
}

function applyCapacityChanges() {
    const newCap = parseInt(document.getElementById('capacitySlider').value);
    const vip = parseInt(document.getElementById('vipSpots').value) || 0;
    const cp = parseInt(document.getElementById('carpoolSpots').value) || 0;
    STATE.capacity = newCap;
    STATE.vipSpots = vip;
    STATE.carpoolSpots = cp;
    SPOTS = buildSpots(newCap);
    showToast('success', '✅ הקיבולת עודכנה', `סך הכל ${newCap} חניות. מתוכן ${vip} VIP ו-${cp} למשותפות.`);
    addNotif('info', 'קיבולת שונתה', `מנהל מערכת עדכן קיבולת ל-${newCap} חניות.`);
    renderAll();
}

function updateVIPSpots(v) { STATE.vipSpots = parseInt(v) || 0; }
function updateCarpoolSpots(v) { STATE.carpoolSpots = parseInt(v) || 0; }
function updateGracePeriod(v) { STATE.gracePeriod = parseInt(v) || 20; }
function updateMiddayMax(v) { STATE.middayMax = parseInt(v) || 3; }

function saveRules() {
    STATE.gracePeriod = parseInt(document.getElementById('gracePeriod').value) || 20;
    STATE.middayMax = parseInt(document.getElementById('middayMax').value) || 3;
    STATE.offerWindow = parseInt(document.getElementById('offerWindow').value) || 10;
    STATE.trafficExtension = parseInt(document.getElementById('trafficExtension').value) || 15;
    STATE.bookingOpen = document.getElementById('bookingOpenTime').value;
    STATE.bookingClose = document.getElementById('bookingCloseTime').value;
    showToast('success', '✅ חוקים נשמרו', 'חוקי המערכת המעודכנים הופעלו מיידית.');
    addNotif('info', 'הגדרות עודכנו', 'מנהל מערכת ביצע שינוי בחוקי החניון.');
    renderAll();
}

function adminClearPenalty(uid) {
    const u = getUserById(uid);
    if (!u) return;
    u.noShows = 0; u.banned = false; u.banEnds = null;
    showToast('success', 'קנס בוטל', `היסטוריית אי-ההגעה של ${u.name} נוקתה.`);
    addNotif('info', 'עריכת מנהל', `בוטל רישום אי-הגעה עבור ${u.name}.`);
    renderAll();
}

function adminForceBook(uid) {
    const u = getUserById(uid);
    if (!u) return;
    const free = SPOTS.find(s => s.state === 'available' && !s.isVIP);
    if (!free) { showToast('warn', 'אין חניות פנויות', 'אין מספיק חניות בשביל להקצות בכוח.'); return; }
    transitionSpot(free, 'reserved', uid);
    BOOKINGS.push({ id: `B${Date.now()}`, userId: uid, date: today(), time: '09:00', spotId: free.id, status: 'reserved', carpoolWith: [], noShow: false, createdAt: Date.now(), forceBooked: true });
    showToast('success', 'הוקצה ידנית', `חניה #${free.num} הוקצתה ל-${u.name} על ימי מנהל.`);
    addNotif('info', 'הקצאה יזומה', `חניה #${free.num} ← ${u.name}`);
    renderAll();
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

