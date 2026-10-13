# Cloudflare deployment and automatic Git builds

This project is configured as a **Cloudflare Worker**. The build embeds the frontend and API in `dist/server/index.js`. Do not configure it as a static Pages site: the NEA lookup needs server-side requests.

## Custom domain

The canonical app/API domain is `https://nea.saadhan.app`. The custom domain route is declared in `wrangler.jsonc` so Git deployments preserve it. The Cloudflare build token needs Workers Routes edit access to the `saadhan.app` zone. The existing workers.dev address remains available as an alternate origin.

## One-time connection

The repository configuration is ready. A Cloudflare account owner must connect the GitHub repository to activate Workers Builds. Committing `wrangler.jsonc` alone does not create a Cloudflare project or Git connection.

1. Open [Cloudflare Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages) in the account that will host the app.
2. Create a Worker application and choose the GitHub repository import/connection option.
3. Authorize the Cloudflare Workers & Pages GitHub app for the `aarambhait` organization and select `aarambhait/nea-billing`.
4. Use the settings below. The Worker name must match `wrangler.jsonc`.
5. Save/deploy and wait for the initial build to succeed.
6. Copy the actual `workers.dev` URL from Cloudflare. Its account subdomain is assigned by Cloudflare; this repository does not invent one.

| Setting | Value |
|---|---|
| Project type | Worker / Workers Builds |
| Worker name | `nea-billing` |
| Repository | `aarambhait/nea-billing` |
| Production branch | `main` |
| Root directory | Repository root (`/`) |
| Build command | `npm run check && npm run build` |
| Deploy command | `npm run deploy` |
| Package manager | npm; committed `package-lock.json` |
| Node version | 22 or newer |
| API token | Allow Cloudflare to create/select its build token |
| Runtime variables | `REQUIRE_API_RATE_LIMIT=true` (provided by Wrangler config) |

If your dashboard asks for an install command, use `npm ci`. If its Node version needs an explicit build variable, set `NODE_VERSION=22` or a newer supported version.

Workers Builds creates/selects a build API token during connection. No Cloudflare token needs to be committed or pasted into this repository. The native connection handles Cloudflare deployment credentials; no GitHub Actions deployment secrets are required.

Once connected, every push to `main` starts a build. The checks must pass, then the Worker is built and deployed. Changes on other branches do not replace production; enable preview builds separately if desired. Do not also create a second deploy pipeline for this Worker unless you deliberately want two independent deployment triggers.

## Build and deploy locally

```bash
npm ci
npm run check
npm run build
npx wrangler deploy --dry-run
```

The dry run validates and bundles the Worker without publishing or requiring deployment credentials.

To deploy manually from an authenticated development machine:

```bash
npx wrangler login
npm run build
npm run deploy
```

The login command is an instruction for the account owner; it is not executed by the automated build. If you prefer an API token locally, supply `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through your environment or secret manager, never source files.

Local Worker preview:

```bash
npm run dev:worker
```

## Verify the first deployment

After Cloudflare reports success:

- Open the Worker URL and check that the form loads.
- Verify `/api/branches` returns JSON with the NEA branch directory.
- Submit a connection you are authorized to query. Confirm the UI shows the returned account, monthly bills and source totals.
- Push a normal subsequent commit to `main`; check Cloudflare Settings > Builds for that commit's successful deployment.

## Runtime and data handling

The Worker serves `/` and `/api/*`. It uses HTTP requests to NEA; it needs no D1, R2, KV or database bindings. The config adds a native `API_RATE_LIMITER` binding (30 requests/60 seconds per client IP per Cloudflare location). Both legacy and v1 data endpoints share it. Customer details and fetched statements are not persisted by the app. NEA's HTML interface can change; input checks and statement totals reconciliation reject unexpected results.

`workers_dev: true` enables a public Workers URL after deployment. This standalone demo has no user login. The versioned `/api/v1/*` endpoints are deliberately open to everyone with CORS enabled and no API keys. [Public API usage and limits](API.md).

The Worker uses the `global_fetch_strictly_public` compatibility flag for explicit public-origin fetching. Upstream timeout/server failures can retry NEA's verified HTTPS alias once within the same request deadline.

## Troubleshooting

- **Worker name mismatch:** use `nea-billing` in Cloudflare and the config.
- **Missing entrypoint:** ensure the build command ran `npm run build`; the generated entrypoint is `dist/server/index.js`.
- **GitHub repository not listed:** allow the Cloudflare GitHub app to access `aarambhait/nea-billing`, including organization approval if required.
- **Dependency install failures:** use `npm ci` with the committed lockfile and Node 22+.
- **Build settings not applied:** set the build/deploy commands in Cloudflare Settings > Builds. Workers Builds settings are not created just by committing Wrangler config.
- **NEA timeout/unavailable:** the app returns a lookup error. A failed NEA request does not necessarily mean the Worker deployment failed.

Official documentation:

- [Workers Builds Git integration](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/)
- [Build and deployment settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
