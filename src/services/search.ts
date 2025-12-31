import { getDatabase } from "./database.js";
import {
  TYPE_MAP,
  ID_TYPE_MAP,
  SearchResultEntity,
} from "../types/search.js";
import { buildHumanReadable, DISCLAIMER } from "./human-readable.js";

interface EntityRow {
  id: number;
  list: "sdn" | "cons";
  entity_type: string;
  primary_name: string | null;
}

interface NameRow {
  entity_id: number;
  list: string;
  name: string;
  is_primary: number;
  alias_type: string | null;
}

interface AddressRow {
  entity_id: number;
  list: string;
  country: string | null;
  country_code: string | null;
  city: string | null;
  address1: string | null;
  postal_code: string | null;
}

interface IdRow {
  entity_id: number;
  list: string;
  id_type: string | null;
  id_value: string | null;
  country: string | null;
}

interface BaseFilters {
  list?: "sdn" | "cons";
  entityTypes: string[];
  limit: number;
  offset: number;
}

function parseBaseFilters(query: Record<string, string | undefined>): BaseFilters | { error: string } {
  const list = query.list?.toLowerCase();
  if (list && list !== "sdn" && list !== "cons") {
    return { error: "list must be 'sdn' or 'cons'" };
  }

  const typeParam = query.type?.toLowerCase() || "all";
  let entityTypes: string[] = [];
  if (typeParam !== "all") {
    const types = typeParam.split(",").map((t) => t.trim());
    for (const t of types) {
      if (!TYPE_MAP[t]) {
        return { error: `Unknown type: ${t}. Valid types: ${Object.keys(TYPE_MAP).join(", ")}` };
      }
      entityTypes.push(TYPE_MAP[t]);
    }
  } else {
    entityTypes = Object.values(TYPE_MAP);
  }

  const limit = Math.min(Math.max(parseInt(query.limit || "50", 10) || 50, 1), 200);
  const offset = Math.max(parseInt(query.offset || "0", 10) || 0, 0);

  return {
    list: list as "sdn" | "cons" | undefined,
    entityTypes,
    limit,
    offset,
  };
}

function buildBaseWhere(filters: BaseFilters): { wheres: string[]; params: unknown[] } {
  const wheres: string[] = [];
  const params: unknown[] = [];

  if (filters.list) {
    wheres.push("e.list = ?");
    params.push(filters.list);
  }

  if (filters.entityTypes.length > 0) {
    wheres.push(`e.entity_type IN (${filters.entityTypes.map(() => "?").join(",")})`);
    params.push(...filters.entityTypes);
  }

  return { wheres, params };
}

function enrichResults(entities: EntityRow[]): SearchResultEntity[] {
  if (entities.length === 0) return [];

  const db = getDatabase();
  const keys = entities.map((e) => `${e.id}-${e.list}`);
  const entityMap = new Map<string, SearchResultEntity>();

  for (const e of entities) {
    entityMap.set(`${e.id}-${e.list}`, {
      id: e.id,
      list: e.list,
      entity_type: e.entity_type,
      primary_name: e.primary_name,
      names: [],
      addresses: [],
      identifications: [],
    });
  }

  const nameRows = db.prepare(`
    SELECT entity_id, list, name, is_primary, alias_type
    FROM names
    WHERE entity_id || '-' || list IN (${keys.map(() => "?").join(",")})
  `).all(...keys) as NameRow[];

  for (const n of nameRows) {
    const key = `${n.entity_id}-${n.list}`;
    entityMap.get(key)?.names?.push({
      name: n.name,
      is_primary: n.is_primary === 1,
      alias_type: n.alias_type,
    });
  }

  const addressRows = db.prepare(`
    SELECT entity_id, list, country, country_code, city, address1, postal_code
    FROM addresses
    WHERE entity_id || '-' || list IN (${keys.map(() => "?").join(",")})
  `).all(...keys) as AddressRow[];

  for (const a of addressRows) {
    const key = `${a.entity_id}-${a.list}`;
    entityMap.get(key)?.addresses?.push({
      country: a.country,
      country_code: a.country_code,
      city: a.city,
      address1: a.address1,
      postal_code: a.postal_code,
    });
  }

  const idRows = db.prepare(`
    SELECT entity_id, list, id_type, id_value, country
    FROM identifications
    WHERE entity_id || '-' || list IN (${keys.map(() => "?").join(",")})
  `).all(...keys) as IdRow[];

  for (const i of idRows) {
    const key = `${i.entity_id}-${i.list}`;
    entityMap.get(key)?.identifications?.push({
      id_type: i.id_type,
      id_value: i.id_value,
      country: i.country,
    });
  }

  return entities.map((e) => entityMap.get(`${e.id}-${e.list}`)!);
}

function executeSearchRaw(
  joins: string[],
  wheres: string[],
  params: unknown[],
  limit: number,
  offset: number
): { total: number; entities: EntityRow[] } {
  const db = getDatabase();
  const whereClause = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";

  const countSql = `
    SELECT COUNT(DISTINCT e.id || '-' || e.list) as total
    FROM entities e
    ${joins.join("\n")}
    ${whereClause}
  `;

  const sql = `
    SELECT DISTINCT e.id, e.list, e.entity_type, e.primary_name
    FROM entities e
    ${joins.join("\n")}
    ${whereClause}
    ORDER BY e.primary_name
    LIMIT ? OFFSET ?
  `;

  const countResult = db.prepare(countSql).get(...params) as { total: number };
  const entities = db.prepare(sql).all(...params, limit, offset) as EntityRow[];

  return { total: countResult.total, entities };
}

function executeSearch(
  joins: string[],
  wheres: string[],
  params: unknown[],
  limit: number,
  offset: number
): { total: number; results: SearchResultEntity[] } {
  const { total, entities } = executeSearchRaw(joins, wheres, params, limit, offset);
  return { total, results: enrichResults(entities) };
}

// ============ /search (generic fuzzy) ============

export function searchGeneric(query: Record<string, string | undefined>) {
  const q = query.q?.trim();
  if (!q) {
    return { success: false, message: "q (query) parameter is required" };
  }

  const baseFilters = parseBaseFilters(query);
  if ("error" in baseFilters) {
    return { success: false, message: baseFilters.error };
  }

  const { wheres, params } = buildBaseWhere(baseFilters);
  const joins: string[] = [];

  // Fuzzy search across names using FTS5
  joins.push("JOIN names_fts nf ON nf.entity_id = e.id");
  wheres.push("names_fts MATCH ?");
  params.push(`"${q.replace(/"/g, '""')}"`);

  const { total, results } = executeSearch(joins, wheres, params, baseFilters.limit, baseFilters.offset);

  const queryInfo = {
    q,
    list: baseFilters.list,
    types: baseFilters.entityTypes.map((t) => t.toLowerCase()),
    limit: baseFilters.limit,
    offset: baseFilters.offset,
  };

  return {
    success: true,
    query: queryInfo,
    total,
    results,
    human_readable: buildHumanReadable({ total, results, query: queryInfo }),
    disclaimer: DISCLAIMER,
  };
}

// ============ /search/name ============

export function searchByName(query: Record<string, string | undefined>) {
  const name = query.name?.trim();
  const firstName = query.first_name?.trim();
  const lastName = query.last_name?.trim();
  const fuzzy = query.fuzzy === "true";

  if (!name && !firstName && !lastName) {
    return { success: false, message: "At least one of name, first_name, or last_name is required" };
  }

  const baseFilters = parseBaseFilters(query);
  if ("error" in baseFilters) {
    return { success: false, message: baseFilters.error };
  }

  // first_name/last_name only for Individuals
  if ((firstName || lastName) && !baseFilters.entityTypes.includes("Individual")) {
    baseFilters.entityTypes = ["Individual"];
  }

  const { wheres, params } = buildBaseWhere(baseFilters);
  const joins: string[] = [];

  if (fuzzy) {
    joins.push("JOIN names_fts nf ON nf.entity_id = e.id");

    if (name) {
      wheres.push("names_fts MATCH ?");
      params.push(`"${name.replace(/"/g, '""')}"`);
    } else {
      const terms: string[] = [];
      if (lastName) terms.push(`"${lastName.replace(/"/g, '""')}"`);
      if (firstName) terms.push(`"${firstName.replace(/"/g, '""')}"`);
      if (terms.length > 0) {
        wheres.push("names_fts MATCH ?");
        params.push(terms.join(" "));
      }
    }
  } else {
    joins.push("JOIN names n ON n.entity_id = e.id AND n.list = e.list");

    if (name) {
      // Match full name, last name part (before comma), or first name part (after comma) exactly
      wheres.push(`(
        LOWER(n.name) = LOWER(?) OR
        LOWER(TRIM(SUBSTR(n.name, 1, INSTR(n.name || ',', ',') - 1))) = LOWER(?) OR
        LOWER(TRIM(SUBSTR(n.name, INSTR(n.name, ',') + 1))) = LOWER(?)
      )`);
      params.push(name, name, name);
    } else if (lastName && firstName) {
      wheres.push("LOWER(n.name) = LOWER(?)");
      params.push(`${lastName}, ${firstName}`);
    } else if (lastName) {
      // Match full name or the last name part (before comma)
      wheres.push("(LOWER(n.name) = LOWER(?) OR LOWER(TRIM(SUBSTR(n.name, 1, INSTR(n.name || ',', ',') - 1))) = LOWER(?))");
      params.push(lastName, lastName);
    } else if (firstName) {
      // Match first name part (after comma) exactly
      wheres.push("LOWER(TRIM(SUBSTR(n.name, INSTR(n.name, ',') + 1))) = LOWER(?)");
      params.push(firstName);
    }
  }

  const { total, results } = executeSearch(joins, wheres, params, baseFilters.limit, baseFilters.offset);

  const queryInfo = {
    name,
    first_name: firstName,
    last_name: lastName,
    fuzzy,
    list: baseFilters.list,
    types: baseFilters.entityTypes.map((t) => t.toLowerCase()),
    limit: baseFilters.limit,
    offset: baseFilters.offset,
  };

  return {
    success: true,
    query: queryInfo,
    total,
    results,
    human_readable: buildHumanReadable({ total, results, query: queryInfo }),
    disclaimer: DISCLAIMER,
  };
}

// ============ /search/address ============

export function searchByAddress(query: Record<string, string | undefined>) {
  const country = query.country?.trim();
  const city = query.city?.trim();
  const address = query.address?.trim();
  const postalCode = query.postal_code?.trim();

  if (!country && !city && !address && !postalCode) {
    return { success: false, message: "At least one of country, city, address, or postal_code is required" };
  }

  const baseFilters = parseBaseFilters(query);
  if ("error" in baseFilters) {
    return { success: false, message: baseFilters.error };
  }

  const { wheres, params } = buildBaseWhere(baseFilters);
  const joins: string[] = ["JOIN addresses a ON a.entity_id = e.id AND a.list = e.list"];

  if (country) {
    if (country.length <= 3) {
      wheres.push("UPPER(a.country_code) = ?");
      params.push(country.toUpperCase());
    } else {
      wheres.push("a.country LIKE ? COLLATE NOCASE");
      params.push(`%${country}%`);
    }
  }

  if (city) {
    wheres.push("a.city LIKE ? COLLATE NOCASE");
    params.push(`%${city}%`);
  }

  if (address) {
    wheres.push("a.address1 LIKE ? COLLATE NOCASE");
    params.push(`%${address}%`);
  }

  if (postalCode) {
    wheres.push("a.postal_code LIKE ? COLLATE NOCASE");
    params.push(`%${postalCode}%`);
  }

  const { total, results } = executeSearch(joins, wheres, params, baseFilters.limit, baseFilters.offset);

  const queryInfo = {
    country,
    city,
    address,
    postal_code: postalCode,
    list: baseFilters.list,
    types: baseFilters.entityTypes.map((t) => t.toLowerCase()),
    limit: baseFilters.limit,
    offset: baseFilters.offset,
  };

  return {
    success: true,
    query: queryInfo,
    total,
    results,
    human_readable: buildHumanReadable({ total, results, query: queryInfo }),
    disclaimer: DISCLAIMER,
  };
}

// ============ /search/id ============

export function searchById(query: Record<string, string | undefined>) {
  const idValue = query.id_value?.trim();
  const idTypeParam = query.id_type?.toLowerCase();

  if (!idValue) {
    return { success: false, message: "id_value is required" };
  }

  const baseFilters = parseBaseFilters(query);
  if ("error" in baseFilters) {
    return { success: false, message: baseFilters.error };
  }

  const { wheres, params } = buildBaseWhere(baseFilters);
  const joins: string[] = ["JOIN identifications i ON i.entity_id = e.id AND i.list = e.list"];

  // Parse id_type if provided
  if (idTypeParam) {
    const idTypes: string[] = [];
    const idTypeList = idTypeParam.split(",").map((t) => t.trim());
    for (const t of idTypeList) {
      if (!ID_TYPE_MAP[t]) {
        return { success: false, message: `Unknown id_type: ${t}. Valid types: ${Object.keys(ID_TYPE_MAP).join(", ")}` };
      }
      idTypes.push(ID_TYPE_MAP[t]);
    }
    wheres.push(`i.id_type IN (${idTypes.map(() => "?").join(",")})`);
    params.push(...idTypes);
  }

  // Exact match on id_value
  wheres.push("i.id_value = ?");
  params.push(idValue);

  const { total, results } = executeSearch(joins, wheres, params, baseFilters.limit, baseFilters.offset);

  const queryInfo = {
    id_value: idValue,
    id_type: idTypeParam?.split(",").map((t) => t.trim()),
    list: baseFilters.list,
    types: baseFilters.entityTypes.map((t) => t.toLowerCase()),
    limit: baseFilters.limit,
    offset: baseFilters.offset,
  };

  return {
    success: true,
    query: queryInfo,
    total,
    results,
    human_readable: buildHumanReadable({ total, results, query: queryInfo }),
    disclaimer: DISCLAIMER,
  };
}

// ============ Batch Search (optimized) ============

interface BatchSearchQuery {
  id: string;
  search_type: "all" | "name" | "address" | "id";
  q?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  fuzzy?: boolean;
  country?: string;
  city?: string;
  address?: string;
  postal_code?: string;
  id_value?: string;
  id_type?: string;
  list?: string;
  type?: string;
  types?: string[];
  limit?: number;
  offset?: number;
}

interface BatchSearchResult {
  id: string;
  success: boolean;
  message?: string;
  query?: Record<string, unknown>;
  total?: number;
  results?: SearchResultEntity[];
  human_readable?: string;
  disclaimer?: string;
}

function buildSearchQuery(query: BatchSearchQuery): {
  joins: string[];
  wheres: string[];
  params: unknown[];
  filters: BaseFilters;
  queryInfo: Record<string, unknown>;
} | { error: string } {
  const params: Record<string, string | undefined> = {
    list: query.list,
    type: query.types?.join(",") || query.type,
    limit: query.limit?.toString(),
    offset: query.offset?.toString(),
  };

  const baseFilters = parseBaseFilters(params);
  if ("error" in baseFilters) {
    return { error: baseFilters.error };
  }

  // Adjust entityTypes for name search with first/last name BEFORE building WHERE
  if (query.search_type === "name") {
    const firstName = query.first_name?.trim();
    const lastName = query.last_name?.trim();
    if ((firstName || lastName) && !baseFilters.entityTypes.includes("Individual")) {
      baseFilters.entityTypes = ["Individual"];
    }
  }

  const { wheres, params: baseParams } = buildBaseWhere(baseFilters);
  const joins: string[] = [];
  const queryInfo: Record<string, unknown> = {
    list: baseFilters.list,
    types: baseFilters.entityTypes.map((t) => t.toLowerCase()),
    limit: baseFilters.limit,
    offset: baseFilters.offset,
  };

  switch (query.search_type) {
    case "all": {
      const q = query.q?.trim();
      if (!q) return { error: "q (query) parameter is required" };
      joins.push("JOIN names_fts nf ON nf.entity_id = e.id");
      wheres.push("names_fts MATCH ?");
      baseParams.push(`"${q.replace(/"/g, '""')}"`);
      queryInfo.q = q;
      break;
    }
    case "name": {
      const name = query.name?.trim();
      const firstName = query.first_name?.trim();
      const lastName = query.last_name?.trim();
      const fuzzy = query.fuzzy === true;

      if (!name && !firstName && !lastName) {
        return { error: "At least one of name, first_name, or last_name is required" };
      }

      queryInfo.name = name;
      queryInfo.first_name = firstName;
      queryInfo.last_name = lastName;
      queryInfo.fuzzy = fuzzy;

      if (fuzzy) {
        joins.push("JOIN names_fts nf ON nf.entity_id = e.id");
        if (name) {
          wheres.push("names_fts MATCH ?");
          baseParams.push(`"${name.replace(/"/g, '""')}"`);
        } else {
          const terms: string[] = [];
          if (lastName) terms.push(`"${lastName.replace(/"/g, '""')}"`);
          if (firstName) terms.push(`"${firstName.replace(/"/g, '""')}"`);
          if (terms.length > 0) {
            wheres.push("names_fts MATCH ?");
            baseParams.push(terms.join(" "));
          }
        }
      } else {
        joins.push("JOIN names n ON n.entity_id = e.id AND n.list = e.list");
        if (name) {
          wheres.push(`(
            LOWER(n.name) = LOWER(?) OR
            LOWER(TRIM(SUBSTR(n.name, 1, INSTR(n.name || ',', ',') - 1))) = LOWER(?) OR
            LOWER(TRIM(SUBSTR(n.name, INSTR(n.name, ',') + 1))) = LOWER(?)
          )`);
          baseParams.push(name, name, name);
        } else if (lastName && firstName) {
          wheres.push("LOWER(n.name) = LOWER(?)");
          baseParams.push(`${lastName}, ${firstName}`);
        } else if (lastName) {
          wheres.push("(LOWER(n.name) = LOWER(?) OR LOWER(TRIM(SUBSTR(n.name, 1, INSTR(n.name || ',', ',') - 1))) = LOWER(?))");
          baseParams.push(lastName, lastName);
        } else if (firstName) {
          wheres.push("LOWER(TRIM(SUBSTR(n.name, INSTR(n.name, ',') + 1))) = LOWER(?)");
          baseParams.push(firstName);
        }
      }
      break;
    }
    case "address": {
      const country = query.country?.trim();
      const city = query.city?.trim();
      const address = query.address?.trim();
      const postalCode = query.postal_code?.trim();

      if (!country && !city && !address && !postalCode) {
        return { error: "At least one of country, city, address, or postal_code is required" };
      }

      joins.push("JOIN addresses a ON a.entity_id = e.id AND a.list = e.list");
      queryInfo.country = country;
      queryInfo.city = city;
      queryInfo.address = address;
      queryInfo.postal_code = postalCode;

      if (country) {
        if (country.length <= 3) {
          wheres.push("UPPER(a.country_code) = ?");
          baseParams.push(country.toUpperCase());
        } else {
          wheres.push("a.country LIKE ? COLLATE NOCASE");
          baseParams.push(`%${country}%`);
        }
      }
      if (city) {
        wheres.push("a.city LIKE ? COLLATE NOCASE");
        baseParams.push(`%${city}%`);
      }
      if (address) {
        wheres.push("a.address1 LIKE ? COLLATE NOCASE");
        baseParams.push(`%${address}%`);
      }
      if (postalCode) {
        wheres.push("a.postal_code LIKE ? COLLATE NOCASE");
        baseParams.push(`%${postalCode}%`);
      }
      break;
    }
    case "id": {
      const idValue = query.id_value?.trim();
      const idTypeParam = query.id_type?.toLowerCase();

      if (!idValue) {
        return { error: "id_value is required" };
      }

      joins.push("JOIN identifications i ON i.entity_id = e.id AND i.list = e.list");
      queryInfo.id_value = idValue;

      if (idTypeParam) {
        const idTypes: string[] = [];
        const idTypeList = idTypeParam.split(",").map((t) => t.trim());
        for (const t of idTypeList) {
          if (!ID_TYPE_MAP[t]) {
            return { error: `Unknown id_type: ${t}. Valid types: ${Object.keys(ID_TYPE_MAP).join(", ")}` };
          }
          idTypes.push(ID_TYPE_MAP[t]);
        }
        wheres.push(`i.id_type IN (${idTypes.map(() => "?").join(",")})`);
        baseParams.push(...idTypes);
        queryInfo.id_type = idTypeList;
      }

      wheres.push("i.id_value = ?");
      baseParams.push(idValue);
      break;
    }
    default:
      return { error: `Unknown search_type: ${query.search_type}` };
  }

  return { joins, wheres, params: baseParams, filters: baseFilters, queryInfo };
}

export function batchSearch(queries: BatchSearchQuery[]): BatchSearchResult[] {
  const rawResults: Array<{
    id: string;
    queryInfo: Record<string, unknown>;
    total: number;
    entities: EntityRow[];
  } | { id: string; error: string }> = [];

  // Phase 1: Execute all searches, collect raw entities
  for (const query of queries) {
    try {
      const built = buildSearchQuery(query);
      if ("error" in built) {
        rawResults.push({ id: query.id, error: built.error });
        continue;
      }

      const { joins, wheres, params, filters, queryInfo } = built;
      const { total, entities } = executeSearchRaw(joins, wheres, params, filters.limit, filters.offset);
      rawResults.push({ id: query.id, queryInfo, total, entities });
    } catch (err) {
      rawResults.push({
        id: query.id,
        error: err instanceof Error ? err.message : "Search failed",
      });
    }
  }

  // Phase 2: Collect all unique entities for batch enrichment
  const allEntities: EntityRow[] = [];
  for (const r of rawResults) {
    if ("entities" in r) {
      allEntities.push(...r.entities);
    }
  }

  // Dedupe entities for enrichment
  const uniqueKeys = new Set<string>();
  const uniqueEntities: EntityRow[] = [];
  for (const e of allEntities) {
    const key = `${e.id}-${e.list}`;
    if (!uniqueKeys.has(key)) {
      uniqueKeys.add(key);
      uniqueEntities.push(e);
    }
  }

  // Single batch enrichment for all entities
  const enrichedMap = new Map<string, SearchResultEntity>();
  if (uniqueEntities.length > 0) {
    const enriched = enrichResults(uniqueEntities);
    for (const e of enriched) {
      enrichedMap.set(`${e.id}-${e.list}`, e);
    }
  }

  // Phase 3: Build final results
  const results: BatchSearchResult[] = [];
  for (const r of rawResults) {
    if ("error" in r) {
      results.push({ id: r.id, success: false, message: r.error });
    } else {
      const enrichedResults = r.entities.map((e) => enrichedMap.get(`${e.id}-${e.list}`)!);
      results.push({
        id: r.id,
        success: true,
        query: r.queryInfo,
        total: r.total,
        results: enrichedResults,
        human_readable: buildHumanReadable({ total: r.total, results: enrichedResults, query: r.queryInfo }),
        disclaimer: DISCLAIMER,
      });
    }
  }

  return results;
}
