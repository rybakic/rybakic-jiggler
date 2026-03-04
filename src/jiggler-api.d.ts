interface JigglerSettings {
  deviation: number;
  frequency: number;
  smoothness: number;
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
