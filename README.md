# Kaka Cafe POS

Restaurant Point-of-Sale system for Kaka Rajasthani, Yelahanka, Bengaluru.

## Tech Stack
- React + Vite (frontend)
- Firebase Realtime Database (data sync)
- Cloudflare Pages (hosting)

## Features
- Billing with GST, packaging, mix payments
- 12 tables with real-time sync across devices
- QR ordering — customers scan, place order, staff gets notified
- WhatsApp bill sending
- Kitchen order (KOT) via WhatsApp
- Inventory tracking with auto-deduction
- Reports, expenses, customer database
- Admin-protected sections

## Firebase Setup
Database URL: `https://kaka-cafe-pos-default-rtdb.asia-southeast1.firebasedatabase.app`
Data path: `/kaka-main/`

Rules (set in Firebase Console → Realtime Database → Rules):
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```
⚠️ Firebase auto-locks rules every 30 days on Spark plan. Upgrade to Blaze (free tier) to prevent this.

## Local Development
```bash
npm install
npm run dev
```
Open http://localhost:5173

## Deploy to Cloudflare Pages
This repo is connected to Cloudflare Pages.
Every push to `main` branch auto-deploys.

Build settings:
- Build command: `npm run build`
- Output directory: `dist`
- Node version: 18

## Default Credentials
- Staff PIN: `0000`
- Admin password: `1234`
(Change these in Settings after first login)
