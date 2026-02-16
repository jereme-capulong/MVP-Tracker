import { GoogleAuthProvider, getAuth, type Auth } from "firebase/auth";
import { firebaseApp, firebaseInitError } from "./firebase";

export let auth: Auth | null = null;
export let authInitError: string | null = firebaseInitError;

try {
  if (!firebaseApp) {
    throw new Error(firebaseInitError ?? "Firebase is not configured.");
  }

  auth = getAuth(firebaseApp);
  authInitError = null;
} catch (error) {
  authInitError = error instanceof Error ? error.message : "Unknown Firebase auth initialization error";
  console.error("Firebase auth initialization failed", error);
}

export { GoogleAuthProvider };
