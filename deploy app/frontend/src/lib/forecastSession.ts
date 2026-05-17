import type { MoleculeCard } from "@/lib/api";

export const FORECAST_SESSION_KEY = "comix_forecast_session";

export interface ForecastSession {
  molecules:          MoleculeCard[];
  molecules_by_atc1:  Record<string, string[]>;
}
