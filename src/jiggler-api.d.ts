interface JigglerSettings {
  deviation: number;
  frequency: number;
  smoothness: number;
  keepFocusOnTitle: boolean;
  focusInterval: number;
  cornerInterval: number;
  foregroundWindowTitle: string;
  enableMicroJiggle: boolean;
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
