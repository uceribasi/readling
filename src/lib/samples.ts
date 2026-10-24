import { db, newId } from './db'
import { countWords } from './tokenize'

const SEEDED_KEY = 'readling.seeded'

const SAMPLES = [
  {
    title: 'The Lighthouse Keeper’s Cat',
    language: 'en',
    content: `Every evening, when the sun dipped below the horizon, Marlow the cat climbed the spiral staircase of the old lighthouse. He was not supposed to be there. The keeper, a quiet woman named Edith, had told him so a hundred times, but Marlow had never been the kind of cat who took advice.

At the top, he would settle on the warm brass rail beside the lamp and watch the ships drift past like slow, glowing beetles. Some nights the fog rolled in so thick that the beam seemed to bend and scatter, and Marlow would flatten his ears as if the darkness itself were whispering.

Edith pretended not to notice. Secretly, she was grateful for the company. Keeping a light burning for strangers is a lonely job, and even a stubborn cat makes the long hours feel shorter.`,
  },
  {
    title: 'Ein Morgen in Berlin',
    language: 'de',
    content: `Lena wacht früh auf, weil die Sonne durch das offene Fenster scheint. Sie macht sich einen Kaffee und setzt sich auf den kleinen Balkon. Unten auf der Straße fährt eine Straßenbahn vorbei, und ein Mann verkauft frische Brötchen.

Heute hat Lena keine Eile. Sie möchte zum Markt gehen, ein paar Äpfel kaufen und danach ihre Großmutter besuchen. Ihre Großmutter wohnt seit vierzig Jahren in derselben Wohnung und kennt jeden Nachbarn beim Namen.

„Das Leben ist schöner, wenn man langsam geht“, sagt sie oft. Lena glaubt, dass sie recht hat.`,
  },
]

/** Adds a couple of sample texts the very first time the app runs. */
export async function seedSamplesOnce(): Promise<void> {
  try {
    if (localStorage.getItem(SEEDED_KEY)) return
    localStorage.setItem(SEEDED_KEY, '1')
  } catch {
    return
  }
  if ((await db.texts.count()) > 0) return
  const now = Date.now()
  await db.texts.bulkAdd(
    SAMPLES.map((sample, index) => ({
      ...sample,
      syncId: newId(),
      kind: 'text' as const,
      wordCount: countWords(sample.content, sample.language),
      createdAt: now - index,
      updatedAt: now - index,
    })),
  )
}
