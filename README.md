# Intra Reimagined

Firefox extension (desktop and Android) that reworks the 42 intra.

## Build

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm build        # outputs the extension to dist/
```

`dist/` is exactly what gets submitted to addons.mozilla.org.

## Release

```sh
cp .env.release.example .env.release   # add your AMO API key/secret
pnpm release                           # bump patch, build, submit to AMO with source
```

## API server (optional)

`server/` is a small dependency-free Node server (TypeScript, run directly by Node 23.6+) that
talks to the 42 API with the app's own credentials, so the extension never holds a secret.

```sh
cp server/.env.example server/.env   # add FT_UID / FT_SECRET from a 42 API app
pnpm server                          # http://127.0.0.1:8787
```

| Endpoint | Returns |
| --- | --- |
| `GET /v1/users/:login/piscine` | `{ login, month, year }` from 42's `pool_month` / `pool_year` |
| `GET /health` | `{ ok: true }` |

The extension uses it when built with `VITE_IR_API=https://your-server pnpm build`; without it,
features fall back to what the intra page itself provides.
