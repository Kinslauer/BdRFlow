import { useCallback, useEffect, useState } from "react";
import { youtubeAccountStatus } from "./api/browser";
import { openWebTab } from "./browserTabs";

/** Google's sign-in page, returning to YouTube once done. */
export const YOUTUBE_SIGN_IN_URL =
  "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F";

/**
 * Whether the user is signed in to YouTube in a web tab, checked when the
 * settings row shows and whenever the window comes back into focus (after
 * signing in in a tab, for example). `null` while unknown.
 */
export function useYouTubeAccount() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(() => {
    setChecking(true);
    youtubeAccountStatus()
      .then(setSignedIn)
      .catch(() => setSignedIn(null))
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => {
    check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [check]);

  const signIn = useCallback(() => {
    openWebTab(YOUTUBE_SIGN_IN_URL);
  }, []);

  return { signedIn, checking, check, signIn };
}
