export {};

declare global {
  interface Window {
    electronAPI: {
      importCsv: () => Promise<string | null>;
    };
  }
}
