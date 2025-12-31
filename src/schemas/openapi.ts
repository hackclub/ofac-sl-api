import type { FastifySchema } from "fastify";

// Common schema components
const EntityType = {
  type: "string",
  enum: ["Individual", "Entity", "Vessel", "Aircraft"],
} as const;

const ListType = {
  type: "string",
  enum: ["sdn", "cons"],
} as const;

const NameObject = {
  type: "object",
  properties: {
    name: { type: "string" },
    is_primary: { type: "boolean" },
    alias_type: { type: "string", nullable: true },
  },
} as const;

const AddressObject = {
  type: "object",
  properties: {
    country: { type: "string", nullable: true },
    country_code: { type: "string", nullable: true },
    city: { type: "string", nullable: true },
    address1: { type: "string", nullable: true },
    postal_code: { type: "string", nullable: true },
  },
} as const;

const IdentificationObject = {
  type: "object",
  properties: {
    id_type: { type: "string", nullable: true },
    id_value: { type: "string", nullable: true },
    country: { type: "string", nullable: true },
  },
} as const;

const HumanReadableField = {
  type: "string",
  description: "Human-readable summary of the search results",
} as const;

const DisclaimerField = {
  type: "string",
  description: "Legal disclaimer for the data",
} as const;

const LastFetchedField = {
  type: "string",
  nullable: true,
  description: "ISO 8601 timestamp of when the OFAC data was last fetched",
} as const;

const SearchResultEntity = {
  type: "object",
  properties: {
    id: { type: "integer", description: "Entity ID" },
    list: ListType,
    entity_type: EntityType,
    primary_name: { type: "string", nullable: true },
    names: { type: "array", items: NameObject },
    addresses: { type: "array", items: AddressObject },
    identifications: { type: "array", items: IdentificationObject },
  },
} as const;

const ErrorResponse = {
  type: "object",
  properties: {
    success: { type: "boolean", enum: [false] },
    message: { type: "string" },
  },
  required: ["success", "message"],
} as const;

const PaginationParams = {
  limit: {
    type: "integer",
    minimum: 1,
    maximum: 200,
    default: 50,
    description: "Maximum number of results to return (1-200)",
  },
  offset: {
    type: "integer",
    minimum: 0,
    default: 0,
    description: "Number of results to skip for pagination",
  },
  human_readable_only: {
    type: "string",
    enum: ["true", "false"],
    default: "false",
    description: "If true, returns only the human_readable summary. Use Accept: text/plain header for plain text response.",
  },
} as const;

const CommonFilterParams = {
  list: {
    type: "string",
    enum: ["sdn", "cons"],
    description: "Filter by sanctions list (SDN or Consolidated)",
  },
  type: {
    type: "string",
    description: "Filter by entity type(s). Comma-separated: individual,entity,vessel,aircraft. Example: individual,entity",
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// ROUTE SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

export const healthSchema: FastifySchema = {
  description: "Health check endpoint",
  tags: ["Health"],
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        status: { type: "string", enum: ["ok"] },
        last_fetched: LastFetchedField,
      },
    },
  },
};

const EntityTypeCount = {
  type: "object",
  properties: {
    type: { type: "string" },
    count: { type: "integer" },
  },
} as const;

const ListStatsSchema = {
  type: "object",
  properties: {
    totalEntities: { type: "integer" },
    entityTypes: { type: "array", items: EntityTypeCount },
  },
} as const;

export const statsSchema: FastifySchema = {
  description: "Get statistics about entities in the OFAC database",
  tags: ["Statistics"],
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        all: ListStatsSchema,
        sdn: ListStatsSchema,
        cons: ListStatsSchema,
        disclaimer: DisclaimerField,
        last_fetched: LastFetchedField,
      },
    },
  },
};

export const searchGenericSchema: FastifySchema = {
  description: "Generic fuzzy search across all entity names using FTS5 trigram matching",
  tags: ["Search"],
  querystring: {
    type: "object",
    required: ["q"],
    properties: {
      q: {
        type: "string",
        description: "Search query (fuzzy matched against entity names)",
        minLength: 1,
      },
      ...CommonFilterParams,
      ...PaginationParams,
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        query: {
          type: "object",
          properties: {
            q: { type: "string" },
            list: { type: "string", nullable: true },
            types: { type: "array", items: { type: "string" } },
            limit: { type: "integer" },
            offset: { type: "integer" },
          },
        },
        total: { type: "integer", description: "Total matching results" },
        results: { type: "array", items: SearchResultEntity },
        human_readable: HumanReadableField,
        disclaimer: DisclaimerField,
        last_fetched: LastFetchedField,
      },
    },
  },
};

export const searchByNameSchema: FastifySchema = {
  description: "Search entities by name. Supports full name or first/last name (for individuals). Use fuzzy=true for FTS5 trigram matching.",
  tags: ["Search"],
  querystring: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Full name to search for",
      },
      first_name: {
        type: "string",
        description: "First name (forces type=individual)",
      },
      last_name: {
        type: "string",
        description: "Last name (forces type=individual)",
      },
      fuzzy: {
        type: "string",
        enum: ["true", "false"],
        default: "false",
        description: "Enable fuzzy matching using FTS5",
      },
      ...CommonFilterParams,
      ...PaginationParams,
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        message: { type: "string" },
        query: {
          type: "object",
          properties: {
            name: { type: "string", nullable: true },
            first_name: { type: "string", nullable: true },
            last_name: { type: "string", nullable: true },
            fuzzy: { type: "boolean" },
            list: { type: "string", nullable: true },
            types: { type: "array", items: { type: "string" } },
            limit: { type: "integer" },
            offset: { type: "integer" },
          },
        },
        total: { type: "integer" },
        results: { type: "array", items: SearchResultEntity },
        human_readable: HumanReadableField,
        disclaimer: DisclaimerField,
        last_fetched: LastFetchedField,
      },
    },
  },
};

export const searchByAddressSchema: FastifySchema = {
  description: "Search entities by address components. Country codes (2-3 chars) use exact match; longer country names use partial match.",
  tags: ["Search"],
  querystring: {
    type: "object",
    properties: {
      country: {
        type: "string",
        description: "Country name or 2-3 letter country code",
      },
      city: {
        type: "string",
        description: "City name (partial match)",
      },
      address: {
        type: "string",
        description: "Street address (partial match)",
      },
      postal_code: {
        type: "string",
        description: "Postal/ZIP code (partial match)",
      },
      ...CommonFilterParams,
      ...PaginationParams,
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        message: { type: "string" },
        query: {
          type: "object",
          properties: {
            country: { type: "string", nullable: true },
            city: { type: "string", nullable: true },
            address: { type: "string", nullable: true },
            postal_code: { type: "string", nullable: true },
            list: { type: "string", nullable: true },
            types: { type: "array", items: { type: "string" } },
            limit: { type: "integer" },
            offset: { type: "integer" },
          },
        },
        total: { type: "integer" },
        results: { type: "array", items: SearchResultEntity },
        human_readable: HumanReadableField,
        disclaimer: DisclaimerField,
        last_fetched: LastFetchedField,
      },
    },
  },
};

export const searchByIdSchema: FastifySchema = {
  description: "Search entities by identification document (passport, tax ID, etc.). Exact match on ID value.",
  tags: ["Search"],
  querystring: {
    type: "object",
    required: ["id_value"],
    properties: {
      id_value: {
        type: "string",
        description: "ID value to search for (exact match)",
        minLength: 1,
      },
      id_type: {
        type: "string",
        description: "Filter by ID type(s). Comma-separated. Valid types: tax_id, registration_number, passport, national_id, vessel_registration, identification_number, mmsi, business_registration, curp, cedula, government_gazette, registration_id, company_number, rfc, uscc, folio_mercantil, license, nit, economic_register, legal_entity_number. Example: passport,national_id",
      },
      ...CommonFilterParams,
      ...PaginationParams,
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        message: { type: "string" },
        query: {
          type: "object",
          properties: {
            id_value: { type: "string" },
            id_type: { type: "array", items: { type: "string" }, nullable: true },
            list: { type: "string", nullable: true },
            types: { type: "array", items: { type: "string" } },
            limit: { type: "integer" },
            offset: { type: "integer" },
          },
        },
        total: { type: "integer" },
        results: { type: "array", items: SearchResultEntity },
        human_readable: HumanReadableField,
        disclaimer: DisclaimerField,
        last_fetched: LastFetchedField,
      },
    },
  },
};
