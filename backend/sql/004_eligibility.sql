CREATE TABLE IF NOT EXISTS election_voters (
  election_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  voter_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  assigned_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (election_id, voter_id),
  CONSTRAINT eligibility_election_fk FOREIGN KEY (election_id) REFERENCES elections(id),
  CONSTRAINT eligibility_voter_fk FOREIGN KEY (voter_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;
