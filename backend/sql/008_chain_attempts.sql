CREATE TABLE IF NOT EXISTS chain_attempts (
  transaction_hash CHAR(66) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  election_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind ENUM('election', 'ballot') NOT NULL,
  nonce BIGINT UNSIGNED NOT NULL,
  status ENUM('pending', 'confirmed', 'failed') NOT NULL DEFAULT 'pending',
  block_number BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY attempt_election_status (election_id, status),
  CONSTRAINT attempt_election_fk FOREIGN KEY (election_id) REFERENCES elections(id)
) ENGINE=InnoDB;
