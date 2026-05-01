import { useCallback, useState } from "react";
import { signInWithPopup } from "firebase/auth";
import { GoogleAuthProvider, auth } from "../auth";

type LoginScreenProps = {
  isAuthResolved: boolean;
  authError: string | null;
};

function getAuthErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to sign in. Please try again.";
}

export function LoginScreen({ isAuthResolved, authError }: LoginScreenProps) {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  const handleSignIn = useCallback(async () => {
    if (!auth || isSigningIn) {
      return;
    }

    setSignInError(null);
    setIsSigningIn(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (error) {
      const authMessage = getAuthErrorMessage(error);
      if (authMessage.toLowerCase().includes("operation-not-supported-in-this-environment")) {
        setSignInError(
          "Google sign-in popup is unsupported in the current app origin. Use the desktop app build with localhost renderer serving."
        );
      } else {
        setSignInError(authMessage);
      }
      console.error("Google sign-in failed", error);
    } finally {
      setIsSigningIn(false);
    }
  }, [isSigningIn]);

  const statusMessage = authError ?? signInError;

  return (
    <main className="login-shell">
      <section className="login-panel">
        <h1>MVP Tracker</h1>
        <p className="login-subtitle">Sign in to sync timers and categories with Firestore.</p>
        <button
          type="button"
          className="login-google-btn"
          disabled={!isAuthResolved || isSigningIn || !auth}
          onClick={handleSignIn}
        >
          {isSigningIn ? "Signing in..." : "Sign in with Google"}
        </button>
        {!isAuthResolved ? (
          <p className="login-status">Checking authentication...</p>
        ) : statusMessage ? (
          <p className="login-error" role="alert">
            {statusMessage}
          </p>
        ) : null}
      </section>
    </main>
  );
}
