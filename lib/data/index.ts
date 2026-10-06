import { localData } from "./local";
import { postgresData } from "./postgres";
import type { DataLayer } from "./types";

export * from "./types";

// DATA_LAYER=postgres uses DATABASE_URL (Supabase in production); anything else uses the local JSON file.
export const data: DataLayer = process.env.DATA_LAYER === "postgres" ? postgresData : localData;
