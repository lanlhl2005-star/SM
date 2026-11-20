import crypto from "node:crypto";

/** Bumped from sm_draft_auth so old tunnel/localhost cookies cannot skip /login. */
export const COOKIE_NAME = "sm_draft_auth_v2";
export const LOGIN_PATH = "/login";
export const LOGOUT_PATH = "/logout";
export const AUTH_STATUS_PATH = "/api/auth-status";

/** HMAC salt version — changing this invalidates every prior session token. */
const SESSION_HMAC_SALT = "site-memo-draft-ui-v2";

/**
 * Password for Draft UI gate. Prefer DRAFT_UI_PASSWORD; UI_PASSWORD is an alias.
 * Blank/whitespace DRAFT_UI_PASSWORD falls through to UI_PASSWORD (so an empty
 * placeholder line in .env cannot disable a real UI_PASSWORD value).
 * Both empty / unset → no gate (local open access).
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function resolveDraftUiPassword(env = process.env) {
  const primary = env.DRAFT_UI_PASSWORD;
  if (primary !== undefined && String(primary).trim() !== "") {
    return String(primary).trim();
  }
  const alias = env.UI_PASSWORD;
  if (alias !== undefined && String(alias).trim() !== "") {
    return String(alias).trim();
  }
  return "";
}

/**
 * @param {string} password
 * @returns {string}
 */
export function sessionTokenForPassword(password) {
  return crypto
    .createHmac("sha256", SESSION_HMAC_SALT)
    .update(password)
    .digest("hex");
}

/**
 * @param {import("express").Request} req
 * @returns {Record<string, string>}
 */
export function parseCookies(req) {
  const header = req.headers?.cookie;
  if (!header) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const part of String(header).split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

/**
 * @param {string} token
 * @param {{ secure?: boolean }} [opts]
 * @returns {string}
 */
export function buildAuthSetCookie(token, opts = {}) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=604800",
  ];
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Clear the session cookie. Include Secure when the request is HTTPS so browsers
 * drop the Secure cookie that Cloudflare-tunnel logins set.
 * Also emit a clear for the legacy v1 cookie name.
 * @param {{ secure?: boolean }} [opts]
 * @returns {string[]}
 */
export function buildAuthClearCookies(opts = {}) {
  const base = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (opts.secure) base.push("Secure");
  const suffix = base.join("; ");
  return [
    `${COOKIE_NAME}=; ${suffix}`,
    // Legacy cookie from pre-v2 gate — clear so old sessions cannot linger.
    `sm_draft_auth=; ${suffix}`,
  ];
}

/** @deprecated Use buildAuthClearCookies */
export function buildAuthClearCookie(opts = {}) {
  return buildAuthClearCookies(opts)[0];
}

/**
 * @param {import("express").Request} req
 * @returns {boolean}
 */
export function requestLooksHttps(req) {
  if (req.secure) return true;
  const proto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return proto === "https";
}

/**
 * @param {string} [errorMessage]
 * @param {string} [nextPath]
 * @returns {string}
 */
export function loginPageHtml(errorMessage = "", nextPath = "/") {
  const err = errorMessage
    ? `<p class="err" role="alert">${escapeHtml(errorMessage)}</p>`
    : "";
  const next = safeNextPath(nextPath);
  const nextField =
    next && next !== "/"
      ? `\n      <input type="hidden" name="next" value="${escapeHtml(next)}" />`
      : `\n      <input type="hidden" name="next" value="/" />`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta http-equiv="Cache-Control" content="no-store" />
  <title>Site Memo Draft — Login</title>
  <style>
    :root { color-scheme: light; --ink: #1a1a1a; --muted: #5a5a5a; --line: #c8c8c8; --bg: #f6f4f0; --err: #8b1a1a; }
    * { box-sizing: border-box; }
    html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
    body {
      margin: 0;
      min-height: 100vh;
      min-height: 100dvh;
      display: grid;
      place-items: center;
      padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
      font-family: "Segoe UI", Tahoma, sans-serif;
      background: linear-gradient(160deg, #ebe6de 0%, #f6f4f0 45%, #e2e8e4 100%);
      color: var(--ink);
    }
    main { width: min(22rem, 100%); padding: 1.5rem 1.4rem 1.6rem; border: 1px solid var(--line); background: rgba(255,255,255,0.92); border-radius: 10px; }
    h1 { margin: 0 0 0.35rem; font-size: 1.25rem; font-weight: 650; }
    p.sub { margin: 0 0 1.1rem; color: var(--muted); font-size: 0.9rem; line-height: 1.35; }
    label { display: block; font-size: 0.85rem; margin-bottom: 0.35rem; }
    input[type="password"] {
      width: 100%;
      min-height: 2.75rem;
      padding: 0.65rem 0.75rem;
      border: 1px solid var(--line);
      border-radius: 6px;
      font: inherit;
      font-size: 1rem;
    }
    button {
      margin-top: 0.9rem;
      width: 100%;
      min-height: 2.85rem;
      padding: 0.7rem 0.85rem;
      border: 1px solid #333;
      border-radius: 6px;
      background: #222;
      color: #fff;
      font: inherit;
      font-size: 1rem;
      cursor: pointer;
    }
    button:hover { background: #000; }
    .err { margin: 0 0 0.85rem; color: var(--err); font-size: 0.9rem; }
    .hint { margin: 1rem 0 0; color: var(--muted); font-size: 0.8rem; line-height: 1.4; }
    .hint a { color: var(--ink); }
  </style>
</head>
<body>
  <main>
    <h1>Site Memo Draft</h1>
    <p class="sub">Enter the Draft UI password to continue.</p>
    ${err}
    <form method="post" action="${LOGIN_PATH}" autocomplete="current-password">${nextField}
      <label for="password">Password</label>
      <input id="password" name="password" type="password" required autofocus />
      <button type="submit">Sign in</button>
    </form>
    <p class="hint">Already signed in on this browser? <a href="${LOGOUT_PATH}">Sign out</a> (or open with <code>?logout=1</code>).</p>
  </main>
</body>
</html>`;
}

/**
 * @param {string} s
 * @returns {string}
 */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} expectedToken
 * @param {string | undefined} got
 * @returns {boolean}
 */
export function tokensMatch(expectedToken, got) {
  if (!got || typeof got !== "string") return false;
  const a = Buffer.from(expectedToken);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Paths that stay reachable without a session when the gate is on.
 * @param {string} pathOnly
 * @returns {boolean}
 */
export function isPublicAuthPath(pathOnly) {
  const p = String(pathOnly || "");
  return (
    p === LOGIN_PATH ||
    p === `${LOGIN_PATH}/` ||
    p === LOGOUT_PATH ||
    p === `${LOGOUT_PATH}/` ||
    p === AUTH_STATUS_PATH
  );
}

/**
 * @param {import("express").Request} req
 * @returns {boolean}
 */
export function requestWantsLogout(req) {
  const q = req.query?.logout;
  if (q === undefined || q === null) return false;
  const raw = Array.isArray(q) ? q[0] : q;
  const s = String(raw).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "";
}

/**
 * Build Express middleware + login/logout routes when password is set.
 * When password is empty, returns a no-op middleware (open local access) but
 * still mounts public auth-status + logout (no-op clear).
 *
 * @param {{ password?: string }} [opts]
 * @returns {{
 *   enabled: boolean,
 *   passwordLength: number,
 *   middleware: import("express").RequestHandler,
 *   mountLoginRoutes: (app: import("express").Express) => void
 * }}
 */
export function createDraftUiAuth(opts = {}) {
  const password = String(opts.password ?? resolveDraftUiPassword()).trim();
  const passwordLength = password.length;

  if (!password) {
    return {
      enabled: false,
      passwordLength: 0,
      middleware(_req, _res, next) {
        next();
      },
      mountLoginRoutes(app) {
        mountPublicAuthStatus(app, false);
        app.get(LOGOUT_PATH, (req, res) => {
          res.setHeader("Cache-Control", "no-store");
          for (const c of buildAuthClearCookies({
            secure: requestLooksHttps(req),
          })) {
            res.append("Set-Cookie", c);
          }
          res.redirect(302, "/");
        });
      },
    };
  }

  const expectedToken = sessionTokenForPassword(password);

  /** @type {import("express").RequestHandler} */
  function middleware(req, res, next) {
    res.setHeader("Cache-Control", "no-store");

    // ?logout=1 on any URL clears the session and forces the login page.
    if (requestWantsLogout(req)) {
      for (const c of buildAuthClearCookies({
        secure: requestLooksHttps(req),
      })) {
        res.append("Set-Cookie", c);
      }
      return res.redirect(302, LOGIN_PATH);
    }

    const pathOnly = String(req.path || "");
    if (isPublicAuthPath(pathOnly)) return next();

    const cookies = parseCookies(req);
    if (tokensMatch(expectedToken, cookies[COOKIE_NAME])) return next();

    // APIs and non-document fetches get 401 JSON; navigations/static get login redirect.
    const accept = String(req.headers.accept || "");
    const wantsJson =
      pathOnly.startsWith("/api/") ||
      accept.includes("application/json") ||
      String(req.headers["x-requested-with"] || "").toLowerCase() ===
        "xmlhttprequest";

    if (wantsJson || pathOnly.startsWith("/api/")) {
      return res.status(401).json({
        error: "Unauthorized",
        login: LOGIN_PATH,
        authRequired: true,
      });
    }

    const nextUrl = `${req.originalUrl || "/"}`;
    const q =
      nextUrl &&
      nextUrl !== LOGIN_PATH &&
      !nextUrl.startsWith(`${LOGIN_PATH}?`) &&
      !nextUrl.includes("logout=")
        ? `?next=${encodeURIComponent(nextUrl)}`
        : "";
    return res.redirect(302, `${LOGIN_PATH}${q}`);
  }

  /**
   * @param {import("express").Express} app
   */
  function mountLoginRoutes(app) {
    mountPublicAuthStatus(app, true);

    app.get(LOGIN_PATH, (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (requestWantsLogout(req)) {
        for (const c of buildAuthClearCookies({
          secure: requestLooksHttps(req),
        })) {
          res.append("Set-Cookie", c);
        }
        return res.type("html").status(200).send(loginPageHtml("Signed out.", "/"));
      }
      const cookies = parseCookies(req);
      if (tokensMatch(expectedToken, cookies[COOKIE_NAME])) {
        const next = safeNextPath(req.query?.next);
        return res.redirect(302, next);
      }
      const next = safeNextPath(req.query?.next);
      res.type("html").status(200).send(loginPageHtml("", next));
    });

    app.post(LOGIN_PATH, (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const submitted = String(body.password ?? "").trim();
      const next = safeNextPath(body.next ?? req.query?.next);

      if (submitted === password) {
        res.setHeader(
          "Set-Cookie",
          buildAuthSetCookie(expectedToken, {
            secure: requestLooksHttps(req),
          })
        );
        return res.redirect(302, next);
      }

      res.type("html").status(401).send(loginPageHtml("Incorrect password.", next));
    });

    app.get(LOGOUT_PATH, (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      for (const c of buildAuthClearCookies({
        secure: requestLooksHttps(req),
      })) {
        res.append("Set-Cookie", c);
      }
      res.type("html").status(200).send(loginPageHtml("Signed out.", "/"));
    });

    app.post(LOGOUT_PATH, (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      for (const c of buildAuthClearCookies({
        secure: requestLooksHttps(req),
      })) {
        res.append("Set-Cookie", c);
      }
      res.redirect(302, LOGIN_PATH);
    });
  }

  return {
    enabled: true,
    passwordLength,
    middleware,
    mountLoginRoutes,
  };
}

/**
 * @param {import("express").Express} app
 * @param {boolean} authRequired
 */
function mountPublicAuthStatus(app, authRequired) {
  app.get(AUTH_STATUS_PATH, (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      authRequired: Boolean(authRequired),
      login: LOGIN_PATH,
      logout: LOGOUT_PATH,
    });
  });
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function safeNextPath(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  const s = String(raw ?? "/").trim() || "/";
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("://")) return "/";
  if (s === LOGIN_PATH || s.startsWith(`${LOGIN_PATH}?`)) return "/";
  if (s === LOGOUT_PATH || s.startsWith(`${LOGOUT_PATH}?`)) return "/";
  // Strip logout query so post-login redirect does not immediately sign out.
  if (/(?:^|[?&])logout=/i.test(s)) {
    try {
      const u = new URL(s, "http://local.invalid");
      u.searchParams.delete("logout");
      const cleaned = u.pathname + (u.search || "");
      return cleaned === LOGIN_PATH ? "/" : cleaned || "/";
    } catch {
      return "/";
    }
  }
  return s;
}
