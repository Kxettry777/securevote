CREATE TABLE IF NOT EXISTS party_accounts (
  party_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  FOREIGN KEY (party_id) REFERENCES registered_parties(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
