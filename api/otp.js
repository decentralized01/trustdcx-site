/**
 * TrustDCX — Email OTP Service
 * Deploy on VPS (Node/Express) or Cloudflare Workers
 *
 * POST /send-otp   { "email": "user@example.com" }
 * POST /verify-otp { "email": "user@example.com", "otp": "123456" }
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY;   // never hardcode
const FROM_ADDRESS   = "TrustDCX <reach@trustdcx.com>";
const OTP_TTL_MS     = 10 * 60 * 1000;               // 10 minutes

// In-memory store (replace with Redis/KV for production)
const otpStore = new Map(); // email → { otp, expiresAt, attempts }

// ─── helpers ─────────────────────────────────────────────────────────────────

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function otpEmailHTML(otp) {
  return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#0B0E14;font-family:Inter,sans-serif;">
<div style="max-width:480px;margin:40px auto;padding:32px;background:#131720;border-radius:12px;border:1px solid #1E2030;">
  <div style="text-align:center;margin-bottom:28px;">
    <svg width="52" height="52" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1E6BFF"/><stop offset="1" stop-color="#0A2A6B"/>
      </linearGradient></defs>
      <path d="M50 6 L86 20 V48 C86 72 70 88 50 96 C30 88 14 72 14 48 V20 Z" fill="url(#g)"/>
      <g fill="#39E0FF"><circle cx="50" cy="43" r="10.5"/>
        <path d="M46 49 L54 49 L57 71 L43 71 Z"/></g>
    </svg>
    <h1 style="color:#FFFFFF;font-size:22px;margin:12px 0 4px;font-weight:800;">TrustDCX</h1>
    <p style="color:#8B93A3;font-size:12px;margin:0;letter-spacing:2px;">SECURED · SELF-CUSTODY</p>
  </div>

  <h2 style="color:#FFFFFF;font-size:18px;font-weight:600;margin:0 0 8px;">Verify your email</h2>
  <p style="color:#8B93A3;font-size:14px;line-height:1.6;margin:0 0 24px;">
    Enter this one-time password in the TrustDCX app to continue.
  </p>

  <div style="background:#0B0E14;border:1px solid #1E6BFF44;border-radius:10px;padding:28px;text-align:center;margin-bottom:24px;">
    <span style="font-size:44px;font-weight:800;letter-spacing:14px;color:#39E0FF;font-family:'Courier New',monospace;">${otp}</span>
  </div>

  <p style="color:#8B93A3;font-size:13px;line-height:1.6;margin:0 0 24px;">
    ⏱ This OTP expires in <strong style="color:#FFFFFF;">10 minutes</strong>.<br>
    🔒 Never share this code with anyone — TrustDCX will never ask for it.
  </p>

  <hr style="border:none;border-top:1px solid #1E2030;margin:0 0 20px;"/>
  <p style="color:#3A4050;font-size:11px;text-align:center;margin:0;">
    If you didn't request this, you can safely ignore this email.<br>
    TrustDCX &nbsp;·&nbsp; <a href="https://trustdcx.com" style="color:#1E6BFF;text-decoration:none;">trustdcx.com</a>
  </p>
</div>
</body>
</html>`;
}

// ─── send-otp endpoint ────────────────────────────────────────────────────────

async function sendOTP(email) {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { status: 400, body: { error: "Invalid email address" } };
  }

  const otp        = generateOTP();
  const expiresAt  = Date.now() + OTP_TTL_MS;
  otpStore.set(email.toLowerCase(), { otp, expiresAt, attempts: 0 });

  const res = await fetch("https://api.resend.com/emails", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type":  "application/json",
    },
    body: JSON.stringify({
      from:    FROM_ADDRESS,
      to:      [email],
      subject: `${otp} is your TrustDCX verification code`,
      html:    otpEmailHTML(otp),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return { status: 502, body: { error: "Failed to send email", detail: err } };
  }

  const data = await res.json();
  return { status: 200, body: { message: "OTP sent", emailId: data.id } };
}

// ─── verify-otp endpoint ─────────────────────────────────────────────────────

async function verifyOTP(email, otp) {
  if (!email || !otp) {
    return { status: 400, body: { error: "email and otp are required" } };
  }

  const key    = email.toLowerCase();
  const record = otpStore.get(key);

  if (!record) {
    return { status: 400, body: { error: "No OTP found for this email" } };
  }
  if (Date.now() > record.expiresAt) {
    otpStore.delete(key);
    return { status: 400, body: { error: "OTP has expired" } };
  }
  if (record.attempts >= 5) {
    otpStore.delete(key);
    return { status: 429, body: { error: "Too many attempts — request a new OTP" } };
  }

  record.attempts++;

  if (record.otp !== String(otp)) {
    return { status: 400, body: { error: "Invalid OTP", attemptsLeft: 5 - record.attempts } };
  }

  otpStore.delete(key);  // single-use
  return { status: 200, body: { verified: true } };
}

// ─── Express adapter (VPS) ────────────────────────────────────────────────────
// npm install express && node api/otp.js

if (typeof require !== "undefined") {
  const express = require("express");
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "https://trustdcx.com");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.post("/send-otp", async (req, res) => {
    const r = await sendOTP(req.body.email);
    res.status(r.status).json(r.body);
  });

  app.post("/verify-otp", async (req, res) => {
    const r = await verifyOTP(req.body.email, req.body.otp);
    res.status(r.status).json(r.body);
  });

  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`TrustDCX OTP API on :${PORT}`));
}

// ─── Cloudflare Workers adapter ───────────────────────────────────────────────
// wrangler secret put RESEND_API_KEY
// wrangler deploy

if (typeof addEventListener !== "undefined") {
  addEventListener("fetch", (event) => {
    event.respondWith(handleRequest(event.request));
  });

  async function handleRequest(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin":  "https://trustdcx.com",
          "Access-Control-Allow-Methods": "POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    let result;
    try {
      const body = await request.json();
      if (url.pathname === "/send-otp")   result = await sendOTP(body.email);
      else if (url.pathname === "/verify-otp") result = await verifyOTP(body.email, body.otp);
      else result = { status: 404, body: { error: "Not found" } };
    } catch {
      result = { status: 400, body: { error: "Invalid JSON" } };
    }

    return new Response(JSON.stringify(result.body), {
      status:  result.status,
      headers: {
        "Content-Type":                 "application/json",
        "Access-Control-Allow-Origin":  "https://trustdcx.com",
      },
    });
  }
}
