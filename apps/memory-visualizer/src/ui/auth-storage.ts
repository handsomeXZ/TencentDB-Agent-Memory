const VISUALIZER_API_KEY_STORAGE_KEY = "tdai-memory-visualizer-api-key";

export function readStoredVisualizerApiKey(): string | undefined {
  try {
    const value = window.sessionStorage.getItem(VISUALIZER_API_KEY_STORAGE_KEY)?.trim();
    return value ? value : undefined;
  } catch (error) {
    void error;
    return undefined;
  }
}

export function storeVisualizerApiKey(value: string): void {
  try {
    window.sessionStorage.setItem(VISUALIZER_API_KEY_STORAGE_KEY, value);
  } catch (error) {
    void error;
  }
}

export function clearStoredVisualizerApiKey(): void {
  try {
    window.sessionStorage.removeItem(VISUALIZER_API_KEY_STORAGE_KEY);
  } catch (error) {
    void error;
  }
}
