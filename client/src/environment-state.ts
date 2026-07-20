export type EnvironmentState = "loading" | "applied" | "safety";

export interface EnvironmentInstallOptions {
  readonly mapName: string;
  readonly stateTarget: HTMLElement;
  readonly install: () => Promise<boolean>;
  readonly activateSafetyMaterials: () => void;
  readonly reapplyStyle: () => void;
  readonly recordDiagnostic: (context: string, error: unknown) => void;
}

function safelyReport(
  record: EnvironmentInstallOptions["recordDiagnostic"],
  context: string,
  error: unknown,
): void {
  try {
    record(context, error);
  } catch (reportingError) {
    console.error("environment diagnostic reporting failed", reportingError);
  }
}

export async function installEnvironmentWithFallback(
  options: EnvironmentInstallOptions,
): Promise<void> {
  options.stateTarget.dataset.envState = "loading";
  try {
    const applied = await options.install();
    if (applied) options.stateTarget.dataset.envState = "applied";
  } catch (error) {
    options.stateTarget.dataset.envState = "safety";
    try {
      options.activateSafetyMaterials();
    } catch (fallbackError) {
      safelyReport(options.recordDiagnostic, "environment safety-material activation failed", fallbackError);
    }
    safelyReport(
      options.recordDiagnostic,
      `offline environment unavailable for ${options.mapName}; safety lighting active`,
      error,
    );
    try {
      options.reapplyStyle();
    } catch (fallbackError) {
      safelyReport(options.recordDiagnostic, "environment basic-material fallback failed", fallbackError);
    }
  }
}
