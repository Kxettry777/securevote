CREATE TABLE IF NOT EXISTS party_candidates (
  id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  party_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  role_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  biography TEXT NOT NULL,
  UNIQUE (party_id, role_id),
  FOREIGN KEY (party_id, role_id) REFERENCES party_candidate_roles(party_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;
