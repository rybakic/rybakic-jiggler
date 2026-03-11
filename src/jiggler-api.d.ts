interface JigglerSettings {
  deviation: readonly [number, number];
  frequency: readonly [number, number];
  smoothness: readonly [number, number];
  keypressInterval: readonly [number, number];
  enableScroll: boolean;
  scrollInterval: readonly [number, number];
  scrollAmount: readonly [number, number];
  enableClick: boolean;
  clickInterval: readonly [number, number];
  keepFocusOnTitle: boolean;
  focusInterval: readonly [number, number];
  cornerInterval: readonly [number, number];
  foregroundWindowTitle: string;
  enableMicroJiggle: boolean;
  enableKeypress: boolean;
  enableCornerSmoothing: boolean;
}

interface JigglerState {
  enabled: boolean;
  settings: JigglerSettings;
}

interface Window {
  jigglerApi?: {
    getState: () => Promise<JigglerState>;
    updateSettings: (settings: JigglerSettings) => Promise<JigglerState>;
    onStateChange: (callback: (state: JigglerState) => void) => () => void;
  };
}
