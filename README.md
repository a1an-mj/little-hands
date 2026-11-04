# little-hands

Little Hands: an offline kindergarten and tuition manager (Electron + React + SQLite).
Project brief and decisions: `CLAUDE.md`. Requirements: `docs/requirements.md`. Designs: `design/`.

## Develop (Linux)

```sh
npm install        # also downloads Electron
npm run dev        # run the app with live reload
npm test           # unit tests (Vitest)
npm run test:e2e   # build, then end-to-end tests in Electron (Playwright)
npm run typecheck
```

The app keeps its database in Electron's user-data folder (`~/.config/little-hands` on Linux,
`%APPDATA%\little-hands` on Windows). Delete `little-hands.db*` there to start fresh.
