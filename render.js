/* ============================================================
   ParkIQ — render.js  All render functions & initialization
   ============================================================ */

function populateUserSelector() {
    const sel = document.getElementById('userSelector');
    if (!sel) return;
    sel.innerHTML = USERS.map(u =>
        '<option value="' + u.id + '"' + (u.id === STATE.currentUserId ? ' selected' : '') + '>' +
        u.name + ' (Tier ' + u.tier + ')</option>'
    ).join('');
}

function populateCarpoolSelects() {
    const others = USERS.filter(u => u.id !== STATE.currentUserId);
    const opts = '<option value="">Select colleague...</option>' +
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
            badgeEl.innerHTML = '<span class="badge badge-banned">Booking Suspended</span>';
        } else if (!bk) {
            badgeEl.innerHTML = '<span class="badge badge-available">No Booking Today</span>';
        } else if (bk.status === 'occupied') {
            badgeEl.innerHTML = '<span class="badge badge-occupied">Checked In</span>';
        } else if (bk.status === 'reserved') {
            badgeEl.innerHTML = '<span class="badge badge-reserved">Reserved</span>';
        } else if (bk.status === 'waitlist') {
            badgeEl.innerHTML = '<span class="badge badge-waitlist">Waitlisted</span>';
        } else {
            badgeEl.innerHTML = '<span class="badge badge-available">Completed</span>';
        }
    }

    const statsEl = document.getElementById('empStatCards');
    if (statsEl) {
        const score = calcPriority(user, user.carpoolWith.length).toFixed(1);
        const wlPos = WAITLIST.findIndex(function (e) { return e.userId === user.id; });
        const avail = SPOTS.filter(function (s) { return s.state === 'available' && !s.isVIP; }).length;
        const scoreColor = avail > 5 ? 'green' : avail > 2 ? 'yellow' : 'red';
        const nsColor = user.noShows === 0 ? 'green' : user.noShows === 1 ? 'yellow' : 'red';
        statsEl.innerHTML =
            '<div class="card"><div class="card-header"><span class="card-title">Priority Score</span><span class="card-icon">🎯</span></div>' +
            '<div class="stat-value cyan">' + score + '</div><div class="stat-label">Your allocation score</div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">Available Spots</span><span class="card-icon">🅿️</span></div>' +
            '<div class="stat-value ' + scoreColor + '">' + avail + '</div><div class="stat-label">of ' + (STATE.capacity - STATE.vipSpots) + ' total</div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">Queue Position</span><span class="card-icon">📍</span></div>' +
            '<div class="stat-value yellow">' + (wlPos >= 0 ? '#' + (wlPos + 1) : '—') + '</div><div class="stat-label">' + (wlPos >= 0 ? 'In waitlist' : 'Not in queue') + '</div></div>' +
            '<div class="card"><div class="card-header"><span class="card-title">No-Shows</span><span class="card-icon">⚠️</span></div>' +
            '<div class="stat-value ' + nsColor + '">' + user.noShows + '</div><div class="stat-label">this month</div></div>';
    }

    const statusEl = document.getElementById('todayStatusContent');
    if (statusEl) {
        const bk = getUserBookingToday(user.id);
        const spot = bk && bk.spotId ? SPOTS.find(function (s) { return s.id === bk.spotId; }) : null;

        if (!bk) {
            statusEl.innerHTML =
                '<div class="empty-state"><span class="empty-ico">🅿️</span><p>No booking for today.</p>' +
                '<button class="btn btn-primary mt-16" onclick="switchView(\'booking\')">Book Now</button></div>';
        } else if (bk.status === 'reserved' && spot) {
            const elapsed = Math.floor((Date.now() - (spot.reservedAt || Date.now())) / 60000);
            const remaining = Math.max(0, STATE.gracePeriod - elapsed);
            const pct = Math.max(0, (remaining / STATE.gracePeriod) * 100);
            const barColor = remaining > 10 ? 'green' : remaining > 5 ? 'yellow' : 'red';
            statusEl.innerHTML =
                '<div class="flex-center gap-16" style="flex-direction:column;padding:16px 0">' +
                '<div style="width:90px;height:90px;background:var(--gradient-main);border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:var(--shadow-glow)">' +
                '<span style="font-size:28px">🅿️</span><span style="font-size:20px;font-weight:900;color:#fff">' + spot.num + '</span></div>' +
                '<div class="text-center"><strong style="font-size:18px">Spot #' + spot.num + ' Reserved</strong>' +
                '<p class="text-sm mt-8">Arrival: ' + bk.time + ' — Grace: ' + remaining + ' min left</p></div>' +
                '<div class="progress-bar-wrap w-full" style="height:10px"><div class="progress-bar-fill ' + barColor + '" style="width:' + pct + '%"></div></div>' +
                '<button class="btn btn-success w-full btn-xl" onclick="doCheckIn()">✅ Check In Now</button>' +
                '</div>';
        } else if (bk.status === 'occupied' && spot) {
            statusEl.innerHTML =
                '<div class="flex-center gap-16" style="flex-direction:column;padding:16px 0">' +
                '<div style="width:90px;height:90px;background:var(--gradient-green);border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 0 30px rgba(16,185,129,.4)">' +
                '<span style="font-size:28px">✅</span><span style="font-size:20px;font-weight:900;color:#fff">' + spot.num + '</span></div>' +
                '<div class="text-center"><strong style="font-size:18px;color:var(--accent-green)">Checked In — Spot #' + spot.num + '</strong>' +
                '<p class="text-sm mt-8">Session active. Have a great day!</p></div>' +
                '<button class="btn btn-warn w-full" onclick="openMiddayModal()">Midday Exit</button>' +
                '</div>';
        } else if (bk.status === 'waitlist') {
            const wPos = WAITLIST.findIndex(function (e) { return e.userId === user.id; }) + 1;
            statusEl.innerHTML =
                '<div class="flex-center gap-16" style="flex-direction:column;padding:16px 0">' +
                '<div style="width:90px;height:90px;background:var(--gradient-warn);border-radius:20px;display:flex;flex-direction:column;align-items:center;justify-content:center">' +
                '<span style="font-size:28px">⏳</span><span style="font-size:20px;font-weight:900;color:#fff">#' + (wPos || '?') + '</span></div>' +
                '<div class="text-center"><strong style="font-size:18px">Queue Position #' + (wPos || '?') + '</strong>' +
                '<p class="text-sm mt-8">Score: ' + ((bk.score || 0).toFixed(1)) + ' — You\'ll be notified when a spot opens.</p></div>' +
                '</div>';
        } else {
            statusEl.innerHTML = '<div class="empty-state"><span class="empty-ico">🏁</span><p>Day complete. See you tomorrow!</p></div>';
        }
    }

    const penEl = document.getElementById('penaltyContent');
    if (penEl) {
        const lvl = user.noShows;
        const lvlLabel = lvl === 0 ? 'Clean Record' : lvl === 1 ? 'Warning Issued' : lvl === 2 ? 'Score Penalized' : 'Suspended';
        const lvlDesc = lvl === 0 ? 'No violations — keep it up!' :
            lvl === 1 ? '1st warning. Next violation reduces your score.' :
                lvl === 2 ? 'Score reduced. One more no-show = 48h ban.' :
                    'Banned until: ' + new Date(user.banEnds || Date.now()).toLocaleString();
        penEl.innerHTML =
            '<div class="flex-between mb-12">' +
            '<div><strong>Violation Level: ' + lvlLabel + '</strong>' +
            '<p class="text-xs mt-8">' + lvlDesc + '</p></div>' +
            '<div class="penalty-meter">' +
            '<div class="penalty-dot ' + (lvl >= 1 ? 'warn' : '') + '"></div>' +
            '<div class="penalty-dot ' + (lvl >= 3 ? 'active' : lvl >= 2 ? 'active' : lvl >= 1 ? 'warn' : '') + '"></div>' +
            '<div class="penalty-dot ' + (lvl >= 3 ? 'active' : '') + '"></div>' +
            '</div></div>' +
            (lvl > 0 ? '<button class="btn btn-ghost" style="font-size:12px" onclick="showToast(\'info\',\'Contact Admin\',\'Ask your parking admin to review your record.\')">Request Review</button>' : '');
    }
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
    const el = document.getElementById('availPreview');
    if (!el) return;
    const avail = SPOTS.filter(function (s) { return s.state === 'available' && !s.isVIP; }).length;
    const res = SPOTS.filter(function (s) { return s.state === 'reserved'; }).length;
    const occ = SPOTS.filter(function (s) { return s.state === 'occupied'; }).length;
    const total = STATE.capacity - STATE.vipSpots;
    const pct = total > 0 ? Math.round(((res + occ) / total) * 100) : 0;
    const fillColor = pct < 70 ? 'green' : pct < 90 ? 'yellow' : 'red';
    el.innerHTML =
        '<div class="flex-between mb-12">' +
        '<div class="text-center"><div class="stat-value green" style="font-size:28px">' + avail + '</div><div class="stat-label">Available</div></div>' +
        '<div class="text-center"><div class="stat-value cyan" style="font-size:28px">' + res + '</div><div class="stat-label">Reserved</div></div>' +
        '<div class="text-center"><div class="stat-value red" style="font-size:28px">' + occ + '</div><div class="stat-label">Occupied</div></div>' +
        '<div class="text-center"><div class="stat-value yellow" style="font-size:28px">' + WAITLIST.length + '</div><div class="stat-label">Waitlist</div></div>' +
        '</div>' +
        '<div class="progress-bar-wrap" style="height:12px"><div class="progress-bar-fill ' + fillColor + '" style="width:' + pct + '%"></div></div>' +
        '<p class="text-xs mt-8 text-center">' + pct + '% occupied (' + (res + occ) + '/' + total + ' spots)</p>';
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
        '<div class="info-row"><span class="label">Org Tier (' + user.tier + ' x 1.0)</span><span class="value bold" style="color:var(--accent-green)">+' + (1.0 * user.tier).toFixed(1) + '</span></div>' +
        '<div class="info-row"><span class="label">Carpool (' + cp + ' x 3.0)</span><span class="value bold" style="color:#a78bfa">+' + (3.0 * cp).toFixed(1) + '</span></div>' +
        '<div class="info-row"><span class="label">No-Shows (' + user.noShows + ' x 2.5)</span><span class="value bold" style="color:var(--accent-red)">-' + (2.5 * user.noShows).toFixed(1) + '</span></div>' +
        '<div class="info-row"><span class="label">Wait History (' + user.waitHistory + 'd x 0.8)</span><span class="value bold" style="color:var(--accent-yellow)">+' + (0.8 * user.waitHistory).toFixed(1) + '</span></div>';
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
        el.innerHTML = '<div class="empty-state"><span class="empty-ico">🚫</span><p>No active reservation to check in.</p>' +
            '<button class="btn btn-primary mt-16" onclick="switchView(\'booking\')">Book a Spot</button></div>';
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
            '<div><h2 style="font-size:22px;font-weight:800">Spot #' + spot.num + ' Awaiting You</h2>' +
            '<p class="text-sm mt-8">Grace period: <strong style="color:var(--accent-' + barColor + ')">' + remaining + ' min left</strong></p></div>' +
            '<div class="w-full"><div class="progress-bar-wrap" style="height:10px"><div class="progress-bar-fill ' + barColor + '" style="width:' + pct + '%"></div></div></div>' +
            '<button class="btn btn-success btn-xl" onclick="doCheckIn()">✅ I\'ve Arrived — Check In</button>' +
            '<div class="grid-2 w-full gap-8">' +
            '<button class="btn btn-warn" onclick="requestGraceExtension()">Traffic +' + STATE.trafficExtension + 'min</button>' +
            '<button class="btn btn-danger" onclick="cancelBooking()">Cancel Spot</button>' +
            '</div>' +
            '</div>';
    } else if (spot.state === 'occupied') {
        el.innerHTML =
            '<div class="checkin-hero">' +
            '<div class="spot-badge-xl" style="background:var(--gradient-green);box-shadow:0 0 40px rgba(16,185,129,.4)">' +
            '<span class="spot-icon">✅</span><span class="spot-num-xl">' + spot.num + '</span></div>' +
            '<div class="text-center"><h2 style="font-size:22px;color:var(--accent-green)">Checked In!</h2>' +
            '<p class="text-sm mt-8">Spot #' + spot.num + ' is actively in use.</p></div>' +
            '<div class="grid-2 w-full gap-8">' +
            '<button class="btn btn-warn w-full" onclick="openMiddayModal()">Midday Exit</button>' +
            '<button class="btn btn-ghost w-full" onclick="returnFromMidday()">Mark Return</button>' +
            '</div>' +
            '</div>';
    } else {
        el.innerHTML =
            '<div class="checkin-hero">' +
            '<div class="spot-badge-xl" style="background:var(--gradient-warn);box-shadow:0 0 40px rgba(245,158,11,.4)">' +
            '<span class="spot-icon">⏸</span><span class="spot-num-xl">' + spot.num + '</span></div>' +
            '<div class="text-center"><h2 style="font-size:22px;color:var(--accent-yellow)">Temporarily Away</h2>' +
            '<p class="text-sm mt-8">Return by ' + (spot.tempReturnTime || '--') + ' (max ' + STATE.middayMax + 'h away)</p></div>' +
            '<button class="btn btn-success btn-xl" onclick="returnFromMidday()">Im Back!</button>' +
            '</div>';
    }
}

function cancelBooking() {
    const user = getUser();
    const spot = SPOTS.find(function (s) { return s.userId === user.id && s.state === 'reserved'; });
    if (!spot) { showToast('warn', 'No Reservation', 'Nothing to cancel.'); return; }
    autoReleaseSpot(spot, 'user_cancelled');
    renderAll();
}

/* ── Waitlist View ─────────────────────────────────────────── */
function renderWaitlist() {
    const qEl = document.getElementById('waitlistQueue');
    const myEl = document.getElementById('myQueueStatus');
    const user = getUser();
    const myPos = WAITLIST.findIndex(function (e) { return e.userId === user.id; });

    if (qEl) {
        if (!WAITLIST.length) {
            qEl.innerHTML = '<div class="empty-state"><span class="empty-ico">🎉</span><p>Waitlist is empty — spots available!</p></div>';
        } else {
            qEl.innerHTML = WAITLIST.map(function (e, i) {
                const u = getUserById(e.userId);
                const isMe = e.userId === user.id;
                return '<div class="queue-item' + (isMe ? ' my-item' : '') + '">' +
                    '<div class="queue-pos' + (isMe ? ' my-pos' : '') + '">' + (i + 1) + '</div>' +
                    '<div class="queue-name"><strong>' + (u ? u.name : 'Unknown') + (isMe ? ' (You)' : '') + '</strong>' +
                    '<small>Score: ' + ((e.score || 0).toFixed(2)) + ' — Tier ' + (u ? u.tier : '?') + ' — No-shows: ' + (u ? u.noShows : 0) + '</small></div>' +
                    '<div class="queue-score">' +
                    (e.offerExpiry ? '<span style="color:var(--accent-yellow)">Offer active</span>' : '<span class="badge badge-waitlist">Waiting</span>') +
                    '</div></div>';
            }).join('');
        }
    }

    if (myEl) {
        if (myPos < 0) {
            const bk = getUserBookingToday(user.id);
            if (bk && bk.status === 'reserved') {
                myEl.innerHTML = '<div class="text-center" style="padding:20px"><span style="font-size:40px;display:block;margin-bottom:12px">✅</span>' +
                    '<strong>You have a spot!</strong><p class="text-sm mt-8">Spot ' + (bk.spotId || '') + ' reserved.</p></div>';
            } else {
                myEl.innerHTML = '<div class="empty-state"><span class="empty-ico">📋</span><p>Not in waitlist. Book a spot first.</p>' +
                    '<button class="btn btn-primary mt-16" onclick="switchView(\'booking\')">Book Now</button></div>';
            }
        } else {
            const bk = getUserBookingToday(user.id);
            const posMsg = myPos === 0 ? 'You are next! Watch for the offer notification.' :
                myPos <= 3 ? (myPos + ' person(s) ahead of you.') :
                    (myPos + ' people ahead. Add carpool partners to boost score!');
            myEl.innerHTML =
                '<div class="text-center" style="padding:20px">' +
                '<div style="width:80px;height:80px;background:var(--gradient-purple);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:900;color:#fff;margin:0 auto 16px">' +
                '#' + (myPos + 1) + '</div>' +
                '<strong style="font-size:20px">Queue Position #' + (myPos + 1) + '</strong>' +
                '<p class="text-sm mt-8">Priority Score: <strong style="color:var(--accent-cyan)">' +
                ((bk && bk.score) ? bk.score.toFixed(2) : calcPriority(user).toFixed(2)) + '</strong></p>' +
                '<p class="text-xs mt-8">' + posMsg + '</p>' +
                '</div>';
        }
    }
}

/* ── Admin View ──────────────────────────────────────────────── */
function renderAdmin() {
    renderAdminStats();
    renderSpotGrid();
    renderUserTable();
}

function renderAdminStats() {
    const el = document.getElementById('adminStatCards');
    if (!el) return;
    const avail = SPOTS.filter(function (s) { return s.state === 'available'; }).length;
    const res = SPOTS.filter(function (s) { return s.state === 'reserved'; }).length;
    const occ = SPOTS.filter(function (s) { return s.state === 'occupied'; }).length;
    const temp = SPOTS.filter(function (s) { return s.state === 'temp-away'; }).length;
    el.innerHTML =
        '<div class="card"><div class="card-header"><span class="card-title">Available</span><span class="card-icon">🟢</span></div><div class="stat-value green">' + avail + '</div><div class="stat-label">ready spots</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">Reserved</span><span class="card-icon">🔵</span></div><div class="stat-value cyan">' + res + '</div><div class="stat-label">pending check-in</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">Occupied</span><span class="card-icon">🔴</span></div><div class="stat-value red">' + occ + '</div><div class="stat-label">in use now</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">Temp Away</span><span class="card-icon">🟡</span></div><div class="stat-value yellow">' + temp + '</div><div class="stat-label">midday exits</div></div>';
}

function renderSpotGrid() {
    const el = document.getElementById('adminSpotGrid');
    if (!el) return;
    el.innerHTML = SPOTS.map(function (s) {
        const u = s.userId ? getUserById(s.userId) : null;
        const icons = { available: '🟢', reserved: '🔵', occupied: '🔴', 'temp-away': '⏸' };
        const ic = icons[s.state] || '⬜';
        const tip = (u ? u.name : 'Empty') + ' | ' + s.state + (s.isCarpool ? ' | Carpool' : '') + (s.isVIP ? ' | VIP' : '');
        return '<div class="spot-cell ' + s.state + '" title="' + tip + '">' +
            '<span class="spot-num">' + s.num + '</span>' +
            '<span class="spot-ico">' + ic + '</span></div>';
    }).join('');
}

function renderUserTable() {
    const el = document.getElementById('userTableBody');
    if (!el) return;
    el.innerHTML = USERS.map(function (u) {
        const score = calcPriority(u, u.carpoolWith.length).toFixed(2);
        const bk = getUserBookingToday(u.id);
        var statusHtml;
        if (u.banned) {
            statusHtml = '<span class="badge badge-banned">Banned</span>';
        } else if (!bk) {
            statusHtml = '<span class="badge badge-available">No booking</span>';
        } else {
            var cls = bk.status === 'occupied' ? 'occupied' : bk.status === 'reserved' ? 'reserved' : bk.status === 'waitlist' ? 'waitlist' : 'available';
            statusHtml = '<span class="badge badge-' + cls + '">' + bk.status + '</span>';
        }
        var nsHtml = u.noShows === 0 ? '<span style="color:var(--accent-green)">0</span>' :
            '<span style="color:' + (u.noShows >= 3 ? 'var(--accent-red)' : 'var(--accent-yellow)') + '">' + u.noShows + '</span>';
        return '<tr>' +
            '<td><strong>' + u.name + '</strong><div class="text-xs">' + u.email + '</div></td>' +
            '<td><strong>' + u.tier + '</strong></td>' +
            '<td class="bold">' + score + '</td>' +
            '<td>' + nsHtml + '</td>' +
            '<td>' + statusHtml + '</td>' +
            '<td><div style="display:flex;gap:6px">' +
            '<button class="btn btn-ghost" style="padding:5px 10px;font-size:11px" onclick="adminClearPenalty(\'' + u.id + '\')">Clear Penalty</button>' +
            '<button class="btn btn-primary" style="padding:5px 10px;font-size:11px" onclick="adminForceBook(\'' + u.id + '\')">Force Book</button>' +
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
        '<div class="card"><div class="card-header"><span class="card-title">Avg Occupancy</span><span class="card-icon">📊</span></div><div class="stat-value cyan">' + avg + '%</div><div class="stat-label">7-day average</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">Total No-Shows</span><span class="card-icon">❌</span></div><div class="stat-value red">' + ns + '</div><div class="stat-label">all-time total</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">Available Now</span><span class="card-icon">🅿️</span></div><div class="stat-value green">' + avail + '</div><div class="stat-label">spots free</div></div>' +
        '<div class="card"><div class="card-header"><span class="card-title">Waitlist</span><span class="card-icon">⏳</span></div><div class="stat-value yellow">' + WAITLIST.length + '</div><div class="stat-label">employees waiting</div></div>';
}

function renderOccupancyChart() {
    const canvas = document.getElementById('occupancyChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const weeks = ['W1', 'W2', 'W3', 'W4'];
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
            html += '<div class="heatmap-cell" style="background:' + heatColor(v) + ';color:#fff" title="' + v + '% occupied">' + v + '%</div>';
        });
    });
    html += '</div><div class="flex gap-16 mt-12" style="font-size:12px;color:var(--text-secondary)">' +
        '<span>🟢 Low (&lt;50%)</span><span>🟡 Medium (50-75%)</span><span>🔴 High (&gt;75%)</span></div>';
    el.innerHTML = html;
}

function renderNoShowTable() {
    const el = document.getElementById('noshowTableBody');
    if (!el) return;
    const sorted = USERS.filter(function (u) { return u.noShows > 0; })
        .sort(function (a, b) { return b.noShows - a.noShows; });
    if (!sorted.length) {
        el.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted)">🎉 No violations recorded!</td></tr>';
        return;
    }
    const penLabels = ['', 'Warning', 'Score Reduced', 'Banned'];
    el.innerHTML = sorted.map(function (u, i) {
        return '<tr><td class="bold">#' + (i + 1) + '</td>' +
            '<td><strong>' + u.name + '</strong><div class="text-xs">' + u.email + '</div></td>' +
            '<td><span style="color:' + (u.noShows >= 3 ? 'var(--accent-red)' : 'var(--accent-yellow)') + '">' + u.noShows + '</span></td>' +
            '<td>' + u.noShows + '</td>' +
            '<td>' + (penLabels[Math.min(u.noShows, 3)] || '—') + '</td>' +
            '<td style="color:var(--accent-red)">-' + (2.5 * u.noShows).toFixed(1) + ' pts</td></tr>';
    }).join('');
}

/* ══════════════════════════════════════════════════════════════
   INITIALIZATION
   ══════════════════════════════════════════════════════════════ */
function init() {
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
            if (view) switchView(view);
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

    // Welcome toast
    setTimeout(function () {
        addNotif('success', 'Welcome to ParkIQ!', 'Smart parking is active. Switch users via the top-right dropdown to simulate different scenarios.');
        showToast('success', 'ParkIQ Ready!', 'Select a user from the top-right dropdown to get started.');
    }, 900);
}

document.addEventListener('DOMContentLoaded', init);
