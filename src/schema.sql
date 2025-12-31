CREATE TABLE entities (
  id INTEGER NOT NULL,
  identity_id INTEGER,
  entity_type TEXT NOT NULL,
  list TEXT NOT NULL CHECK (list IN ('sdn', 'cons')),
  primary_name TEXT,
  PRIMARY KEY (id, list)
);

CREATE TABLE names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL,
  list TEXT NOT NULL,
  name TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  alias_type TEXT,
  script TEXT,
  FOREIGN KEY (entity_id, list) REFERENCES entities(id, list)
);

CREATE TABLE addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL,
  list TEXT NOT NULL,
  country TEXT,
  country_code TEXT,
  city TEXT,
  address1 TEXT,
  postal_code TEXT,
  FOREIGN KEY (entity_id, list) REFERENCES entities(id, list)
);

CREATE TABLE identifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL,
  list TEXT NOT NULL,
  id_type TEXT,
  id_value TEXT,
  country TEXT,
  FOREIGN KEY (entity_id, list) REFERENCES entities(id, list)
);

CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_list ON entities(list);
CREATE INDEX idx_names_entity ON names(entity_id);
CREATE INDEX idx_names_name ON names(name COLLATE NOCASE);
CREATE INDEX idx_addresses_entity ON addresses(entity_id);
CREATE INDEX idx_addresses_country ON addresses(country);
CREATE INDEX idx_identifications_entity ON identifications(entity_id);

-- FTS5 virtual table for fast fuzzy name search
CREATE VIRTUAL TABLE names_fts USING fts5(
  name,
  entity_id UNINDEXED,
  content='names',
  content_rowid='id',
  tokenize='trigram'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER names_ai AFTER INSERT ON names BEGIN
  INSERT INTO names_fts(rowid, name, entity_id) VALUES (new.id, new.name, new.entity_id);
END;
