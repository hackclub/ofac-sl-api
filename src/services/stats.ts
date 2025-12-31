import { getDatabase } from "./database.js";
import type { EntityTypeStats, StatsResponse, ListStats } from "../types/ofac.js";
import { DISCLAIMER } from "./human-readable.js";

interface CountRow {
  entity_type: string;
  count: number;
}

interface TotalRow {
  count: number;
}

function getListStats(list?: "sdn" | "cons"): ListStats {
  const db = getDatabase();
  
  const whereClause = list ? `WHERE list = '${list}'` : "";
  
  const total = db.prepare(`SELECT COUNT(*) as count FROM entities ${whereClause}`).get() as TotalRow;
  
  const types = db.prepare(`
    SELECT entity_type, COUNT(*) as count 
    FROM entities 
    ${whereClause}
    GROUP BY entity_type 
    ORDER BY count DESC
  `).all() as CountRow[];

  return {
    totalEntities: total.count,
    entityTypes: types.map((t) => ({ type: t.entity_type, count: t.count })),
  };
}

export function computeStats(): StatsResponse & { disclaimer: string } {
  return {
    success: true,
    all: getListStats(),
    sdn: getListStats("sdn"),
    cons: getListStats("cons"),
    disclaimer: DISCLAIMER,
  };
}
