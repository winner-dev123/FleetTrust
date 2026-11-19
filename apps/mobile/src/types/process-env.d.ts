// Declares the public env vars so they can be read with dot access, which is the
// only form Expo inlines into the bundle.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly EXPO_PUBLIC_APP_ENV?: string;
      readonly EXPO_PUBLIC_API_URL?: string;
    }
  }
}

export {};
