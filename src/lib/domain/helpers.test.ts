import { describe, expect, it } from 'vitest'
import { excelSerialToIso, parseGermanDate, addMonths } from './dates'
import { euroToCents, parseEuroInput, parseNumberInput } from './money'
import { resolveTripKm, validateTrip, validateExpense } from './validation'

describe('Datum & Zahlen', () => {
  it('Excel-Seriennummern', () => {
    expect(excelSerialToIso(46385)).toBe('2026-12-29')
    expect(excelSerialToIso(45658)).toBe('2025-01-01')
    expect(excelSerialToIso(61)).toBe('1900-03-01')
    expect(excelSerialToIso(0)).toBeNull()
  })
  it('deutsche Datumsangaben', () => {
    expect(parseGermanDate('29.12.2025')).toBe('2025-12-29')
    expect(parseGermanDate('1.2.25')).toBe('2025-02-01')
    expect(parseGermanDate('31.02.2025')).toBeNull()
  })
  it('Monatsaddition', () => expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'))
  it('Euro-Eingaben', () => {
    expect(euroToCents(319.15)).toBe(31915)
    expect(parseEuroInput('1.234,56 €')).toBe(123456)
    expect(parseEuroInput('319,15')).toBe(31915)
    expect(parseEuroInput('319.15')).toBe(31915)
    expect(parseEuroInput('12,345')).toBeNull()
    expect(parseEuroInput('abc')).toBeNull()
  })
  it('Kilometer-Eingaben', () => {
    expect(parseNumberInput('1.234')).toBe(1234)
    expect(parseNumberInput('12,5')).toBe(12.5)
    expect(parseNumberInput('x')).toBeNull()
  })
})

describe('Validierung', () => {
  it('berechnet km aus Kilometerständen', () => {
    expect(resolveTripKm(20, 520, 3)).toBe(500)
    expect(resolveTripKm(undefined, 520, 3)).toBe(3)
  })
  it('Endstand muss mindestens Anfangsstand sein', () => {
    const e = validateTrip({ startDate: '2026-01-01', odoStart: 500, odoEnd: 400, km: 10, personIds: ['a'] })
    expect(e.odoEnd).toMatch(/mindestens/)
  })
  it('Fahrt ohne Personen ist ungültig', () => {
    expect(validateTrip({ startDate: '2026-01-01', km: 10, personIds: [] }).personIds).toBeDefined()
  })
  it('gültige Fahrt', () => {
    expect(validateTrip({ startDate: '2026-01-01', odoStart: 1, odoEnd: 11, km: 10, personIds: ['a'] })).toEqual({})
  })
  it('Direktkosten brauchen Personen', () => {
    expect(validateExpense({ title: 'x', categoryId: 'c', amountCents: 100, date: '2026-01-01', allocation: 'direct', directPersonIds: [] }).directPersonIds).toBeDefined()
  })
})
