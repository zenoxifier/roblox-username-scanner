# Roblox Username Scanner Backend

This backend proxies username lookups so Roblox Studio does not have to request
the Roblox Users API directly.

## Files

- `server.js`
- `package.json`

## Render settings

Create a **Web Service** on Render and connect this folder/repository.

Use:

- Language: Node
- Build Command: `npm install`
- Start Command: `npm start`

Render will give you a URL similar to:

`https://your-service-name.onrender.com`

Your Roblox script should then use:

`https://your-service-name.onrender.com/check`

## Test

Open:

`https://your-service-name.onrender.com/health`

You should receive:

`{"ok":true}`

Then the Roblox game can POST:

`{"username":"test123"}`

to `/check`.

## Important limitation

The Roblox Users API tells us whether a username currently maps to an
existing Roblox user. A response saying `available: true` means the username
was not found by this lookup. It is NOT a guarantee that Roblox will let a
user register/claim that username at that exact moment.

The backend intentionally has no Roblox cookies, account credentials, or API
keys.
