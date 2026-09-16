CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  action VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  election_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY audit_election (election_id, id),
  CONSTRAINT audit_actor_fk FOREIGN KEY (actor_id) REFERENCES users(id)
) ENGINE=InnoDB;
