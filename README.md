# VW California – Fahrtenbuch & Kostenabrechnung

Webanwendung zur Verwaltung des Fahrtenbuchs und zur fairen, centgenauen Verteilung der Fahrzeugkosten unseres VW California.
Läuft vollständig im Browser – ohne Backend, ohne Konto, ohne Cloud.

## Installation & Start

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install        # Abhängigkeiten installieren (einmalig)
npm run dev        # Entwicklungsserver starten → http://localhost:5173
```

Weitere Befehle:

| Befehl | Zweck |
| --- | --- |
| `npm run build` | Typprüfung + Produktionsbuild nach `dist/` |
| `npm run preview` | Produktionsbuild lokal ansehen (http://localhost:4173) |
| `npm test` | Automatisierte Tests (Vitest) |
| `npm run typecheck` | TypeScript-Prüfung |
| `npm run lint` | ESLint |

Der Inhalt von `dist/` ist eine statische Website und kann auf jedem Webspace abgelegt werden (Hash-Routing, keine Serverkonfiguration nötig).

## Erste Schritte

1. **Import & Backup → Excel-Datei auswählen** und `VW California.xlsx` wählen.
2. In der Vorschau Fahrten, Kosten und Personen prüfen. Bei wiederkehrenden Kosten ohne Datum (z. B. Leasingrate) den **Beginn der Laufzeit** eintragen.
3. **Auswahl importieren.** Danach direkt ein **Backup herunterladen**.

## Datensicherung – bitte lesen

- Alle Daten liegen **nur lokal in diesem Browser** (IndexedDB). Es gibt **keine** Synchronisierung zwischen Geräten oder Browsern.
- Werden Browserdaten/Website-Daten gelöscht, sind die Daten weg. Schutz bietet nur ein **Backup**.
- **Backup herunterladen** (Seite „Import & Backup“) erzeugt eine JSON-Datei mit *allen* Daten (Fahrten, Kosten, Personen, Kategorien, Einstellungen).
- **Backup wiederherstellen** prüft die Datei vollständig und ersetzt danach – nach Bestätigung – alle Daten atomar. Bei einer fehlerhaften Datei wird nichts verändert.
- Gerätewechsel: Backup auf dem alten Gerät herunterladen, auf dem neuen Gerät wiederherstellen.
- Die App bittet den Browser um dauerhaften Speicher (`navigator.storage.persist`); ob das gewährt wurde, steht unter „Speicher“.
- Das Dashboard erinnert, solange noch nie ein Backup erstellt wurde.

## Berechnungslogik

Die Berechnung ist als reine, UI-unabhängige Funktion in `src/lib/domain/settlement.ts` umgesetzt und vollständig getestet.

1. **Gesamtkosten** des Kostenzeitraums summieren – getrennt nach Verteilungsart.
2. **Gesamtkilometer** aller gültigen Fahrten des Zeitraums summieren. Jede Fahrt hat genau *einen* Kilometerwert und zählt nur einmal, egal wie viele Personen beteiligt sind.
3. **Kilometerpreis** = kilometerbezogene Kosten ÷ Gesamtkilometer
4. **Fahrtkosten** = Kilometer der Fahrt × Kilometerpreis
5. **Anteil je Person** = Fahrtkosten ÷ Anzahl der Beteiligten dieser Fahrt
6. Anteile je Person summieren.

**Beispiel:** 600 € / 1.000 km = 0,60 €/km. Fahrt mit 200 km und zwei Personen → 120 € → je 60 €.

### Rundung
Beträge werden intern in Cent gerechnet. Fahrtkosten und Personenanteile werden mit dem Restbetragsverfahren (Hare-Niemeyer, exakt mit BigInt) auf ganze Cent verteilt. Die Summe aller Anteile entspricht dadurch **immer exakt** den verteilten Kosten (z. B. 100 € auf drei Personen = 33,34 + 33,33 + 33,33). Restcents werden reihum verteilt, nicht immer an dieselbe Person.

### Zwei Verteilungsarten für Kosten
- **Über den Kilometerpreis** (Standard): fließt in den Kilometerpreis ein.
- **Direkt auf Personen**: fließt *nicht* in den Kilometerpreis ein, sondern wird zu gleichen Teilen auf ausdrücklich gewählte Personen verteilt (z. B. Stellplatzgebühr nur für zwei Personen). Jede Kostenbuchung gehört genau einer Verteilungsart an, es wird also nichts doppelt verrechnet.

### Randfälle
- Keine Fahrten oder 0 km: Es gibt keinen Kilometerpreis (keine Division durch null). Die kilometerbezogenen Kosten werden als **„nicht verteilt“** ausgewiesen und es erscheint ein Hinweis.
- Fahrten mit fehlenden/ungültigen Kilometern, ohne Personen oder mit Endstand < Anfangsstand werden nicht berücksichtigt und in der Abrechnung aufgelistet.

### Zeiträume (Periodenlogik)
- Eine **Fahrt** gehört zu dem Zeitraum, in dem ihr **Startdatum** liegt. Mehrtägige Fahrten über ein Periodenende werden vollständig dem Startzeitraum zugeordnet (mit Hinweis).
- Eine **Kostenbuchung** gehört zu dem Zeitraum, in dem ihr **Buchungs- bzw. Fälligkeitsdatum** liegt.
- Filter: Gesamt, Jahr, Monat, frei wählbarer Zeitraum.
- Standardmäßig gilt für Kosten und Fahrten **derselbe** Zeitraum. Optional lässt sich ein abweichender Kostenzeitraum wählen. Das wird dann deutlich als Warnung angezeigt und im Export vermerkt.
- Die Abrechnung zeigt immer, aus welchem tatsächlichen Datumsbereich die berücksichtigten Fahrten und Kosten stammen.

### Wiederkehrende Kosten
Monatliche oder jährliche Kosten werden **nicht** als Kopien gespeichert. Gespeichert wird eine Ausgabe mit Regel (z. B. „monatlich, 24×“). Die einzelnen Fälligkeiten werden bei jeder Berechnung deterministisch abgeleitet und erhalten stabile IDs wie `<ausgabe-id>#2026-03`. Je Ausgabe und Periode gibt es genau eine Buchung, deshalb sind Doppelbuchungen durch Neuladen oder Neuberechnen ausgeschlossen.
- Mit fester Anzahl oder Enddatum: alle Fälligkeiten zählen (auch zukünftige, mit Hinweis). Das entspricht der Excel-Logik (319,15 € × 24).
- Unbefristet: Fälligkeiten bis zum Ende des gewählten Zeitraums bzw. bis heute.

## Excel-Import

Angepasst an die Struktur von `VW California.xlsx`:

| Blatt | Inhalt | Verarbeitung |
| --- | --- | --- |
| `Fahrtenbuch` | Kopfzeile in Zeile 3: Von, Bis, Kilometerstand Anfang/Ende, gefahrene Kilometer (Formel), Wer, Kosten für Fahrt | Kopfzeile wird automatisch gesucht. Kilometer werden aus den Kilometerständen **nachgerechnet** (Formelwerte werden nicht vorausgesetzt). „Wer“ wird an Komma, Semikolon, „/“, „&“ und „und“ getrennt. Summenzeilen werden übersprungen. „Kosten für Fahrt“ wird ignoriert (berechnet die App selbst). |
| `Kosten` | Bezeichnung, Betrag, Anzahl, Gesamt (=Betrag×Anzahl) | Anzahl > 1 → monatlich wiederkehrend mit dieser Anzahl. Die Kategorie wird über Stichworte erkannt. Abweichungen zwischen Gesamt und Betrag × Anzahl werden gemeldet. |
| `Kostenverteilung` | Excel-Berechnung | Wird **nicht** importiert. Dient als Quelle für Personennamen und als **Gegenprobe**: Die App rechnet die Datei nach und vergleicht mit den Excel-Werten. |

- **Vorschau** vor dem Import mit Status je Zeile: Bereit, Bitte prüfen, Fehler, Duplikat. Dazu kommen verständliche Hinweise.
- **Duplikate**: Jeder importierte Datensatz erhält einen Importschlüssel. Zusätzlich wird inhaltlich mit vorhandenen Fahrten (Datum, km, Personen) und Kosten verglichen. Ein wiederholter Import legt nichts doppelt an, auch nicht mit einer veralteten Vorschau.
- Der Import ergänzt nur und überschreibt nie bestehende Daten. Er läuft atomar: Bei einem Fehler wird nichts übernommen.
- Auch eigene Excel-Exporte der App lassen sich wieder importieren.

## Excel-Export

- **Fahrtenbuch** (gefiltert) auf der Seite „Fahrtenbuch“
- **Abrechnung** mit den Blättern Übersicht, Personenanteile, Fahrten (mit Anteilen je Person), Kosten (inkl. Kategorien), Berechnungsgrundlagen
- **Alle Daten** (Fahrtenbuch, Kosten, Personen) unter „Import & Backup“

## Getroffene Entscheidungen

- **Personen** haben stabile UUIDs. Fahrten speichern IDs, keine Namen. Umbenennen und Deaktivieren verändern keine historischen Daten. Löschen ist nur möglich, solange eine Person nirgends verwendet wird.
- **Datum der Excel-Fahrt**: Die Zelle enthält den 29.12.2026, das Format zeigt aber kein Jahr („d-mmm“). Der Import übernimmt den gespeicherten Wert und markiert die Zeile mit „Bitte prüfen“. Nach dem Import lässt sich das Datum bearbeiten.
- **Beginn der Leasinglaufzeit** steht nicht in der Datei. Die Vorschau schlägt den Monat der ersten Fahrt vor, der Wert ist änderbar.
- Kilometer sind auf eine Nachkommastelle genau, Beträge auf den Cent genau.
- Hash-Routing (`#/fahrten`), damit die App ohne Serverkonfiguration überall läuft.

## Projektstruktur

```
src/
  lib/domain/        Reine Fachlogik (ohne UI/DB) – vollständig getestet
    settlement.ts    Zentrale Kostenverteilung + Periodenlogik
    allocate.ts      Centgenaue Verteilung (Restbetragsverfahren)
    recurrence.ts    Wiederkehrende Kosten → Einzelbuchungen mit stabilen IDs
    period.ts        Zeiträume (Gesamt/Jahr/Monat/frei)
    validation.ts    Eingabevalidierung
    dates.ts, money.ts, types.ts
  lib/db/            Dexie/IndexedDB-Schema, Repository, React-Hooks
  lib/io/            Excel-Import (Analyse + Übernahme), Excel-Export, Backup
  components/        UI-Bausteine, Formulare, Import-Vorschau
  pages/             Dashboard, Fahrtenbuch, Kosten, Abrechnung, Personen, Import & Backup
```

## Technik

React 19, TypeScript, Vite, Tailwind CSS 4, lucide-react (Icons), Dexie (IndexedDB), SheetJS (Excel), Zod (Backup-Validierung), Intl-API (deutsches Währungs- und Datumsformat), Vitest + fake-indexeddb (Tests).
