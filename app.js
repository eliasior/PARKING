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
    { id: 'u1', name: 'Alex Cohen', tier: 3, email: 'alex@corp.com', noShows: 0, waitHistory: 2, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null },
    { id: 'u2', name: 'Maya Levi', tier: 4, email: 'maya@corp.com', noShows: 1, waitHistory: 0, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null },
    { id: 'u3', name: 'Yoni Shapiro', tier: 2, email: 'yoni@corp.com', noShows: 3, waitHistory: 5, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 1, banned: true, banEnds: Date.now() + 86400000 },
    { id: 'u4', name: 'Dana Mizrahi', tier: 5, email: 'dana@corp.com', noShows: 0, waitHistory: 1, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null },
    { id: 'u5', name: 'Rotem Bar', tier: 1, email: 'rotem@corp.com', noShows: 2, waitHistory: 3, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null },
    { id: 'u6', name: 'Noa Peretz', tier: 3, email: 'noa@corp.com', noShows: 0, waitHistory: 4, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null },
    { id: 'u7', name: 'Tal Katz', tier: 2, email: 'tal@corp.com', noShows: 1, waitHistory: 0, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null },
    { id: 'u8', name: 'Ilan Gross', tier: 4, email: 'ilan@corp.com', noShows: 0, waitHistory: 2, carpoolWith: [], graceUsedToday: false, graceUsedWeek: 0, banned: false, banEnds: null },
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
            showToast('error', '🚫 Booking Blocked', `You are banned for ${hrs}h due to repeated no-shows.`);
            return;
        } else { user.banned = false; }
    }

    const dateVal = document.getElementById('bookingDate').value;
    const timeVal = document.getElementById('bookingTime').value;
    const carpools = getCarpoolTagIds();

    if (!dateVal) { showToast('warn', '⚠️ Missing Date', 'Please select a date.'); return; }

    const carpoolVerified = carpools.length > 0;
    const score = calcPriority(user, carpools.length);

    // Check available spots
    const freeSpots = SPOTS.filter(s => s.state === 'available' && !s.isVIP);
    const carpoolFreeSpots = freeSpots.filter(s => s.isCarpool);
    const regularFreeSpots = freeSpots.filter(s => !s.isCarpool);

    const existingBooking = BOOKINGS.find(b => b.userId === user.id && b.date === dateVal && b.status !== 'cancelled');
    if (existingBooking) {
        showToast('warn', 'Already Booked', `You have an active booking for ${dateVal}.`); return;
    }

    // Try to assign a spot
    let assignedSpot = null;
    if (carpoolVerified && carpoolFreeSpots.length > 0) {
        assignedSpot = carpoolFreeSpots[0];
        showToast('success', '⭐ Carpool Priority!', 'You got a premium near-elevator spot!');
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

    BOOKINGS.push(booking);

    if (assignedSpot) {
        transitionSpot(assignedSpot, 'reserved', user.id);
        showToast('success', '✅ Spot Reserved!', `Spot #${assignedSpot.num} is reserved for you. Check in within ${STATE.gracePeriod} min of your arrival time.`);
        addNotif('success', 'Booking Confirmed', `Spot #${assignedSpot.num} reserved for ${dateVal} at ${timeVal}`);
    } else {
        const pos = addToWaitlist(user, score, carpools.length);
        booking.waitlistPos = pos;
        showToast('warn', '📋 Added to Waitlist', `No spots available. You're #${pos} in queue (score: ${score.toFixed(1)}).`);
        addNotif('warn', 'Waitlisted', `Position #${pos} for ${dateVal}. You'll be notified when a spot opens.`);
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
    showToast('warn', '⏱ Spot Released', `Spot #${spot.num} auto-released (${reason}). Notifying waitlist...`);
    if (userId === STATE.currentUserId) addNotif('error', 'Spot Released', `Your spot #${spot.num} was auto-released (${reason}).`);
    setTimeout(() => notifyNextInWaitlist(spot), 500);
    renderAll();
}

function applyPenalty(user) {
    if (user.noShows === 1) {
        addNotif('warn', '⚠️ No-Show Warning', `First no-show recorded. Future violations reduce your priority score.`);
        showToast('warn', '⚠️ No-Show Warning', `Warning: 1st no-show recorded for ${user.name}`);
    } else if (user.noShows === 2) {
        addNotif('error', '❌ Priority Penalty', `Second no-show! Your priority score reduced by 5 pts.`);
        showToast('error', '❌ Priority Penalized', `${user.name} score reduced (2nd no-show).`);
    } else if (user.noShows >= 3) {
        user.banned = true;
        user.banEnds = Date.now() + 48 * 3600000;
        addNotif('error', '🚫 Banned 48h', `Third no-show. Booking suspended for 48 hours.`);
        showToast('error', '🚫 Booking Suspended', `${user.name} banned 48h for repeated no-shows.`);
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
    addNotif('success', '🎉 Spot Available!', `Spot #${spot.num} is available. Accept within ${STATE.offerWindow} min!`);

    if (next.userId === STATE.currentUserId) {
        showOfferBanner(spot);
        showOfferModal(spot);
    } else {
        showToast('info', '📢 Offer Sent', `Spot #${spot.num} offered to ${u?.name}. Waiting for response...`);
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
        addNotif('warn', 'Offer Expired', `Offer for ${u?.name} expired. Moving to next in queue.`);
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
    showToast('success', '✅ Spot Accepted!', `Spot #${spot.num} is now yours! Check in within ${STATE.gracePeriod} min.`);
    addNotif('success', 'Spot Confirmed', `Spot #${spot.num} allocated from waitlist.`);
    renderAll();
}

function declineOffer() {
    clearInterval(OFFER_TIMER_ID);
    const spot = SPOTS.find(s => s.id === OFFER_SPOT_ID);
    WAITLIST.shift();
    hideOfferBanner();
    closeModal('offerModal');
    showToast('info', 'Offer Declined', 'Notifying next in queue...');
    setTimeout(() => notifyNextInWaitlist(spot), 800);
    renderAll();
}

function simulateSpotRelease() {
    const occupied = SPOTS.find(s => s.state === 'occupied' || s.state === 'reserved');
    if (occupied) {
        autoReleaseSpot(occupied, 'user_cancelled');
    } else {
        showToast('info', 'No Occupied Spots', 'All spots are already free or no bookings today.');
    }
}

// ── Check-In ───────────────────────────────────────────────────
function doCheckIn() {
    const user = getUser();
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'reserved');
    if (!spot) { showToast('warn', 'No Reservation', 'No reserved spot found for today.'); return; }
    clearGraceTimerForSpot(spot);
    transitionSpot(spot, 'occupied', user.id);
    const bk = BOOKINGS.find(b => b.spotId === spot.id && b.userId === user.id && b.status === 'reserved');
    if (bk) bk.status = 'occupied';
    showToast('success', '✅ Checked In!', `You're checked in to spot #${spot.num}. Have a great day!`);
    addNotif('success', 'Check-In Confirmed', `Spot #${spot.num} — active session started.`);
    renderAll();
}

// ── Grace Extension ────────────────────────────────────────────
function requestGraceExtension() {
    const user = getUser();
    if (user.graceUsedToday) {
        showToast('warn', 'Limit Reached', 'You already used your grace extension today.'); return;
    }
    if (user.graceUsedWeek >= 1) {
        showToast('warn', 'Weekly Limit', 'You already used your weekly grace extension.'); return;
    }
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'reserved');
    if (!spot) { showToast('warn', 'No Reservation', 'No active reservation to extend.'); return; }
    clearGraceTimerForSpot(spot);
    const extMs = STATE.trafficExtension * 60 * 1000;
    graceTimers[spot.id] = setTimeout(() => {
        if (spot.state === 'reserved') autoReleaseSpot(spot, 'grace_expired_extended');
    }, extMs);
    user.graceUsedToday = true;
    user.graceUsedWeek++;
    showToast('success', `⏱ +${STATE.trafficExtension} Min Grace`, `Extension granted. Report to vehicle immediately!`);
    addNotif('info', 'Grace Extended', `Traffic extension applied (+${STATE.trafficExtension} min). Used: 1/day, ${user.graceUsedWeek}/week`);
    renderAll();
}

// ── Midday Exit ────────────────────────────────────────────────
function submitMiddayExit() {
    const type = document.getElementById('departureType').value;
    const user = getUser();
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'occupied');
    if (!spot) { showToast('warn', 'Not Checked In', 'You must be checked in first.'); closeModal('middayModal'); return; }
    if (type === 'permanent') {
        transitionSpot(spot, 'available');
        const bk = BOOKINGS.find(b => b.spotId === spot.id && b.userId === user.id && b.status === 'occupied');
        if (bk) bk.status = 'completed';
        showToast('info', '🚪 Day Ended', 'Spot released. See you next time!');
        addNotif('info', 'Session Ended', `Spot #${spot.num} returned to pool.`);
        setTimeout(() => notifyNextInWaitlist(spot), 500);
    } else {
        const returnTime = document.getElementById('returnTime').value;
        spot.state = 'temp-away';
        spot.tempReturnTime = returnTime;
        const maxMs = STATE.middayMax * 3600000;
        spot.tempTimer = setTimeout(() => {
            if (spot.state === 'temp-away') {
                autoReleaseSpot(spot, 'midday_timeout');
                addNotif('error', 'Midday Timeout', `Max away time (${STATE.middayMax}h) exceeded. Spot released.`);
            }
        }, maxMs);
        showToast('warn', '⏸ Spot On Hold', `Spot #${spot.num} held. Return by ${returnTime} (max ${STATE.middayMax}h).`);
        addNotif('warn', 'Temporary Departure', `Spot #${spot.num} on hold until ${returnTime}.`);
    }
    closeModal('middayModal');
    renderAll();
}

function returnFromMidday() {
    const user = getUser();
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'temp-away');
    if (!spot) { showToast('info', 'Back!', 'Spot status already updated.'); return; }
    clearTimeout(spot.tempTimer);
    spot.state = 'occupied';
    showToast('success', 'Welcome Back!', `Spot #${spot.num} is active again.`);
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
    showToast('success', '🚗 Carpool Registered!', `Group of ${user.carpoolWith.length + 1} registered. Priority boost applied!`);
    addNotif('success', 'Carpool Group Set', `${user.carpoolWith.length} partner(s) added. Score +${(3 * user.carpoolWith.length).toFixed(1)} pts`);
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
    showToast('success', '✅ Capacity Updated', `${newCap} total spots. ${vip} VIP, ${cp} carpool-priority.`);
    addNotif('info', 'Capacity Changed', `Admins set capacity to ${newCap} spots.`);
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
    showToast('success', '✅ Rules Saved', 'System rules updated and active immediately.');
    addNotif('info', 'Rules Updated', 'Admin updated system configuration.');
    renderAll();
}

function adminClearPenalty(uid) {
    const u = getUserById(uid);
    if (!u) return;
    u.noShows = 0; u.banned = false; u.banEnds = null;
    showToast('success', 'Penalty Cleared', `${u.name}'s record cleared by admin.`);
    addNotif('info', 'Admin Override', `${u.name}'s no-show record cleared.`);
    renderAll();
}

function adminForceBook(uid) {
    const u = getUserById(uid);
    if (!u) return;
    const free = SPOTS.find(s => s.state === 'available' && !s.isVIP);
    if (!free) { showToast('warn', 'No Spots', 'No available spots to force-assign.'); return; }
    transitionSpot(free, 'reserved', uid);
    BOOKINGS.push({ id: `B${Date.now()}`, userId: uid, date: today(), time: '09:00', spotId: free.id, status: 'reserved', carpoolWith: [], noShow: false, createdAt: Date.now(), forceBooked: true });
    showToast('success', 'Force-Booked', `Spot #${free.num} assigned to ${u.name} by admin.`);
    addNotif('info', 'Admin Force-Book', `Spot #${free.num} → ${u.name}`);
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
}

function openNotifPanel() {
    STATE.notifCount = 0;
    const badge = document.getElementById('notifBadge');
    if (badge) badge.textContent = '0';
    renderNotifList();
    openModal('notifModal');
}

function renderNotifList() {
    const el = document.getElementById('notifList');
    if (!el) return;
    if (!STATE.notifications.length) {
        el.innerHTML = '<div class="empty-state"><span class="empty-ico">🔕</span><p>No notifications yet.</p></div>'; return;
    }
    const icons = { success: '✅', warn: '⚠️', error: '❌', info: 'ℹ️' };
    el.innerHTML = STATE.notifications.slice(0, 20).map(n => `
    <div class="toast ${n.type}" style="animation:none">
      <span class="toast-icon">${icons[n.type] || '🔔'}</span>
      <div class="toast-body"><strong>${n.title}</strong><p>${n.msg}</p></div>
      <span style="font-size:10px;color:var(--text-muted);white-space:nowrap">${n.time}</span>
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

function openCarpoolModal() {
    carpoolModal_tags = [];
    populateCarpoolSelects();
    openModal('carpoolModal');
    renderCarpoolTags('carpoolModalTags', [], () => { });
}

function openMiddayModal() {
    const user = getUser();
    const spot = SPOTS.find(s => s.userId === user.id && s.state === 'occupied');
    if (!spot) { showToast('warn', 'Not Checked In', 'Check in first before marking a midday exit.'); return; }
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
    el.textContent = 'Locating...';
    setTimeout(() => {
        const pass = Math.random() > 0.3;
        el.textContent = pass ? '✅ Within 500m of parking facility' : '❌ Out of range (GPS weak)';
        el.style.color = pass ? 'var(--accent-green)' : 'var(--accent-red)';
        if (pass) showToast('success', '📍 Location Verified', 'You are within the parking geofence.', '3000');
        else showToast('warn', '📡 Out of Range', 'Move closer to the facility or use QR code.', '3000');
    }, 1500);
}

let geoOn = true, qrOn = false;
function toggleGeo() { geoOn = !geoOn; document.getElementById('geoToggle').classList.toggle('on', geoOn); }
function toggleQR() { qrOn = !qrOn; document.getElementById('qrToggle').classList.toggle('on', qrOn); }

