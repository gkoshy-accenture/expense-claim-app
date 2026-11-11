# Expense claim app

A small web app for the AI Factory workshop. It has a claim form, a list of submitted claims and a few unit tests. It has **no dependencies**, so there is nothing to `npm install`.

## Run it on your machine

Requires Node.js 18 or newer.

```
npm test
npm start
```

Open http://127.0.0.1:3000. Claims are kept in memory and cleared when the app restarts.

## Workshop: make your change

1. Create a branch named after your username, for example `user07`.
2. Edit `public/config.json` and put your name in `workshopper`.
3. Run `npm test`, then commit and push your branch.
4. Ask Copilot to trigger the Jenkins job for your branch, check the build result, and open the deployed app to see your name in the header.

Everyone deploys to the same place, so the most recent deploy is the one you see.

## Rules for changing the code

- **Use relative URLs only.** The app is served under `/myapp/`, so write `api/claims` and `style.css`, not `/api/claims`. A test fails if you break this.
- Keep `npm test` passing. Jenkins runs it before every deploy.
- Do not add dependencies. The Jenkins server does not run `npm install`.

## Project layout

| Path | Purpose |
|---|---|
| `server.js` | HTTP server and API (`/api/claims`, `/api/categories`, `/health`) |
| `lib/claims.js` | Validation and the in-memory store |
| `public/` | Page, styles, script and `config.json` |
| `test/` | Unit tests (`node --test`) |
| `deploy/` | Host-only files: Jenkins pipeline, systemd unit, VM setup script, Caddy example |
