/**
 * Jest stand-in for every @react-native-firebase/* module (mapped in package.json). Native
 * Firebase can't load in Node, and tests never use it: they install a fake runtime
 * (test/fake-platform.ts). Anything that reaches a real Firebase call fails loudly.
 */
const unavailable = (name: string) => () => {
  throw new Error(
    `@react-native-firebase ${name}() is not available in unit tests; use the fake platform`,
  );
};

export const AuthorizationStatus = {
  NOT_DETERMINED: -1,
  DENIED: 0,
  AUTHORIZED: 1,
  PROVISIONAL: 2,
  EPHEMERAL: 3,
} as const;

export const getApp = unavailable("getApp");
export const initializeAppCheck = unavailable("initializeAppCheck");
export const getToken = unavailable("getToken");
export const getAuth = unavailable("getAuth");
export const connectAuthEmulator = unavailable("connectAuthEmulator");
export const getIdToken = unavailable("getIdToken");
export const isSignInWithEmailLink = unavailable("isSignInWithEmailLink");
export const onAuthStateChanged = unavailable("onAuthStateChanged");
export const sendSignInLinkToEmail = unavailable("sendSignInLinkToEmail");
export const signInWithEmailLink = unavailable("signInWithEmailLink");
export const signOut = unavailable("signOut");
export const getId = unavailable("getId");
export const getInstallations = unavailable("getInstallations");
export const getMessaging = unavailable("getMessaging");
export const getInitialNotification = unavailable("getInitialNotification");
export const hasPermission = unavailable("hasPermission");
export const onMessage = unavailable("onMessage");
export const onNotificationOpenedApp = unavailable("onNotificationOpenedApp");
export const requestPermission = unavailable("requestPermission");
