# ✈ Flug-Tag

Et sanntids kart-spill på **ekte trafikk** — litt som Risk, Pokémon Go og
Ingress. Ekte fly (ADS-B) og ekte båter (AIS) beveger seg live på kartet. Du
**tagger** fartøy som passerer nær deg, de blir laget ditt sitt, de drar et
farget **spor/territorium** etter seg, og **flyplasser farges** av laget hvis
fly faktisk lander der. Multiplayer kommer senere — i dag spiller du mot
simulerte rivaler som kaprer nøytrale fartøy.

**Spill:** https://helgedimmen.github.io/Flug-Tag/

## Slik spiller du

1. Åpne appen (på mobil funker det best — den bruker GPS-en din; uten GPS
   settes du i Trondheim).
2. Velg lag (Blå / Rød / Grønn / Gul) øverst til venstre.
3. Fartøy innenfor rekkevidde (den stiplete sirkelen) **blinker** — trykk på et
   fly eller en båt, eller bruk den store **TAGG**-knappen / mellomromstasten
   for å fange det nærmeste.
4. Eide fly som **faktisk lander** på en flyplass gir laget ditt kontroll der
   (flyet går lavt/på bakken nær flyplassen — dette er ekte landinger, ikke
   simulerte).
5. Når laget ditt eier ≥ 3 fartøy, fylles området mellom dem med fargen din —
   ditt territorium (Ingress-stil).
6. Resultattavlen teller fly + båter + flyplasser → poeng.

## Datakilder (live)

| Hva | Kilde | Nøkkel? |
|---|---|---|
| ✈ Fly | [adsb.lol](https://api.adsb.lol/docs) → [adsb.fi](https://github.com/adsbfi/opendata) → [airplanes.live](https://airplanes.live/api-guide/) (automatisk reserve) | Nei — helt åpne |
| 🚢 Båter | [aisstream.io](https://aisstream.io) (WebSocket) | Ja — gratis |

Flyene funker rett ut av boksen. **Båter krever en gratis nøkkel** fra
aisstream.io (logg inn med GitHub, lag en «API Key»). To måter å bruke den på:

- **For alle spillere:** legg nøkkelen som repo-secret **`AISSTREAM_KEY`**
  (Settings → Secrets and variables → Actions). Neste deploy baker den inn, og
  båter er på for alle. NB: alt i en statisk bundle er offentlig — nøkkelen er
  gratis og kan når som helst regenereres på aisstream.io om noen snylter.
- **Bare for deg:** trykk «båter av — legg inn gratis nøkkel» i spillet og lim
  inn. Lagres kun i din nettleser (localStorage).

## Kjør lokalt

```bash
npm install
npm run dev      # http://localhost:3000
```

Andre kommandoer:

```bash
npm test         # spill-logikk + live-normalisering (vitest)
npm run build    # produksjonsbygg (statisk eksport til out/)
npm run lint     # eslint
```

## Publisering (GitHub Pages)

Spillet er rent klient-side og bygges som en statisk side (`out/`), så
`.github/workflows/deploy.yml` publiserer det til GitHub Pages ved hver push
til spill-branchen. Engangsoppsettet (public repo + Pages-source «GitHub
Actions») er allerede gjort.

## Hvordan det er bygget

| Lag | Fil | Ansvar |
|---|---|---|
| Typer | `src/lib/types.ts` | Felles domene-typer (Team, Vessel, Airport, Landing …) |
| Data ✈ | `src/lib/live/adsb.ts` | Poller ADS-B-aggregatorene, normaliserer, bytter kilde ved feil |
| Data 🚢 | `src/lib/live/ais.ts` | aisstream.io-WebSocket, normaliserer AIS-meldinger, reconnect |
| Verden | `src/lib/live/world.ts` | Slår sammen feedene, dead reckoning mellom oppdateringer, ekte landingsdeteksjon, rydder bort stille fartøy |
| Matte | `src/lib/geo.ts` | Avstand, peiling, destinasjonspunkt, konveks innhylling |
| Regler | `src/lib/game.ts` | Tagging, rival-AI, flyplass-kontroll, poeng |
| Kart | `src/components/MapView.tsx` | Leaflet, imperativ tegning av fartøy/spor/felt/flyplasser |
| Spill | `src/components/GameClient.tsx` | Spill-løkka, GPS, polling/streaming, HUD |

### To viktige designvalg

- **Tall kommer fra deterministisk kode, ikke gjetting.** All
  poeng-/kontroll-/avstands-matte ligger i `src/lib/*` og er dekket av tester.
- **Live hele veien, med fallback mellom kilder.** Fly hentes fra tre
  uavhengige åpne aggregatorer — dør én, brukes neste. Mellom oppdateringene
  føres fartøyene fremover langs kurs og fart (dead reckoning), så bevegelsen
  er glatt selv om feedene tikker hvert 8. sekund. Eierskap og spor overlever
  hver oppdatering fordi fartøy er nøklet på ekte id (ICAO-hex / MMSI).

## Veikart

- [x] **MVP:** tagge fly, lag-eierskap, spor + territorium, flyplass-kontroll,
      resultattavle, GPS.
- [x] **Ekte flydata:** adsb.lol/adsb.fi/airplanes.live, ekte landinger.
- [x] **Ekte båter:** AIS via aisstream.io.
- [ ] **Multiplayer:** lagene blir ekte spillere; delt server-state
      (eierskap, landinger, kontroll) i sanntid.
- [ ] **Mer Ingress/Risk:** havner som territorier for båter, ruter som
      «linker», felt-poeng for areal, angrep/forsvar.
