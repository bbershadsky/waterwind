# Waterwind

Mobile-friendly marine weather board for wind, waves, radar, and nearby buoy conditions. Built for quick go/no-go reads on small water, with a default pin at Abino Bay, Lake Erie.

`abay.ps1` was the first iteration — a local PowerShell briefing. That was enough to prove the data stack, but I wanted the same view anytime from my phone, so it became this site.

## Stack

- Next.js (App Router) + TypeScript
- Open-Meteo, Environment Canada, NDBC, RainViewer, OpenStreetMap
- Recharts + Leaflet
- Location, units (°C/°F), and theme stored in `localStorage`

## Run

```bash
npm install
npm run dev
```

```bash
npm run build
npm start
```

Deploy on Vercel with no required env vars.

## License

MIT — see [LICENSE](LICENSE).

Third-party data remains under each provider’s terms (Open-Meteo, Environment Canada, NDBC, RainViewer, OpenStreetMap).
