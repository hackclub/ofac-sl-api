import type { SearchResultEntity } from "../types/search.js";

export const DISCLAIMER =
  'This information is NOT OFFICIAL GUIDANCE and provided "AS-IS" without warranties. Verify results against official sources.';

const HUMAN_READABLE_DISCLAIMER = `\n\n${DISCLAIMER}`;

const MAX_LISTED = 10;

export function buildHumanReadable(opts: {
  total: number;
  results: SearchResultEntity[];
  query: Record<string, unknown>;
}): string {
  const { total, results, query } = opts;

  const { queryLabel, nameSearchTerm } = deriveQueryLabel(query);
  const listDescription = buildListDescription(query, results);

  if (!total || total === 0) {
    return `No matches for "${queryLabel}" were found on the Sanctions List.${HUMAN_READABLE_DISCLAIMER}`;
  }

  const shown = results.slice(0, MAX_LISTED);
  const bullets = shown.map((entity) => formatMatch(entity, nameSearchTerm)).join("\n");

  const extraCount = Math.max(0, total - shown.length);
  const extraLine =
    extraCount > 0 ? `\n- ...and ${extraCount} more result(s) not shown.` : "";

  const matchWord = total === 1 ? "match was" : "matches were";
  const header = `${total} ${matchWord} found for "${queryLabel}" on ${listDescription}:`;

  return `${header}\n${bullets}${extraLine}${HUMAN_READABLE_DISCLAIMER}`;
}

function deriveQueryLabel(query: Record<string, unknown>): {
  queryLabel: string;
  nameSearchTerm?: string;
} {
  const q = str(query.q);
  const name = str(query.name);
  const firstName = str(query.first_name);
  const lastName = str(query.last_name);
  const country = str(query.country);
  const city = str(query.city);
  const address = str(query.address);
  const postal = str(query.postal_code);
  const idValue = str(query.id_value);
  const idTypes = query.id_type as string[] | undefined;

  if (idValue) {
    const typeLabel = idTypes?.length ? ` (type: ${idTypes.join(", ")})` : "";
    return { queryLabel: `ID "${idValue}"${typeLabel}` };
  }

  if (country || city || address || postal) {
    const parts: string[] = [];
    if (country) parts.push(`country: ${country}`);
    if (city) parts.push(`city: ${city}`);
    if (address) parts.push(`address: ${address}`);
    if (postal) parts.push(`postal code: ${postal}`);
    return { queryLabel: parts.join(", ") };
  }

  if (name || firstName || lastName) {
    const combined = name || [lastName, firstName].filter(Boolean).join(", ").trim();
    return { queryLabel: combined, nameSearchTerm: combined };
  }

  if (q) {
    return { queryLabel: q, nameSearchTerm: q };
  }

  return { queryLabel: "your search criteria" };
}

function buildListDescription(
  query: Record<string, unknown>,
  results: SearchResultEntity[]
): string {
  const filterList = str(query.list) as "sdn" | "cons" | undefined;

  const hasSDN = results.some((r) => r.list === "sdn");
  const hasCons = results.some((r) => r.list === "cons");

  const effectiveList =
    filterList || (hasSDN && !hasCons ? "sdn" : hasCons && !hasSDN ? "cons" : undefined);

  if (effectiveList === "sdn") {
    return "the SDN List";
  }
  if (effectiveList === "cons") {
    return "the Non-SDN Consolidated List";
  }
  if (hasSDN && hasCons) {
    return "both the SDN and Non-SDN Lists";
  }

  return "the Sanctions List";
}

function formatMatch(entity: SearchResultEntity, nameSearchTerm?: string): string {
  const listLabel = entity.list === "sdn" ? "SDN" : "Non-SDN";
  const { displayName, aliasLabel } = pickDisplayName(entity, nameSearchTerm);
  const country = pickDisplayCountry(entity);
  const countryPart = country ? ` in ${country}` : "";

  return `- ${listLabel}: "${displayName}"${aliasLabel}${countryPart}.`;
}

function pickDisplayName(
  entity: SearchResultEntity,
  nameSearchTerm?: string
): { displayName: string; aliasLabel: string } {
  const names = entity.names ?? [];
  const primary = names.find((n) => n.is_primary);
  const fallbackName = primary?.name || names[0]?.name || entity.primary_name || "Unknown";

  if (!nameSearchTerm) {
    return { displayName: fallbackName, aliasLabel: "" };
  }

  const term = normalize(nameSearchTerm);

  // Check if primary name matches
  if (primary && normalize(primary.name).includes(term)) {
    return { displayName: primary.name, aliasLabel: "" };
  }

  // Check aliases for match
  const matchedAlias = names.find((n) => !n.is_primary && normalize(n.name).includes(term));
  if (matchedAlias) {
    return {
      displayName: matchedAlias.name,
      aliasLabel: " (alias)",
    };
  }

  // Fallback to primary name
  return { displayName: fallbackName, aliasLabel: "" };
}

function pickDisplayCountry(entity: SearchResultEntity): string | null {
  const addr = (entity.addresses || []).find((a) => a.country?.trim());
  if (addr?.country) return addr.country.trim();

  const id = (entity.identifications || []).find((i) => i.country?.trim());
  if (id?.country) return id.country.trim();

  return null;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  return undefined;
}
