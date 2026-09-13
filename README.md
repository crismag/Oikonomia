# Oikonomia

Church leadership planning, coordination and reporting.

Oikonomia gives leaders one shared workspace for calendars, meetings, ministry
work, lifegroups, outreach, goals, reports and volunteer coordination.

## Documentation

- [User guide](docs/user-guide/)
- [Architecture](docs/architecture/)

## Running Oikonomia

Requires Node 22 and a platform that can build `better-sqlite3`.

```bash
npm ci
npm run build
OIKONOMIA_URL=https://your-host \
OIKONOMIA_DB=/var/lib/oikonomia/oikonomia.db \
PORT=8080 npm start       # node .output/server.js
```

The built server reads its environment, not a `.env` file. Both variables above
are required in production; see
[deployment](docs/architecture/deployment.md) for the rest, and for Hostinger.

The first person to open a new installation is sent to `/setup`, which creates
the first administrator and then closes itself. Everybody else is invited from
inside the application.

`.env.example` lists every setting and what each one switches on.

## Development

```bash
npm run dev        # development server
npx vitest run     # tests
npx tsc --noEmit   # typecheck
npx eslint .       # lint
npm run build      # production build
npm run smoke      # start the built server and check it serves
```
