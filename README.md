# Continuum — run locally & deploy

## Fastest path: deploy with no code editor at all (Vercel + GitHub, all in browser)

You don't need VS Code or a terminal for this. Everything happens on
github.com and vercel.com in your browser.

1. **Put the files on GitHub.** Go to https://github.com/new, create a
   repo (any name, e.g. `continuum-ai`). On the repo page click
   "uploading an existing file" and drag in every file/folder from this
   project (keep the folder structure: `api/`, `src/`, `index.html`,
   `package.json`, `vite.config.js`). Commit.
   - Do NOT upload `.env` if you made one locally — it's meant to stay secret.
2. **Import it into Vercel.** Go to https://vercel.com, sign up with your
   GitHub account, click "Add New… → Project", pick the repo you just
   made. Vercel auto-detects it's a Vite app — leave the defaults.
3. **Add your API key.** Before clicking Deploy, open "Environment
   Variables" and add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your real key from https://console.anthropic.com/settings/keys
4. Click **Deploy**. In about a minute you'll get a live URL like
   `https://continuum-ai.vercel.app` — that's your finished, working app,
   sign-up page and all.

This works because the `api/chat.js` file in this project is a Vercel
serverless function — Vercel automatically turns it into a live backend
endpoint, so you don't need to separately host `server/index.js` at all
for this path.

Any time you change a file on GitHub (even editing directly in the GitHub
web UI), Vercel automatically redeploys.

---

## Alternative: run locally in VS Code

This is the VS Code-ready version of the Continuum AI chat app. Two things
had to change from the Claude.ai artifact version, because those two
features only exist inside Claude.ai's sandbox:

1. **`window.storage`** (chat history) → replaced with a `localStorage`
   shim in `src/storage.js` that has the exact same `get/set/delete/list`
   API, so `App.jsx` didn't need to change. This means saved chats live
   only in the browser you used — for real multi-device accounts you'd
   swap this for calls to a real database.
2. **Calling `api.anthropic.com` directly from the browser** → this needs
   an API key, and a key can never live in frontend code (anyone could
   steal it from the browser). So there's now a tiny Express server
   (`server/index.js`) that holds the key and proxies requests. The React
   app calls `/api/chat` on your own server instead.

## 1. Install

```bash
cd continuum-project
npm install
```

## 2. Add your Anthropic API key

```bash
cp .env.example .env
```

Open `.env` and paste your real key (get one at https://console.anthropic.com/settings/keys):

```
ANTHROPIC_API_KEY=sk-ant-...
```

## 3. Run it

```bash
npm run dev
```

This starts both the Vite frontend (http://localhost:5173) and the
Express backend (http://localhost:8787) together. Open
http://localhost:5173 in your browser.

## 4. Deploy it

You need to deploy two pieces: the frontend (static React build) and the
backend (the small Express proxy holding your API key).

**Frontend — Vercel or Netlify (both have free tiers):**
```bash
npm run build
```
This creates a `dist/` folder. Drag it into Netlify, or connect the repo
to Vercel and set the build command to `vite build` and output directory
to `dist`.

**Backend — Render, Railway, or Fly.io (all have free/cheap tiers):**
- Push this project to GitHub.
- Create a new "Web Service" on Render (or similar) pointing at the
  `server/` start command: `node server/index.js`.
- Add an environment variable `ANTHROPIC_API_KEY` with your real key in
  the host's dashboard (never commit `.env` to GitHub — it's already
  gitignored).
- Once deployed you'll get a URL like `https://continuum-api.onrender.com`.

**Connect them:** in your frontend hosting dashboard (Vercel/Netlify), add
an environment variable:
```
VITE_API_URL=https://continuum-api.onrender.com
```
Redeploy the frontend — it will now call your live backend instead of
`localhost:8787`.

## Notes

- The signup/login system stores password hashes with a simple demo hash
  (`btoa`), not real cryptographic hashing (bcrypt/argon2). Fine for a
  personal project, not for anything with real users' real passwords.
- Chat images are sent as base64 in the request body — the 20MB body
  limit in `server/index.js` should be plenty, but very large images may
  need compressing client-side first.
