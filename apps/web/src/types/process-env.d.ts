// Declares the public env vars so they can be read with dot access, which is the
// only form Next.js inlines into the client bundle.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly NEXT_PUBLIC_APP_ENV?: string;
      readonly NEXT_PUBLIC_API_URL?: string;
      readonly NEXT_PUBLIC_FIREBASE_PROJECT_ID?: string;
      readonly NEXT_PUBLIC_FIREBASE_API_KEY?: string;
      readonly NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?: string;
      readonly NEXT_PUBLIC_FIREBASE_APP_ID?: string;
      readonly NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST?: string;
    }
  }
}

export {};
