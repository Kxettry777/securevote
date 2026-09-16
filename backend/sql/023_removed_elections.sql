CREATE TABLE IF NOT EXISTS removed_elections (
  election_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  removed_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  removed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (election_id) REFERENCES elections(id),
  FOREIGN KEY (removed_by) REFERENCES users(id)
) ENGINE=InnoDB;
