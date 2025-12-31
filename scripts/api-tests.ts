// Comprehensive OFAC API Tests
// Run: npx tsx scripts/api-tests.ts

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const PERF_WARN_MS = Number(process.env.PERF_WARN_MS || 300);

// ANSI color helpers
const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  blue: (s: string) => `\x1b[34m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bgGreen: (s: string) => `\x1b[42m\x1b[30m${s}\x1b[0m`,
  bgRed: (s: string) => `\x1b[41m\x1b[37m${s}\x1b[0m`,
};

function expect(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function httpGet(path: string, params: Record<string, string | number | undefined> = {}) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url);
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body, url: url.toString() };
}

function isErrorResponse(status: number, body: any): boolean {
  return status === 400 || body?.success === false;
}

interface Test {
  name: string;
  category: string;
  fn: () => Promise<void>;
}

const tests: Test[] = [];

function defineTest(category: string, name: string, fn: () => Promise<void>) {
  tests.push({ name, category, fn });
}

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH CHECK TESTS
// ═══════════════════════════════════════════════════════════════════════════

defineTest("Health", "GET / returns success status", async () => {
  const { status, body } = await httpGet("/");
  expect(status === 200, `Expected 200, got ${status}`);
  expect(body?.success === true, "Expected success: true");
  expect(body?.status === "ok", 'Expected status: "ok"');
});

// ═══════════════════════════════════════════════════════════════════════════
// STATS TESTS
// ═══════════════════════════════════════════════════════════════════════════

defineTest("Stats", "GET /stats returns valid stats object", async () => {
  const { status, body } = await httpGet("/stats");
  expect(status === 200, `Expected 200, got ${status}`);
  expect(body?.success === true, "Expected success: true");
  expect(typeof body.all === "object", "Expected 'all' stats object");
  expect(typeof body.sdn === "object", "Expected 'sdn' stats object");
  expect(typeof body.cons === "object", "Expected 'cons' stats object");
});

defineTest("Stats", "GET /stats has reasonable entity counts", async () => {
  const { body } = await httpGet("/stats");
  expect(body.all.totalEntities >= 15000, `Expected >= 15000 entities, got ${body.all.totalEntities}`);
  expect(body.sdn.totalEntities > body.cons.totalEntities, "Expected SDN > CONS entities");
});

defineTest("Stats", "GET /stats includes entity type breakdown", async () => {
  const { body } = await httpGet("/stats");
  expect(Array.isArray(body.all.entityTypes), "Expected entityTypes array");
  expect(body.all.entityTypes.length >= 2, "Expected at least 2 entity types");
  const types = body.all.entityTypes.map((t: any) => t.type);
  expect(types.includes("Individual"), "Expected Individual type");
  expect(types.includes("Entity"), "Expected Entity type");
});

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC SEARCH TESTS
// ═══════════════════════════════════════════════════════════════════════════

defineTest("Search", "GET /search basic query", async () => {
  const { status, body } = await httpGet("/search", { q: "bank" });
  expect(status === 200, `Expected 200, got ${status}`);
  expect(body.success === true, "Expected success: true");
  expect(body.query.q === "bank", "Expected query.q to echo 'bank'");
  expect(Array.isArray(body.results), "Expected results array");
  expect(body.results.length <= body.query.limit, "results.length <= limit");
});

defineTest("Search", "GET /search returns enriched results", async () => {
  const { body } = await httpGet("/search", { q: "bank", limit: 5 });
  if (body.total > 0) {
    const r = body.results[0];
    expect("id" in r, "Result should have id");
    expect("list" in r, "Result should have list");
    expect("entity_type" in r, "Result should have entity_type");
    expect("primary_name" in r, "Result should have primary_name");
    expect(Array.isArray(r.names), "Result should have names array");
    expect(Array.isArray(r.addresses), "Result should have addresses array");
    expect(Array.isArray(r.identifications), "Result should have identifications array");
  }
});

defineTest("Search", "GET /search with list=sdn filters correctly", async () => {
  const { body } = await httpGet("/search", { q: "bank", list: "sdn" });
  expect(body.success === true, "Expected success: true");
  if (body.total > 0) {
    for (const r of body.results) {
      expect(r.list === "sdn", `Expected list "sdn", got "${r.list}"`);
    }
  }
});

defineTest("Search", "GET /search with list=cons filters correctly", async () => {
  const { body } = await httpGet("/search", { q: "oil", list: "cons" });
  expect(body.success === true, "Expected success: true");
  if (body.total > 0) {
    for (const r of body.results) {
      expect(r.list === "cons", `Expected list "cons", got "${r.list}"`);
    }
  }
});

defineTest("Search", "GET /search with type=individual filters correctly", async () => {
  const { body } = await httpGet("/search", { q: "ali", type: "individual" });
  expect(body.success === true, "Expected success: true");
  if (body.total > 0) {
    for (const r of body.results) {
      expect(r.entity_type === "Individual", `Expected Individual, got "${r.entity_type}"`);
    }
  }
});

defineTest("Search", "GET /search with type=entity filters correctly", async () => {
  const { body } = await httpGet("/search", { q: "bank", type: "entity" });
  expect(body.success === true, "Expected success: true");
  if (body.total > 0) {
    for (const r of body.results) {
      expect(r.entity_type === "Entity", `Expected Entity, got "${r.entity_type}"`);
    }
  }
});

defineTest("Search", "GET /search with multiple types", async () => {
  const { body } = await httpGet("/search", { q: "bank", type: "individual,entity" });
  expect(body.success === true, "Expected success: true");
  if (body.total > 0) {
    for (const r of body.results) {
      expect(
        r.entity_type === "Individual" || r.entity_type === "Entity",
        `Expected Individual or Entity, got "${r.entity_type}"`
      );
    }
  }
});

defineTest("Search", "GET /search respects limit parameter", async () => {
  const { body } = await httpGet("/search", { q: "ali", limit: 10 });
  expect(body.query.limit === 10, "Expected limit to be 10");
  expect(body.results.length <= 10, "Expected at most 10 results");
});

defineTest("Search", "GET /search clamps limit to max 200", async () => {
  const { status, body } = await httpGet("/search", { q: "bank", limit: 9999 });
  if (status === 400) {
    expect(body.message?.includes("limit"), "Expected validation error for limit");
  } else {
    expect(body.query.limit <= 200, "Expected limit clamped to <= 200");
  }
});

defineTest("Search", "GET /search clamps limit to min 1", async () => {
  const { status, body } = await httpGet("/search", { q: "bank", limit: 0 });
  if (status === 400) {
    expect(body.message?.includes("limit"), "Expected validation error for limit");
  } else {
    expect(body.query.limit >= 1, "Expected limit clamped to >= 1");
  }
});

defineTest("Search", "GET /search clamps negative offset to 0", async () => {
  const { status, body } = await httpGet("/search", { q: "bank", offset: -10 });
  if (status === 400) {
    expect(body.message?.includes("offset"), "Expected validation error for offset");
  } else {
    expect(body.query.offset >= 0, "Expected offset clamped to >= 0");
  }
});

defineTest("Search", "GET /search pagination works", async () => {
  const { body: page1 } = await httpGet("/search", { q: "ali", limit: 5, offset: 0 });
  const { body: page2 } = await httpGet("/search", { q: "ali", limit: 5, offset: 5 });
  expect(page1.success && page2.success, "Both pages should succeed");
  if (page1.total > 5 && page2.results.length > 0) {
    const ids1 = new Set(page1.results.map((r: any) => `${r.id}-${r.list}`));
    const hasOverlap = page2.results.some((r: any) => ids1.has(`${r.id}-${r.list}`));
    expect(!hasOverlap, "Page 2 should not overlap with page 1");
  }
});

// Error cases
defineTest("Search", "GET /search without q returns error", async () => {
  const { status, body } = await httpGet("/search");
  expect(isErrorResponse(status, body), "Expected error response");
});

defineTest("Search", "GET /search with invalid list returns error", async () => {
  const { status, body } = await httpGet("/search", { q: "bank", list: "foo" });
  expect(isErrorResponse(status, body), "Expected error response");
});

defineTest("Search", "GET /search with invalid type returns error", async () => {
  const { status, body } = await httpGet("/search", { q: "bank", type: "foo" });
  expect(isErrorResponse(status, body), "Expected error response");
});

// ═══════════════════════════════════════════════════════════════════════════
// NAME SEARCH TESTS
// ═══════════════════════════════════════════════════════════════════════════

defineTest("Name Search", "GET /search/name with name (non-fuzzy)", async () => {
  const { body } = await httpGet("/search/name", { name: "ali", fuzzy: "false" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.name === "ali", "Expected query.name to echo 'ali'");
  expect(body.query.fuzzy === false, "Expected fuzzy: false");
});

defineTest("Name Search", "GET /search/name with name (fuzzy)", async () => {
  const { body } = await httpGet("/search/name", { name: "ali", fuzzy: "true" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.fuzzy === true, "Expected fuzzy: true");
});

defineTest("Name Search", "GET /search/name with first_name and last_name", async () => {
  const { body } = await httpGet("/search/name", { first_name: "juan", last_name: "garcia" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.first_name === "juan", "Expected first_name to echo");
  expect(body.query.last_name === "garcia", "Expected last_name to echo");
  expect(body.query.types.includes("individual"), "first/last_name forces Individual type");
});

defineTest("Name Search", "GET /search/name with last_name only", async () => {
  const { body } = await httpGet("/search/name", { last_name: "rodriguez" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.types.includes("individual"), "last_name forces Individual type");
});

defineTest("Name Search", "GET /search/name with first_name only", async () => {
  const { body } = await httpGet("/search/name", { first_name: "mohammad" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.types.includes("individual"), "first_name forces Individual type");
});

defineTest("Name Search", "GET /search/name respects list filter", async () => {
  const { body } = await httpGet("/search/name", { name: "ali", list: "sdn" });
  expect(body.success === true, "Expected success: true");
  if (body.total > 0) {
    for (const r of body.results) {
      expect(r.list === "sdn", `Expected list "sdn", got "${r.list}"`);
    }
  }
});

// Error cases
defineTest("Name Search", "GET /search/name without any name param returns error", async () => {
  const { status, body } = await httpGet("/search/name");
  expect(isErrorResponse(status, body), "Expected error response");
});

defineTest("Name Search", "GET /search/name with invalid list returns error", async () => {
  const { status, body } = await httpGet("/search/name", { name: "test", list: "bad" });
  expect(isErrorResponse(status, body), "Expected error response");
});

// ═══════════════════════════════════════════════════════════════════════════
// ADDRESS SEARCH TESTS
// ═══════════════════════════════════════════════════════════════════════════

defineTest("Address Search", "GET /search/address with country code", async () => {
  const { body } = await httpGet("/search/address", { country: "RU" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.country === "RU", "Expected country to echo 'RU'");
  if (body.total > 0) {
    for (const r of body.results) {
      const hasRU = r.addresses?.some((a: any) => a.country_code === "RU");
      expect(hasRU, "Expected at least one RU address");
    }
  }
});

defineTest("Address Search", "GET /search/address with country name", async () => {
  const { body } = await httpGet("/search/address", { country: "Russia" });
  expect(body.success === true, "Expected success: true");
  if (body.total > 0) {
    for (const r of body.results) {
      const hasRussia = r.addresses?.some((a: any) =>
        a.country?.toLowerCase().includes("russia")
      );
      expect(hasRussia, "Expected Russia in address country");
    }
  }
});

defineTest("Address Search", "GET /search/address with city", async () => {
  const { body } = await httpGet("/search/address", { city: "tehran" });
  expect(body.success === true, "Expected success: true");
  if (body.total > 0) {
    for (const r of body.results) {
      const hasCity = r.addresses?.some((a: any) =>
        a.city?.toLowerCase().includes("tehran")
      );
      expect(hasCity, "Expected Tehran in address city");
    }
  }
});

defineTest("Address Search", "GET /search/address with multiple filters", async () => {
  const { body } = await httpGet("/search/address", { country: "MX", city: "mexico" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.country === "MX", "Expected country filter");
  expect(body.query.city === "mexico", "Expected city filter");
});

defineTest("Address Search", "GET /search/address with postal_code", async () => {
  const { body } = await httpGet("/search/address", { country: "RU", postal_code: "1" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.postal_code === "1", "Expected postal_code filter");
});

defineTest("Address Search", "GET /search/address respects list filter", async () => {
  const { body } = await httpGet("/search/address", { country: "IR", list: "sdn" });
  expect(body.success === true, "Expected success: true");
  if (body.total > 0) {
    for (const r of body.results) {
      expect(r.list === "sdn", `Expected list "sdn", got "${r.list}"`);
    }
  }
});

defineTest("Address Search", "GET /search/address respects type filter", async () => {
  const { body } = await httpGet("/search/address", { country: "RU", type: "individual" });
  expect(body.success === true, "Expected success: true");
  if (body.total > 0) {
    for (const r of body.results) {
      expect(r.entity_type === "Individual", `Expected Individual, got "${r.entity_type}"`);
    }
  }
});

// Error cases
defineTest("Address Search", "GET /search/address without any param returns error", async () => {
  const { status, body } = await httpGet("/search/address");
  expect(isErrorResponse(status, body), "Expected error response");
});

// ═══════════════════════════════════════════════════════════════════════════
// ID SEARCH TESTS
// ═══════════════════════════════════════════════════════════════════════════

defineTest("ID Search", "GET /search/id with id_value (no match expected)", async () => {
  const { body } = await httpGet("/search/id", { id_value: "NONEXISTENT_ID_12345" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.id_value === "NONEXISTENT_ID_12345", "Expected id_value to echo");
  expect(body.total === 0, "Expected 0 results for nonexistent ID");
});

defineTest("ID Search", "GET /search/id with id_type filter", async () => {
  const { body } = await httpGet("/search/id", { id_value: "test", id_type: "passport" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.id_type?.includes("passport"), "Expected id_type filter echoed");
});

defineTest("ID Search", "GET /search/id with multiple id_types", async () => {
  const { body } = await httpGet("/search/id", { id_value: "test", id_type: "passport,national_id" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.id_type?.includes("passport"), "Expected passport in id_type");
  expect(body.query.id_type?.includes("national_id"), "Expected national_id in id_type");
});

defineTest("ID Search", "GET /search/id respects list filter", async () => {
  const { body } = await httpGet("/search/id", { id_value: "123", list: "sdn" });
  expect(body.success === true, "Expected success: true");
  expect(body.query.list === "sdn", "Expected list filter");
});

// Error cases
defineTest("ID Search", "GET /search/id without id_value returns error", async () => {
  const { status, body } = await httpGet("/search/id");
  expect(isErrorResponse(status, body), "Expected error response");
});

defineTest("ID Search", "GET /search/id with invalid id_type returns error", async () => {
  const { status, body } = await httpGet("/search/id", { id_value: "123", id_type: "foo" });
  expect(isErrorResponse(status, body), "Expected error response");
});

// ═══════════════════════════════════════════════════════════════════════════
// HUMAN READABLE ONLY TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function httpGetWithHeaders(path: string, params: Record<string, string | number | undefined>, headers: Record<string, string>) {
  const url = new URL(path, BASE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url, { headers });
  const contentType = res.headers.get("content-type") || "";
  let body: any;
  if (contentType.includes("text/plain")) {
    body = await res.text();
  } else {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  }
  return { status: res.status, body, contentType };
}

defineTest("Human Readable", "human_readable_only returns JSON with success and human_readable", async () => {
  const { status, body } = await httpGet("/search", { q: "bank", human_readable_only: "true", limit: 5 });
  expect(status === 200, `Expected 200, got ${status}`);
  expect(body.success === true, "Expected success: true");
  expect(typeof body.human_readable === "string", "Expected human_readable string");
  expect(typeof body.disclaimer === "string", "Expected disclaimer string");
  expect(body.results === undefined, "Should not include results");
  expect(body.total === undefined, "Should not include total");
});

defineTest("Human Readable", "human_readable_only with Accept: text/plain returns plain text", async () => {
  const { status, body, contentType } = await httpGetWithHeaders(
    "/search",
    { q: "bank", human_readable_only: "true", limit: 5 },
    { Accept: "text/plain" }
  );
  expect(status === 200, `Expected 200, got ${status}`);
  expect(contentType.includes("text/plain"), "Expected text/plain content type");
  expect(typeof body === "string", "Expected string body");
  expect(body.includes("found for") || body.includes("No matches"), "Expected human readable text");
});

defineTest("Human Readable", "human_readable_only works on /search/name", async () => {
  const { body } = await httpGet("/search/name", { name: "ali", fuzzy: "true", human_readable_only: "true", limit: 5 });
  expect(typeof body.human_readable === "string", "Expected human_readable string");
  expect(body.results === undefined, "Should not include results");
});

defineTest("Human Readable", "human_readable_only works on /search/address", async () => {
  const { body } = await httpGet("/search/address", { country: "RU", human_readable_only: "true", limit: 5 });
  expect(typeof body.human_readable === "string", "Expected human_readable string");
  expect(body.results === undefined, "Should not include results");
});

defineTest("Human Readable", "human_readable_only works on /search/id", async () => {
  const { body } = await httpGet("/search/id", { id_value: "test123", human_readable_only: "true" });
  expect(typeof body.human_readable === "string", "Expected human_readable string");
  expect(body.results === undefined, "Should not include results");
});

// ═══════════════════════════════════════════════════════════════════════════
// BATCH SEARCH TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function httpPost(path: string, body: unknown) {
  const url = new URL(path, BASE_URL);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  let responseBody: any;
  try {
    responseBody = await res.json();
  } catch {
    responseBody = null;
  }
  return { status: res.status, body: responseBody };
}

defineTest("Batch", "POST /batch with multiple search types", async () => {
  const { status, body } = await httpPost("/batch", {
    queries: [
      { id: "1", search_type: "name", name: "ali", fuzzy: true, limit: 5 },
      { id: "2", search_type: "all", q: "bank", limit: 5 },
      { id: "3", search_type: "address", country: "RU", limit: 5 },
    ],
  });
  expect(status === 200, `Expected 200, got ${status}`);
  expect(body.success === true, "Expected success: true");
  expect(Array.isArray(body.results), "Expected results array");
  expect(body.results.length === 3, "Expected 3 results");
  expect(body.results[0].id === "1", "Expected first result id to be '1'");
  expect(body.results[1].id === "2", "Expected second result id to be '2'");
  expect(body.results[2].id === "3", "Expected third result id to be '3'");
});

defineTest("Batch", "POST /batch preserves order and IDs", async () => {
  const { body } = await httpPost("/batch", {
    queries: [
      { id: "z", search_type: "name", name: "test", limit: 1 },
      { id: "a", search_type: "name", name: "test2", limit: 1 },
      { id: "m", search_type: "all", q: "test3", limit: 1 },
    ],
  });
  expect(body.results[0].id === "z", "Expected first id 'z'");
  expect(body.results[1].id === "a", "Expected second id 'a'");
  expect(body.results[2].id === "m", "Expected third id 'm'");
});

defineTest("Batch", "POST /batch handles individual query errors gracefully", async () => {
  const { status, body } = await httpPost("/batch", {
    queries: [
      { id: "good", search_type: "name", name: "ali", limit: 5 },
      { id: "bad", search_type: "name" }, // missing required name param
      { id: "good2", search_type: "all", q: "bank", limit: 5 },
    ],
  });
  expect(status === 200, `Expected 200, got ${status}`);
  expect(body.success === true, "Batch should succeed overall");
  expect(body.results.length === 3, "Expected 3 results");
  expect(body.results[0].success === true, "First query should succeed");
  expect(body.results[1].success === false, "Second query should fail");
  expect(body.results[2].success === true, "Third query should succeed");
});

defineTest("Batch", "POST /batch with id search type", async () => {
  const { status, body } = await httpPost("/batch", {
    queries: [
      { id: "1", search_type: "id", id_value: "NONEXISTENT123", limit: 5 },
    ],
  });
  expect(status === 200, `Expected 200, got ${status}`);
  expect(body.results[0].success === true, "ID search should succeed");
  expect(body.results[0].total === 0, "Expected 0 results for nonexistent ID");
});

defineTest("Batch", "POST /batch respects filters", async () => {
  const { body } = await httpPost("/batch", {
    queries: [
      { id: "1", search_type: "name", name: "ali", fuzzy: true, list: "sdn", types: ["individual"], limit: 10 },
    ],
  });
  expect(body.results[0].success === true, "Query should succeed");
  if (body.results[0].total > 0) {
    for (const r of body.results[0].results) {
      expect(r.list === "sdn", `Expected list "sdn", got "${r.list}"`);
      expect(r.entity_type === "Individual", `Expected Individual, got "${r.entity_type}"`);
    }
  }
});

defineTest("Batch", "POST /batch with empty queries array", async () => {
  const { status, body } = await httpPost("/batch", { queries: [] });
  expect(status === 200, `Expected 200, got ${status}`);
  expect(body.success === true, "Expected success: true");
  expect(body.results.length === 0, "Expected empty results array");
});

defineTest("Batch", "POST /batch without queries returns error", async () => {
  const { status } = await httpPost("/batch", {});
  expect(status === 400, "Expected 400 for missing queries");
});

// ═══════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  ms: number;
  error?: string;
}

async function run() {
  console.log("\n" + c.bold("━".repeat(70)));
  console.log(c.bold(c.cyan("  🔍 OFAC API Test Suite")));
  console.log(c.gray(`  Target: ${BASE_URL}`));
  console.log(c.gray(`  Tests: ${tests.length}`));
  console.log(c.bold("━".repeat(70)) + "\n");

  const results: TestResult[] = [];
  const categories = new Map<string, TestResult[]>();

  // Group tests by category
  for (const test of tests) {
    if (!categories.has(test.category)) {
      categories.set(test.category, []);
    }
  }

  let totalPassed = 0;
  let totalFailed = 0;
  let totalSlow = 0;
  const startTime = performance.now();

  for (const [category, _] of categories) {
    console.log(c.bold(c.blue(`▸ ${category}`)));
    
    const categoryTests = tests.filter((t) => t.category === category);
    
    for (const test of categoryTests) {
      const testStart = performance.now();
      let passed = false;
      let error: string | undefined;

      try {
        await test.fn();
        passed = true;
        totalPassed++;
      } catch (err) {
        passed = false;
        totalFailed++;
        error = err instanceof Error ? err.message : String(err);
      }

      const ms = performance.now() - testStart;
      const isSlow = ms > PERF_WARN_MS;
      if (isSlow) totalSlow++;

      results.push({ name: test.name, category, passed, ms, error });
      categories.get(category)!.push({ name: test.name, category, passed, ms, error });

      // Print result
      const icon = passed ? c.green("✓") : c.red("✗");
      const time = isSlow ? c.yellow(`${ms.toFixed(0)}ms`) : c.gray(`${ms.toFixed(0)}ms`);
      console.log(`  ${icon} ${test.name} ${time}`);
      
      if (error) {
        console.log(c.red(`    └─ ${error}`));
      }
    }
    console.log();
  }

  const totalTime = performance.now() - startTime;

  // Summary
  console.log(c.bold("━".repeat(70)));
  console.log(c.bold("  📊 Summary"));
  console.log(c.bold("━".repeat(70)));
  
  const passedStr = totalFailed === 0 ? c.bgGreen(` ${totalPassed} passed `) : c.green(`${totalPassed} passed`);
  const failedStr = totalFailed > 0 ? c.bgRed(` ${totalFailed} failed `) : c.gray(`${totalFailed} failed`);
  const slowStr = totalSlow > 0 ? c.yellow(`${totalSlow} slow`) : c.gray(`${totalSlow} slow`);
  
  console.log(`\n  ${passedStr}  ${failedStr}  ${slowStr}`);
  console.log(c.gray(`  Total time: ${(totalTime / 1000).toFixed(2)}s\n`));

  // Slowest tests
  const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5);
  console.log(c.bold("  ⏱  Slowest Tests:"));
  for (const r of slowest) {
    const timeColor = r.ms > PERF_WARN_MS ? c.yellow : c.gray;
    console.log(`     ${timeColor(`${r.ms.toFixed(0)}ms`.padStart(6))} ${r.name}`);
  }

  // Failed tests summary
  if (totalFailed > 0) {
    console.log("\n" + c.bold(c.red("  ❌ Failed Tests:")));
    for (const r of results.filter((r) => !r.passed)) {
      console.log(c.red(`     • ${r.name}`));
      if (r.error) console.log(c.gray(`       ${r.error}`));
    }
  }

  console.log("\n" + c.bold("━".repeat(70)) + "\n");

  if (totalFailed > 0) {
    process.exitCode = 1;
  }
}

// Run warmup request then start tests
async function main() {
  console.log(c.gray("\n  Warming up..."));
  try {
    await httpGet("/");
    await run();
  } catch (err) {
    console.error(c.red(`\n  Failed to connect to ${BASE_URL}`));
    console.error(c.gray("  Make sure the server is running: npm run dev\n"));
    process.exitCode = 1;
  }
}

main();
