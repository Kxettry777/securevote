CREATE TABLE IF NOT EXISTS deleted_parties (
  party_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  deleted_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  deleted_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (party_id) REFERENCES registered_parties(id),
  FOREIGN KEY (deleted_by) REFERENCES users(id)
) ENGINE=InnoDB;
