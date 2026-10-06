import { localData } from "./local";
import type { DataLayer } from "./types";

export * from "./types";

// The Supabase implementation arrives in the replica-backend stage; DATA_LAYER=supabase will select it.
export const data: DataLayer = localData;
