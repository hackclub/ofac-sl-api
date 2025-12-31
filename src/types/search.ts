export const TYPE_MAP: Record<string, string> = {
  individual: "Individual",
  entity: "Entity",
  vessel: "Vessel",
  aircraft: "Aircraft",
};

export const ID_TYPE_MAP: Record<string, string> = {
  tax_id: "Tax ID No.",
  registration_number: "Registration Number",
  passport: "Passport",
  national_id: "National ID No.",
  vessel_registration: "Vessel Registration Identification",
  identification_number: "Identification Number",
  mmsi: "MMSI",
  business_registration: "Business Registration Number",
  curp: "C.U.R.P.",
  cedula: "Cedula No.",
  government_gazette: "Government Gazette Number",
  registration_id: "Registration ID",
  company_number: "Company Number",
  rfc: "R.F.C.",
  uscc: "Unified Social Credit Code (USCC)",
  folio_mercantil: "Folio Mercantil No.",
  license: "License",
  nit: "NIT #",
  economic_register: "Economic Register Number (CBLS)",
  legal_entity_number: "Legal Entity Number",
};

export interface SearchOptions {
  list?: "sdn" | "cons";
  entityTypes: string[];
  country?: string;
  nameSearch?: {
    mode: "full" | "first_last";
    firstName?: string;
    lastName?: string;
    rawName?: string;
    fuzzy: boolean;
  };
  idFilter?: {
    idTypes: string[];
    idValue: string;
  };
  limit: number;
  offset: number;
}

export interface SearchResultEntity {
  id: number;
  list: "sdn" | "cons";
  entity_type: string;
  primary_name: string | null;
  names?: Array<{
    name: string;
    is_primary: boolean;
    alias_type: string | null;
  }>;
  addresses?: Array<{
    country: string | null;
    country_code: string | null;
    city: string | null;
    address1: string | null;
    postal_code: string | null;
  }>;
  identifications?: Array<{
    id_type: string | null;
    id_value: string | null;
    country: string | null;
  }>;
}

export interface SearchResponse {
  success: boolean;
  message?: string;
  query?: {
    list?: string;
    types: string[];
    country?: string;
    name?: string;
    first_name?: string;
    last_name?: string;
    id_type?: string[];
    id_value?: string;
    fuzzy: boolean;
    limit: number;
    offset: number;
  };
  total?: number;
  results?: SearchResultEntity[];
}
