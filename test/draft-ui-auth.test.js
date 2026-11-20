import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import express from "express";
import {
  AUTH_STATUS_PATH,
  COOKIE_NAME,
  LOGIN_PATH,
  LOGOUT_PATH,
  buildAuthClearCookies,
  buildAuthSetCookie,
  createDraftUiAuth,
  requestLooksHttps,
  resolveDraftUiPassword,
  sessionTokenForPassword,
} from "../src/draft-ui-auth.js";
import { createApp } from "../src/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

test("resolveDraftUiPassword prefers DRAFT_UI_PASSWORD over UI_PASSWORD", () => {
  assert.equal(resolveDraftUiPassword({}), "");
  assert.equal(resolveDraftUiPassword({ DRAFT_UI_PASSWORD: "  " }), "");
  assert.equal(resolveDraftUiPassword({ DRAFT_UI_PASSWORD: "secret" }), "secret");
  assert.equal(resolveDraftUiPassword({ UI_PASSWORD: "alias" }), "alias");
  assert.equal(
    resolveDraftUiPassword({ DRAFT_UI_PASSWORD: "a", UI_PASSWORD: "b" }),
    "a"
  );
});

test("blank DRAFT_UI_PASSWORD falls through to UI_PASSWORD", () => {
  assert.equal(
    resolveDraftUiPassword({ DRAFT_UI_PASSWORD: "", UI_PASSWORD: "alias" }),
    "alias"
  );
  assert.equal(
    resolveDraftUiPassword({ DRAFT_UI_PASSWORD: "   ", UI_PASSWORD: "alias" }),
    "alias"
  );
});

test("cookie name is v2 so legacy sm_draft_auth sessions cannot skip login", () => {
  assert.equal(COOKIE_NAME, "sm_draft_auth_v2");
  const legacy = crypto
    .createHmac("sha256", "site-memo-draft-ui-v1")
    .update("same")
    .digest("hex");
  assert.notEqual(sessionTokenForPassword("same"), legacy);
});

/**
 * @param {string} password
 */
function buildTestApp(password) {
  const auth = createDraftUiAuth({ password });
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  auth.mountLoginRoutes(app);
  app.use(auth.middleware);
  app.get("/", (_req, res) => res.type("html").send("<html>ok</html>"));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/styles.css", (_req, res) => res.type("css").send("body{}"));
  return { app, auth };
}

/**
 * @param {import("express").Express} app
 * @param {import("http").RequestOptions & { body?: string | object }} opts
 */
function request(app, opts) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {import("net").AddressInfo} */ (server.address());
      const headers = { ...(opts.headers || {}) };
      let body = opts.body;
      if (body && typeof body === "object") {
        body = new URLSearchParams(
          Object.entries(body).map(([k, v]) => [k, String(v)])
        ).toString();
        headers["Content-Type"] =
          headers["Content-Type"] || "application/x-www-form-urlencoded";
      }
      if (body != null) {
        headers["Content-Length"] = Buffer.byteLength(String(body));
      }
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: opts.path || "/",
          method: opts.method || "GET",
          headers,
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            server.close();
            const text = Buffer.concat(chunks).toString("utf8");
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              text,
              json: () => {
                try {
                  return JSON.parse(text);
                } catch {
                  return null;
                }
              },
            });
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (body != null) req.write(String(body));
      req.end();
    });
  });
}

/** @param {string | string[] | undefined} setCookie */
function setCookieHeader(setCookie) {
  if (!setCookie) return "";
  return Array.isArray(setCookie) ? setCookie.join("\n") : String(setCookie);
}

test("auth disabled when password empty: open access", async () => {
  const { app, auth } = buildTestApp("");
  assert.equal(auth.enabled, false);
  const html = await request(app, { path: "/" });
  assert.equal(html.status, 200);
  assert.match(html.text, /ok/);
  const api = await request(app, { path: "/api/health" });
  assert.equal(api.status, 200);
  assert.equal(api.json()?.ok, true);
});

test("auth rejects HTML and API without cookie", async () => {
  const { app, auth } = buildTestApp("test-password");
  assert.equal(auth.enabled, true);
  assert.equal(auth.passwordLength, "test-password".length);

  const html = await request(app, { path: "/" });
  assert.equal(html.status, 302);
  assert.match(String(html.headers.location), new RegExp(`^${LOGIN_PATH}`));
  assert.match(String(html.headers["cache-control"] || ""), /no-store/i);

  const api = await request(app, { path: "/api/health" });
  assert.equal(api.status, 401);
  assert.equal(api.json()?.error, "Unauthorized");
  assert.equal(api.json()?.authRequired, true);
});

test("auth rejects static assets without cookie", async () => {
  const { app } = buildTestApp("test-password");
  const css = await request(app, { path: "/styles.css" });
  assert.equal(css.status, 302);
  assert.match(String(css.headers.location), new RegExp(`^${LOGIN_PATH}`));
});

test("legacy v1 cookie name is rejected", async () => {
  const password = "test-password";
  const { app } = buildTestApp(password);
  const token = sessionTokenForPassword(password);
  const api = await request(app, {
    path: "/api/health",
    headers: { Cookie: `sm_draft_auth=${token}` },
  });
  assert.equal(api.status, 401);
});

test("auth accepts valid session cookie", async () => {
  const password = "test-password";
  const { app } = buildTestApp(password);
  const token = sessionTokenForPassword(password);
  const api = await request(app, {
    path: "/api/health",
    headers: { Cookie: `${COOKIE_NAME}=${token}` },
  });
  assert.equal(api.status, 200);
  assert.equal(api.json()?.ok, true);

  const html = await request(app, {
    path: "/",
    headers: { Cookie: `${COOKIE_NAME}=${encodeURIComponent(token)}` },
  });
  assert.equal(html.status, 200);
  assert.match(html.text, /ok/);
});

test("auth rejects wrong cookie and wrong login password", async () => {
  const { app } = buildTestApp("correct-password");
  const bad = await request(app, {
    path: "/api/health",
    headers: { Cookie: `${COOKIE_NAME}=deadbeef` },
  });
  assert.equal(bad.status, 401);

  const login = await request(app, {
    method: "POST",
    path: LOGIN_PATH,
    body: { password: "wrong" },
  });
  assert.equal(login.status, 401);
  assert.match(login.text, /Incorrect password/);
});

test("login form sets cookie and allows API", async () => {
  const password = "gate-secret";
  const { app } = buildTestApp(password);
  const login = await request(app, {
    method: "POST",
    path: LOGIN_PATH,
    body: { password, next: "/api/health" },
  });
  assert.equal(login.status, 302);
  assert.equal(login.headers.location, "/api/health");
  const setCookie = setCookieHeader(login.headers["set-cookie"]);
  assert.match(setCookie, new RegExp(`${COOKIE_NAME}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.doesNotMatch(setCookie, /;\s*Secure/i);

  const cookiePair = setCookie.split(/[\r\n]/)[0].split(";")[0];
  const api = await request(app, {
    path: "/api/health",
    headers: { Cookie: cookiePair },
  });
  assert.equal(api.status, 200);
  assert.equal(api.json()?.ok, true);
});

test("login over Cloudflare HTTPS sets Secure cookie", async () => {
  const password = "tunnel-secret";
  const { app } = buildTestApp(password);
  const login = await request(app, {
    method: "POST",
    path: LOGIN_PATH,
    headers: { "X-Forwarded-Proto": "https" },
    body: { password, next: "/" },
  });
  assert.equal(login.status, 302);
  const setCookie = setCookieHeader(login.headers["set-cookie"]);
  assert.match(setCookie, /;\s*Secure/i);
});

test("logout clears Secure cookie on HTTPS tunnel", async () => {
  const password = "tunnel-secret";
  const { app } = buildTestApp(password);
  const token = sessionTokenForPassword(password);
  const out = await request(app, {
    path: LOGOUT_PATH,
    headers: {
      "X-Forwarded-Proto": "https",
      Cookie: `${COOKIE_NAME}=${token}`,
    },
  });
  assert.equal(out.status, 200);
  assert.match(out.text, /Signed out|password/i);
  const setCookie = setCookieHeader(out.headers["set-cookie"]);
  assert.match(setCookie, new RegExp(`${COOKIE_NAME}=`));
  assert.match(setCookie, /Max-Age=0/i);
  assert.match(setCookie, /;\s*Secure/i);
  assert.match(setCookie, /sm_draft_auth=/);
});

test("?logout=1 clears session and redirects to login", async () => {
  const password = "session-secret";
  const { app } = buildTestApp(password);
  const token = sessionTokenForPassword(password);
  const res = await request(app, {
    path: "/?logout=1",
    headers: { Cookie: `${COOKIE_NAME}=${token}` },
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, LOGIN_PATH);
  const setCookie = setCookieHeader(res.headers["set-cookie"]);
  assert.match(setCookie, /Max-Age=0/i);
});

test("public /api/auth-status reports authRequired without cookie", async () => {
  const { app } = buildTestApp("gate");
  const res = await request(app, { path: AUTH_STATUS_PATH });
  assert.equal(res.status, 200);
  assert.equal(res.json()?.authRequired, true);
  assert.equal(res.json()?.login, LOGIN_PATH);
  assert.equal(res.json()?.logout, LOGOUT_PATH);
});

test("requestLooksHttps uses x-forwarded-proto without requiring localhost HTTPS", () => {
  assert.equal(requestLooksHttps({ secure: false, headers: {} }), false);
  assert.equal(
    requestLooksHttps({
      secure: false,
      headers: { "x-forwarded-proto": "https" },
    }),
    true
  );
  assert.equal(
    requestLooksHttps({
      secure: false,
      headers: { "x-forwarded-proto": "http" },
    }),
    false
  );
  assert.equal(requestLooksHttps({ secure: true, headers: {} }), true);
});

test("buildAuthSetCookie Secure only when requested", () => {
  const token = "abc";
  assert.doesNotMatch(buildAuthSetCookie(token, { secure: false }), /Secure/);
  assert.match(buildAuthSetCookie(token, { secure: true }), /Secure/);
});

test("buildAuthClearCookies includes Secure when requested", () => {
  const cookies = buildAuthClearCookies({ secure: true });
  assert.ok(cookies.length >= 2);
  assert.match(cookies[0], /Secure/);
  assert.match(cookies[1], /sm_draft_auth=/);
});

test("createApp gates HTML, static, guide image, and all API routes", async () => {
  const password = "integration-secret";
  const { app, draftUiAuth } = createApp({
    password,
    publicDir,
  });
  assert.equal(draftUiAuth.enabled, true);

  const paths = [
    "/",
    "/index.html",
    "/app.js",
    "/styles.css",
    "/guide/sm-sample-annotated.jpg",
    "/api/health",
    "/api/groups",
    "/api/days",
    "/api/photos",
    "/api/photo-file",
    "/api/defaults",
    "/api/open-hint",
  ];

  for (const p of paths) {
    const res = await request(app, { path: p });
    if (p.startsWith("/api/")) {
      assert.equal(res.status, 401, `${p} should be 401`);
      assert.equal(res.json()?.error, "Unauthorized", `${p} body`);
    } else {
      assert.equal(res.status, 302, `${p} should redirect`);
      assert.match(
        String(res.headers.location),
        new RegExp(`^${LOGIN_PATH}`),
        `${p} location`
      );
    }
  }

  const status = await request(app, { path: AUTH_STATUS_PATH });
  assert.equal(status.status, 200);
  assert.equal(status.json()?.authRequired, true);

  const postDraft = await request(app, {
    method: "POST",
    path: "/api/drafts",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(postDraft.status, 401);

  const loginPage = await request(app, { path: LOGIN_PATH });
  assert.equal(loginPage.status, 200);
  assert.match(loginPage.text, /password/i);
});

test("createApp with empty password stays open (local-only design)", async () => {
  const { app, draftUiAuth } = createApp({ password: "", publicDir });
  assert.equal(draftUiAuth.enabled, false);
  const res = await request(app, { path: "/api/health" });
  assert.equal(res.status, 200);
  assert.equal(res.json()?.ok, true);
  assert.equal(res.json()?.auth, false);
  assert.equal(res.json()?.authRequired, false);
  const status = await request(app, { path: AUTH_STATUS_PATH });
  assert.equal(status.status, 200);
  assert.equal(status.json()?.authRequired, false);
});
