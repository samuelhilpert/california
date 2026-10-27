import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let env: RulesTestEnvironment
const BOOK = 'books/california'

const user = (email: string, verified = true) =>
  env.authenticatedContext(email, { email, email_verified: verified }).firestore()

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules',
    firestore: { rules: readFileSync(resolve(__dirname, '../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
afterAll(async () => env?.cleanup())
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, BOOK), { name: 'VW California', memberEmails: ['samuel@example.com', 'dennis@example.com'] })
    await setDoc(doc(db, BOOK, 'trips', 't1'), { id: 't1', km: 10 })
  })
})

describe('Firestore-Regeln', () => {
  it('Mitglieder können lesen und schreiben', async () => {
    const db = user('samuel@example.com')
    await assertSucceeds(getDoc(doc(db, BOOK)))
    await assertSucceeds(getDocs(collection(db, BOOK, 'trips')))
    await assertSucceeds(setDoc(doc(db, BOOK, 'trips', 't2'), { id: 't2', km: 5 }))
    await assertSucceeds(deleteDoc(doc(db, BOOK, 'trips', 't1')))
  })
  it('E-Mail-Groß-/Kleinschreibung spielt keine Rolle', async () => {
    await assertSucceeds(getDoc(doc(user('Dennis@Example.com'), BOOK, 'trips', 't1')))
  })
  it('Nicht-Mitglieder haben keinen Zugriff', async () => {
    const db = user('fremd@example.com')
    await assertFails(getDoc(doc(db, BOOK)))
    await assertFails(getDocs(collection(db, BOOK, 'trips')))
    await assertFails(setDoc(doc(db, BOOK, 'trips', 'x'), { id: 'x' }))
  })
  it('unbestätigte E-Mail-Adressen haben keinen Zugriff – auch nicht mit Mitglieds-Adresse', async () => {
    await assertFails(getDoc(doc(user('samuel@example.com', false), BOOK, 'trips', 't1')))
  })
  it('ohne Anmeldung kein Zugriff', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), BOOK, 'trips', 't1')))
  })
  it('Mitglieder können Mitglieder verwalten, aber die Liste nicht leeren', async () => {
    const db = user('samuel@example.com')
    await assertSucceeds(updateDoc(doc(db, BOOK), { memberEmails: ['samuel@example.com', 'dennis@example.com', 'konrad@example.com'] }))
    await assertFails(updateDoc(doc(db, BOOK), { memberEmails: [] }))
    await assertFails(updateDoc(doc(user('fremd@example.com'), BOOK), { memberEmails: ['fremd@example.com'] }))
  })
  it('ein bestehendes Buch kann nicht übernommen werden; ein neues nur mit sich selbst als Mitglied', async () => {
    await assertFails(setDoc(doc(user('fremd@example.com'), BOOK), { memberEmails: ['fremd@example.com'] }))
    await assertFails(setDoc(doc(user('neu@example.com'), 'books/anderes'), { memberEmails: ['jemand@example.com'] }))
    await assertSucceeds(setDoc(doc(user('neu@example.com'), 'books/anderes'), { memberEmails: ['neu@example.com'] }))
    await assertFails(setDoc(doc(user('neu@example.com', false), 'books/drittes'), { memberEmails: ['neu@example.com'] }))
  })
  it('Bücher können nicht gelöscht oder aufgelistet werden; unbekannte Sammlungen sind gesperrt', async () => {
    const db = user('samuel@example.com')
    await assertFails(deleteDoc(doc(db, BOOK)))
    await assertFails(getDocs(collection(db, 'books')))
    await assertFails(setDoc(doc(db, BOOK, 'geheim', 'x'), { a: 1 }))
    await assertFails(setDoc(doc(db, 'anderes', 'x'), { a: 1 }))
  })
})
