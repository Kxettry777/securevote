CREATE TABLE IF NOT EXISTS party_details (
  candidate_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  short_name VARCHAR(16) NOT NULL DEFAULT '',
  symbol VARCHAR(60) NOT NULL DEFAULT '',
  CONSTRAINT party_candidate_fk FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;
