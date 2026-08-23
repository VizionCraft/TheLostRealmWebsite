const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MINECRAFT_NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const HTTPS_URL_RE = /^https:\/\/[^\s]+$/;
const DATA_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;
const MAX_IMAGE_DATA_LENGTH = 6_000_000;

const SITE_IMAGE_SLOTS = {
  home_hero: "Home page hero",
  home_lore: "Home page lore artwork",
  region_hearthvale: "Region card — Hearthvale",
  region_blackwood: "Region card — The Blackwood",
  region_silent_gate: "Region card — The Silent Gate",
  gallery_citadel: "Gallery — The Lost Citadel",
  gallery_blackwood: "Gallery — The Blackwood",
  gallery_hearthvale: "Gallery — Hearthvale",
  gallery_silent_gate: "Gallery — The Silent Gate",
};

const textEncoder = new TextEncoder();
const hmacKeyCache = new Map();

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const response = await routeRequest(request, env);
      const headers = new Headers(response.headers);
      Object.entries(cors).forEach(([key, value]) => headers.set(key, value));
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (error) {
      console.error(error);
      const message = error instanceof ApiError ? error.message : "The Lost Realm API encountered an unexpected error.";
      const status = error instanceof ApiError ? error.status : 500;
      return json({ detail: message }, status, cors);
    }
  },
};

function mediaStore(env) {
  const store = env.IMAGES || env.MEDIA || env["the-lost-realm-images"];
  if (!store) throw new ApiError(500, "Image storage binding is not configured.");
  return store;
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function routeRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (method === "GET" && path === "/") return json({ name: "The Lost Realm API", version: "3.1.0", status: "ready" });
  if (method === "GET" && path === "/health") return json({ status: "healthy" });

  if (method === "POST" && path === "/api/auth/request-code") return requestCode(request, env);
  if (method === "POST" && path === "/api/auth/verify-code") return verifyCode(request, env);
  if (method === "POST" && path === "/api/auth/logout") return logout(request, env);
  if (method === "GET" && path === "/api/me") return me(request, env);
  if (method === "DELETE" && path === "/api/account") return deleteAccount(request, env);
  if (method === "POST" && path === "/api/account/request-data") return requestData(request, env);
  if (method === "POST" && path === "/api/account/email-change/request") return requestEmailChange(request, env);
  if (method === "POST" && path === "/api/account/email-change/verify") return verifyEmailChange(request, env);
  if (method === "POST" && path === "/api/account/email-change/confirm") return confirmEmailChange(request, env);
  if (method === "POST" && path === "/api/account/link") return linkAccount(request, env);

  if (method === "POST" && path === "/api/minecraft/link-code") return minecraftLinkCode(request, env);
  if (method === "POST" && path === "/api/minecraft/heartbeat") return minecraftHeartbeat(request, env);
  if (method === "POST" && path === "/api/dev/link-code") return developmentLinkCode(request, env);

  if (method === "GET" && path === "/api/admin/summary") return adminSummary(request, env);
  if (method === "GET" && path === "/api/site-content") return siteContent(request, env);
  if (method === "GET" && path === "/api/admin/staff") return adminStaffList(request, env);
  if (method === "POST" && path === "/api/admin/staff") return adminStaffCreate(request, env);

  let match = path.match(/^\/api\/admin\/staff\/(\d+)$/);
  if (match && method === "PUT") return adminStaffUpdate(request, env, Number(match[1]));
  if (match && method === "DELETE") return adminStaffDelete(request, env, Number(match[1]));

  if (method === "GET" && path === "/api/admin/site-images") return adminSiteImages(request, env);
  match = path.match(/^\/api\/admin\/site-images\/([A-Za-z0-9_-]+)$/);
  if (match && method === "PUT") return adminSiteImageUpdate(request, env, match[1]);
  if (match && method === "DELETE") return adminSiteImageReset(request, env, match[1]);

  match = path.match(/^\/api\/media\/(site|staff)\/([A-Za-z0-9_-]+)$/);
  if (match && method === "GET") return mediaResponse(env, `${match[1]}:${match[2]}`);

  if (method === "GET" && path === "/api/status") return minecraftStatus(env);
  if (method === "GET" && path === "/api/news") return news();
  if (method === "GET" && path === "/api/ranks") return ranks();

  throw new ApiError(404, "Not found.");
}

function corsHeaders(origin, env) {
  const headers = {
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Link-Secret",
    "Access-Control-Max-Age": "86400",
  };
  if (origin && isAllowedOrigin(origin, env)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  return headers;
}

function isAllowedOrigin(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return allowed.includes(origin.replace(/\/$/, ""));
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Invalid JSON request body.");
  }
}

function nowTs() {
  return Math.floor(Date.now() / 1000);
}

function isoTime(timestamp) {
  if (timestamp === null || timestamp === undefined) return null;
  return new Date(Number(timestamp) * 1000).toISOString();
}

function intEnv(env, key, fallback, minimum = 1) {
  const parsed = Number.parseInt(env[key] || "", 10);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) throw new ApiError(422, "Enter a valid email address.");
  return email;
}

function validateCode(value) {
  const code = String(value || "").trim();
  if (!/^\d{6}$/.test(code)) throw new ApiError(422, "Code must contain six digits.");
  return code;
}

function validateMinecraftName(value) {
  const name = String(value || "").trim();
  if (!MINECRAFT_NAME_RE.test(name)) throw new ApiError(422, "Minecraft names may contain letters, numbers, and underscores.");
  return name;
}

function validateMinecraftUuid(value) {
  const uuid = String(value || "").trim().toLowerCase();
  const compact = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/.test(compact)) throw new ApiError(422, "Minecraft UUID is invalid.");
  return uuid;
}

function adminEmails(env) {
  return new Set(String(env.ADMIN_EMAILS || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean));
}

function constantTimeEqual(a, b) {
  const left = String(a);
  const right = String(b);
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return diff === 0;
}

async function hmacHex(secret, value) {
  if (!secret) throw new ApiError(500, "APP_SECRET is not configured.");
  let keyPromise = hmacKeyCache.get(secret);
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    hmacKeyCache.set(secret, keyPromise);
  }
  const key = await keyPromise;
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function digest(env, value, purpose) {
  return hmacHex(env.APP_SECRET, `${purpose}:${value}`);
}

function secureRandomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function base64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function randomToken() {
  return base64Url(secureRandomBytes(48));
}

function randomSixDigitCode() {
  const data = new Uint32Array(1);
  crypto.getRandomValues(data);
  return String(data[0] % 1_000_000).padStart(6, "0");
}

function clientIp(request) {
  return (request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown").split(",", 1)[0].trim().slice(0, 64);
}

function bearerToken(request) {
  const value = request.headers.get("Authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

async function cleanupAuthRows(env) {
  const now = nowTs();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?1").bind(now),
    env.DB.prepare("DELETE FROM verification_codes WHERE expires_at <= ?1 OR (used_at IS NOT NULL AND used_at < ?2)").bind(now - 86400, now - 86400),
    env.DB.prepare("DELETE FROM link_codes WHERE expires_at <= ?1 OR (used_at IS NOT NULL AND used_at < ?2)").bind(now - 86400, now - 86400),
    env.DB.prepare("DELETE FROM email_change_requests WHERE expires_at <= ?1 OR (confirmed_at IS NOT NULL AND confirmed_at < ?2)").bind(now - 86400, now - 86400),
  ]);
}

async function currentUser(request, env) {
  const token = bearerToken(request);
  if (!token) throw new ApiError(401, "Sign in required.");
  const tokenHash = await digest(env, token, "session");
  const now = nowTs();
  const row = await env.DB.prepare(`
    SELECT users.*, sessions.last_used_at AS session_last_used_at
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ?1 AND sessions.expires_at > ?2
  `).bind(tokenHash, now).first();
  if (!row) throw new ApiError(401, "Session expired. Sign in again.");
  if (now - Number(row.session_last_used_at || 0) >= 600) {
    await env.DB.prepare("UPDATE sessions SET last_used_at = ?1 WHERE token_hash = ?2").bind(now, tokenHash).run();
  }
  return row;
}

async function requireAdmin(request, env) {
  const user = await currentUser(request, env);
  if (!Number(user.is_admin)) throw new ApiError(403, "Administrator access required.");
  return user;
}

function rowToUser(row) {
  return {
    id: Number(row.id),
    email: row.email,
    created_at: isoTime(row.created_at),
    last_login: isoTime(row.last_login),
    is_admin: Boolean(Number(row.is_admin)),
    minecraft_uuid: row.minecraft_uuid || null,
    minecraft_name: row.minecraft_name || null,
    playtime_minutes: Number(row.playtime_minutes || 0),
    quests_completed: Number(row.quests_completed || 0),
    achievements: Number(row.achievements || 0),
    friends: Number(row.friends || 0),
    playtime_rank: row.playtime_rank || "Traveler",
    display_title: row.display_title || "Traveler",
  };
}

function publicMediaUrl(value, requestUrl) {
  const token = String(value || "");
  const match = token.match(/^media:(site|staff):([A-Za-z0-9_-]+)$/);
  if (!match) return token;
  const origin = new URL(requestUrl).origin;
  return `${origin}/api/media/${match[1]}/${match[2]}`;
}

function rowToStaff(row, requestUrl) {
  return {
    id: Number(row.id),
    name: row.name,
    role: row.role,
    description: row.description || "",
    youtube_url: row.youtube_url || "",
    icon_url: publicMediaUrl(row.icon_url || "", requestUrl),
    sort_order: Number(row.sort_order || 100),
    visible: Boolean(Number(row.visible)),
    created_at: isoTime(row.created_at),
    updated_at: isoTime(row.updated_at),
  };
}

async function requestCode(request, env) {
  const payload = await readJson(request);
  const email = normalizeEmail(payload.email);
  const now = nowTs();
  const code = randomSixDigitCode();
  const codeMinutes = intEnv(env, "CODE_MINUTES", 10, 2);
  await cleanupAuthRows(env);

  const last = await env.DB.prepare("SELECT created_at FROM verification_codes WHERE email = ?1 ORDER BY created_at DESC LIMIT 1").bind(email).first();
  if (last && now - Number(last.created_at) < 60) throw new ApiError(429, `Wait ${60 - (now - Number(last.created_at))} seconds before requesting another code.`);

  const recent = await env.DB.prepare("SELECT COUNT(*) AS total FROM verification_codes WHERE email = ?1 AND created_at > ?2").bind(email, now - 3600).first();
  if (Number(recent?.total || 0) >= 8) throw new ApiError(429, "Too many codes requested. Try again later.");

  const hash = await digest(env, `${email}:${code}`, "email-code");
  await env.DB.batch([
    env.DB.prepare("UPDATE verification_codes SET used_at = ?1 WHERE email = ?2 AND used_at IS NULL").bind(now, email),
    env.DB.prepare(`INSERT INTO verification_codes(email, code_hash, created_at, expires_at, request_ip) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(email, hash, now, now + codeMinutes * 60, clientIp(request)),
  ]);

  if (isEmailDevMode(env)) {
    return json({ message: "Email delivery is in development mode.", dev_code: code });
  }
  await sendSignInCode(env, email, code, codeMinutes);
  return json({ message: "A one-time code was sent to your email." });
}

async function verifyCode(request, env) {
  const payload = await readJson(request);
  const email = normalizeEmail(payload.email);
  const code = validateCode(payload.code);
  const now = nowTs();
  await cleanupAuthRows(env);

  const record = await env.DB.prepare(`SELECT * FROM verification_codes WHERE email = ?1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`).bind(email).first();
  if (!record || Number(record.expires_at) <= now) throw new ApiError(400, "That code expired. Request a new one.");
  if (Number(record.attempts) >= 5) throw new ApiError(429, "Too many incorrect attempts. Request a new code.");

  const supplied = await digest(env, `${email}:${code}`, "email-code");
  if (!constantTimeEqual(record.code_hash, supplied)) {
    await env.DB.prepare("UPDATE verification_codes SET attempts = attempts + 1 WHERE id = ?1").bind(record.id).run();
    throw new ApiError(400, "That code is incorrect.");
  }

  await env.DB.prepare("UPDATE verification_codes SET used_at = ?1 WHERE id = ?2").bind(now, record.id).run();
  let user = await env.DB.prepare("SELECT * FROM users WHERE email = ?1").bind(email).first();
  const isAdmin = user ? (Number(user.is_admin) || adminEmails(env).has(email) ? 1 : 0) : (adminEmails(env).has(email) ? 1 : 0);
  let userId;
  if (user) {
    await env.DB.prepare("UPDATE users SET last_login = ?1, is_admin = ?2 WHERE id = ?3").bind(now, isAdmin, user.id).run();
    userId = Number(user.id);
  } else {
    const inserted = await env.DB.prepare("INSERT INTO users(email, created_at, last_login, is_admin) VALUES (?1, ?2, ?3, ?4)").bind(email, now, now, isAdmin).run();
    userId = Number(inserted.meta.last_row_id);
  }

  const rawToken = randomToken();
  const tokenHash = await digest(env, rawToken, "session");
  const sessionDays = intEnv(env, "SESSION_DAYS", 30, 1);
  await env.DB.prepare(`INSERT INTO sessions(user_id, token_hash, created_at, expires_at, last_used_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(userId, tokenHash, now, now + sessionDays * 86400, now).run();
  return json({ message: "Signed in successfully.", token: rawToken, expires_in_days: sessionDays });
}

async function logout(request, env) {
  const token = bearerToken(request);
  if (token) {
    const tokenHash = await digest(env, token, "session");
    await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(tokenHash).run();
  }
  return json({ message: "Logged out." });
}

async function me(request, env) {
  return json(rowToUser(await currentUser(request, env)));
}

async function deleteAccount(request, env) {
  const user = await currentUser(request, env);
  await env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(user.id).run();
  return json({ message: "Your Lost Realm website account was permanently deleted." });
}

async function requestData(request, env) {
  const user = await currentUser(request, env);
  const data = rowToUser(user);
  data.exported_at = isoTime(nowTs());
  if (isEmailDevMode(env)) {
    return json({ message: "Email delivery is in development mode. Your data is included in the API response.", data });
  }
  await sendDataExport(env, user.email, data);
  return json({ message: "A copy of your account data was emailed to you." });
}

async function requestEmailChange(request, env) {
  const user = await currentUser(request, env);
  const payload = await readJson(request);
  const newEmail = normalizeEmail(payload.email);
  const currentEmail = normalizeEmail(user.email);
  if (newEmail === currentEmail) throw new ApiError(409, "That is already the email on this account.");

  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?1 AND id <> ?2").bind(newEmail, user.id).first();
  if (existing) throw new ApiError(409, "That email address is already used by another Lost Realm account.");

  const now = nowTs();
  const code = randomSixDigitCode();
  const codeMinutes = intEnv(env, "CODE_MINUTES", 10, 2);
  await cleanupAuthRows(env);

  const last = await env.DB.prepare("SELECT created_at FROM email_change_requests WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 1").bind(user.id).first();
  if (last && now - Number(last.created_at) < 60) throw new ApiError(429, `Wait ${60 - (now - Number(last.created_at))} seconds before requesting another code.`);

  const recent = await env.DB.prepare("SELECT COUNT(*) AS total FROM email_change_requests WHERE user_id = ?1 AND created_at > ?2").bind(user.id, now - 3600).first();
  if (Number(recent?.total || 0) >= 6) throw new ApiError(429, "Too many email-change requests. Try again later.");

  const codeHash = await digest(env, `${user.id}:${newEmail}:${code}`, "email-change-code");
  await env.DB.batch([
    env.DB.prepare("UPDATE email_change_requests SET confirmed_at = ?1 WHERE user_id = ?2 AND confirmed_at IS NULL").bind(now, user.id),
    env.DB.prepare(`INSERT INTO email_change_requests(user_id, new_email, code_hash, created_at, expires_at, attempts, request_ip)
      VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6)`)
      .bind(user.id, newEmail, codeHash, now, now + codeMinutes * 60, clientIp(request)),
  ]);

  if (isEmailDevMode(env)) {
    return json({ message: "Email delivery is in development mode.", dev_code: code });
  }
  await sendEmailChangeCode(env, newEmail, code, codeMinutes);
  return json({ message: "A verification code was sent to your new email address." });
}

async function verifyEmailChange(request, env) {
  const user = await currentUser(request, env);
  const payload = await readJson(request);
  const newEmail = normalizeEmail(payload.email);
  const code = validateCode(payload.code);
  const now = nowTs();
  await cleanupAuthRows(env);

  const record = await env.DB.prepare(`SELECT * FROM email_change_requests
    WHERE user_id = ?1 AND new_email = ?2 AND confirmed_at IS NULL
    ORDER BY created_at DESC LIMIT 1`).bind(user.id, newEmail).first();
  if (!record || Number(record.expires_at) <= now) throw new ApiError(400, "That email-change code expired. Request a new one.");
  if (Number(record.attempts) >= 5) throw new ApiError(429, "Too many incorrect attempts. Request a new code.");

  const supplied = await digest(env, `${user.id}:${newEmail}:${code}`, "email-change-code");
  if (!constantTimeEqual(record.code_hash, supplied)) {
    await env.DB.prepare("UPDATE email_change_requests SET attempts = attempts + 1 WHERE id = ?1").bind(record.id).run();
    throw new ApiError(400, "That code is incorrect.");
  }

  const confirmationToken = randomToken();
  const confirmationHash = await digest(env, confirmationToken, "email-change-confirm");
  await env.DB.prepare("UPDATE email_change_requests SET verified_at = ?1, confirmation_token_hash = ?2 WHERE id = ?3")
    .bind(now, confirmationHash, record.id).run();

  return json({
    message: "New email verified. Confirm the change to finish.",
    confirmation_token: confirmationToken,
    current_email: user.email,
    new_email: newEmail,
  });
}

async function confirmEmailChange(request, env) {
  const user = await currentUser(request, env);
  const payload = await readJson(request);
  const confirmationToken = String(payload.confirmation_token || "").trim();
  if (confirmationToken.length < 32) throw new ApiError(422, "Email-change confirmation is invalid.");

  const now = nowTs();
  const confirmationHash = await digest(env, confirmationToken, "email-change-confirm");
  const record = await env.DB.prepare(`SELECT * FROM email_change_requests
    WHERE user_id = ?1 AND confirmation_token_hash = ?2 AND verified_at IS NOT NULL
      AND confirmed_at IS NULL AND expires_at > ?3
    ORDER BY id DESC LIMIT 1`).bind(user.id, confirmationHash, now).first();
  if (!record) throw new ApiError(400, "That email-change confirmation expired. Start again.");

  const newEmail = normalizeEmail(record.new_email);
  const oldEmail = normalizeEmail(user.email);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?1 AND id <> ?2").bind(newEmail, user.id).first();
  if (existing) throw new ApiError(409, "That email address is now used by another Lost Realm account.");

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET email = ?1 WHERE id = ?2").bind(newEmail, user.id),
    env.DB.prepare("UPDATE email_change_requests SET confirmed_at = ?1 WHERE id = ?2").bind(now, record.id),
    env.DB.prepare("UPDATE verification_codes SET used_at = ?1 WHERE email IN (?2, ?3) AND used_at IS NULL").bind(now, oldEmail, newEmail),
  ]);

  if (!isEmailDevMode(env)) {
    await Promise.allSettled([
      sendEmailChangedNotice(env, oldEmail, newEmail, true),
      sendEmailChangedNotice(env, newEmail, newEmail, false),
    ]);
  }

  return json({ message: `Your account email was changed to ${newEmail}.`, email: newEmail });
}

async function linkAccount(request, env) {
  const user = await currentUser(request, env);
  const payload = await readJson(request);
  const code = validateCode(payload.code);
  const codeHash = await digest(env, code, "link-code");
  const now = nowTs();
  const record = await env.DB.prepare("SELECT * FROM link_codes WHERE code_hash = ?1 AND used_at IS NULL AND expires_at > ?2").bind(codeHash, now).first();
  if (!record) throw new ApiError(400, "That Minecraft link code is invalid or expired.");
  const existing = await env.DB.prepare("SELECT id FROM users WHERE (minecraft_uuid = ?1 OR minecraft_name = ?2) AND id <> ?3").bind(record.minecraft_uuid, record.minecraft_name, user.id).first();
  if (existing) throw new ApiError(409, "That Minecraft account is already linked to another website account.");
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET minecraft_uuid = ?1, minecraft_name = ?2 WHERE id = ?3").bind(record.minecraft_uuid, record.minecraft_name, user.id),
    env.DB.prepare("UPDATE link_codes SET used_at = ?1 WHERE id = ?2").bind(now, record.id),
  ]);
  return json({ message: `Minecraft account ${record.minecraft_name} was linked successfully.` });
}

async function createLinkCode(env, minecraftName, minecraftUuid) {
  const now = nowTs();
  const code = randomSixDigitCode();
  const minutes = intEnv(env, "LINK_CODE_MINUTES", 15, 2);
  const codeHash = await digest(env, code, "link-code");
  await env.DB.batch([
    env.DB.prepare("UPDATE link_codes SET used_at = ?1 WHERE minecraft_uuid = ?2 AND used_at IS NULL").bind(now, minecraftUuid),
    env.DB.prepare(`INSERT INTO link_codes(code_hash, minecraft_uuid, minecraft_name, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(codeHash, minecraftUuid, minecraftName, now, now + minutes * 60),
  ]);
  return { code, minecraft_name: minecraftName, expires_in_minutes: minutes };
}

function requireServerSecret(request, env) {
  if (!env.LINK_API_SECRET) throw new ApiError(503, "LINK_API_SECRET is not configured.");
  const supplied = request.headers.get("X-Link-Secret") || "";
  if (!supplied || !constantTimeEqual(supplied, env.LINK_API_SECRET)) throw new ApiError(401, "Invalid Minecraft linking secret.");
}

async function minecraftLinkCode(request, env) {
  requireServerSecret(request, env);
  const payload = await readJson(request);
  return json(await createLinkCode(env, validateMinecraftName(payload.minecraft_name), validateMinecraftUuid(payload.minecraft_uuid)));
}

async function minecraftHeartbeat(request, env) {
  requireServerSecret(request, env);
  const payload = await readJson(request);
  const onlinePlayers = Math.max(0, Number.parseInt(payload.online_players ?? 0, 10) || 0);
  const maxPlayers = Math.max(1, Number.parseInt(payload.max_players ?? intEnv(env, "WEBSITE_MAX_PLAYERS", 500), 10) || 500);
  const latency = payload.latency_ms === null || payload.latency_ms === undefined ? null : Math.max(0, Number(payload.latency_ms) || 0);
  const host = String(env.MINECRAFT_SERVER_HOST || "play.thelostrealm.org").slice(0, 255);
  await env.DB.prepare(`
    INSERT INTO server_status(id, online_players, max_players, latency_ms, host, updated_at)
    VALUES (1, ?1, ?2, ?3, ?4, ?5)
    ON CONFLICT(id) DO UPDATE SET online_players=excluded.online_players, max_players=excluded.max_players,
      latency_ms=excluded.latency_ms, host=excluded.host, updated_at=excluded.updated_at
  `).bind(onlinePlayers, maxPlayers, latency, host, nowTs()).run();
  return json({ message: "Heartbeat received." });
}

async function developmentLinkCode(request, env) {
  if (String(env.DEMO_MODE || "false").toLowerCase() !== "true") throw new ApiError(404, "Not found.");
  const payload = await readJson(request);
  const name = validateMinecraftName(payload.minecraft_name);
  const uuid = payload.minecraft_uuid ? validateMinecraftUuid(payload.minecraft_uuid) : await offlineUuidHex(name);
  return json(await createLinkCode(env, name, uuid));
}

async function offlineUuidHex(name) {
  const digestBuffer = await crypto.subtle.digest("MD5", textEncoder.encode(`OfflinePlayer:${name}`)).catch(() => null);
  if (digestBuffer) return [...new Uint8Array(digestBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return [...secureRandomBytes(16)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function adminSummary(request, env) {
  const admin = await requireAdmin(request, env);
  const [total, linked, recentResult] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS total FROM users").first(),
    env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE minecraft_uuid IS NOT NULL").first(),
    env.DB.prepare("SELECT id, email, minecraft_name, created_at FROM users ORDER BY created_at DESC LIMIT 10").all(),
  ]);
  return json({
    administrator: admin.email,
    total_accounts: Number(total?.total || 0),
    linked_accounts: Number(linked?.total || 0),
    recent_accounts: (recentResult.results || []).map((row) => ({
      id: Number(row.id), email: row.email, minecraft_name: row.minecraft_name || null, created_at: isoTime(row.created_at),
    })),
  });
}

async function siteContent(request, env) {
  const [staffResult, imageResult] = await Promise.all([
    env.DB.prepare("SELECT * FROM staff_members WHERE visible = 1 ORDER BY sort_order ASC, id ASC").all(),
    env.DB.prepare("SELECT slot, image_url FROM site_images ORDER BY slot").all(),
  ]);
  const images = {};
  for (const row of imageResult.results || []) images[row.slot] = publicMediaUrl(row.image_url, request.url);
  return json({ staff: (staffResult.results || []).map((row) => rowToStaff(row, request.url)), images });
}

function validateStaffPayload(payload) {
  const name = String(payload.name || "").trim();
  const role = String(payload.role || "").trim();
  const description = String(payload.description || "").trim();
  const youtubeUrl = String(payload.youtube_url || "").trim();
  const iconUrl = String(payload.icon_url || "").trim();
  const sortOrder = Math.max(-10000, Math.min(10000, Number.parseInt(payload.sort_order ?? 100, 10) || 100));
  const visible = payload.visible === false ? 0 : 1;
  if (!name || name.length > 64) throw new ApiError(422, "Staff name is required and must be 64 characters or fewer.");
  if (!role || role.length > 64) throw new ApiError(422, "Staff role is required and must be 64 characters or fewer.");
  if (description.length > 500) throw new ApiError(422, "Staff description must be 500 characters or fewer.");
  if (youtubeUrl && !HTTPS_URL_RE.test(youtubeUrl)) throw new ApiError(422, "YouTube URL must begin with https://");
  if (iconUrl.length > MAX_IMAGE_DATA_LENGTH) throw new ApiError(422, "Uploaded image is too large.");
  if (iconUrl && !iconUrl.startsWith("assets/img/") && !HTTPS_URL_RE.test(iconUrl) && !DATA_IMAGE_RE.test(iconUrl)) throw new ApiError(422, "Icon must be a website image path, HTTPS URL, or uploaded PNG/JPEG/WebP image.");
  return { name, role, description, youtubeUrl, iconUrl, sortOrder, visible };
}

async function adminStaffList(request, env) {
  await requireAdmin(request, env);
  const result = await env.DB.prepare("SELECT * FROM staff_members ORDER BY sort_order ASC, id ASC").all();
  return json({ staff: (result.results || []).map((row) => rowToStaff(row, request.url)) });
}

async function adminStaffCreate(request, env) {
  await requireAdmin(request, env);
  const data = validateStaffPayload(await readJson(request));
  const now = nowTs();
  const inserted = await env.DB.prepare(`
    INSERT INTO staff_members(name, role, description, youtube_url, icon_url, sort_order, visible, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, '', ?5, ?6, ?7, ?7)
  `).bind(data.name, data.role, data.description, data.youtubeUrl, data.sortOrder, data.visible, now).run();
  const id = Number(inserted.meta.last_row_id);
  let iconValue = data.iconUrl;
  if (DATA_IMAGE_RE.test(iconValue)) iconValue = await saveDataImage(env, `staff:${id}`, iconValue, `media:staff:${id}`);
  await env.DB.prepare("UPDATE staff_members SET icon_url = ?1 WHERE id = ?2").bind(iconValue, id).run();
  const row = await env.DB.prepare("SELECT * FROM staff_members WHERE id = ?1").bind(id).first();
  return json({ message: "Staff member added.", staff_member: rowToStaff(row, request.url) }, 201);
}

async function adminStaffUpdate(request, env, id) {
  await requireAdmin(request, env);
  const existing = await env.DB.prepare("SELECT * FROM staff_members WHERE id = ?1").bind(id).first();
  if (!existing) throw new ApiError(404, "Staff member not found.");
  const data = validateStaffPayload(await readJson(request));
  let iconValue = data.iconUrl;
  const currentMediaUrl = `${new URL(request.url).origin}/api/media/staff/${id}`;
  if (iconValue === currentMediaUrl) iconValue = existing.icon_url;
  if (DATA_IMAGE_RE.test(iconValue)) iconValue = await saveDataImage(env, `staff:${id}`, iconValue, `media:staff:${id}`);
  if (String(existing.icon_url || "").startsWith("media:staff:") && !String(iconValue).startsWith("media:staff:")) await mediaStore(env).delete(`staff:${id}`);
  await env.DB.prepare(`
    UPDATE staff_members SET name=?1, role=?2, description=?3, youtube_url=?4, icon_url=?5,
      sort_order=?6, visible=?7, updated_at=?8 WHERE id=?9
  `).bind(data.name, data.role, data.description, data.youtubeUrl, iconValue, data.sortOrder, data.visible, nowTs(), id).run();
  const row = await env.DB.prepare("SELECT * FROM staff_members WHERE id = ?1").bind(id).first();
  return json({ message: "Staff member updated.", staff_member: rowToStaff(row, request.url) });
}

async function adminStaffDelete(request, env, id) {
  await requireAdmin(request, env);
  const existing = await env.DB.prepare("SELECT icon_url FROM staff_members WHERE id = ?1").bind(id).first();
  if (!existing) throw new ApiError(404, "Staff member not found.");
  await env.DB.prepare("DELETE FROM staff_members WHERE id = ?1").bind(id).run();
  if (String(existing.icon_url || "").startsWith("media:staff:")) await mediaStore(env).delete(`staff:${id}`);
  return json({ message: "Staff member removed." });
}

function requireImageSlot(slot) {
  if (!Object.prototype.hasOwnProperty.call(SITE_IMAGE_SLOTS, slot)) throw new ApiError(404, "Unknown website image slot.");
  return slot;
}

async function adminSiteImages(request, env) {
  await requireAdmin(request, env);
  const result = await env.DB.prepare("SELECT slot, image_url, updated_at FROM site_images").all();
  const custom = new Map((result.results || []).map((row) => [row.slot, row]));
  return json({ images: Object.entries(SITE_IMAGE_SLOTS).map(([slot, label]) => {
    const row = custom.get(slot);
    return { slot, label, image_url: row ? publicMediaUrl(row.image_url, request.url) : "", updated_at: row ? isoTime(row.updated_at) : null };
  }) });
}

async function adminSiteImageUpdate(request, env, slot) {
  await requireAdmin(request, env);
  const validSlot = requireImageSlot(slot);
  const payload = await readJson(request);
  let imageUrl = String(payload.image_url || "").trim();
  if (!imageUrl || imageUrl.length > MAX_IMAGE_DATA_LENGTH) throw new ApiError(422, "Image is missing or too large.");
  if (!imageUrl.startsWith("assets/img/") && !HTTPS_URL_RE.test(imageUrl) && !DATA_IMAGE_RE.test(imageUrl)) throw new ApiError(422, "Image must be a website image path, HTTPS URL, or uploaded PNG/JPEG/WebP image.");
  if (DATA_IMAGE_RE.test(imageUrl)) imageUrl = await saveDataImage(env, `site:${validSlot}`, imageUrl, `media:site:${validSlot}`);
  else await mediaStore(env).delete(`site:${validSlot}`);
  await env.DB.prepare(`
    INSERT INTO site_images(slot, image_url, updated_at) VALUES (?1, ?2, ?3)
    ON CONFLICT(slot) DO UPDATE SET image_url=excluded.image_url, updated_at=excluded.updated_at
  `).bind(validSlot, imageUrl, nowTs()).run();
  return json({ message: `${SITE_IMAGE_SLOTS[validSlot]} updated.` });
}

async function adminSiteImageReset(request, env, slot) {
  await requireAdmin(request, env);
  const validSlot = requireImageSlot(slot);
  await env.DB.prepare("DELETE FROM site_images WHERE slot = ?1").bind(validSlot).run();
  await mediaStore(env).delete(`site:${validSlot}`);
  return json({ message: `${SITE_IMAGE_SLOTS[validSlot]} reset to the built-in artwork.` });
}

async function saveDataImage(env, key, dataUrl, storedValue) {
  const match = dataUrl.match(DATA_IMAGE_RE);
  if (!match) throw new ApiError(422, "Use a PNG, JPEG, or WebP image.");
  const mime = match[1] === "jpeg" ? "image/jpeg" : `image/${match[1]}`;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  await mediaStore(env).put(key, bytes.buffer, { metadata: { contentType: mime } });
  return storedValue;
}

async function mediaResponse(env, key) {
  const result = await mediaStore(env).getWithMetadata(key, "arrayBuffer");
  if (!result.value) throw new ApiError(404, "Image not found.");
  return new Response(result.value, {
    headers: {
      "Content-Type": result.metadata?.contentType || "application/octet-stream",
      "Cache-Control": "public, max-age=300",
    },
  });
}

async function minecraftStatus(env) {
  const row = await env.DB.prepare("SELECT * FROM server_status WHERE id = 1").first();
  const maxFallback = intEnv(env, "WEBSITE_MAX_PLAYERS", 500, 1);
  const host = String(env.MINECRAFT_SERVER_HOST || "play.thelostrealm.org");
  if (!row || nowTs() - Number(row.updated_at || 0) > 90) {
    return json({ online: false, online_players: 0, max_players: Number(row?.max_players || maxFallback), latency_ms: null, host });
  }
  return json({
    online: true,
    online_players: Number(row.online_players || 0),
    max_players: Number(row.max_players || maxFallback),
    latency_ms: row.latency_ms === null ? null : Number(row.latency_ms),
    host: row.host || host,
  });
}

function news() {
  return json({ news: [
    { id: 1, headline: "The gates of the realm", category: "Realm News", summary: "The roads beyond Hearthvale are open to new adventurers." },
    { id: 2, headline: "Welcome to Hearthvale", category: "World Chronicle", summary: "Meet the village that stands at the edge of the forgotten road." },
  ] });
}

function ranks() {
  return json({ playtime: [
    { name: "Traveler", description: "The first step into the realm." },
    { name: "Adventurer", description: "For those who return to the road." },
    { name: "Knight", description: "A proven defender of the realm." },
    { name: "Champion", description: "A name remembered by the people." },
  ] });
}

function isEmailDevMode(env) {
  const demo = String(env.DEMO_MODE || "false").toLowerCase() === "true";
  return demo && !hasEmailProvider(env);
}

function hasEmailProvider(env) {
  return Boolean((env.GMAIL_WEB_APP_URL && env.GMAIL_MAILER_SECRET) || (env.RESEND_API_KEY && env.FROM_EMAIL));
}

async function sendEmailChangeCode(env, email, code, minutes) {
  const safeCode = escapeHtml(code);
  await sendEmail(env, {
    to: email,
    subject: `${code} confirms your Lost Realm email change`,
    text: `THE LOST REALM\n\nYou requested to use this email address for your Lost Realm account.\n\nVerification code: ${code}\n\nThis code expires in ${minutes} minutes.\nIf you did not request this change, you can ignore this email.`,
    html: `<div style="background:#0d0a09;padding:32px;font-family:Arial,sans-serif;color:#f0eadf"><div style="max-width:560px;margin:auto;background:#191510;border:1px solid #6f5935;border-radius:18px;padding:32px"><p style="color:#e2b869;letter-spacing:3px;font-size:12px;font-weight:bold">THE LOST REALM</p><h1 style="font-family:Georgia,serif;margin:8px 0 12px">Verify your new email</h1><p style="color:#bdb2a5">Enter this code on your account page to continue:</p><div style="margin:24px 0;padding:18px;text-align:center;background:#0d0a09;border:1px solid #6f5935;border-radius:12px;font-size:34px;letter-spacing:10px;font-weight:bold;color:#f6dda2">${safeCode}</div><p style="color:#aaa094">This code expires in ${minutes} minutes. If you did not request an email change, you can ignore this message.</p></div></div>`,
  });
}

async function sendEmailChangedNotice(env, recipient, newEmail, isOldAddress) {
  const safeNewEmail = escapeHtml(newEmail);
  const subject = isOldAddress ? "Your Lost Realm account email was changed" : "Your Lost Realm email is now active";
  const text = isOldAddress
    ? `THE LOST REALM\n\nThe email address on your Lost Realm account was changed to ${newEmail}.\n\nIf you made this change, no action is needed. If you did not make this change, contact Lost Realm support immediately.`
    : `THE LOST REALM\n\nThis email address is now the sign-in email for your Lost Realm account.\n\nYou can use it the next time you request a one-time sign-in code.`;
  const html = isOldAddress
    ? `<div style="background:#0d0a09;padding:32px;font-family:Arial,sans-serif;color:#f0eadf"><div style="max-width:560px;margin:auto;background:#191510;border:1px solid #6f5935;border-radius:18px;padding:32px"><p style="color:#e2b869;letter-spacing:3px;font-size:12px;font-weight:bold">THE LOST REALM</p><h1 style="font-family:Georgia,serif">Account email changed</h1><p style="color:#bdb2a5">The sign-in email for your Lost Realm account was changed to <strong style="color:#f6dda2">${safeNewEmail}</strong>.</p><p style="color:#aaa094">If you made this change, no action is needed. If you did not, contact Lost Realm support immediately.</p></div></div>`
    : `<div style="background:#0d0a09;padding:32px;font-family:Arial,sans-serif;color:#f0eadf"><div style="max-width:560px;margin:auto;background:#191510;border:1px solid #6f5935;border-radius:18px;padding:32px"><p style="color:#e2b869;letter-spacing:3px;font-size:12px;font-weight:bold">THE LOST REALM</p><h1 style="font-family:Georgia,serif">Email updated</h1><p style="color:#bdb2a5"><strong style="color:#f6dda2">${safeNewEmail}</strong> is now the sign-in email for your Lost Realm account.</p></div></div>`;
  await sendEmail(env, { to: recipient, subject, text, html });
}

async function sendSignInCode(env, email, code, minutes) {
  const safeCode = escapeHtml(code);
  await sendEmail(env, {
    to: email,
    subject: `${code} is your Lost Realm sign-in code`,
    text: `THE LOST REALM\n\nYour one-time sign-in code is: ${code}\n\nThis code expires in ${minutes} minutes.\nIf you did not request this code, you can ignore this email.`,
    html: `<div style="background:#0d0a09;padding:32px;font-family:Arial,sans-serif;color:#f0eadf"><div style="max-width:560px;margin:auto;background:#191510;border:1px solid #6f5935;border-radius:18px;padding:32px"><p style="color:#e2b869;letter-spacing:3px;font-size:12px;font-weight:bold">THE LOST REALM</p><h1 style="font-family:Georgia,serif;margin:8px 0 12px">Your sign-in code</h1><p style="color:#bdb2a5">Use this one-time code to enter your player portal:</p><div style="margin:24px 0;padding:18px;text-align:center;background:#0d0a09;border:1px solid #6f5935;border-radius:12px;font-size:34px;letter-spacing:10px;font-weight:bold;color:#f6dda2">${safeCode}</div><p style="color:#aaa094">This code expires in ${minutes} minutes. If you did not request it, you can safely ignore this email.</p></div></div>`,
  });
}

async function sendDataExport(env, email, data) {
  const pretty = JSON.stringify(data, null, 2);
  await sendEmail(env, {
    to: email,
    subject: "Your Lost Realm account data",
    text: `Here is the information currently stored for your Lost Realm website account:\n\n${pretty}`,
    html: `<div style="font-family:Arial,sans-serif"><h2>Your Lost Realm account data</h2><p>Below is the information currently stored for your website account.</p><pre style="background:#111;color:#eee;padding:16px;border-radius:10px;white-space:pre-wrap">${escapeHtml(pretty)}</pre></div>`,
  });
}

async function sendEmail(env, { to, subject, text, html }) {
  const fromName = String(env.FROM_NAME || "The Lost Realm Support");
  const replyTo = String(env.REPLY_TO_EMAIL || env.FROM_EMAIL || "").trim();

  if (env.GMAIL_WEB_APP_URL && env.GMAIL_MAILER_SECRET) {
    const response = await fetch(String(env.GMAIL_WEB_APP_URL), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret: String(env.GMAIL_MAILER_SECRET),
        to,
        subject,
        text,
        html,
        from_name: fromName,
        reply_to: replyTo,
      }),
      redirect: "follow",
    });
    let data = null;
    try { data = await response.json(); } catch { /* handled below */ }
    if (!response.ok || !data?.ok) throw new ApiError(502, data?.error || "Gmail delivery failed.");
    return;
  }

  const fromEmail = String(env.FROM_EMAIL || "");
  if (env.RESEND_API_KEY && fromEmail) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [to], subject, text, html }),
    });
    if (!response.ok) {
      let detail = "Email delivery failed.";
      try { const data = await response.json(); detail = data.message || detail; } catch { /* keep generic */ }
      throw new ApiError(502, detail);
    }
    return;
  }

  throw new ApiError(503, "Email delivery is not configured.");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
