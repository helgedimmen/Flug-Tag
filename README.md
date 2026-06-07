# ✈ Flug-Tag

Et sanntids kart-spill bygget på flydata — **litt som Risk, Pokémon Go og Ingress.**
Ekte fly flyr mellom ekte flyplasser. Du **tagger** fly som passerer over deg,
de blir laget ditt sitt, de drar et farget **spor/territorium** etter seg, og
**flyplasser farges** av laget som lander flest fly der. Multiplayer kommer
senere — i dag spiller du mot simulerte rivaler.

## Slik spiller du

1. Åpne appen (på mobil funker det best — den bruker GPS-en din).
2. Velg lag (Blå / Rød / Grønn / Gul) øverst til venstre.
3. Fly innenfor rekkevidde (den stiplete sirkelen) **blinker** — trykk på et fly,
   eller bruk den store **TAGG**-knappen / mellomromstasten for å fange det
   nærmeste. Da blir flyet ditt og fargen din følger det.
4. Eide fly som lander på en flyplass gir laget ditt kontroll der. Flyplassen
   farges av laget med flest landinger i tidsvinduet.
5. Når laget ditt eier ≥ 3 fly, fylles området mellom dem med fargen din — ditt
   territorium (Ingress-stil).
6. Resultattavlen oppe til høyre teller fly + flyplasser → poeng.

## Spill online (GitHub Pages)

Spillet er rent klient-side, så det kan kjøres som en vanlig nettside rett fra
repoet. Et GitHub Actions-oppsett (`.github/workflows/deploy-pages.yml`) bygger
og publiserer automatisk ved hver push til spill-branchen.

**Engangsoppsett:** gå til repoets **Settings → Pages → Build and deployment →
Source: «GitHub Actions»**. Etter det blir spillet liggende på
`https://<bruker>.github.io/Flug-Tag/` og oppdateres ved hver endring.

## Kjør lokalt

```bash
npm install
npm run dev      # http://localhost:3000
```

Andre kommandoer:

```bash
npm test         # kjør spill-logikk-testene (vitest)
npm run build    # produksjonsbygg
npm run lint     # eslint
```

## Hvordan det er bygget

| Lag | Fil | Ansvar |
|---|---|---|
| Typer | `src/lib/types.ts` | Felles domene-typer (Team, Plane, Airport, Landing …) |
| Data | `src/lib/airports.ts`, `src/lib/teams.ts` | Brettet (flyplasser) + lagene |
| Matte | `src/lib/geo.ts` | Avstand, peiling, storsirkel-interpolasjon, konveks innhylling |
| Motor | `src/lib/simulation.ts` | Lokal flysimulering — beveger fly, registrerer landinger |
| Regler | `src/lib/game.ts` | Tagging, rival-AI, flyplass-kontroll, poeng |
| Kart | `src/components/MapView.tsx` | Leaflet, imperativ tegning av fly/spor/felt/flyplasser |
| Spill | `src/components/GameClient.tsx` | Spill-løkka (requestAnimationFrame), GPS, HUD |

### To viktige designvalg

- **Tall kommer fra deterministisk kode, ikke gjetting.** All
  poeng-/kontroll-/avstands-matte ligger i `src/lib/*` og er dekket av tester.
- **Datakilden er byttbar.** Spillet kjører i dag på en lokal simulering
  (`FlightSim`) — null nettverk, null nøkkel, alltid spillbart. Den ekte
  flydata-kilden (OpenSky Network) ligger klar bak samme grensesnitt i
  `src/lib/opensky.ts` + `/api/flights`, og slås på når man setter
  `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`. OpenSky krever nå OAuth2
  (anonym tilgang gir 403), så simuleringen er standard inntil videre.

## Veikart

- [x] **MVP (denne versjonen):** tagge fly, lag-eierskap, spor + territorium,
      flyplass-kontroll, resultattavle, simulert data, GPS.
- [ ] **Ekte flydata:** koble `FlightSim` ut og `/api/flights` (OpenSky) inn;
      utlede «landinger» fra faktiske ankomster.
- [ ] **Multiplayer:** lagene blir ekte spillere; delt server-state
      (eierskap, landinger, kontroll) i sanntid.
- [ ] **Mer Ingress/Risk:** ruter som «linker» mellom flyplasser, felt-poeng for
      areal, angrep/forsvar av flyplasser.
