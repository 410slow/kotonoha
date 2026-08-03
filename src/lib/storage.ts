import { doc, getDoc, setDoc } from 'firebase/firestore'
import { firestore } from './firebase'
import type { Learner } from '../types'

export async function readLearner(uid: string): Promise<Learner | null> {
  const snapshot = await getDoc(doc(firestore, 'learners', uid))
  return snapshot.exists() ? (snapshot.data() as Learner) : null
}

export async function saveLearner(uid: string, learner: Learner): Promise<void> {
  await setDoc(doc(firestore, 'learners', uid), learner, { merge: true })
}
