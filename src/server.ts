import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { downloadAndProcessOFACData } from "./services/ofac-downloader.js";
import {
  isCacheValid,
  initializeDatabaseFromCache,
  createDatabase,
  finalizeDatabase,
  createInMemoryDatabaseInstance,
  finalizeDatabaseInstance,
  swapDatabase,
  getLastFetched,
} from "./services/database.js";
import { computeStats } from "./services/stats.js";
import {
  searchGeneric,
  searchByName,
  searchByAddress,
  searchById,
  batchSearch,
} from "./services/search.js";
import {
  healthSchema,
  statsSchema,
  searchGenericSchema,
  searchByNameSchema,
  searchByAddressSchema,
  searchByIdSchema,
} from "./schemas/openapi.js";

const fastify = Fastify({
  logger: true,
});

await fastify.register(fastifyCors, {
  origin: true,
});

await fastify.register(fastifySwagger, {
  openapi: {
    openapi: "3.0.3",
    info: {
      title: "OFAC Sanctions List API",
      description: `A REST API for searching the U.S. Treasury's Office of Foreign Assets Control (OFAC) sanctions lists.

## Data Sources
- **SDN List**: Specially Designated Nationals and Blocked Persons
- **Consolidated List**: Non-SDN Consolidated Sanctions List

## Features
- Fuzzy name search using FTS5 trigram matching
- Filter by entity type (Individual, Entity, Vessel, Aircraft)
- Search by address, identification documents, or name components
- Pagination support with configurable limits

## Entity Types
- **individual**: Natural persons
- **entity**: Organizations, companies, etc.
- **vessel**: Ships and maritime vessels
- **aircraft**: Aircraft

## ID Types
Supported identification document types: passport, national_id, tax_id, registration_number, vessel_registration, mmsi, business_registration, and more.

## Disclaimer
This API provides access to sanctions information for informational purposes only and does not constitute official guidance. The data is provided "as is" without warranties of any kind, and may be incomplete or out of date. Users should verify results against official sources before making decisions or taking action. The provider disclaims any liability for decisions or actions taken based on this information. By using the API, you acknowledge responsibility for compliance with applicable laws and regulations.
`,
      version: "1.0.0",
      contact: {
        name: "API Support",
      },
      license: {
        name: "MIT",
      },
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Development server",
      },
    ],
    tags: [
      { name: "Health", description: "Health check endpoints" },
      { name: "Statistics", description: "Database statistics" },
      { name: "Search", description: "Search endpoints for OFAC entities" },
    ],
  },
});

await fastify.register(fastifySwaggerUi, {
  routePrefix: "/docs",
  uiConfig: {
    docExpansion: "list",
    deepLinking: true,
    defaultModelsExpandDepth: 3,
    defaultModelExpandDepth: 3,
  },
});

fastify.get("/", { schema: healthSchema }, async () => {
  return {
    success: true,
    status: "ok",
    last_fetched: getLastFetched()?.toISOString() ?? null,
  };
});

fastify.get("/stats", { schema: statsSchema }, async () => {
  try {
    return {
      ...computeStats(),
      last_fetched: getLastFetched()?.toISOString() ?? null,
    };
  } catch {
    return { success: false, message: "Database not initialized" };
  }
});

function handleHumanReadableOnly(
  request: {
    headers: { accept?: string };
    query: Record<string, string | undefined>;
  },
  reply: { type: (t: string) => void },
  result: {
    success?: boolean;
    message?: string;
    human_readable?: string;
    disclaimer?: string;
  }
):
  | string
  | {
      success: boolean;
      message?: string;
      human_readable: string;
      disclaimer: string;
    }
  | null {
  const query = request.query as Record<string, string | undefined>;
  if (query.human_readable_only !== "true") return null;

  const humanReadable = result.human_readable || "";
  const disclaimer = result.disclaimer || "";

  if (request.headers.accept?.includes("text/plain")) {
    reply.type("text/plain");
    return humanReadable;
  }

  return {
    success: result.success ?? true,
    message: result.message,
    human_readable: humanReadable,
    disclaimer,
  };
}

fastify.get(
  "/search",
  { schema: searchGenericSchema },
  async (request, reply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const result = {
        ...searchGeneric(query),
        last_fetched: getLastFetched()?.toISOString() ?? null,
      };
      const humanOnly = handleHumanReadableOnly(request, reply, result);
      if (humanOnly !== null) return humanOnly;
      return result;
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Search failed",
      };
    }
  }
);

fastify.get(
  "/search/name",
  { schema: searchByNameSchema },
  async (request, reply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const result = {
        ...searchByName(query),
        last_fetched: getLastFetched()?.toISOString() ?? null,
      };
      const humanOnly = handleHumanReadableOnly(request, reply, result);
      if (humanOnly !== null) return humanOnly;
      return result;
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Search failed",
      };
    }
  }
);

fastify.get(
  "/search/address",
  { schema: searchByAddressSchema },
  async (request, reply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const result = {
        ...searchByAddress(query),
        last_fetched: getLastFetched()?.toISOString() ?? null,
      };
      const humanOnly = handleHumanReadableOnly(request, reply, result);
      if (humanOnly !== null) return humanOnly;
      return result;
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Search failed",
      };
    }
  }
);

fastify.get(
  "/search/id",
  { schema: searchByIdSchema },
  async (request, reply) => {
    try {
      const query = request.query as Record<string, string | undefined>;
      const result = {
        ...searchById(query),
        last_fetched: getLastFetched()?.toISOString() ?? null,
      };
      const humanOnly = handleHumanReadableOnly(request, reply, result);
      if (humanOnly !== null) return humanOnly;
      return result;
    } catch (err) {
      return {
        success: false,
        message: err instanceof Error ? err.message : "Search failed",
      };
    }
  }
);

fastify.post<{
  Body: {
    queries: Array<{
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
    }>;
  };
}>(
  "/batch",
  {
    schema: {
      description: `Submit multiple searches in a single request for efficient bulk searching.

## Overview
The batch endpoint allows you to perform multiple sanctions searches in one API call. Each query is processed independently, and individual failures don't affect other queries in the batch.

## Performance
Optimized to minimize database queries by batching entity enrichment across all results.

## Search Types
- **all**: Fuzzy search across all names (requires \`q\`)
- **name**: Name-specific search (requires \`name\`, \`first_name\`, or \`last_name\`)
- **address**: Address search (requires \`country\`, \`city\`, \`address\`, or \`postal_code\`)
- **id**: ID document search (requires \`id_value\`)

## Example Request
\`\`\`json
{
  "queries": [
    {"id": "customer-123", "search_type": "name", "name": "John Smith", "fuzzy": true},
    {"id": "customer-456", "search_type": "name", "first_name": "Mohammad", "last_name": "Hassan"},
    {"id": "vendor-789", "search_type": "address", "country": "IR"},
    {"id": "txn-001", "search_type": "id", "id_value": "ABC123456", "id_type": "passport"}
  ]
}
\`\`\`

## Response
Each result includes the original \`id\` for matching, along with \`success\`, \`total\`, \`results\`, \`human_readable\`, and \`disclaimer\` fields.
`,
      tags: ["Search"],
      body: {
        type: "object",
        required: ["queries"],
        properties: {
          queries: {
            type: "array",
            description: "Array of search queries to execute",
            items: {
              type: "object",
              required: ["id", "search_type"],
              properties: {
                id: {
                  type: "string",
                  description:
                    "Client-provided unique identifier. Returned in response to match results with requests.",
                },
                search_type: {
                  type: "string",
                  enum: ["all", "name", "address", "id"],
                  description:
                    "Type of search: 'all' (fuzzy name), 'name' (exact/fuzzy name), 'address' (location), 'id' (identification document)",
                },
                q: {
                  type: "string",
                  description:
                    "Search query for 'all' search type. Fuzzy matched against entity names.",
                },
                name: {
                  type: "string",
                  description:
                    "Full name for 'name' search. Matches exactly or fuzzy based on 'fuzzy' flag.",
                },
                first_name: {
                  type: "string",
                  description:
                    "First name for 'name' search. Forces type=individual.",
                },
                last_name: {
                  type: "string",
                  description:
                    "Last name for 'name' search. Forces type=individual.",
                },
                fuzzy: {
                  type: "boolean",
                  default: false,
                  description:
                    "Enable fuzzy matching for 'name' search using FTS5 trigram.",
                },
                country: {
                  type: "string",
                  description:
                    "Country name or 2-3 letter code for 'address' search.",
                },
                city: {
                  type: "string",
                  description:
                    "City name for 'address' search (partial match).",
                },
                address: {
                  type: "string",
                  description:
                    "Street address for 'address' search (partial match).",
                },
                postal_code: {
                  type: "string",
                  description:
                    "Postal/ZIP code for 'address' search (partial match).",
                },
                id_value: {
                  type: "string",
                  description:
                    "ID value for 'id' search (exact match). Required for id search type.",
                },
                id_type: {
                  type: "string",
                  description:
                    "Filter by ID type(s) for 'id' search. Comma-separated: passport, national_id, tax_id, etc.",
                },
                list: {
                  type: "string",
                  enum: ["sdn", "cons"],
                  description:
                    "Filter by sanctions list: 'sdn' (SDN List) or 'cons' (Consolidated Non-SDN).",
                },
                type: {
                  type: "string",
                  description:
                    "Filter by entity type(s). Comma-separated: individual, entity, vessel, aircraft.",
                },
                types: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "Entity types as array. Alternative to comma-separated 'type'.",
                },
                limit: {
                  type: "integer",
                  minimum: 1,
                  maximum: 200,
                  default: 50,
                  description: "Maximum results per query (1-200).",
                },
                offset: {
                  type: "integer",
                  minimum: 0,
                  default: 0,
                  description: "Pagination offset for this query.",
                },
              },
            },
          },
        },
      },
      response: {
        200: {
          description: "Batch search results",
          type: "object",
          properties: {
            success: {
              type: "boolean",
              description: "Overall batch success status",
            },
            results: {
              type: "array",
              description:
                "Array of search results, one per query in the same order as input",
              items: {
                type: "object",
                properties: {
                  id: {
                    type: "string",
                    description: "The client-provided ID from the request",
                  },
                  success: {
                    type: "boolean",
                    description: "Whether this individual query succeeded",
                  },
                  message: {
                    type: "string",
                    description: "Error message if success is false",
                  },
                  query: {
                    type: "object",
                    description: "Echo of the parsed query parameters",
                  },
                  total: {
                    type: "integer",
                    description: "Total number of matching entities",
                  },
                  results: {
                    type: "array",
                    description:
                      "Array of matching entities with names, addresses, and IDs",
                  },
                  human_readable: {
                    type: "string",
                    description: "Natural language summary of results",
                  },
                  disclaimer: {
                    type: "string",
                    description: "Legal disclaimer",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  async (request) => {
    const { queries } = request.body;
    const results = batchSearch(queries);
    return { success: true, results };
  }
);

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function buildAndSwapOfacDatabaseSnapshot(): Promise<void> {
  const tempDb = createInMemoryDatabaseInstance();

  try {
    await downloadAndProcessOFACData(tempDb, true);
    const readyDb = finalizeDatabaseInstance(tempDb);
    swapDatabase(readyDb);
    fastify.log.info("OFAC database refreshed and swapped successfully");
  } catch (err) {
    fastify.log.error(
      { err },
      "OFAC database refresh failed; keeping previous database"
    );
    try {
      tempDb.close();
    } catch {
      // ignore
    }
  }
}

function startOfacRefreshScheduler(): void {
  function scheduleNext(): void {
    setTimeout(async () => {
      try {
        fastify.log.info("Starting scheduled OFAC refresh");
        await buildAndSwapOfacDatabaseSnapshot();
      } catch (err) {
        fastify.log.error(
          { err },
          "Unexpected error during scheduled OFAC refresh"
        );
      } finally {
        scheduleNext();
      }
    }, REFRESH_INTERVAL_MS);
  }

  scheduleNext();
  fastify.log.info(
    `OFAC auto-refresh scheduled every ${
      REFRESH_INTERVAL_MS / 1000 / 60 / 60
    } hours`
  );
}

async function start() {
  try {
    if (isCacheValid()) {
      initializeDatabaseFromCache();
    } else {
      createDatabase();
      await downloadAndProcessOFACData();
      finalizeDatabase();
    }

    await fastify.listen({ port: 3000, host: "0.0.0.0" });
    console.log("📚 Swagger docs available at http://localhost:3000/docs");

    startOfacRefreshScheduler();
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
