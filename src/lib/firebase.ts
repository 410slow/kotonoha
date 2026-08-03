import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'

const firebaseConfig = {
  apiKey: 'AIzaSyCZWH_kFSrt9iXE_y_nn6Ueymc7f_55r_w',
  authDomain: 'japan-fcb65.firebaseapp.com',
  projectId: 'japan-fcb65',
  storageBucket: 'japan-fcb65.firebasestorage.app',
  messagingSenderId: '761877240256',
  appId: '1:761877240256:web:dfe29ab12ebdbcc2d65025',
  measurementId: 'G-1VZD6B0YK8',
}

export const firebaseApp = initializeApp(firebaseConfig)
export const firestore = getFirestore(firebaseApp)
export const auth = getAuth(firebaseApp)
