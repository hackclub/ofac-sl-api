export interface ReferenceValue {
  "@_refId": number;
  type: string;
  value: string;
  isoCode?: string;
}

export interface EntityType {
  "@_refId": number;
  "#text": string;
}

export interface GeneralInfo {
  identityId: number;
  entityType: EntityType;
  title?: string;
}

export interface Entity {
  "@_id": number;
  generalInfo: GeneralInfo;
}

export interface SanctionsData {
  sanctionsData: {
    referenceValues: {
      referenceValue: ReferenceValue | ReferenceValue[];
    };
    entities: {
      entity: Entity | Entity[];
    };
  };
}

export interface EntityTypeStats {
  type: string;
  count: number;
}

export interface ListStats {
  totalEntities: number;
  entityTypes: EntityTypeStats[];
}

export interface StatsResponse {
  success: boolean;
  all: ListStats;
  sdn: ListStats;
  cons: ListStats;
}
