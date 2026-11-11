# Expense claim app

A small web app for the AI Factory workshop. It has a claim form, a list of submitted claims and a few unit tests. It has **no dependencies**, so there is nothing to `npm install`.

## Run it on your machine

Requires Node.js 22.13 or newer. Run `npm install` once (it installs the `mssql` driver for Azure SQL).

```
npm test
npm start
```

Open http://127.0.0.1:3000. With no database settings, the app uses a local SQLite file (`data/claims.db`, created on first run; delete it to start fresh). On the workshop server, the host supplies Azure SQL settings, so deployed builds use the shared Azure SQL database. Node prints an "experimental" warning for SQLite, which is harmless.

## Workshop: make your change

1. Create a branch named after your username, for example `user07`.
2. Edit `public/config.json` and put your name in `workshopper`.
3. Run `npm test`, then commit and push your branch.
4. Ask Copilot to trigger the Jenkins job for your branch, check the build result, and open the deployed app to see your name in the header.

Everyone deploys to the same place, so the most recent deploy is the one you see.

## Rules for changing the code

- **Use relative URLs only.** The app is served under `/myapp/`, so write `api/claims` and `style.css`, not `/api/claims`. A test fails if you break this.
- Keep `npm test` passing. Jenkins runs it before every deploy.
- Do not add new dependencies. `mssql` is the only one the app needs.
- Never put passwords or tokens in the code. The server provides database settings through environment variables.
- The shared database login can read and write rows but cannot change the schema, so work with the existing `claims` table.

## Project layout

| Path | Purpose |
|---|---|
| `server.js` | HTTP server and API (`/api/claims`, `/api/categories`, `/health`) |
| `lib/claims.js` | Validation, and the stores (Azure SQL, with a SQLite fallback for local runs) |
| `public/` | Page, styles, script and `config.json` |
| `test/` | Unit tests (`node --test`) |
| `mcp-db/` | Host-only: read-only MCP server that lets Copilot query the claims database |
| `scripts/seed.js` | Host-only: clears the claims table and loads sample claims |
| `deploy/` | Host-only files: Jenkins pipeline, systemd units, VM setup script, Azure SQL script, Caddy example |

## Query the database from Copilot CLI (MCP)

The workshop host runs a read-only MCP server next to the app. Ask the host for the URL and the token, then add this to `~/.copilot/mcp-config.json` (or use `/mcp add` in Copilot CLI and choose an HTTP server):

```json
{
  "mcpServers": {
    "claims-db": {
      "type": "http",
      "url": "https://YOUR-HOSTNAME/db-mcp/",
      "headers": { "Authorization": "Bearer YOUR-TOKEN" },
      "tools": ["*"]
    }
  }
}
```

Never commit this file or paste the token into the repo. Example prompts:

- "Using the claims-db MCP server, describe the schema."
- "List the submitted claims and total the amount by category."
- "Which employee has the largest claim?"

The server can only read. The database login it uses has read-only rights, so any attempt to change data is rejected.

## Host setup (Azure VM and Azure SQL)

Everything in `deploy/` is for the workshop host. In order:

1. `azure-sql-setup.sql`: run once in the Azure portal Query editor (replace the two passwords first).
2. `rebuild-vm.sh <hostname>`: only for a brand new VM. Installs Java, Jenkins, Caddy, then runs `vm-setup.sh`.
3. `vm-setup.sh`: installs Node 22, the app and MCP services, and the SQL Server driver for the MCP server.
4. `configure-db.sh`: asks for the Azure SQL server, database and the two logins, then writes `/etc/demo-app.env` and `/etc/mcp-db.env` and restarts the services.
5. Create the Jenkins job from `Jenkinsfile.example`, run it with `BRANCH=main`, then `sudo systemctl start mcp-db`.
6. Check `curl -s http://127.0.0.1:3000/health/db`.
