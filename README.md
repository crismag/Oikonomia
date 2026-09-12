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
cp .env.example .env      # then set OIKONOMIA_URL
npm run build
node .output/server/index.mjs
```

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
