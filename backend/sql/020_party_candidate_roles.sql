CREATE TABLE IF NOT EXISTS party_candidate_roles (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  party_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  name VARCHAR(80) NOT NULL,
  rank_order INT UNSIGNED NOT NULL,
  UNIQUE (party_id, name),
  UNIQUE (party_id, rank_order),
  UNIQUE (party_id, id),
  FOREIGN KEY (party_id) REFERENCES registered_parties(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;
