CREATE TABLE IF NOT EXISTS voting_credentials (
  election_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  voter_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  encrypted_nullifier VARCHAR(256) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  PRIMARY KEY (election_id, voter_id),
  CONSTRAINT credential_eligibility_fk FOREIGN KEY (election_id, voter_id) REFERENCES election_voters(election_id, voter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_as_ci;
