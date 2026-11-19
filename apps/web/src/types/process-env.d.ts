// Declares the public env vars so they can be read with dot access, which is the
// only form Next.js inlines into the client bundle.
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      readonly NEXT_PUBLIC_APP_ENV?: string;
      readonly NEXT_PUBLIC_API_URL?: string;
    }
  }
}

export {};
