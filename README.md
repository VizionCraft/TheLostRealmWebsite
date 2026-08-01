# The Lost Realm Website — Version 1.0

A cinematic, mobile-friendly Minecraft RPG website foundation built for:

- GitHub
- Cloudflare Pages
- Local FastAPI testing
- Future Cloudflare Tunnel deployment

## What Version 1 includes

- Cinematic home page
- Animated ember particles
- News page
- Wiki / world guide
- Rank pages
- Store preview
- Leaderboards preview
- Gallery
- Staff page
- Account dashboard preview
- Responsive navigation
- Copy-IP button
- Discord invite integration
- Optional FastAPI status backend
- Cloudflare Pages security headers

Authentication, email verification, Minecraft linking, admin tools, and real purchases are intentionally reserved for later releases.

## Project structure

```text
frontend/   Static website deployed to Cloudflare Pages
backend/    Optional FastAPI server for local/live API features
```

## Local frontend test

Open a command prompt in `frontend`:

```bat
py -m http.server 5500
```

Open:

```text
http://127.0.0.1:5500
```

## Local backend test

Open a command prompt in `backend`:

```bat
py -m pip install -r requirements.txt
copy .env.example .env
py -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

Open:

```text
http://127.0.0.1:8000/docs
```

To make the frontend use the local backend, edit:

```text
frontend/assets/js/config.js
```

Set:

```js
API_BASE_URL: "http://127.0.0.1:8000",
```

The static Cloudflare version works without the backend because demo mode is built in.

## GitHub upload

Create a new repository named:

```text
TheLostRealmWebsite
```

Upload everything inside this extracted folder.

Do not upload a real `.env` file. The included `.gitignore` blocks it.

## Cloudflare Pages settings

- Framework preset: `None`
- Build command: leave blank
- Build output directory: `frontend`

Cloudflare gives you a temporary address similar to:

```text
https://thelostrealmwebsite.pages.dev
```

No purchased domain is required during development.

## Configuration

Edit:

```text
frontend/assets/js/config.js
```

You can change:

- `SERVER_IP`
- `DISCORD_INVITE`
- `API_BASE_URL`
- `DEMO_MODE`

## Future backend domain

When the domain is purchased much later:

```text
https://api.thelostrealm.org
```

can point to FastAPI through Cloudflare Tunnel.
