# OFAC Sanctions List API

A REST API for searching the U.S. Treasury's Office of Foreign Assets Control (OFAC) sanctions lists.

## Features

- **Fuzzy name search** using FTS5 trigram matching
- **Exact name matching** with support for first/last name components
- **Address search** by country, city, street address, or postal code
- **ID search** by passport, tax ID, national ID, and other identification types
- **Batch search** for efficient bulk searching
- **Human-readable summaries** for easy interpretation of results

## Quick Start

```bash
npm install
npm run dev
```

The server starts on `http://localhost:3000`. Swagger docs available at `/docs`.

## Endpoints

### Health & Stats

- `GET /` - Health check
- `GET /stats` - Database statistics (entity counts by type and list)

### Search

- `GET /search?q=<query>` - Generic fuzzy search across all names
- `GET /search/name` - Name-specific search with exact or fuzzy matching
- `GET /search/address` - Search by address components
- `GET /search/id` - Search by identification documents
- `POST /batch` - Batch search for multiple queries

### Common Query Parameters

| Parameter | Description                                                                           |
| --------- | ------------------------------------------------------------------------------------- |
| `list`    | Filter by list: `sdn` or `cons`                                                       |
| `type`    | Filter by entity type: `individual`, `entity`, `vessel`, `aircraft` (comma-separated) |
| `limit`   | Max results (1-200, default 50)                                                       |
| `offset`  | Pagination offset                                                                     |

## Examples

### Fuzzy Name Search

```bash
curl "http://localhost:3000/search?q=bank"
```

### Exact Name Match

```bash
curl "http://localhost:3000/search/name?name=Mohammad%20Hassan&fuzzy=false"
```

### Name Components

```bash
curl "http://localhost:3000/search/name?first_name=Mohammad&last_name=Hassan"
```

### Address Search

```bash
curl "http://localhost:3000/search/address?country=Russia&city=Moscow"
```

### ID Search

```bash
curl "http://localhost:3000/search/id?id_value=ABC123&id_type=passport"
```

### Batch Search

```bash
curl -X POST "http://localhost:3000/batch" \
  -H "Content-Type: application/json" \
  -d '{
    "queries": [
      {"id": "1", "search_type": "name", "name": "ali", "fuzzy": true},
      {"id": "2", "search_type": "address", "country": "IR"},
      {"id": "3", "search_type": "id", "id_value": "ABC123"}
    ]
  }'
```

## Response Format

All search responses include:

- `success`: Boolean indicating success
- `query`: Echo of search parameters
- `total`: Total matching results
- `results`: Array of matching entities with names, addresses, and IDs
- `human_readable`: Natural language summary of results
- `disclaimer`: Legal disclaimer

## Data Sources

- **SDN List**: Specially Designated Nationals and Blocked Persons
- **Consolidated List**: Non-SDN Consolidated Sanctions List

Data is downloaded from the U.S. Treasury and cached locally for performance.

## API Documentation

Interactive Swagger documentation is available at `/docs` when the server is running.

OpenAPI 3.0 specification is available at `/docs/json`.

## Running Tests

```bash
# Start the server first
npm run dev

# In another terminal, run tests
npx tsx scripts/api-tests.ts
```

## Disclaimer

This API provides access to sanctions information for informational purposes only and does not constitute official guidance. The data is provided "as is" without warranties of any kind, and may be incomplete or out of date. Users should verify results against official sources before making decisions or taking action. The provider disclaims any liability for decisions or actions taken based on this information. By using the API, you acknowledge responsibility for compliance with applicable laws and regulations.

For official OFAC information, visit: https://ofac.treasury.gov/

## License

MIT
