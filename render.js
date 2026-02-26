/* ============================================================
   ParkIQ — render.js  All render functions & initialization
   ============================================================ */

function populateUserSelector() {
    // Disabled: User is now natively authenticated 
    // const sel = document.getElementById('userSelector');
    // if (!sel) return;
    // sel.innerHTML = USERS...
}

function populateCarpoolSelects() {
    const others = USERS.filter(u => u.id !== STATE.currentUserId);
    const opts = '<option value="">בחר קולגה...</option>' +
        others.map(u => '<option value="' + u.id + '">' + u.name + '</option>').join('');
    ['carpoolSelect', 'carpoolModalSelect'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.innerHTML = opts;
    });
}

function renderAll() {
    renderEmployee();
    const active = document.querySelector('.view.active');
    if (!active) return;
    const name = active.id.replace('view-', '');
    if (name === 'booking') renderBookingView();
    if (name === 'checkin') renderCheckin();
    if (name === 'waitlist') renderWaitlist();
    if (name === 'admin') renderAdmin();
    if (name === 'analytics') renderAnalytics();
    populateCarpoolSelects();
}

/* ── Employee View ─────────────────────────────────────────── */
function renderEmployee() {
    const user = getUser();
    if (!user) return;

    const nameEl = document.getElementById('empName');
    if (nameEl) nameEl.textContent = user.name.split(' ')[0];

    const dateEl = document.getElementById('todayDate');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const badgeEl = document.getElementById('empStatusBadge');
    if (badgeEl) {
        const bk = getUserBookingToday(user.id);
        if (user.banned) {
            badgeEl.innerHTML = '<span class="badge badge-banned">הזמנות מושעות</span>';
        } else if (!bk) {
            badgeEl.innerHTML = '<span class="badge badge-available">אין חניה היום</span>';
        } else if (bk.status === 'occupied') {
            badgeEl.innerHTML = '<span class="badge badge-occupied">צ\'ק-אין פעיל</span>';
        } else if (bk.status === 'reserved') {
            badgeEl.innerHTML = '<span class="badge badge-reserved">שמור</span>';
        } else if (bk.status === 'waitlist') {
            badgeEl.innerHTML = '<span class="badge badge-waitlist">רשימת המתנה</span>';
        } else {
            badgeEl.innerHTML = '<span class="badge badge-available">הושלם</span>';
        }
    }

    const statsEl = document.getElementById('empStatCards');
    if (statsEl) {
        const score = calcPriority(user, (user.carpoolWith || []).length).toFixed(1);
        const wlPos = WAITLIST.findIndex(function (e) { return e.userId === user.id; });
        const avail = SPOTS.filter(function (s) { return s.state === 'available' && !s.isVIP; }).length;
        const scoreColor = avail > 5 ? 'green' : avail > 2 ? 'yellow' : 'red';
        const nsColor = user.noShows === 0 ? 'green' : user.noShows === 1 ? 'yellow' : 'red';
        statsEl.innerHTML =
            '<div class="card"><div class="card-header"><span class="card-title">ציון תעדוף</span><span class="card-icon">🎯</span></div>' +
            '<div class="stat-value cyan">' + score + '</div><div class="stat-label">ציון הקצאה נוכחי</div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">חניות פנויות</span><span class="card-icon">🅿️</span></div>' +
            '<div class="stat-value ' + scoreColor + '">' + avail + '</div><div class="stat-label">מתוך ' + (STATE.capacity - STATE.vipSpots) + ' סה"כ</div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">מיקום בתור</span><span class="card-icon">📍</span></div>' +
            '<div class="stat-value yellow">' + (wlPos >= 0 ? '#' + (wlPos + 1) : '—') + '</div><div class="stat-label">' + (wlPos >= 0 ? 'ברשימת המתנה' : 'לא ברשימה') + '</div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">אי-הגעה</span><span class="card-icon">⚠️</span></div>' +
            '<div class="stat-value ' + nsColor + '">' + user.noShows + '</div><div class="stat-label">החודש</div></div>';
    }

    const statusEl = document.getElementById('todayStatusContent');
    if (statusEl) {
        const bk = getUserBookingToday(user.id);
        const spot = bk && bk.spotId ? SPOTS.find(function (s) { return s.id === bk.spotId; }) : null;

        if (!bk) {
            statusEl.innerHTML =
                '<div class="empty-state"><span class="empty-ico">🅿️</span><p>אין הזמנה להיום.</p>' +
                '<button class="btn btn-primary mt-16" onclick="switchView(\'booking\')">הזמן עכשיו</button></div>';
        } else if (bk.status === 'reserved' && spot) {
            const elapsed = Math.floor((Date.now() - (spot.reservedAt || Date.now())) / 60000);
            const remaining = Math.max(0, STATE.gracePeriod - elapsed);
            const pct = Math.max(0, (remaining / STATE.gracePeriod) * 100);
            const barColor = remaining > 10 ? 'green' : remaining > 5 ? 'yellow' : 'red';
            statusEl.innerHTML =
                '<div class="flex-center gap-16" style="flex-direction:column;padding:16px 0">' +
                '<div style="width:90px;height:90px;background:var(--gradient-main);border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:var(--shadow-glow)">' +
                '<span style="font-size:28px">🅿️</span><span style="font-size:20px;font-weight:900;color:#fff">' + spot.num + '</span></div>' +
                '<div class="text-center"><strong style="font-size:18px">חניה #' + spot.num + ' שמורה</strong>' +
                '<p class="text-sm mt-8">הגעה: ' + bk.time + ' — חסד: נותרו ' + remaining + ' דקות</p></div>' +
                '<div class="progress-bar-wrap w-full" style="height:10px"><div class="progress-bar-fill ' + barColor + '" style="width:' + pct + '%"></div></div>' +
                '<button class="btn btn-success w-full btn-xl" onclick="doCheckIn()">✅ צ\'ק אין עכשיו</button>' +
                '</div>';
        } else if (bk.status === 'occupied' && spot) {
            statusEl.innerHTML =
                '<div class="flex-center gap-16" style="flex-direction:column;padding:16px 0">' +
                '<div style="width:90px;height:90px;background:var(--gradient-green);border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 0 30px rgba(16,185,129,.4)">' +
                '<span style="font-size:28px">✅</span><span style="font-size:20px;font-weight:900;color:#fff">' + spot.num + '</span></div>' +
                '<div class="text-center"><strong style="font-size:18px;color:var(--accent-green)">מחובר — חניה #' + spot.num + '</strong>' +
                '<p class="text-sm mt-8">סשן חניה פעיל. יום מקסים!</p></div>' +
                '<button class="btn btn-warn w-full" onclick="openMiddayModal()">יציאה באמצע היום</button>' +
                '</div>';
        } else if (bk.status === 'waitlist') {
            const wPos = WAITLIST.findIndex(function (e) { return e.userId === user.id; }) + 1;
            statusEl.innerHTML =
                '<div class="flex-center gap-16" style="flex-direction:column;padding:16px 0">' +
                '<div style="width:90px;height:90px;background:var(--gradient-warn);border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center">' +
                '<span style="font-size:28px">⏳</span><span style="font-size:20px;font-weight:900;color:#fff">#' + (wPos || '?') + '</span></div>' +
                '<div class="text-center"><strong style="font-size:18px">מיקום בתור הגלובאלי #' + (wPos || '?') + '</strong>' +
                '<p class="text-sm mt-8">ציון: ' + ((bk.score || 0).toFixed(1)) + ' — תקבל התראה כשחניה תתפנה.</p></div>' +
                '</div>';
        } else {
            statusEl.innerHTML = '<div class="empty-state"><span class="empty-ico">🏁</span><p>היום הושלם. נתראה מחר!</p></div>';
        }
    }

    const penEl = document.getElementById('penaltyContent');
    if (penEl) {
        const lvl = user.noShows;
        const lvlLabel = lvl === 0 ? 'רקורד נקי' : lvl === 1 ? 'אזהרה הונפקה' : lvl === 2 ? 'ציון תעדוף הופחת' : 'השעיה למערכת';
        const lvlDesc = lvl === 0 ? 'ללא עבירות — המשך כך!' :
            lvl === 1 ? 'אזהרה ראשונה. העבירה הבאה תפגע בציון שלך.' :
                lvl === 2 ? 'ציון הופחת. אי-הגעה נוספת = השעיה ל-48 שעות.' :
                    'מושעה עד: ' + new Date(user.banEnds || Date.now()).toLocaleString('he-IL');
        penEl.innerHTML =
            '<div class="flex-between mb-12">' +
            '<div><strong>רמת ענישה: ' + lvlLabel + '</strong>' +
            '<p class="text-xs mt-8">' + lvlDesc + '</p></div>' +
            '<div class="penalty-meter">' +
            '<div class="penalty-dot ' + (lvl >= 1 ? 'warn' : '') + '"></div>' +
            '<div class="penalty-dot ' + (lvl >= 3 ? 'active' : lvl >= 2 ? 'active' : lvl >= 1 ? 'warn' : '') + '"></div>' +
            '<div class="penalty-dot ' + (lvl >= 3 ? 'active' : '') + '"></div>' +
            '</div></div>' +
            (lvl > 0 ? '<button class="btn btn-ghost" style="font-size:12px" onclick="showToast(\'info\',\'בקשת ערעור\',\'פנה למנהל הרכב במשרד לבירור הרישום שלך.\')">בקש ערעור</button>' : '');
    }

    // Phase 2: Render Eco Leaderboard
    renderEcoLeaderboard();
}

function renderEcoLeaderboard() {
    const el = document.getElementById('ecoLeaderboardContent');
    if (!el) return;

    // Sort users by ecoPoints (descending) and get top 3
    const sorted = [...USERS].sort((a, b) => (b.ecoPoints || 0) - (a.ecoPoints || 0)).slice(0, 3);

    let html = '';
    const medals = ['🥇', '🥈', '🥉'];

    sorted.forEach((u, i) => {
        const isMe = u.id === getUser().id;
        html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border-radius:var(--radius-md);background:' + (isMe ? 'rgba(16,185,129,0.1)' : 'var(--bg-glass)') + ';border:1px solid ' + (isMe ? 'rgba(16,185,129,0.3)' : 'var(--border)') + ';">' +
            '<div style="display:flex;align-items:center;gap:12px;">' +
            '<span style="font-size:20px;">' + medals[i] + '</span>' +
            '<div><strong style="display:block;font-size:14px;color:var(--text-primary)">' + u.name + (isMe ? ' (אתה)' : '') + '</strong>' +
            '<span style="font-size:12px;color:var(--text-muted)">דרגה ' + u.tier + '</span></div>' +
            '</div>' +
            '<div style="text-align:right;">' +
            '<strong style="color:var(--accent-green);font-size:16px;">' + (u.ecoPoints || 0) + '</strong>' +
            '<span style="display:block;font-size:10px;text-transform:uppercase;color:var(--text-muted)">נקודות</span>' +
            '</div>' +
            '</div>';
    });

    el.innerHTML = html;
}

/* ── Booking View ──────────────────────────────────────────── */
function renderBookingView() {
    const dateEl = document.getElementById('bookingDate');
    if (dateEl && !dateEl.value) { dateEl.value = today(); dateEl.min = today(); }
    renderAvailabilityPreview();
    renderPriorityBreakdown();
    populateCarpoolSelects();
}

function renderAvailabilityPreview() {
    renderParkingMap('availPreview');
}

function renderPriorityBreakdown() {
    const el = document.getElementById('priorityBreakdown');
    if (!el) return;
    const user = getUser();
    const cp = getCarpoolTagIds().length;
    const score = calcPriority(user, cp);
    el.innerHTML =
        '<div style="font-family:monospace;background:var(--bg-glass);border:1px solid var(--border);border-radius:var(--radius-md);padding:14px;margin-bottom:14px;font-size:13px;line-height:1.8">' +
        '<span style="color:var(--accent-cyan)">P(' + user.name.split(' ')[0] + ') = </span>' +
        '<span style="color:var(--accent-green)">' + (1.0 * user.tier).toFixed(1) + '</span> + ' +
        '<span style="color:#a78bfa">' + (3.0 * cp).toFixed(1) + '</span> - ' +
        '<span style="color:var(--accent-red)">' + (2.5 * user.noShows).toFixed(1) + '</span> + ' +
        '<span style="color:var(--accent-yellow)">' + (0.8 * user.waitHistory).toFixed(1) + '</span>' +
        ' = <strong style="color:#fff;font-size:16px"> ' + score.toFixed(2) + '</strong>' +
        '</div>' +
        '<div class="info-row"><span class="label">דרגת ארגון (' + user.tier + ' x 1.0)</span><span class="value bold" style="color:var(--accent-green)">+' + (1.0 * user.tier).toFixed(1) + '</span></div>' +
        '<div class="info-row"><span class="label">קארפול (' + cp + ' x 3.0)</span><span class="value bold" style="color:#a78bfa">+' + (3.0 * cp).toFixed(1) + '</span></div>' +
        '<div class="info-row"><span class="label">אי-הגעה (' + user.noShows + ' x 2.5)</span><span class="value bold" style="color:var(--accent-red)">-' + (2.5 * user.noShows).toFixed(1) + '</span></div>' +
        '<div class="info-row"><span class="label">היסטוריית המתנה (' + user.waitHistory + 'ימים x 0.8)</span><span class="value bold" style="color:var(--accent-yellow)">+' + (0.8 * user.waitHistory).toFixed(1) + '</span></div>';
}

/* ── Check-In View ─────────────────────────────────────────── */
function renderCheckin() {
    const el = document.getElementById('checkinContent');
    if (!el) return;
    const user = getUser();
    const spot = SPOTS.find(function (s) {
        return s.userId === user.id && (s.state === 'reserved' || s.state === 'occupied' || s.state === 'temp-away');
    });

    if (!spot) {
        el.innerHTML = '<div class="empty-state"><span class="empty-ico">🚫</span><p>אין חניה פעילה לעשות עליה צ\'ק-אין.</p>' +
            '<button class="btn btn-primary mt-16" onclick="switchView(\'booking\')">הזמן חניה</button></div>';
        return;
    }

    if (spot.state === 'reserved') {
        const elapsed = spot.reservedAt ? Math.floor((Date.now() - spot.reservedAt) / 60000) : 0;
        const remaining = Math.max(0, STATE.gracePeriod - elapsed);
        const pct = Math.max(0, (remaining / STATE.gracePeriod) * 100);
        const barColor = remaining > 10 ? 'green' : remaining > 5 ? 'yellow' : 'red';
        el.innerHTML =
            '<div class="checkin-hero">' +
            '<div class="spot-badge-xl"><span class="spot-icon">🅿️</span><span class="spot-num-xl">' + spot.num + '</span></div>' +
            '<div><h2 style="font-size:22px;font-weight:800">חניה #' + spot.num + ' ממתינה לך</h2>' +
            '<p class="text-sm mt-8">זמן חסד: <strong style="color:var(--accent-' + barColor + ')">נותרו ' + remaining + ' דקות</strong></p></div>' +
            '<div class="w-full"><div class="progress-bar-wrap" style="height:10px"><div class="progress-bar-fill ' + barColor + '" style="width:' + pct + '%"></div></div></div>' +

            // Magic Scanner Container
            '<div id="magicScannerWrap" style="width:100%;text-align:center;margin-top:8px;">' +
            '<button class="btn btn-success btn-xl" onclick="startMagicScan()">📷 פתח סורק חכם (QR/לוחית)</button>' +
            '</div>' +

            '<div class="grid-2 w-full gap-8 mt-16">' +
            '<button class="btn btn-warn" onclick="requestGraceExtension()">פקקים +' + STATE.trafficExtension + ' דק\'</button>' +
            '<button class="btn btn-danger" onclick="cancelBooking()">בטל חניה</button>' +
            '</div>' +
            '</div>';
    } else if (spot.state === 'occupied') {
        el.innerHTML =
            '<div class="checkin-hero">' +
            '<div class="spot-badge-xl" style="background:var(--gradient-green);box-shadow:0 0 40px rgba(16,185,129,.4)">' +
            '<span class="spot-icon">✅</span><span class="spot-num-xl">' + spot.num + '</span></div>' +
            '<div class="text-center"><h2 style="font-size:22px;color:var(--accent-green)">מחובר!</h2>' +
            '<p class="text-sm mt-8">חניה #' + spot.num + ' בשימושך כעת.</p></div>' +
            '<div class="grid-2 w-full gap-8">' +
            '<button class="btn btn-warn w-full" onclick="openMiddayModal()">יציאת אמצע היום</button>' +
            '<button class="btn btn-ghost w-full" onclick="returnFromMidday()">סמן חזרה</button>' +
            '</div>' +
            '</div>';
    } else {
        el.innerHTML =
            '<div class="checkin-hero">' +
            '<div class="spot-badge-xl" style="background:var(--gradient-warn);box-shadow:0 0 40px rgba(245,158,11,.4)">' +
            '<span class="spot-icon">⏸</span><span class="spot-num-xl">' + spot.num + '</span></div>' +
            '<div class="text-center"><h2 style="font-size:22px;color:var(--accent-yellow)">הפסקה זמנית</h2>' +
            '<p class="text-sm mt-8">חזור עד ' + (spot.tempReturnTime || '--') + ' (מקסימום ' + STATE.middayMax + ' שעות)</p></div>' +
            '<button class="btn btn-success btn-xl" onclick="returnFromMidday()">חזרתי לחניה!</button>' +
            '</div>';
    }
}

async function cancelBooking() {
    const user = getUser();
    const spot = SPOTS.find(function (s) { return s.userId === user.id && s.state === 'reserved'; });
    if (!spot) { showToast('warn', 'No Reservation', 'Nothing to cancel.'); return; }

    try {
        const token = localStorage.getItem('parkiq_token');
        const res = await fetch(`${API_URL}/spots/${spot.id}/cancel`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'שגיאת ביטול ה-Checkout');
        }
        showToast('info', 'ביטול בוצע', `ביטלת את החניה #${spot.num}.`);
        addNotif('info', 'השתחררה חניה', `ביטלת את החניה בהצלחה.`);
    } catch (err) {
        showToast('error', 'שגיאה', err.message);
    }
}

/* ── Waitlist View ─────────────────────────────────────────── */

// ── Magic Scanner Logic (Phase 2) ──────────────────────────────
function startMagicScan() {
    const wrap = document.getElementById('magicScannerWrap');
    if (!wrap) return;

    // Inject the scanning animation HTML
    wrap.innerHTML =
        '<div class="scanner-container scanning" id="scanBox">' +
        '<div class="scanner-laser"></div>' +
        '<div class="qr-dummy" style="background:var(--text-primary);mask-image:url(\'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path d=%22M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm15 0h3v3h-3zm-5 0h3v3h-3zm0 5h3v3h-3zm5 0h3v3h-3z%22/></svg>\');-webkit-mask-image:url(\'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path d=%22M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm15 0h3v3h-3zm-5 0h3v3h-3zm0 5h3v3h-3zm5 0h3v3h-3z%22/></svg>\');mask-size:cover;-webkit-mask-size:cover;"></div>' +
        '<div class="scanner-success-mark" id="scanSuccess">✅</div>' +
        '</div>' +
        '<p class="text-xs" style="color:var(--accent-cyan);margin-top:8px;" id="scanText">מאמת לוחית רישוי / קוד QR...</p>';

    // Play scanning sound simulation if we had audio, but visually wait 2.5s
    setTimeout(function () {
        const box = document.getElementById('scanBox');
        const txt = document.getElementById('scanText');
        if (box && txt) {
            box.classList.remove('scanning');
            box.classList.add('success');
            txt.innerText = 'זיהוי התאמה אושר!';
            txt.style.color = 'var(--accent-green)';

            // Wait a moment for success animation to finish, then actually check in
            setTimeout(function () {
                doCheckIn();
            }, 800);
        }
    }, 2500);
}

function renderWaitlist() {
    const qEl = document.getElementById('waitlistQueue');
    const myEl = document.getElementById('myQueueStatus');
    const user = getUser();
    const myPos = WAITLIST.findIndex(function (e) { return e.userId === user.id; });

    if (qEl) {
        if (!WAITLIST.length) {
            qEl.innerHTML = `
                <div class="empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-muted); background: rgba(16, 185, 129, 0.05); border-radius: 12px; border: 1px dashed rgba(16, 185, 129, 0.2);">
                    <div style="font-size: 44px; margin-bottom: 12px;">🎉</div>
                    <p style="font-size: 16px; font-weight: 600; color: var(--accent-green);">החניון פנוי לרווחה!</p>
                    <p style="font-size: 13px; opacity: 0.8; margin-top: 4px;">אין כרגע ממתינים בתור. זו הזדמנות מצוינת להזמין חניה.</p>
                </div>
            `;
        } else {
            qEl.innerHTML = WAITLIST.map(function (e, i) {
                const u = getUserById(e.userId);
                const isMe = e.userId === user.id;
                return '<div class="queue-item' + (isMe ? ' my-item' : '') + '">' +
                    '<div class="queue-pos' + (isMe ? ' my-pos' : '') + '">' + (i + 1) + '</div>' +
                    '<div class="queue-name"><strong>' + (u ? u.name : 'Unknown') + (isMe ? ' (את/ה)' : '') + '</strong>' +
                    '<small>ציון: ' + ((e.score || 0).toFixed(2)) + ' — דרגה ' + (u ? u.tier : '?') + ' — אי-הגעה: ' + (u ? u.noShows : 0) + '</small></div>' +
                    '<div class="queue-score">' +
                    (e.offerExpiry ? '<span style="color:var(--accent-yellow)">הצעה פעילה</span>' : '<span class="badge badge-waitlist">ממתין</span>') +
                    '</div></div>';
            }).join('');
        }
    }

    if (myEl) {
        if (myPos < 0) {
            const bk = getUserBookingToday(user.id);
            if (bk && bk.status === 'reserved') {
                myEl.innerHTML = '<div class="text-center" style="padding:20px"><span style="font-size:40px;display:block;margin-bottom:12px">✅</span>' +
                    '<strong>יש לך חניה!</strong><p class="text-sm mt-8">חניה ' + (bk.spotId || '') + ' שמורה עבורך.</p></div>';
            } else {
                myEl.innerHTML = `
                    <div class="empty-state" style="padding: 30px 20px; text-align: center; color: var(--text-muted);">
                        <div style="font-size: 40px; margin-bottom: 12px; opacity: 0.6;">📋</div>
                        <p style="font-size: 14px; font-weight: 500;">אינך רשום בתור להיום</p>
                        <p style="font-size: 12px; opacity: 0.7; margin-top: 4px; margin-bottom: 20px;">רוצה לשריין מקום? בדוק זמינות במערכת ההזמנות.</p>
                        <button class="btn btn-primary btn-sm" onclick="switchView('booking')" style="padding: 10px 20px;">הזמן חניה עכשיו</button>
                    </div>
                `;
            }
        } else {
            const bk = getUserBookingToday(user.id);
            const posMsg = myPos === 0 ? 'את/ה הבא בתור! חכה להתראת הצעת החניה.' :
                myPos <= 3 ? ('רק ' + myPos + ' אנשים לפניך.') :
                    (myPos + ' אנשים לפניך. הוסף שותפי נסיעה לקארפול כדי לקדם עדיפות!');
            myEl.innerHTML =
                '<div class="text-center" style="padding:20px">' +
                '<div style="width:80px;height:80px;background:var(--gradient-purple);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:#fff;margin:0 auto 16px">' +
                '#' + (myPos + 1) + '</div>' +
                '<strong style="font-size:20px">מיקומך בתור #' + (myPos + 1) + '</strong>' +
                '<p class="text-sm mt-8">ציון תעדוף נוכחי: <strong style="color:var(--accent-cyan)">' +
                ((bk && bk.score) ? bk.score.toFixed(2) : calcPriority(user).toFixed(2)) + '</strong></p>' +
                '<p class="text-xs mt-8">' + posMsg + '</p>' +
                '</div>';
        }
    }
}

/* ── Admin View ──────────────────────────────────────────────── */
function renderAdmin() {
    const adminPanel = document.getElementById('adminAddUserSection');
    if (adminPanel) {
        let userRole = 'user';
        try {
            const ls = localStorage.getItem('parkiq_user');
            if (ls) userRole = JSON.parse(ls).role;
        } catch (e) { }
        adminPanel.style.display = (userRole === 'admin') ? 'block' : 'none';
    }
    // Sync admin inputs to current configuration
    const capSlider = document.getElementById('capacitySlider');
    if (capSlider && STATE.capacity) capSlider.value = STATE.capacity;
    const dp = document.getElementById('capacityDisplay');
    if (dp && STATE.capacity) dp.innerHTML = STATE.capacity;

    const vipSp = document.getElementById('vipSpots');
    if (vipSp && typeof STATE.vipSpots !== 'undefined') vipSp.value = STATE.vipSpots;

    const cpSp = document.getElementById('carpoolSpots');
    if (cpSp && typeof STATE.carpoolSpots !== 'undefined') cpSp.value = STATE.carpoolSpots;

    const evSp = document.getElementById('evSpots');
    if (evSp && typeof STATE.evSpots !== 'undefined') evSp.value = STATE.evSpots;

    const gp = document.getElementById('gracePeriod');
    if (gp && STATE.gracePeriod) gp.value = STATE.gracePeriod;

    renderAdminStats();
    renderSpotGrid();
    renderUserTable();
    renderAdminLogs();
}

async function renderAdminLogs() {
    const el = document.getElementById('adminLogsBody');
    if (!el) return;

    // Call the global helper to fetch logs (we will add to app.js)
    const logs = await (typeof fetchAdminLogs === 'function' ? fetchAdminLogs() : Promise.resolve([]));

    if (!logs || logs.length === 0) {
        el.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:16px;">אין תיעוד במערכת</td></tr>';
        return;
    }

    el.innerHTML = logs.map(function (log) {
        const timeStr = new Date(log.timestamp).toLocaleString('he-IL');
        const nameStr = log.userName ? `<strong>${log.userName}</strong><br><small class="text-xs text-muted">${log.userId}</small>` : log.userId;
        return '<tr>' +
            '<td class="text-xs text-muted" style="white-space:nowrap;">' + timeStr + '</td>' +
            '<td>' + nameStr + '</td>' +
            '<td><span class="badge badge-waitlist">' + log.action + '</span></td>' +
            '<td class="text-sm">' + log.details + '</td>' +
            '</tr>';
    }).join('');
}

function renderAdminStats() {
    const el = document.getElementById('adminStatCards');
    if (!el) return;
    const avail = SPOTS.filter(function (s) { return s.state === 'available'; }).length;
    const res = SPOTS.filter(function (s) { return s.state === 'reserved'; }).length;
    const occ = SPOTS.filter(function (s) { return s.state === 'occupied'; }).length;
    const temp = SPOTS.filter(function (s) { return s.state === 'temp-away'; }).length;
    el.innerHTML =
        '<div class="card"><div class="card-header"><span class="card-title">פנוי</span><span class="card-icon">🟢</span></div><div class="stat-value green">' + avail + '</div><div class="stat-label">חניות זמינות</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">שמור</span><span class="card-icon">🔵</span></div><div class="stat-value cyan">' + res + '</div><div class="stat-label">ממתינים לצ\'ק-אין</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">תפוס</span><span class="card-icon">🔴</span></div><div class="stat-value red">' + occ + '</div><div class="stat-label">בשימוש כעת</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">יציאה זמנית</span><span class="card-icon">🟡</span></div><div class="stat-value yellow">' + temp + '</div><div class="stat-label">יציאות יומיומיות</div></div>';
}

function renderSpotGrid() {
    renderParkingMap('adminParkingMap');
}

function renderUserTable() {
    const el = document.getElementById('userTableBody');
    if (!el) return;
    el.innerHTML = USERS.map(function (u) {
        const score = calcPriority(u, (u.carpoolWith || []).length).toFixed(2);
        const bk = getUserBookingToday(u.id);
        var statusHtml;
        if (u.banned) {
            statusHtml = '<span class="badge badge-banned">מושעה</span>';
        } else if (!bk) {
            statusHtml = '<span class="badge badge-available">אין הזמנה</span>';
        } else {
            var cls = bk.status === 'occupied' ? 'occupied' : bk.status === 'reserved' ? 'reserved' : bk.status === 'waitlist' ? 'waitlist' : 'available';
            statusHtml = '<span class="badge badge-' + cls + '">' + bk.status + '</span>';
        }
        var nsHtml = u.noShows === 0 ? '<span style="color:var(--accent-green)">0</span>' :
            '<span style="color:' + (u.noShows >= 3 ? 'var(--accent-red)' : 'var(--accent-yellow)') + '">' + u.noShows + '</span>';
        var evtg = u.isEV ? ' <span style="font-size:10px;background:rgba(16,185,129,0.2);color:var(--accent-green);border-radius:4px;padding:2px 4px;">⚡ EV</span>' : '';
        return '<tr>' +
            '<td><strong>' + u.name + '</strong>' + evtg + '<div class="text-xs">' + u.email + '</div></td>' +
            '<td><strong>' + u.tier + '</strong></td>' +
            '<td class="bold">' + score + '</td>' +
            '<td>' + nsHtml + '</td>' +
            '<td>' + statusHtml + '</td>' +
            '<td><div style="display:flex;gap:6px">' +
            '<button class="btn btn-ghost" style="padding:5px 10px;font-size:11px" onclick="adminClearPenalty(\'' + u.id + '\')">נקה ענישה</button>' +
            '<button class="btn btn-primary" style="padding:5px 10px;font-size:11px" onclick="adminForceBook(\'' + u.id + '\')">הזמנת מנהל</button>' +
            '</div></td></tr>';
    }).join('');
}

/* ── Analytics View ──────────────────────────────────────────── */
function renderAnalytics() {
    renderAnalyticsStats();
    setTimeout(function () {
        renderOccupancyChart();
        renderNoShowChart();
    }, 50);
    renderHeatmap();
    renderNoShowTable();
}

function renderAnalyticsStats() {
    const el = document.getElementById('analyticsStats');
    if (!el) return;
    const avg = (HISTORY.weeklyOccupancy.reduce(function (a, b) { return a + b; }, 0) / 7).toFixed(1);
    const ns = USERS.reduce(function (a, u) { return a + u.noShows; }, 0);
    const avail = SPOTS.filter(function (s) { return s.state === 'available'; }).length;
    el.innerHTML =
        '<div class="card"><div class="card-header"><span class="card-title">ממוצע תפוסה</span><span class="card-icon">📊</span></div><div class="stat-value cyan">' + avg + '%</div><div class="stat-label">ממוצע 7 ימים</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">סה"כ אי-הגעה</span><span class="card-icon">❌</span></div><div class="stat-value red">' + ns + '</div><div class="stat-label">סה"כ כל הזמנים</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">פנוי עכשיו</span><span class="card-icon">🅿️</span></div><div class="stat-value green">' + avail + '</div><div class="stat-label">חניות ריקות</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">המתנה</span><span class="card-icon">⏳</span></div><div class="stat-value yellow">' + WAITLIST.length + '</div><div class="stat-label">עובדים ממתינים</div></div>';
}

function renderOccupancyChart() {
    const canvas = document.getElementById('occupancyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const labels = ['ב\'', 'ג\'', 'ד\'', 'ה\'', 'ו\'', 'ש\'', 'א\''];
    const data = HISTORY.weeklyOccupancy;
    const W = canvas.parentElement.clientWidth || 400;
    const H = 200;
    canvas.width = W; canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    const pad = { t: 24, r: 16, b: 36, l: 40 };
    const cW = W - pad.l - pad.r;
    const cH = H - pad.t - pad.b;
    const barW = cW / labels.length;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    [25, 50, 75, 100].forEach(function (v) {
        const y = pad.t + cH - (v / 100) * cH;
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + cW, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '10px Inter'; ctx.textAlign = 'right';
        ctx.fillText(v + '%', pad.l - 4, y + 3);
    });
    data.forEach(function (v, i) {
        const x = pad.l + i * barW + barW * 0.15;
        const bw = barW * 0.7;
        const h = (v / 100) * cH;
        const y = pad.t + cH - h;
        const grad = ctx.createLinearGradient(0, y, 0, y + h);
        grad.addColorStop(0, 'rgba(0,212,255,0.9)');
        grad.addColorStop(1, 'rgba(0,102,255,0.5)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, bw, h, 4);
        else ctx.rect(x, y, bw, h);
        ctx.fill();
        ctx.fillStyle = 'rgba(240,244,255,0.75)'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
        ctx.fillText(v + '%', x + bw / 2, y - 5);
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '11px Inter';
        ctx.fillText(labels[i], x + bw / 2, H - pad.b + 14);
    });
}

function renderNoShowChart() {
    const canvas = document.getElementById('noshowChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const labels = ['ב\'', 'ג\'', 'ד\'', 'ה\'', 'ו\'', 'ש\'', 'א\''];
    const data = HISTORY.noShowsWeek;
    const W = canvas.parentElement.clientWidth || 400;
    const H = 200;
    canvas.width = W; canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    const pad = { t: 24, r: 16, b: 36, l: 32 };
    const cW = W - pad.l - pad.r;
    const cH = H - pad.t - pad.b;
    const maxV = Math.max.apply(null, data) + 1;
    const pts = data.map(function (v, i) {
        return { x: pad.l + (i / (data.length - 1)) * cW, y: pad.t + cH - (v / maxV) * cH };
    });
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + cH);
    grad.addColorStop(0, 'rgba(239,68,68,0.3)');
    grad.addColorStop(1, 'rgba(239,68,68,0.0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.moveTo(pts[0].x, pad.t + cH);
    pts.forEach(function (p) { ctx.lineTo(p.x, p.y); });
    ctx.lineTo(pts[pts.length - 1].x, pad.t + cH); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(function (p, i) { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
    ctx.stroke();
    pts.forEach(function (p, i) {
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(240,244,255,0.8)'; ctx.font = '10px Inter'; ctx.textAlign = 'center';
        ctx.fillText(data[i], p.x, p.y - 9);
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '11px Inter';
        ctx.fillText(labels[i], p.x, H - pad.b + 14);
    });
}

function renderHeatmap() {
    const el = document.getElementById('heatmapContainer');
    if (!el) return;
    const days = ['ב\'', 'ג\'', 'ד\'', 'ה\'', 'ו\''];
    const weeks = ['שבוע 1', 'שבוע 2', 'שבוע 3', 'שבוע 4'];
    function heatColor(v) {
        if (v < 50) return 'rgba(16,185,129,' + (0.2 + v / 120) + ')';
        if (v < 75) return 'rgba(245,158,11,' + (0.3 + v / 250) + ')';
        return 'rgba(239,68,68,' + (0.3 + v / 250) + ')';
    }
    var html = '<div class="heatmap-grid"><div class="heatmap-label"></div>' +
        days.map(function (d) { return '<div class="heatmap-header">' + d + '</div>'; }).join('');
    HISTORY.heatmap.forEach(function (row, wi) {
        html += '<div class="heatmap-label">' + weeks[wi] + '</div>';
        row.forEach(function (v) {
            html += '<div class="heatmap-cell" style="background:' + heatColor(v) + ';color:#fff" title="' + v + '% תפוסה">' + v + '%</div>';
        });
    });
    html += '</div><div class="flex gap-16 mt-12" style="font-size:12px;color:var(--text-secondary)">' +
        '<span>🟢 נמוכה (&lt;50%)</span><span>🟡 בינונית (50-75%)</span><span>🔴 גבוהה (&gt;75%)</span></div>';
    el.innerHTML = html;
}

function renderNoShowTable() {
    const el = document.getElementById('noshowTableBody');
    if (!el) return;
    const sorted = USERS.filter(function (u) { return u.noShows > 0; })
        .sort(function (a, b) { return b.noShows - a.noShows; });
    if (!sorted.length) {
        el.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">🎉 לא נרשמו עבירות!</td></tr>';
        return;
    }
    const penLabels = ['', 'אזהרה', 'ציון הופחת', 'מושעה'];
    el.innerHTML = sorted.map(function (u, i) {
        return '<tr><td class="bold">#' + (i + 1) + '</td>' +
            '<td><strong>' + u.name + '</strong><div class="text-xs">' + u.email + '</div></td>' +
            '<td><span style="color:' + (u.noShows >= 3 ? 'var(--accent-red)' : 'var(--accent-yellow)') + '">' + u.noShows + '</span></td>' +
            '<td>' + u.noShows + '</td>' +
            '<td>' + (penLabels[Math.min(u.noShows, 3)] || '—') + '</td>' +
            '<td style="color:var(--accent-red)">-' + (2.5 * u.noShows).toFixed(1) + ' pts</td></tr>';
    }).join('');
}

function renderProfile() {
    const el = document.getElementById('profileMetricsGrid');
    if (!el) return;
    const user = getUser();
    if (!user) return;

    // Get 5 most recent bookings for the user
    const userHistory = BOOKINGS
        .filter(function (b) { return b.userId === user.id; })
        .sort(function (a, b) { return b.createdAt - a.createdAt; })
        .slice(0, 5);

    let historyHtml = userHistory.map(function (b) {
        let statusColor = 'var(--text-muted)';
        let statusHebrew = b.status;
        if (b.status === 'completed' || b.status === 'fulfilled' || b.status === 'occupied') {
            statusColor = 'var(--accent-green)';
            statusHebrew = 'מומשה';
        }
        if (b.status === 'cancelled') {
            statusColor = 'var(--accent-red)';
            statusHebrew = 'בוטלה';
        }
        if (b.status === 'reserved') statusHebrew = 'שמורה';
        if (b.status === 'waitlist') statusHebrew = 'בהמתנה';

        return '<div style="padding: 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">' +
            '<span style="font-weight: 500;">' + b.date + ' | ' + b.time + '</span>' +
            '<span class="status-pill" style="color: ' + statusColor + '; border: 1px solid ' + statusColor + '; background: transparent;">' + statusHebrew + '</span>' +
            '</div>';
    }).join('');

    if (!historyHtml) historyHtml = `
        <div class="empty-state" style="padding: 40px 20px; text-align: center; color: var(--text-muted);">
            <div style="font-size: 40px; margin-bottom: 12px; opacity: 0.5;">📅</div>
            <p style="font-size: 14px; font-weight: 500;">טרם בוצעו הזמנות</p>
            <p style="font-size: 12px; opacity: 0.7; margin-top: 4px;">ההיסטוריה שלך תופיע כאן לאחר שתשתמש בשירות.</p>
        </div>
    `;

    el.innerHTML =
        '<div class="stat-card" style="display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 24px;">' +
        '<div class="stat-title" style="font-size: 1.1rem; margin-bottom: 8px;">Eco-Points 🌱</div>' +
        '<div class="stat-value" style="color:var(--accent-green); font-size: 2.5rem;">' + (user.ecoPoints || 0) + '</div>' +
        '<div class="stat-desc" style="margin-top: 8px;">מדד אקולוגי למניעת זיהום אוויר ושמירה על סדר</div>' +
        '</div>' +
        '<div class="stat-card" style="display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 24px;">' +
        '<div class="stat-title" style="font-size: 1.1rem; margin-bottom: 8px;">עבירות (No-shows) ⚠️</div>' +
        '<div class="stat-value" style="color:' + (user.noShows > 0 ? 'var(--accent-red)' : 'var(--accent-cyan)') + '; font-size: 2.5rem;">' + (user.noShows || 0) + '</div>' +
        '<div class="stat-desc" style="margin-top: 8px;">אי-הגעה לאחר הזמנה ללא ביטול בזמן</div>' +
        '</div>' +
        '<div class="stat-card" style="display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 24px;">' +
        '<div class="stat-title" style="font-size: 1.1rem; margin-bottom: 8px;">ימי חסד (Grace) ⏳</div>' +
        '<div class="stat-value" style="font-size: 2.5rem;">' + (user.graceUsedWeek || 0) + ' <span style="font-size: 1.5rem; color: var(--text-muted);">/ 2</span></div>' +
        '<div class="stat-desc" style="margin-top: 8px;">ניצולת חסד שבועית לביטולי רגע-אחרון</div>' +
        '</div>' +
        '<div class="stat-card" style="grid-column: 1 / -1; margin-top: 16px;">' +
        '<div class="stat-title" style="margin-bottom: 16px; font-size: 1.1rem;">היסטוריית הזמנות 📋</div>' +
        '<div style="background: var(--surface-hover); border-radius: 8px; overflow: hidden; border: 1px solid var(--border);">' +
        historyHtml +
        '</div>' +
        '</div>';
}

/* ══════════════════════════════════════════════════════════════
   INITIALIZATION
   ══════════════════════════════════════════════════════════════ */
function init() {
    initTheme(); // Phase 2: Intialize Light/Dark Mode
    var d = today();

    // Seed demo data — some spots occupied/reserved
    var s3 = SPOTS[7]; s3.state = 'reserved'; s3.userId = 'u2'; s3.reservedAt = Date.now() - 5 * 60000;
    BOOKINGS.push({ id: 'B_d1', userId: 'u2', date: d, time: '08:30', spotId: s3.id, status: 'reserved', carpoolWith: [], score: calcPriority(USERS[1]), noShow: false, createdAt: Date.now() });

    var s4 = SPOTS[2]; s4.state = 'occupied'; s4.userId = 'u4'; s4.isCarpool = true;
    BOOKINGS.push({ id: 'B_d2', userId: 'u4', date: d, time: '08:00', spotId: s4.id, status: 'occupied', carpoolWith: ['u6'], carpoolVerified: true, score: calcPriority(USERS[3], 1), noShow: false, createdAt: Date.now() });

    var s5 = SPOTS[10]; s5.state = 'occupied'; s5.userId = 'u8';
    BOOKINGS.push({ id: 'B_d3', userId: 'u8', date: d, time: '09:00', spotId: s5.id, status: 'occupied', carpoolWith: [], score: calcPriority(USERS[7]), noShow: false, createdAt: Date.now() });

    // Seed waitlist
    WAITLIST.push({ userId: 'u5', score: calcPriority(USERS[4]), requestedAt: Date.now() - 8 * 60000, offerExpiry: null });
    WAITLIST.push({ userId: 'u7', score: calcPriority(USERS[6]), requestedAt: Date.now() - 3 * 60000, offerExpiry: null });
    WAITLIST.sort(function (a, b) { return b.score - a.score; });
    BOOKINGS.push({ id: 'B_d4', userId: 'u5', date: d, time: '09:00', spotId: null, status: 'waitlist', carpoolWith: [], score: WAITLIST[0].score, noShow: false, createdAt: Date.now() });
    BOOKINGS.push({ id: 'B_d5', userId: 'u7', date: d, time: '09:30', spotId: null, status: 'waitlist', carpoolWith: [], score: WAITLIST[1].score, noShow: false, createdAt: Date.now() });

    // Nav tab click events
    document.querySelectorAll('.nav-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            var view = tab.dataset.view;
            if (view) {
                switchView(view);
                if (typeof toggleMenu === 'function') toggleMenu(false);
            }
        });
    });

    // Set booking date
    var bd = document.getElementById('bookingDate');
    if (bd) { bd.value = d; bd.min = d; }

    populateUserSelector();
    populateCarpoolSelects();
    renderAll();

    // Background polling (30s)
    setInterval(function () {
        renderEmployee();
        var active = document.querySelector('.view.active');
        if (active) {
            var n = active.id.replace('view-', '');
            if (n === 'admin') renderAdmin();
            if (n === 'waitlist') renderWaitlist();
        }
    }, 30000);

    // Global UI Check-in (1s)
    setInterval(function () {
        if (typeof updateOfferCountdowns === 'function') {
            updateOfferCountdowns();
        }
    }, 1000);

    // Welcome toast
    setTimeout(function () {
        addNotif('success', 'ברוכים הבאים ל-ParkIQ!', 'מערכת ניהול חניות חכמה פעילה. החלף משתמשים דרך התפריט בפינה העליונה כדי לדמות תרחישים שונים.');
        showToast('success', 'מערכת ParkIQ מוכנה!', 'בחר משתמש מהרשימה הנפתחת בפינה העליונה כדי להתחיל.');
    }, 900);
}

// ── Shared Parking Map Renderer (Phase 2) ──────────────────────
function renderParkingMap(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    let html = '';

    SPOTS.forEach(function (spot) {
        let spotClass = 'spot-open';
        let icon = '';

        if (spot.state === 'occupied' || spot.state === 'reserved' || spot.state === 'temp-away') {
            spotClass = 'spot-occupied';
            icon = '🚗';
        } else if (spot.isVIP) {
            spotClass = 'spot-vip';
            icon = '👑';
        } else if (spot.isCarpool) {
            spotClass = 'spot-carpool';
            icon = '🤝';
        } else if (spot.isEV) {
            spotClass = 'spot-ev';
            icon = '⚡';
            const u = spot.userId ? getUserById(spot.userId) : null;
        }

        const u = spot.userId ? getUserById(spot.userId) : null;
        const stateHe = spot.state === 'available' ? 'פנוי' : spot.state === 'reserved' ? 'שמור' : spot.state === 'occupied' ? 'תפוס' : spot.state === 'temp-away' ? 'הפסקה' : spot.state;
        const tip = 'חניה ' + spot.num + (u ? ' | ' + u.name : '') + ' | ' + stateHe;

        html += '<div class="parking-spot ' + spotClass + '" title="' + tip + '">' +
            '<div class="spot-user-icon">' + icon + '</div>' +
            '<div>' + spot.num + '</div>' +
            '</div>';
    });

    el.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', async function () {
    initTheme();
    const isAuth = await checkAuth();
    if (isAuth) {
        init();
        document.getElementById('loginOverlay').classList.add('hidden');
    } else {
        document.getElementById('loginOverlay').classList.remove('hidden');
    }
});

// ── Analytics (Chart.js) ───────────────────────────────────────
let occChartInstance = null;
let noshowChartInstance = null;

function renderAnalytics() {
    // Top Stats
    const statsEl = document.getElementById('analyticsStats');
    if (statsEl) {
        statsEl.innerHTML = `
            <div class="card">
                <div class="card-title text-muted">סך חניות בחניון</div>
                <div class="stat-value cyan">${STATE.capacity || 0}</div>
            </div>
            <div class="card">
                <div class="card-title text-muted">ממוצע תפוסה יומי</div>
                <div class="stat-value green">82%</div>
            </div>
            <div class="card">
                <div class="card-title text-muted">בקשות פתוחות היום</div>
                <div class="stat-value yellow">${BOOKINGS.filter(b => b.date === new Date().toISOString().split('T')[0]).length || 0}</div>
            </div>
            <div class="card">
                <div class="card-title text-muted">אי-הגעה (חודשי)</div>
                <div class="stat-value red">${USERS.reduce((sum, u) => sum + (u.noShows || 0), 0)}</div>
            </div>
        `;
    }

    // Occupancy Chart
    const ctxOcc = document.getElementById('occupancyChart');
    if (ctxOcc) {
        if (occChartInstance) occChartInstance.destroy();
        occChartInstance = new Chart(ctxOcc, {
            type: 'line',
            data: {
                labels: ['א\'', 'ב\'', 'ג\'', 'ד\'', 'ה\''],
                datasets: [{
                    label: 'תפוסה באחוזים',
                    data: [72, 85, 91, 78, 63],
                    borderColor: '#00d4ff',
                    backgroundColor: 'rgba(0, 212, 255, 0.1)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, max: 100, ticks: { color: '#94a3b8' } },
                    x: { ticks: { color: '#94a3b8' } }
                },
                plugins: {
                    legend: { labels: { color: '#fff' } }
                }
            }
        });
    }

    // NoShow Chart
    const ctxNs = document.getElementById('noshowChart');
    if (ctxNs) {
        if (noshowChartInstance) noshowChartInstance.destroy();
        noshowChartInstance = new Chart(ctxNs, {
            type: 'bar',
            data: {
                labels: ['א\'', 'ב\'', 'ג\'', 'ד\'', 'ה\''],
                datasets: [{
                    label: 'אירועי אי-הגעה',
                    data: [2, 3, 1, 4, 1],
                    backgroundColor: '#ef4444',
                    borderRadius: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: { beginAtZero: true, suggestedMax: 5, ticks: { color: '#94a3b8', stepSize: 1 } },
                    x: { ticks: { color: '#94a3b8' } }
                },
                plugins: {
                    legend: { labels: { color: '#fff' } }
                }
            }
        });
    }
}
