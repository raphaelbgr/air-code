export interface IControlMode {
  readonly attached: boolean;
  on(event: 'output', handler: (paneId: string, data: string) => void): this;
  on(event: 'error', handler: (error: Error) => void): this;
  on(event: 'detached', handler: () => void): this;
  on(event: 'ready', handler: () => void): this;
  sendKeys(target: string, keys: string): Promise<void>;
  resizePane(paneId: string, cols: number, rows: number): Promise<void>;
  capturePaneContent(target: string, lines?: number): Promise<string>;
  detach(): void;
}
