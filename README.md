# ParkIQ 🅿️ — Intelligent Parking Management System

ParkIQ is a comprehensive, real-time parking management solution designed for corporate offices. It features a modern dark-themed interface, automated waitlists, eco-point rewards, and real-time status synchronization.

## 🚀 Key Features

- **Real-time Status**: Live parking spot availability powered by WebSockets.
- **Automated Waitlist**: Intelligent queue management with priority scoring.
- **Eco-Points 🌱**: Rewards system for carpooling and on-time check-ins.
- **Admin Dashboard**: Full control over parking capacity, user tiers, and rules.
- **QR Entry**: Magic scanning and camera-based QR validation for quick entry.
- **PWA Ready**: Installable on iOS and Android for a native app feel.

## 🛠 Tech Stack

- **Frontend**: Vanilla HTML5, CSS3 (Modern Glassmorphism), Javascript (ES6+).
- **Backend**: Node.js, Express.
- **Real-time**: Socket.io.
- **Database**: SQLite (SQL) for persistent storage.
- **Auth**: JWT (JSON Web Tokens) with Bcrypt password hashing.

## 📦 Installation & Local Setup

### 1. Backend Setup
```bash
cd server
npm install
node server.js
```

### 2. Frontend Setup
Simply open `index.html` in your browser (preferably via a local server like Live Server) or access it via the deployed URL.

## 🌐 Deployment

### Backend (Render.com)
The backend is optimized for Render with the following considerations:
- **Disk Storage**: SQLite requires a persistent disk mount at `/data`.
- **Environment Variables**: `PORT`, `SECRET_KEY`, `PRODUCTION_SERVER`.

### Frontend (GitHub Pages)
The frontend can be hosted statically on GitHub Pages. Ensure `app.js` is configured with the correct `PRODUCTION_SERVER` URL.

## 📄 License
MIT License. Developed for internal corporate use.
