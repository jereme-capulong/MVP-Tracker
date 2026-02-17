export {};

declare global {
  interface Window {
    electronAPI: {
      importCsv: () => Promise<string | null>;
      pickAlertSoundFile: () => Promise<string | null>;
      googleOAuthSignIn: (
        clientId: string,
        clientSecret?: string
      ) => Promise<{ idToken: string; accessToken: string }>;
      windowControls?: {
        minimize: () => void;
        toggleMaximize: () => void;
        close: () => void;
        isMaximized: () => Promise<boolean>;
        onMaximizedStateChange: (listener: (isMaximized: boolean) => void) => () => void;
      };
    };
  }
}
