# Connecting a future React Native + Expo app

Not built yet. The backend and logic are already shaped for it:

1. **Create the Expo app** next to the web app: `apps/mobile` (Expo Router, TypeScript), added to the npm workspaces.
2. **Reuse the packages unchanged**: `@dujing/core` and `@dujing/data` have no browser or React-DOM code.
   Metro needs `watchFolders` pointing at the repo root so it can resolve the workspace packages.
3. **Content**: use `createBibleRepo(fetchSource("https://<your-site>/content/"))` to read the same
   files the website serves, or bundle John's JSON with the app and pass a `ContentSource` that
   reads bundled assets (works offline).
4. **Accounts & data**: the same Supabase project. Use `@supabase/supabase-js` with
   `AsyncStorage` (or `expo-secure-store`) as the session store, and the same Supabase
   `UserDataStore` implementation the web uses (Phase 4). Row Level Security protects data
   identically on every client.
5. **Password reset links**: add the app's deep-link scheme (e.g. `dujing://reset`) to the
   Supabase redirect allow-list.
6. **Audio**: the chapter MP3s and timing manifests are plain files; play them with `expo-audio`.
7. **App Store note**: if Google sign-in is offered on iOS, Apple generally requires
   Sign in with Apple as well.
