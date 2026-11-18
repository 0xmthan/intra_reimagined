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
