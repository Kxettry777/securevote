CREATE TABLE IF NOT EXISTS chain_transactions (
  job_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  election_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind ENUM('election', 'ballot') NOT NULL,
  nonce BIGINT UNSIGNED NOT NULL,
  transaction_hash CHAR(66) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  raw_transaction MEDIUMTEXT CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status ENUM('pending', 'confirmed', 'failed') NOT NULL DEFAULT 'pending',
  block_number BIGINT UNSIGNED NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY chain_nonce_unique (nonce),
  UNIQUE KEY chain_hash_unique (transaction_hash),
  KEY chain_election_status (election_id, status),
  CONSTRAINT transaction_election_fk FOREIGN KEY (election_id) REFERENCES elections(id)
) ENGINE=InnoDB;
