# SpeedyMap — Product Requirements Document

## Overview
App mobile per autisti italiani di consegne. Tre tipi di utente (Privato, Dipendente, Azienda) con dashboard dedicate. Pianificazione percorsi ottimizzati su tutta Italia, avvisi ZTL Palermo, OCR etichette via AI.

## Stack
- Frontend: Expo (SDK 54) / React Native, expo-router, @gorhom/bottom-sheet, react-native-webview + Leaflet (OpenStreetMap), expo-location, expo-image-picker
- Backend: FastAPI + Motor (MongoDB)
- Auth: Emergent-managed Google OAuth
- AI OCR: GPT-4o (vision) via emergentintegrations (Emergent LLM key)
- Geocoding: Nominatim (tutta Italia, `countrycodes=it`)
- Routing: OSRM pubblico (router.project-osrm.org) per polyline; nearest-neighbor lato server per l'ordine

## Lingua
Tutta l'interfaccia è in **italiano** (file `/app/frontend/src/i18n.ts`).

## Ruoli utente
1. **Privato (`private`)** — gestisce le proprie consegne
2. **Dipendente (`employee`)** — entra in un'azienda tramite codice invito; la sua attività è visibile al manager
3. **Azienda (`company`)** — crea la propria azienda, ottiene un codice invito di 6 caratteri, e gestisce un team di dipendenti

## Flusso utente
1. Splash → Google login (Emergent OAuth)
2. **Onboarding** (primo login): scelta del ruolo + setup azienda/codice invito
3. Redirect alla dashboard adatta:
   - Privato/Dipendente → `/dashboard` (mappa 70% + lista consegne 30% + FAB sempre visibile)
   - Azienda → `/company` (mappa con posizioni dipendenti + lista dipendenti con stats e codice invito)

## Feature principali
- **Mappa interattiva OpenStreetMap** tutta Italia, centrata sulla posizione GPS dell'autista
- **Aggiunta tappe** illimitate via FAB "+" persistente (sticky in alto al bottom sheet)
- **Autocomplete indirizzi** Italia via Nominatim (debounced 350ms)
- **OCR etichetta** con GPT-4o vision: scatta foto → AI estrae indirizzo+destinatario → auto-fill
- **Ottimizzazione percorso**: pulsante "Naviga" → backend calcola ordine nearest-neighbor + chiama OSRM per polyline reale su strada → mostra km e durata stimata, disegna percorso arancione sulla mappa
- **Filtro veicolo** (Piccolo/Medio/Grande) + toggle **ZTL Pass** persistenti per utente
- **Avvisi ZTL Palermo**: ogni consegna nel Centro Storico è marcata in rosso se l'autista non ha il pass
- **Tracking GPS dipendenti**: ping posizione ogni 60s (e ogni focus), il manager azienda vede online/offline + ultima posizione

## API surface (`/api`)
- `POST /auth/session`, `GET /auth/me`, `POST /auth/logout`
- `POST /onboarding/role`
- `POST /company/setup`, `POST /company/join`, `GET /company/employees`
- `POST /location/ping`
- `PUT /profile` (vehicle_size, ztl_pass)
- `GET /geocode/search?q=...` (Italy-wide)
- `GET /ztl/check`, `GET /ztl/polygon`
- `GET/POST /deliveries`, `PUT/DELETE /deliveries/{id}`
- `POST /route/optimize` → `{ order, polyline, distance_km, duration_min }`
- `POST /ocr/extract` (GPT-4o vision)

## Test coverage
- **44/44 backend tests** passing (auth, profile, deliveries CRUD, ZTL, geocoding Italy-wide, role onboarding, company invite, location tracking, route optimize)

## Smart business enhancement
**SpeedyMap Pro per Aziende — €19/driver/mese**: monetizzazione del piano azienda con tracking GPS live, dashboard manager, statistiche performance, e copertura ZTL estesa (Roma/Milano/Napoli/Firenze) in roadmap. Il "free tier" resta per i privati. Il codice invito blocca naturalmente l'azienda allo strumento (lock-in positivo).
