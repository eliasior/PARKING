const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const http = require('http'); // Added for Socket.io
const { Server } = require('socket.io'); // Added for Socket.io
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: '*' }
});

app.use(cors());
app.use(express.json());

// Serve static files from the parent directory
app.use(express.static(path.join(__dirname, '..')));

const PORT = 3000;
const SECRET_KEY = 'parkiq_secret_key_123'; // In production, use env var

// --- WebSockets ---
io.on('connection', (socket) => {
    console.log('A client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});
// Function to emit state updates to all clients
function broadcastUpdate() {
    io.emit('state_updated');
}

// Connect to SQLite DB
const db = new sqlite3.Database('./parkiq.db', (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDB();
    }
});

// Initialize Database Tables
function initDB() {
    db.serialize(() => {
        // Users Table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT,
            password TEXT,
            role TEXT DEFAULT 'user',
            tier INTEGER DEFAULT 3,
            noShows INTEGER DEFAULT 0,
            waitHistory INTEGER DEFAULT 0,
            graceUsedToday INTEGER DEFAULT 0,
            graceUsedWeek INTEGER DEFAULT 0,
            banned INTEGER DEFAULT 0, /* 0 = false, 1 = true */
            banEnds INTEGER DEFAULT NULL,
            ecoPoints INTEGER DEFAULT 0,
            isEV INTEGER DEFAULT 0
        )`);

        // Spots Table
        db.run(`CREATE TABLE IF NOT EXISTS spots (
            id TEXT PRIMARY KEY,
            num INTEGER,
            state TEXT DEFAULT 'available',
            userId TEXT,
            reservedAt INTEGER,
            expiresAt INTEGER, /* For persistent timers */
            isCarpool INTEGER DEFAULT 0,
            isVIP INTEGER DEFAULT 0,
            isEV INTEGER DEFAULT 0,
            tempReturnTime TEXT
        )`);

        // Bookings Table
        db.run(`CREATE TABLE IF NOT EXISTS bookings (
            id TEXT PRIMARY KEY,
            userId TEXT,
            date TEXT,
            time TEXT,
            spotId TEXT,
            status TEXT,
            carpoolWith TEXT, /* JSON array */
            carpoolVerified INTEGER DEFAULT 0,
            score REAL,
            noShow INTEGER DEFAULT 0,
            createdAt INTEGER,
            forceBooked INTEGER DEFAULT 0
        )`);

        // Settings Table (for capacity and rules)
        db.run(`CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        )`);

        // Audit Logs Table
        db.run(`CREATE TABLE IF NOT EXISTS logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER,
            userId TEXT,
            action TEXT,
            details TEXT
        )`);

        seedInitialData();
        recoverTimers();
    });
}

function recoverTimers() {
    console.log("[INIT] Recovering persistent timers...");
    const now = Date.now();
    db.all("SELECT id, userId, state, expiresAt FROM spots WHERE state IN ('reserved', 'pending_offer')", (err, rows) => {
        if (err) return;
        rows.forEach(spot => {
            if (spot.expiresAt && spot.expiresAt < now) {
                console.log(`[INIT] Timer already expired for spot ${spot.id}, processing now.`);
                if (spot.state === 'reserved') {
                    handleGraceExpiration(spot.id, spot.userId);
                } else if (spot.state === 'pending_offer') {
                    handleOfferExpiration(spot.id, spot.userId);
                }
            } else if (spot.expiresAt) {
                const remaining = spot.expiresAt - now;
                console.log(`[INIT] Restarting timer for spot ${spot.id}: ${Math.round(remaining / 1000)}s remaining.`);
                if (spot.state === 'reserved') {
                    startGraceTimer(spot.id, spot.userId, remaining);
                } else if (spot.state === 'pending_offer') {
                    startOfferTimer(spot.id, spot.userId, remaining);
                }
            }
        });
    });
}

function seedInitialData() {
    // 1. Seed ALMOG Admin User
    db.get("SELECT id FROM users WHERE id = 'ALMOG'", async (err, row) => {
        if (!row) {
            const hashedPassword = await bcrypt.hash('035017707', 10);
            db.run(`INSERT INTO users (id, name, email, password, role, tier) 
                    VALUES (?, ?, ?, ?, ?, ?)`,
                ['ALMOG', 'ALMOG (Admin)', 'admin@parkiq.com', hashedPassword, 'admin', 5],
                (err) => {
                    if (err) console.error("Error seeding Admin ALMOG", err);
                    else console.log("Admin user ALMOG seeded successfully.");
                });
        }
    });

    // 2. Default users from original app.js
    const initialUsers = [
        { id: 'u1', name: 'Alex Cohen', tier: 3, email: 'alex@corp.com' },
        { id: 'u2', name: 'Maya Levi', tier: 4, email: 'maya@corp.com' },
        { id: 'u3', name: 'Yoni Shapiro', tier: 2, email: 'yoni@corp.com' },
        { id: 'u4', name: 'Dana Mizrahi', tier: 5, email: 'dana@corp.com' },
        { id: 'u5', name: 'Rotem Bar', tier: 1, email: 'rotem@corp.com' },
        { id: 'u6', name: 'Noa Peretz', tier: 3, email: 'noa@corp.com' },
        { id: 'u7', name: 'Tal Katz', tier: 2, email: 'tal@corp.com' },
        { id: 'u8', name: 'Ilan Gross', tier: 4, email: 'ilan@corp.com' }
    ];

    initialUsers.forEach(u => {
        db.get("SELECT id FROM users WHERE id = ?", [u.id], async (err, row) => {
            if (!row) {
                // Mock password for regular users: 123456
                const hp = await bcrypt.hash('123456', 10);
                db.run(`INSERT INTO users (id, name, email, password, role, tier) VALUES (?, ?, ?, ?, ?, ?)`,
                    [u.id, u.name, u.email, hp, 'user', u.tier]);
            }
        });
    });

    // 3. Init Spots (30 total, 3 VIP, 5 Carpool, 4 EV)
    db.get("SELECT count(*) as cnt FROM spots", (err, row) => {
        if (row.cnt === 0) {
            const stmt = db.prepare("INSERT INTO spots (id, num, state, isCarpool, isVIP, isEV) VALUES (?, ?, ?, ?, ?, ?)");
            for (let i = 1; i <= 30; i++) {
                const isCarpool = (i <= 5) ? 1 : 0;
                const isEV = (i >= 6 && i <= 9) ? 1 : 0;
                const isVIP = (i > 27) ? 1 : 0;
                stmt.run([`S${i}`, i, 'available', isCarpool, isVIP, isEV]);
            }
            stmt.finalize();
            console.log("30 Spots seeded");
            db.run(`INSERT INTO settings (key, value) VALUES ('capacity', '30')`);
            db.run(`INSERT INTO settings (key, value) VALUES ('vipSpots', '3')`);
            db.run(`INSERT INTO settings (key, value) VALUES ('carpoolSpots', '5')`);
            db.run(`INSERT INTO settings (key, value) VALUES ('evSpots', '4')`);
        }
    });
}

// --- LOGGING HELPER ---
function logAction(userId, action, details = "") {
    const timestamp = Date.now();
    db.run("INSERT INTO logs (timestamp, userId, action, details) VALUES (?, ?, ?, ?)", [timestamp, userId, action, details], (err) => {
        if (err) console.error("Failed to write log", err);
    });
}

// ==========================================
// API ENDPOINTS
// ==========================================

// --- AUTHENTICATION ---
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get("SELECT * FROM users WHERE id = ?", [username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: 'User not found' });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'Incorrect password' });

        const token = jwt.sign({ id: user.id, role: user.role }, SECRET_KEY, { expiresIn: '24h' });
        // remove password before sending user data
        delete user.password;
        res.json({ token, user });
    });
});

// Middleware for auth
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.sendStatus(401);

    jwt.verify(token, SECRET_KEY, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: "Access denied. Admin only." });
    }
    next();
}

// --- USERS ---
app.get('/api/users', authenticateToken, (req, res) => {
    db.all("SELECT id, name, email, role, tier, noShows, waitHistory, graceUsedToday, graceUsedWeek, banned, banEnds, ecoPoints, isEV FROM users", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Add a user (Admin only)
app.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    const { id, name, email, password, role, tier, isEV } = req.body;

    db.get("SELECT id FROM users WHERE id = ?", [id], async (err, row) => {
        if (row) return res.status(400).json({ error: 'User ID already exists - preventing duplicates' });

        const hp = await bcrypt.hash(password || '123456', 10);
        db.run(`INSERT INTO users (id, name, email, password, role, tier, isEV) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, name, email, hp, role || 'user', tier || 3, isEV ? 1 : 0],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                logAction(req.user.id, 'admin_add_user', `Created user ${id}`);
                res.json({ message: 'User created' });
            }
        );
    });
});

// Delete user (Admin only)
app.delete('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const idToDelete = req.params.id;
    // Self-lockout prevention: Admin cannot delete themselves if it's the main ALMOG user
    if (idToDelete === 'ALMOG') {
        return res.status(403).json({ error: "Cannot delete the primary admin account ALMOG (Self-lockout prevention)." });
    }
    db.run("DELETE FROM users WHERE id = ?", [idToDelete], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        logAction(req.user.id, 'admin_delete_user', `Deleted user ${idToDelete}`);
        res.json({ message: 'User deleted' });
        broadcastUpdate();
    });
});

app.put('/api/users/:id', authenticateToken, requireAdmin, (req, res) => {
    const { name, email, tier, role, isEV } = req.body;
    const { id } = req.params;

    if (!name || !tier) return res.status(400).json({ error: "Name and Tier are required" });

    db.run(`UPDATE users SET name = ?, email = ?, tier = ?, role = ?, isEV = ? WHERE id = ?`,
        [name, email, parseInt(tier), role || 'user', isEV ? 1 : 0, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "User not found" });

            logAction(req.user.id, 'admin_update_user', `Updated user ${id}: ${name}, Tier ${tier}`);
            broadcastUpdate();
            res.json({ message: "User updated successfully" });
        });
});

// Admin Clear Penalty
app.post('/api/admin/clear-penalty', authenticateToken, requireAdmin, (req, res) => {
    const { userId } = req.body;
    db.run("UPDATE users SET noShows = 0, banned = 0, banEnds = NULL WHERE id = ?", [userId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
        logAction(req.user.id, 'admin_clear_penalty', `Cleared all penalties for ${userId}`);
        broadcastUpdate();
        res.json({ success: true });
    });
});

// Admin Force Book
app.post('/api/admin/force-book', authenticateToken, requireAdmin, (req, res) => {
    const { userId } = req.body;
    // Find first available regular spot
    db.get("SELECT id, num FROM spots WHERE state = 'available' AND isVIP = 0 ORDER BY num ASC LIMIT 1", (err, spot) => {
        if (!spot) return res.status(400).json({ error: 'אין מספיק חניות בשביל להקצות בכוח.' });

        const spotId = spot.id;
        const reservedAt = Date.now();
        db.run("UPDATE spots SET state = 'reserved', userId = ?, reservedAt = ? WHERE id = ?", [userId, reservedAt, spotId], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            db.run("INSERT INTO bookings (id, userId, date, time, spotId, status, carpoolWith, carpoolVerified, score, noShow, createdAt, forceBooked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [`B${Date.now()}_${Math.floor(Math.random() * 1000)}`, userId, new Date().toISOString().split('T')[0], '09:00', spotId, 'reserved', '[]', 0, 100, 0, Date.now(), 1],
                (err) => {
                    if (err) {
                        console.error("Force book insert error:", err);
                        // Even if booking insert fails, the spot was already updated. We should probably try to be atomic, 
                        // but for now let's at least log the error.
                    }
                    logAction(req.user.id, 'ADMIN_FORCE_BOOK', `Assigned spot ${spot.num} for user ${userId}`);
                    broadcastUpdate();
                    res.json({ success: true, spotNum: spot.num });
                }
            );
        });
    });
});

// Admin Rules Update
app.post('/api/admin/rules', authenticateToken, requireAdmin, (req, res) => {
    const rules = req.body; // e.g., { gracePeriod: 20, middayMax: 3, ... }
    db.serialize(() => {
        const stmt = db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)");
        for (const key of Object.keys(rules)) {
            stmt.run(key, String(rules[key]));
        }
        stmt.finalize(() => {
            logAction(req.user.id, 'admin_rules_update', `Updated global settings`);

            // If capacity was changed, resize the spots table
            if (rules.capacity !== undefined) {
                const cap = parseInt(rules.capacity);
                const vip = parseInt(rules.vipSpots || 0);
                const cp = parseInt(rules.carpoolSpots || 0);
                const ev = parseInt(rules.evSpots || 0);

                db.run("DELETE FROM spots WHERE num > ?", [cap]);
                db.get("SELECT MAX(num) as maxNum FROM spots", (err, row) => {
                    const currentMax = (row && row.maxNum) ? row.maxNum : 0;
                    if (currentMax < cap) {
                        const s_stmt = db.prepare("INSERT INTO spots (id, num, state, isCarpool, isVIP, isEV) VALUES (?, ?, 'available', 0, 0, 0)");
                        for (let i = currentMax + 1; i <= cap; i++) {
                            s_stmt.run(`S${i}`, i);
                        }
                        s_stmt.finalize();
                    }

                    db.run("UPDATE spots SET isCarpool = 0, isEV = 0, isVIP = 0", () => {
                        if (cp > 0) db.run("UPDATE spots SET isCarpool = 1 WHERE num <= ?", [cp]);
                        if (ev > 0) db.run("UPDATE spots SET isEV = 1 WHERE num > ? AND num <= ?", [cp, cp + ev]);
                        if (vip > 0) db.run("UPDATE spots SET isVIP = 1 WHERE num > ?", [cap - vip]);

                        // Give db a moment to finish updates before broadcasting
                        setTimeout(() => {
                            broadcastUpdate();
                            res.json({ success: true });
                        }, 500);
                    });
                });
            } else {
                broadcastUpdate();
                res.json({ success: true });
            }
        });
    });
});

// Admin Generate Guest Pass
app.post('/api/admin/guest-pass', authenticateToken, requireAdmin, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Guest name is required' });

    const guestId = 'G' + Math.floor(1000 + Math.random() * 9000);
    const hp = await bcrypt.hash('guest', 10);

    // 1. Create Guest User
    db.run(`INSERT INTO users (id, name, email, password, role, tier) VALUES (?, ?, ?, ?, ?, ?)`,
        [guestId, name, `guest-${guestId}@parkiq.local`, hp, 'guest', 5],
        (err) => {
            if (err) return res.status(500).json({ error: 'Failed to create guest user' });

            // 2. Find a VIP spot first, fallback to regular
            db.get("SELECT id, num FROM spots WHERE state = 'available' AND isVIP = 1 LIMIT 1", (err, spot) => {
                if (!spot) {
                    db.get("SELECT id, num FROM spots WHERE state = 'available' LIMIT 1", (err, anySpot) => {
                        if (!anySpot) {
                            res.json({ message: 'Guest Created (No Spots Available)', guestId, code: `QR-${guestId}` });
                            return;
                        }
                        assignGuest(anySpot, guestId, res);
                    });
                    return;
                }
                assignGuest(spot, guestId, res);
            });
        }
    );

    function assignGuest(spot, guestId, res) {
        const reservedAt = Date.now();
        db.run("UPDATE spots SET state = 'reserved', userId = ?, reservedAt = ? WHERE id = ?", [guestId, reservedAt, spot.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            const bookingId = `B${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            db.run("INSERT INTO bookings (id, userId, date, time, spotId, status, carpoolWith, carpoolVerified, score, noShow, createdAt, forceBooked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [bookingId, guestId, new Date().toISOString().split('T')[0], '08:00', spot.id, 'reserved', '[]', 0, 100, 0, Date.now(), 1],
                (err) => {
                    if (err) console.error("Guest pass booking error:", err);
                    logAction(req.user.id, 'ADMIN_GUEST_PASS', `Created guest pass ${guestId} and assigned spot ${spot.num}`);
                    broadcastUpdate();
                    res.json({ message: 'Guest pass created', guestId, spotNum: spot.num, code: `QR-${guestId}` });
                }
            );
        });
    }
});

// Admin Logs Retrieve
app.get('/api/admin/logs', authenticateToken, requireAdmin, (req, res) => {
    db.all("SELECT logs.*, users.name as userName FROM logs LEFT JOIN users ON logs.userId = users.id ORDER BY timestamp DESC LIMIT 100", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Complete data fetch for initialization
app.get('/api/state', authenticateToken, (req, res) => {
    db.all("SELECT * FROM spots", (err, spots) => {
        db.all("SELECT id, name, email, role, tier, noShows, waitHistory, graceUsedToday, graceUsedWeek, banned, banEnds, ecoPoints, isEV FROM users", (err, users) => {
            db.all("SELECT * FROM bookings", (err, bookings) => {
                db.all("SELECT * FROM settings", (err, settingsRows) => {
                    const settings = {};
                    settingsRows.forEach(r => settings[r.key] = r.value);
                    res.json({ spots, users, bookings, settings });
                });
            });
        });
    });
});

// ==========================================
// WAITLIST LOGIC
// ==========================================
function processWaitlist(spotId) {
    // 1. Check if spot is ACTUALLY available
    db.get("SELECT state, isVIP FROM spots WHERE id = ?", [spotId], (err, spot) => {
        if (!spot || spot.state !== 'available') return;
        if (spot.isVIP) return; // VIP spots don't get auto-assigned to regular waitlist

        // 2. Find topmost person on waitlist for today
        db.get("SELECT * FROM bookings WHERE status = 'waitlist' ORDER BY score DESC, createdAt ASC LIMIT 1", (err, booking) => {
            if (!booking) return;

            const userId = booking.userId;
            const reservedAt = Date.now();

            // 3. Assign spot to them as an offer
            db.run("UPDATE spots SET state = 'pending_offer', userId = ?, reservedAt = ? WHERE id = ? AND state = 'available'",
                [userId, reservedAt, spotId],
                function (err) {
                    if (this.changes === 0) return; // Race condition

                    // 4. Update booking
                    db.run("UPDATE bookings SET status = 'offered', spotId = ? WHERE id = ?", [spotId, booking.id]);

                    console.log(`Waitlist processed: Spot ${spotId} offered to ${userId}`);
                    startOfferTimer(spotId, userId);
                    broadcastUpdate();
                }
            );
        });
    });
}

// Example minimal endpoints for app logic compatibility
// We are migrating the purely frontend state machine to at least use the DB to persist the state
// --- PARKING ACTIONS ---

const graceTimers = {};
const offerTimers = {};

function clearGraceTimer(spotId) {
    if (graceTimers[spotId]) {
        clearTimeout(graceTimers[spotId]);
        delete graceTimers[spotId];
    }
}

function startGraceTimer(spotId, userId, overrideMs = null) {
    clearGraceTimer(spotId);
    db.get("SELECT value FROM settings WHERE key = 'gracePeriod'", (err, row) => {
        const mins = (row && row.value) ? parseFloat(row.value) : 20;
        const ms = overrideMs !== null ? overrideMs : mins * 60 * 1000;
        const expiresAt = Date.now() + ms;

        // Persist expiration
        db.run("UPDATE spots SET expiresAt = ? WHERE id = ?", [expiresAt, spotId]);

        graceTimers[spotId] = setTimeout(() => {
            handleGraceExpiration(spotId, userId);
        }, ms);
    });
}

function handleGraceExpiration(spotId, userId) {
    db.get("SELECT state FROM spots WHERE id = ?", [spotId], (err, row) => {
        if (row && row.state === 'reserved') {
            db.run("UPDATE spots SET state = 'available', userId = NULL, reservedAt = NULL, expiresAt = NULL WHERE id = ?", [spotId], () => {
                db.run("UPDATE bookings SET status = 'cancelled' WHERE spotId = ? AND userId = ? AND status = 'reserved'", [spotId, userId]);
                db.run("UPDATE users SET noShows = noShows + 1 WHERE id = ?", [userId]);
                console.log(`Grace period expired for spot ${spotId}, released.`);
                broadcastUpdate();
                processWaitlist(spotId);
            });
        }
    });
}

function clearOfferTimer(spotId) {
    if (offerTimers[spotId]) {
        clearTimeout(offerTimers[spotId]);
        delete offerTimers[spotId];
    }
}

function startOfferTimer(spotId, userId, overrideMs = null) {
    clearOfferTimer(spotId);
    db.get("SELECT value FROM settings WHERE key = 'offerPeriod'", (err, row) => {
        const mins = (row && row.value) ? parseFloat(row.value) : 10;
        const ms = overrideMs !== null ? overrideMs : mins * 60 * 1000;
        const expiresAt = Date.now() + ms;

        // Persist expiration
        db.run("UPDATE spots SET expiresAt = ? WHERE id = ?", [expiresAt, spotId]);

        offerTimers[spotId] = setTimeout(() => {
            handleOfferExpiration(spotId, userId);
        }, ms);
    });
}

function handleOfferExpiration(spotId, userId) {
    db.get("SELECT state FROM spots WHERE id = ?", [spotId], (err, row) => {
        if (row && row.state === 'pending_offer') {
            db.run("UPDATE spots SET state = 'available', userId = NULL, reservedAt = NULL, expiresAt = NULL WHERE id = ?", [spotId], () => {
                db.run("UPDATE bookings SET status = 'cancelled' WHERE spotId = ? AND userId = ? AND status = 'offered'", [spotId, userId]);
                console.log(`Offer period expired for spot ${spotId}, released.`);
                broadcastUpdate();
                processWaitlist(spotId);
            });
        }
    });
}

app.post('/api/spots/:id/reserve', authenticateToken, (req, res) => {
    const { userId } = req.body;
    const spotId = req.params.id;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // For simplicity, we assume the reservation is for today (as seen in the INSERT below)
    // In a real app, we'd check the requested date.
    const bookingTime = '09:00'; // The default time used below
    const [h, m] = bookingTime.split(':').map(Number);
    const checkDate = new Date();
    checkDate.setHours(h, m, 0, 0);

    if (checkDate < now) {
        return res.status(400).json({ error: 'Cannot reserve a spot for a time that has passed today.' });
    }

    const reservedAt = Date.now();

    db.run("UPDATE spots SET state = 'reserved', userId = ?, reservedAt = ? WHERE id = ? AND state = 'available'",
        [userId, reservedAt, spotId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(409).json({ error: 'Spot already taken (race condition handled)' });

            const bookingId = `B${Date.now()}_${Math.floor(Math.random() * 1000)}`;
            db.run("INSERT INTO bookings (id, userId, date, time, spotId, status, carpoolWith, carpoolVerified, score, noShow, createdAt, forceBooked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [bookingId, userId, todayStr, '09:00', spotId, 'reserved', '[]', 0, 100, 0, Date.now(), 0],
                (err) => {
                    if (err) console.error("Reservation insert error:", err);
                    logAction(userId, 'RESERVE_SPOT', `Reserved spot ${spotId} `);
                    startGraceTimer(spotId, userId);
                    broadcastUpdate();
                    res.json({ success: true, spotId, userId });
                }
            );
        }
    );
});

app.post('/api/bookings/waitlist', authenticateToken, (req, res) => {
    const { userId, date, time, carpoolWith, carpoolVerified, score } = req.body;

    // Time Validation
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    if (date === todayStr) {
        const [h, m] = time.split(':').map(Number);
        const checkDate = new Date();
        checkDate.setHours(h, m, 0, 0);
        if (checkDate < now) {
            return res.status(400).json({ error: 'Cannot join waitlist for a time that has passed today.' });
        }
    }

    db.get("SELECT id FROM bookings WHERE userId = ? AND date = ? AND status IN ('waitlist', 'reserved', 'offered')", [userId, date], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) return res.status(409).json({ error: 'כבר קיימת הזמנה או בקשת המתנה לתאריך זה.' });

        const nowTs = Date.now();
        const bookingId = `B${nowTs}_${Math.floor(Math.random() * 1000)}`;
        const cwStr = JSON.stringify(carpoolWith || []);

        db.run("INSERT INTO bookings (id, userId, date, time, spotId, status, carpoolWith, carpoolVerified, score, noShow, createdAt, forceBooked) VALUES (?, ?, ?, ?, NULL, 'waitlist', ?, ?, ?, 0, ?, 0)",
            [bookingId, userId, date, time, cwStr, carpoolVerified ? 1 : 0, score, nowTs],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                logAction(userId, 'JOIN_WAITLIST', `Joined waitlist for ${date}`);

                db.get("SELECT COUNT(*) as pos FROM bookings WHERE status = 'waitlist' AND date = ? AND (score > ? OR (score = ? AND createdAt <= ?))",
                    [date, score, score, nowTs], (err, row) => {
                        broadcastUpdate();
                        res.json({ success: true, waitlistPos: row ? row.pos : 1, bookingId });
                    });
            }
        );
    });
});

app.post('/api/spots/:id/offer/accept', authenticateToken, (req, res) => {
    const spotId = req.params.id;
    const userId = req.user.id;

    db.run("UPDATE spots SET state = 'reserved' WHERE id = ? AND userId = ? AND state = 'pending_offer'",
        [spotId, userId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(400).json({ error: 'Invalid offer state or not your offer' });

            clearOfferTimer(spotId);
            db.run("UPDATE bookings SET status = 'reserved' WHERE spotId = ? AND userId = ? AND status = 'offered'", [spotId, userId]);
            startGraceTimer(spotId, userId);
            broadcastUpdate();
            res.json({ success: true, spotId });
        }
    );
});

app.post('/api/spots/:id/offer/decline', authenticateToken, (req, res) => {
    const spotId = req.params.id;
    const userId = req.user.id;

    db.run("UPDATE spots SET state = 'available', userId = NULL, reservedAt = NULL WHERE id = ? AND userId = ? AND state = 'pending_offer'",
        [spotId, userId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(400).json({ error: 'Invalid offer state or not your offer' });

            clearOfferTimer(spotId);
            db.run("UPDATE bookings SET status = 'cancelled' WHERE spotId = ? AND userId = ? AND status = 'offered'", [spotId, userId]);
            broadcastUpdate();
            processWaitlist(spotId);
            res.json({ success: true, spotId });
        }
    );
});

app.post('/api/spots/:id/checkin', authenticateToken, (req, res) => {
    const spotId = req.params.id;
    const userId = req.user.id;

    db.run("UPDATE spots SET state = 'occupied' WHERE id = ? AND userId = ? AND state = 'reserved'",
        [spotId, userId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(400).json({ error: 'Invalid check-in state or not your spot' });

            clearGraceTimer(spotId);

            // Mark booking as fulfilled
            db.run("UPDATE bookings SET status = 'fulfilled' WHERE spotId = ? AND userId = ? AND status = 'reserved'", [spotId, userId]);
            logAction(userId, 'CHECK_IN', `Checked into spot ${spotId} `);
            broadcastUpdate();
            res.json({ success: true, spotId });
        }
    );
});

app.post('/api/qr-checkin', (req, res) => {
    const { code } = req.body;
    if (!code || !code.startsWith('QR-')) return res.status(400).json({ error: 'קוד QR לא חוקי' });

    const userId = code.replace('QR-', '');

    db.get("SELECT id, num FROM spots WHERE userId = ? AND state = 'reserved'", [userId], (err, spot) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!spot) return res.status(404).json({ error: 'לא נמצאה חניה שמורה עבור קוד זה.' });

        db.run("UPDATE spots SET state = 'occupied' WHERE id = ?", [spot.id], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            clearGraceTimer(spot.id);
            db.run("UPDATE bookings SET status = 'fulfilled' WHERE spotId = ? AND userId = ? AND status = 'reserved'", [spot.id, userId]);
            logAction(userId, 'QR_CHECKIN', `QR Scanned. Checked into spot ${spot.num}`);
            broadcastUpdate();

            res.json({ success: true, spotNum: spot.num });
        });
    });
});

app.post('/api/spots/:id/cancel', authenticateToken, (req, res) => {
    const spotId = req.params.id;
    const userId = req.user.id;

    db.run("UPDATE spots SET state = 'available', userId = NULL, reservedAt = NULL WHERE id = ? AND userId = ?",
        [spotId, userId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(400).json({ error: 'Spot not found or not yours' });

            clearGraceTimer(spotId);
            db.run("UPDATE bookings SET status = 'cancelled' WHERE spotId = ? AND userId = ? AND status = 'reserved'", [spotId, userId], () => {
                logAction(userId, 'CANCEL_BOOKING', `Cancelled reservation for spot ${spotId}`);
                broadcastUpdate();
                processWaitlist(spotId);
                res.json({ success: true, spotId });
            });
        }
    );
});

app.post('/api/spots/:id/checkout', authenticateToken, (req, res) => {
    const spotId = req.params.id;
    const userId = req.user.id;

    db.run("UPDATE spots SET state = 'available', userId = NULL, reservedAt = NULL WHERE id = ? AND userId = ?",
        [spotId, userId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(400).json({ error: 'Spot not found or not yours' });

            db.run("UPDATE bookings SET status = 'completed' WHERE spotId = ? AND userId = ? AND status = 'occupied'", [spotId, userId], () => {
                logAction(userId, 'CHECK_OUT', `Checked out of spot ${spotId} `);
                broadcastUpdate();
                processWaitlist(spotId);
                res.json({ success: true, spotId });
            });
        }
    );
});

// ── Midnight Reset Cron Job ────────────────────────────────────
let lastResetDate = new Date().getDate();

setInterval(() => {
    const now = new Date();
    if (now.getHours() === 0 && now.getMinutes() === 0 && now.getDate() !== lastResetDate) {
        lastResetDate = now.getDate();
        console.log('[CRON] Running Midnight Reset...');

        db.serialize(() => {
            // Reward Eco-Points for yesterday's successful parking
            const yesterday = new Date(now.getTime() - 1000); // 1 second before midnight
            const targetDateStr = yesterday.toISOString().split('T')[0];

            db.all("SELECT userId, carpoolWith, carpoolVerified FROM bookings WHERE date = ? AND status IN ('fulfilled', 'completed')", [targetDateStr], (err, rows) => {
                if (rows && rows.length > 0) {
                    rows.forEach(row => {
                        let pts = 10; // Base points for valid check-in
                        try {
                            const cp = JSON.parse(row.carpoolWith || "[]");
                            if (row.carpoolVerified) {
                                pts += (cp.length * 5); // +5 per valid carpool member
                            }
                        } catch (e) { }
                        db.run("UPDATE users SET ecoPoints = ecoPoints + ? WHERE id = ?", [pts, row.userId]);
                    });
                }
            });

            db.run("UPDATE spots SET state = 'available', userId = NULL, reservedAt = NULL, expiresAt = NULL");
            db.run("UPDATE users SET graceUsedToday = 0");

            // Cancel only "Today's" or "Yesterday's" leftover bookings that weren't fulfilled
            db.run("UPDATE bookings SET status = 'cancelled' WHERE status IN ('reserved', 'waitlist', 'offered') AND date <= ?", [targetDateStr]);

            if (now.getDay() === 0) {
                db.run("UPDATE users SET graceUsedWeek = 0");
            }

            console.log('[CRON] Midnight Reset & Eco-Points Distribution Complete.');
            broadcastUpdate();
        });
    }
}, 60 * 1000); // Check every minute

// Use server.listen instead of app.listen for Socket.io
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
