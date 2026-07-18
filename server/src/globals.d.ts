declare const process: {
  readonly env: Readonly<Record<string, string | undefined>>;
  exit(code?: number): never;
};

declare const console: {
  error(...values: readonly unknown[]): void;
  log(...values: readonly unknown[]): void;
};
