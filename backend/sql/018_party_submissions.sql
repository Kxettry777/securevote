CREATE TABLE IF NOT EXISTS party_submissions (
  party_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  submitted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (party_id) REFERENCES registered_parties(id)
) ENGINE=InnoDB;
