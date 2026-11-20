import crypto from "node:crypto";

export const COOKIE_NAME = "sm_draft_auth";
export const LOGIN_PATH = "/login";

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
  return crypto.createHmac("sha256", "site-memo-draft-ui-v1").update(password).digest("hex");
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
 * @returns {string}
 */
export function buildAuthClearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
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
 * Build Express middleware + login routes when password is set.
 * When password is empty, returns a no-op middleware (open local access).
 *
 * @param {{ password?: string }} [opts]
 * @returns {{ enabled: boolean, middleware: import("express").RequestHandler, mountLoginRoutes: (app: import("express").Express) => void }}
 */
export function createDraftUiAuth(opts = {}) {
  const password = String(opts.password ?? resolveDraftUiPassword()).trim();
  if (!password) {
    return {
      enabled: false,
      middleware(_req, _res, next) {
        next();
      },
      mountLoginRoutes() {},
    };
  }

  const expectedToken = sessionTokenForPassword(password);

  /** @type {import("express").RequestHandler} */
  function middleware(req, res, next) {
    // Fail closed: only /login is public when a password is configured.
    const pathOnly = String(req.path || "");
    if (pathOnly === LOGIN_PATH || pathOnly === `${LOGIN_PATH}/`) return next();

    const cookies = parseCookies(req);
    if (tokensMatch(expectedToken, cookies[COOKIE_NAME])) return next();

    res.setHeader("Cache-Control", "no-store");

    // APIs and non-document fetches get 401 JSON; navigations/static get login redirect.
    const accept = String(req.headers.accept || "");
    const wantsJson =
      pathOnly.startsWith("/api/") ||
      accept.includes("application/json") ||
      String(req.headers["x-requested-with"] || "").toLowerCase() === "xmlhttprequest";

    if (wantsJson || pathOnly.startsWith("/api/")) {
      return res.status(401).json({
        error: "Unauthorized",
        login: LOGIN_PATH,
      });
    }

    const nextUrl = `${req.originalUrl || "/"}`;
    const q =
      nextUrl && nextUrl !== LOGIN_PATH && !nextUrl.startsWith(`${LOGIN_PATH}?`)
        ? `?next=${encodeURIComponent(nextUrl)}`
        : "";
    return res.redirect(302, `${LOGIN_PATH}${q}`);
  }

  /**
   * @param {import("express").Express} app
   */
  function mountLoginRoutes(app) {
    app.get(LOGIN_PATH, (req, res) => {
      const cookies = parseCookies(req);
      if (tokensMatch(expectedToken, cookies[COOKIE_NAME])) {
        const next = safeNextPath(req.query?.next);
        return res.redirect(302, next);
      }
      res.setHeader("Cache-Control", "no-store");
      const next = safeNextPath(req.query?.next);
      res.type("html").status(200).send(loginPageHtml("", next));
    });

    app.post(LOGIN_PATH, (req, res) => {
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

      res.setHeader("Cache-Control", "no-store");
      res.type("html").status(401).send(loginPageHtml("Incorrect password.", next));
    });
  }

  return { enabled: true, middleware, mountLoginRoutes };
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
  return s;
}
