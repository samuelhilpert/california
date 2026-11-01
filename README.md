# VW California – Fahrtenbuch & Kostenabrechnung

Gemeinsames Fahrtenbuch mit fairer, centgenauer Kostenverteilung für unseren VW California.
Alle Mitglieder arbeiten auf **einem gemeinsamen Datenstand** (Firebase). Die App funktioniert auch **offline** und lässt sich auf dem Handy wie eine App installieren.

**Funktionen:** Fahrtenbuch, Kosten (einmalig, monatlich, jährlich, auf Monate verteilt), Abrechnung nach Kilometerpreis, Ausgleich „wer schuldet wem“, abgeschlossene Abrechnungen, Excel-Export, Backup, Mitgliederverwaltung, dunkles Design.

---

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Firebase-Projekt anlegen
1. <https://console.firebase.google.com> → **Projekt hinzufügen** (z. B. `vw-california`). Google Analytics wird nicht benötigt.
2. **Authentication** → *Jetzt starten* → Anbieter **E-Mail/Passwort** aktivieren.
   Empfohlen: *Vorlagen* → Sprache auf **Deutsch** stellen (Bestätigungs- und Passwort-E-Mails).
3. **Firestore Database** → *Datenbank erstellen* → Standort **`europe-west3` (Frankfurt)** → *Produktionsmodus*.
   Die eigentlichen Sicherheitsregeln werden beim ersten Deployment eingespielt.
4. **Projekteinstellungen** (Zahnrad) → *Deine Apps* → Web-App (`</>`) registrieren → die angezeigte Konfiguration notieren.

Der kostenlose Spark-Tarif reicht für drei Personen bei Weitem.

### 2. Lokal starten
```bash
npm install
cp .env.example .env.local     # Werte aus Schritt 1.4 eintragen
npm run dev                    # → http://localhost:5173
```

### 3. Veröffentlichen
**Variante A – automatisch per GitHub Actions (empfohlen):** Jeder Push auf `main` wird geprüft und veröffentlicht.
1. Google Cloud Console → *IAM & Verwaltung* → *Dienstkonten* (Projekt aus Schritt 1) → Dienstkonto erstellen mit der Rolle **Firebase-Administrator** → *Schlüssel* → *JSON* herunterladen.
2. GitHub-Repository → *Settings* → *Secrets and variables* → *Actions*:
   - **Secret** `FIREBASE_SERVICE_ACCOUNT` = Inhalt der JSON-Datei
   - **Variables** `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` (aus Schritt 1.4)
3. Auf `main` pushen → die App ist unter `https://<projekt-id>.web.app` erreichbar.

**Variante B – manuell:**
```bash
npx firebase login
npx firebase use --add          # Projekt auswählen
npm run build
npx firebase deploy --only hosting,firestore:rules,firestore:indexes
```

### 4. Fahrtenbuch einrichten und Mitglieder einladen
1. App öffnen → **Konto erstellen** → E-Mail bestätigen → **Fahrtenbuch einrichten**. Du bist das erste Mitglied.
2. **Einstellungen → Mitglieder** → E-Mail-Adressen der anderen Mitglieder **freischalten**.
3. Diese öffnen den Link, wählen **Konto erstellen** mit Namen und genau dieser Adresse und bestätigen die E-Mail. Sie erscheinen dann automatisch als Person im Fahrtenbuch. Weitere Personen ohne Konto (z. B. Gäste) legt man direkt beim Eintragen einer Fahrt an. Danach sehen alle denselben Datenstand.

**Auf dem Handy installieren:** iPhone: Safari → Teilen → *Zum Home-Bildschirm*. Nur so bleiben die Offline-Daten auf iOS dauerhaft erhalten. Android: Chrome → Menü → *App installieren*.

---

## Pro-Modus

Unter *Einstellungen → Pro-Modus* (je Konto, auf allen Geräten) erscheint der Bereich **Entdecken**:

- **Statistik:** Kilometer und Kosten je Monat/Jahr, je Person, wer was bezahlt hat, Kosten pro km, Kalender „Wann war der Bus unterwegs?“, Nächte je Person, Verbrauch und Spritpreis.
- **Karte & Länder:** alle Ziele und Zwischenstationen, besuchte Länder eingefärbt, filterbar nach Jahr und Person.
- **Jahresrückblick** zum Teilen.
- Zusatzfelder: **Zwischenstationen** bei Fahrten (eine lange Reise bleibt eine Fahrt mit einer Kilometerzahl) und **Liter** bei Tankfüllungen.

Der Pro-Modus ändert nie die Abrechnung – alle sehen dieselben Zahlen. Orte werden über OpenStreetMap (Nominatim) gesucht und je Gerät im Browser zwischengespeichert; Kartenkacheln von OpenStreetMap, Ländergrenzen von Natural Earth (`public/geo/laender.json`, gemeinfrei).

---

## Daten, Sicherheit, Offline

- **Speicherort:** Firestore im eigenen Firebase-Projekt (Region Frankfurt). Pfad `books/<VITE_BOOK_ID>/…`.
- **Zugriff:** nur angemeldete Personen mit **bestätigter E-Mail-Adresse**, die in der Mitgliederliste stehen. Die Prüfung erzwingt der Server über die Regeln in `firestore.rules`, nicht die App. Die Firebase-Webkonfiguration ist nicht geheim.
- **Offline:** Jedes Gerät hält eine Kopie im Browser (IndexedDB). Änderungen ohne Netz werden sofort angezeigt und automatisch übertragen, sobald wieder eine Verbindung besteht. Oben steht jeweils der Status „Synchronisiert / Wird synchronisiert / Offline“.
- **Gleichzeitige Änderungen:** Änderungen anderer erscheinen in Echtzeit. Bearbeiten zwei Personen *denselben* Datensatz gleichzeitig, gilt die zuletzt gespeicherte Fassung.
- **Backup:** *Einstellungen → Backup & Export → Backup herunterladen* erzeugt eine JSON-Datei mit allen Daten. Beim Einspielen wählst du **Zusammenführen** (ergänzt, löscht nichts, legt gleichnamige Personen zusammen) oder **Ersetzen** (Stand entspricht exakt der Sicherung). Die Übersicht erinnert nach 30 Tagen mit Änderungen an ein neues Backup. Backups der früheren lokalen Version (Schema 1) werden erkannt.

---

## Berechnungslogik

Reine, UI-unabhängige Funktionen in `src/lib/domain/`, vollständig getestet.

1. **Gesamtkosten** des Kostenzeitraums, getrennt nach Verteilungsart
2. **Gesamtkilometer** aller gültigen Fahrten. Jede Fahrt hat genau *einen* km-Wert, egal wie viele Personen beteiligt sind.
3. **Kilometerpreis** = km-bezogene Kosten ÷ Gesamtkilometer
4. **Fahrtkosten** = km der Fahrt × Kilometerpreis
5. **Anteil je Person** = Fahrtkosten ÷ Anzahl Beteiligte
6. **Direkt zugeordnete Kosten** (z. B. Stellplatz nur für zwei) zählen nicht zum km-Preis und werden zu gleichen Teilen auf die gewählten Personen verteilt.

Beispiel: 600 € / 1.000 km = 0,60 €/km. Eine Fahrt mit 200 km und zwei Personen kostet 120 €, also 60 € je Person.

**Rundung:** Gerechnet wird intern in Cent, die Verteilung nutzt das Restbetragsverfahren (exakt mit BigInt). Die Summe der Anteile entspricht immer exakt den verteilten Kosten (100 € auf drei Personen = 33,34 + 33,33 + 33,33). Restcents werden reihum verteilt.

**Randfälle:** Ohne Fahrten oder bei 0 km gibt es keinen km-Preis (keine Division durch null). Die Kosten werden als „nicht verteilt“ ausgewiesen und es erscheint ein Hinweis. Fahrten mit ungültigen Angaben werden aufgelistet und nicht berücksichtigt.

**Zeiträume:** Eine Fahrt zählt im Zeitraum ihres **Startdatums**, eine Kostenbuchung im Zeitraum ihres **Fälligkeitsdatums**. Ein abweichender Kostenzeitraum ist möglich und wird deutlich als Warnung angezeigt.

**Wiederkehrende Kosten** werden nicht kopiert, sondern bei jeder Berechnung je Fälligkeit mit fester ID (`<ausgabe>#2026-03`) abgeleitet. Doppelbuchungen sind damit ausgeschlossen. Bei fester Anzahl zählen alle Raten, wie in der Excel-Datei. Unbefristete Kosten zählen bis zum Ende des Zeitraums bzw. bis heute.

**Auf Monate verteilen:** Eine Fälligkeit (z. B. Jahresversicherung) lässt sich centgenau auf *n* Monate verteilen. Das ist wichtig für Monatsabrechnungen.

**Ausgleich:** Saldo = bezahlte Kosten − Kostenanteil + geleistete − erhaltene Ausgleichszahlungen. Vorgeschlagen werden möglichst wenige Überweisungen (höchstens n−1). Mit „Als bezahlt erfassen“ wird eine Überweisung als Zahlung gespeichert. Kosten ohne Zahler (gemeinsames Konto) werden separat ausgewiesen.

**Kilometerstand-Prüfung:** Lücken zwischen aufeinanderfolgenden Fahrten (Ende 1.020 → nächster Beginn 1.400) werden gemeldet. Diese Kilometer zahlt sonst niemand, und der km-Preis steigt für alle. Lücken lassen sich per Klick als Fahrt nachtragen. Überschneidungen deuten auf Doppel- oder Tippfehler hin.

**Abgeschlossene Abrechnungen** speichern das Ergebnis samt Namen fest. Ändern sich später Daten im Zeitraum, zeigt die App die Abweichung an.

---

## Entwicklung & Tests

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver mit echtem Firebase-Projekt (`.env.local`) |
| `npm run emulators` + `npm run dev:emulator` | Lokal **ohne** Firebase-Projekt gegen die Emulatoren (benötigt Java 11+) |
| `npm test` | Unit-Tests: Berechnung, Ausgleich, Wiederholungen, Excel-Export, Backup, Zusammenführen |
| `npm run test:rules` | Tests der Firestore-Sicherheitsregeln im Emulator |
| `npm run e2e` | End-to-End-Tests im Emulator: Chromium, Firefox, WebKit (Safari) und iPhone, inkl. Barrierefreiheits-Prüfung (axe, WCAG 2.1 AA), Echtzeit, Offline und Zugriffsschutz |
| `npm run check` | Typprüfung, Lint, Unit- und Regeltests, Build |

Die CI (`.github/workflows/ci.yml`) führt alles bei jedem Push aus und veröffentlicht `main` automatisch.

Lokal kann `PLAYWRIGHT_CHROMIUM_PATH` auf ein vorhandenes Chromium zeigen, falls `npx playwright install` keinen Zugriff auf den Download-Server hat.

## Projektstruktur

```
src/
  lib/domain/      Fachlogik ohne UI/DB: settlement, balance, allocate, recurrence, tripChecks, period, validation
  lib/store/       Datenschicht: DataStore-Schnittstelle, FirestoreStore (Echtzeit + offline), MemoryStore (Tests), repo
  lib/io/          Excel-Export, Backup (Ersetzen/Zusammenführen)
  lib/book.ts      Fahrtenbuch-Dokument, Mitglieder
  components/      UI-Bausteine, AuthGate (Login/Einrichtung), Formulare, Ausgleich, abgeschlossene Abrechnungen
  pages/           Übersicht, Fahrtenbuch, Kosten, Abrechnung, Einstellungen (mit Unterseiten Personen sowie Backup & Export)
firestore.rules    Zugriffsregeln (nur bestätigte Mitglieder)
tests/rules/       Tests der Zugriffsregeln
e2e/               Playwright-Tests
```

## Technik
React 19, TypeScript, Vite, Tailwind CSS 4, lucide-react, Firebase (Auth + Firestore mit Offline-Cache, Hosting), vite-plugin-pwa, SheetJS, Zod, Vitest, Playwright, axe-core.

Die Excel-Datei mit euren echten Daten (`*.xlsx`) ist per `.gitignore` vom Repository ausgeschlossen.
