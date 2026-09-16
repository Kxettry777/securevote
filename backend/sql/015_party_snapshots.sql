CREATE TABLE IF NOT EXISTS election_party_snapshots (
  candidate_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  party_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  symbol_image MEDIUMBLOB NOT NULL,
  roster JSON NOT NULL,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE,
  FOREIGN KEY (party_id) REFERENCES registered_parties(id)
) ENGINE=InnoDB;
