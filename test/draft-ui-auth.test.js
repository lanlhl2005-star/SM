import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import express from "express";
import {
  COOKIE_NAME,
  LOGIN_PATH,
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

  const html = await request(app, { path: "/" });
  assert.equal(html.status, 302);
  assert.match(String(html.headers.location), new RegExp(`^${LOGIN_PATH}`));

  const api = await request(app, { path: "/api/health" });
  assert.equal(api.status, 401);
  assert.equal(api.json()?.error, "Unauthorized");
});

test("auth rejects static assets without cookie", async () => {
  const { app } = buildTestApp("test-password");
  const css = await request(app, { path: "/styles.css" });
  assert.equal(css.status, 302);
  assert.match(String(css.headers.location), new RegExp(`^${LOGIN_PATH}`));
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
  const setCookie = String(login.headers["set-cookie"] || "");
  assert.match(setCookie, new RegExp(`${COOKIE_NAME}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.doesNotMatch(setCookie, /;\s*Secure/i);

  const cookiePair = setCookie.split(";")[0];
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
  const setCookie = String(login.headers["set-cookie"] || "");
  assert.match(setCookie, /;\s*Secure/i);
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
});
